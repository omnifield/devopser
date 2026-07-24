// @omnifield/skeleton — прог init/drift против temp-репо (Docker в сессии недоступен,
// [[no-docker-in-session]] — доказываем формой материализации/дрейфа; живой devbox-провижн
// доказывает ревьюер). Ядро теста — «манифест = источник рамки» (DEVOPSER-97): состав
// managed/init-only/CI берётся из template.json, init.mjs его исполняет.
//   node --test
//
// НЕ публикуется (нет в package.json files[]).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPrArgs,
  buildRepoSettings,
  buildRulesetSpec,
  diffRepoSettings,
  diffRulesets,
  dispatch,
  isStackCiCheck,
  mergeFlag,
  resolvePreset,
  validateBranchName,
  validateCommitMessage,
} from "./files/git-flow.mjs";

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const INIT = join(PKG_DIR, "init.mjs");
const TEMPLATE = JSON.parse(readFileSync(join(PKG_DIR, "template.json"), "utf8"));

// Запуск init.mjs как процесса (тот же путь, что reusable CI / продукт-репо).
// mkdtemp → basename не совпадёт с repo-flow.json → фолбэк-детект по фактам (детерминизм).
function run(target, ...args) {
  return spawnSync(process.execPath, [INIT, ...args, target], { encoding: "utf8" });
}
function mkRepo() {
  return mkdtempSync(join(tmpdir(), "skel-"));
}

// --- Рамка объявлена манифестом (форма контракта) ----------------------------

test("template.json объявляет managed-набор непустым, каждый пункт = {src,dest}", () => {
  assert.ok(Array.isArray(TEMPLATE.managed) && TEMPLATE.managed.length > 0);
  for (const m of TEMPLATE.managed) {
    assert.equal(typeof m.src, "string");
    assert.equal(typeof m.dest, "string");
  }
});

test("template.json объявляет per-stack templates (common/node/go/python) и CI-jobs (go/node/frontend/python)", () => {
  assert.ok(Array.isArray(TEMPLATE.templates.common));
  assert.ok(Array.isArray(TEMPLATE.templates.node));
  assert.ok(Array.isArray(TEMPLATE.templates.go));
  assert.ok(Array.isArray(TEMPLATE.templates.python), "python-шаблоны объявлены (DEVOPSER-159)");
  for (const s of ["go", "node", "frontend", "python"]) {
    assert.equal(typeof TEMPLATE.ci.jobs[s].name, "string");
    assert.equal(typeof TEMPLATE.ci.jobs[s].reusable, "string");
  }
  // python-caller → python-ci.yml (job-имя 'python' → check-run 'python / …', stack-CI git-flow).
  assert.equal(TEMPLATE.ci.jobs.python.name, "python");
  assert.equal(TEMPLATE.ci.jobs.python.reusable, "python-ci.yml");
});

test("init.mjs ЧИТАЕТ template.json, а не хардкодит рамку (extract, не rewrite)", () => {
  const src = readFileSync(INIT, "utf8");
  assert.match(src, /template\.json/, "init.mjs должен читать template.json");
  // Рамка не пере-захардкожена массивами обратно в init.mjs.
  assert.doesNotMatch(src, /const MANAGED = \[/, "MANAGED не должен быть литералом-массивом");
});

// --- init материализует РОВНО объявленное манифестом --------------------------

test("init (node-стек по дефолту): каждый managed-dest из манифеста создан; .sh — 0755", () => {
  const repo = mkRepo();
  try {
    const r = run(repo); // пустой репо → detectStacks → ['node']
    assert.equal(r.status, 0, r.stderr);
    for (const { dest, exec } of TEMPLATE.managed) {
      const p = join(repo, dest);
      assert.ok(existsSync(p), `managed ${dest} должен быть создан`);
      if (exec) assert.equal(statSync(p).mode & 0o777, 0o755, `${dest} exec-бит 0755`);
    }
    // node-templates + CI-caller'ы (node job) — тоже из манифеста.
    for (const { dest } of [...TEMPLATE.templates.common, ...TEMPLATE.templates.node]) {
      assert.ok(existsSync(join(repo, dest)), `init-only ${dest} создан`);
    }
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.match(
      ci,
      new RegExp(TEMPLATE.ci.jobs.node.reusable),
      "ci.yml несёт node-caller из манифеста",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// DEVOPSER-131: голый репо без объявленного стека → node-дефолт НЕ молча (loud WARN в stderr).
test("init (голый репо): loud WARN про необъявленный стек в stderr, node-дефолт сохранён", () => {
  const repo = mkRepo();
  try {
    const r = run(repo); // нет go.mod/package.json, basename≠repo-flow → detectStacks фолбэк
    assert.equal(r.status, 0, r.stderr); // node-дефолт: init всё равно проходит (обратная совм.)
    assert.match(r.stderr, /стек.*не объявлен/i, "видимый WARN про необъявленный стек");
    assert.match(r.stderr, /repo-flow\.json|go\.mod|package\.json/, "WARN подсказывает как объявить");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("init (go.mod): стек детектится → БЕЗ warn про необъявленный стек", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n");
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /стек.*не объявлен/i, "объявленный стек → без WARN");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("init (go-стек): go-templates из манифеста созданы, go-caller в ci.yml", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // → detectStacks → ['go']
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    for (const { dest } of TEMPLATE.templates.go) {
      assert.ok(existsSync(join(repo, dest)), `go init-only ${dest} создан`);
    }
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.match(ci, new RegExp(TEMPLATE.ci.jobs.go.reusable), "ci.yml несёт go-caller");
    // go-репо не несёт node-пресеты (nx/biome) — разведение стеков сохранено.
    assert.ok(!existsSync(join(repo, "nx.json")), "go-репо без nx.json");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-159: first-class python-стек (детект + полиглот + backward-compat) ----------

test("init (python-стек): pyproject.toml → детект python (без warn), py-templates + python-caller", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "pyproject.toml"), "[project]\nname = 'x'\n"); // → detectStacks → ['python']
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /стек: \[python\]/, "pyproject → стек python");
    assert.doesNotMatch(r.stderr, /стек.*не объявлен/i, "объявленный py-стек → без WARN про стек");
    // seed-канон python из манифеста.
    for (const { dest } of TEMPLATE.templates.python)
      assert.ok(existsSync(join(repo, dest)), `python init-only ${dest} создан`);
    const pv = readFileSync(join(repo, ".python-version"), "utf8").trim();
    assert.equal(pv, "3.12", ".python-version = 3.12 (канон brainer)");
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.match(ci, /python-ci\.yml/, "ci.yml несёт python-caller");
    // python-репо не тянет node-пресеты (nx/biome) — стеки разведены.
    assert.ok(!existsSync(join(repo, "nx.json")), "python-only без nx.json");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("init (python-стек): uv.lock тоже детектит python (без pyproject у детекта нет записи)", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "uv.lock"), "version = 1\n"); // uv.lock → python
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /стек: \[python\]/, "uv.lock → стек python");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("init (полиглот node+python): pyproject + package.json → ОБА стека, ОБА caller'а (DEVOPSER-159)", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "package.json"), '{ "name": "x" }\n');
    writeFileSync(join(repo, "pyproject.toml"), "[project]\nname = 'x'\n");
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /стек: \[node, python\]/, "полиглот node+python (стеки не взаимоисключают)");
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.match(ci, /node-ci\.yml/, "ci.yml несёт node-caller");
    assert.match(ci, /python-ci\.yml/, "ci.yml несёт python-caller");
    // node-набор (nx/biome) присутствует; python-канон тоже.
    assert.ok(existsSync(join(repo, "nx.json")), "node-часть → nx.json");
    assert.ok(existsSync(join(repo, "pyproject.toml")), "python-часть → pyproject.toml");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("backward-compat: go-only не тянет python (ни pyproject-seed, ни python-caller); drift чист", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // go-only
    assert.equal(run(repo).status, 0);
    // go детект НЕ создаёт pyproject.toml (иначе следующий прогон ложно детектил бы python).
    for (const { dest } of TEMPLATE.templates.python)
      assert.ok(!existsSync(join(repo, dest)), `go-only без python-seed ${dest}`);
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.doesNotMatch(ci, /python-ci\.yml/, "go-only ci.yml без python-caller");
    assert.equal(run(repo, "--check").status, 0, "go-only drift чист (python аддитивен)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("backward-compat: node-only не тянет python-caller/seed", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0); // пустой → node-дефолт
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.doesNotMatch(ci, /python-ci\.yml/, "node-only ci.yml без python-caller");
    assert.ok(!existsSync(join(repo, ".python-version")), "node-only без .python-version");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("python seed-канон: pyproject-шаблон несёт ruff-правила + uv-пин (промоушен факта brainer)", () => {
  const tpl = readFileSync(join(PKG_DIR, "files/python/pyproject-template.toml"), "utf8");
  assert.match(tpl, /\[tool\.ruff\]/, "ruff-конфиг присутствует");
  assert.match(tpl, /line-length\s*=\s*120/, "ruff line-length 120 (канон brainer)");
  assert.match(tpl, /target-version\s*=\s*"py312"/, "ruff target py312");
  assert.match(tpl, /select\s*=\s*\[.*"E".*"F".*"W".*"I".*"UP".*"B".*\]/, "ruff select E/F/W/I/UP/B");
  assert.match(tpl, /required-version/, "uv-пин (toolchain-pin, читается version-file'ом CI)");
});

// --- DEVOPSER-44/45: devcontainer IDE-канон + стек-чистота (ноль node-утечек в go) --------

const REPO_ROOT = join(PKG_DIR, "..", "..");
const readDevcontainer = (repo) =>
  JSON.parse(readFileSync(join(repo, ".devcontainer/devcontainer.json"), "utf8"));

test("devcontainer несёт IDE-канон customizations.vscode (biome-форматтер, formatOnSave) — DEVOPSER-44", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const vs = readDevcontainer(repo).customizations?.vscode;
    assert.ok(vs, "customizations.vscode присутствует");
    assert.ok(vs.extensions.includes("biomejs.biome"), "biome-расширение в extensions");
    assert.equal(vs.settings["editor.formatOnSave"], true, "formatOnSave включён");
    assert.equal(vs.settings["[typescript]"]["editor.defaultFormatter"], "biomejs.biome");
    assert.equal(vs.settings["typescript.tsdk"], "node_modules/typescript/lib");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("node-devcontainer: postCreate несёт npm-whoami-гейт + pnpm install; .husky создан (без регрессий)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0); // пустой → node
    const dc = readDevcontainer(repo);
    assert.match(dc.postCreateCommand, /npm whoami/, "node: npm-whoami-гейт присутствует");
    assert.match(dc.postCreateCommand, /pnpm install/, "node: pnpm install присутствует");
    assert.ok(existsSync(join(repo, ".husky/pre-commit")), "node: .husky/pre-commit создан");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("go-only devcontainer: НОЛЬ node-утечек (нет npm-whoami/pnpm), .husky не создан — DEVOPSER-45", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // → go-only
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    assert.doesNotMatch(dc.postCreateCommand, /npm whoami/, "go: без npm-whoami-гейта");
    // pnpm/store-mount (chown) — общая инфра, ок; утечка = pnpm install (node-тулинг).
    assert.doesNotMatch(dc.postCreateCommand, /pnpm install/, "go: без pnpm install");
    assert.doesNotMatch(dc.postCreateCommand, /pnpm -C/, "go: без pnpm -C воркдир-инсталла");
    assert.ok(!existsSync(join(repo, ".husky/pre-commit")), "go: .husky/pre-commit НЕ создан (nx-хуки node-only)");
    assert.ok(!existsSync(join(repo, ".husky/pre-push")), "go: .husky/pre-push НЕ создан");
    // Стек-чистый шаблон — валидный drift-check (нет husky-дрейфа на go).
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stdout + c.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("frontend-devcontainer: pnpm-воркдир из repo-flow (не хардкод), npm-whoami есть, husky нет — DEVOPSER-45", () => {
  const base = mkRepo();
  const repo = join(base, "chater"); // basename → repo-flow.json[chater] = go+frontend, workdir web
  mkdirSync(repo, { recursive: true });
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /стек: \[go, frontend\]/, "repo-flow дал go+frontend");
    const dc = readDevcontainer(repo);
    assert.match(dc.postCreateCommand, /pnpm -C web install/, "frontend: pnpm-воркдир из repo-flow (web)");
    assert.match(dc.postCreateCommand, /npm whoami/, "frontend: npm-whoami-гейт (тянет @omnifield-пресеты)");
    assert.ok(!existsSync(join(repo, ".husky/pre-commit")), "go+frontend: husky нет (node-only)");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- DEVOPSER-187/188: volume-native devcontainer (secrets/pnpm/env) + merge-каскад --------

const FRAGMENT = () =>
  JSON.parse(readFileSync(join(PKG_DIR, "files/devcontainer-fragment.json"), "utf8"));

test("devcontainer seed = volume-native полный: secrets/pnpm/registry mounts + env-wiring + --add-host; host-bind/network НЕ в манифесте (DEVOPSER-187)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    // containerEnv-полнота (секрет-модель): канон-переменные наведены на secret-volume.
    for (const k of Object.keys(FRAGMENT().containerEnv))
      assert.match(dc.containerEnv[k], /^\/home\/vscode\/\.secrets/, `containerEnv.${k} → secret-volume`);
    const mstr = JSON.stringify(dc.mounts);
    assert.match(mstr, /omnifield-secrets/, "secrets-mount присутствует");
    assert.match(mstr, /omnifield-pnpm-store/, "pnpm-store-mount присутствует");
    assert.match(mstr, /omnifield-registry/, "registry-mount присутствует");
    assert.deepEqual(dc.runArgs, ["--add-host=host.docker.internal:host-gateway"], "runArgs = только --add-host");
    // network/alias/restart и host-bind workspace — НЕ в манифесте (ставит провизионер devbox.sh).
    assert.ok(!("initializeCommand" in dc), "initializeCommand (network create) НЕ в манифесте — провизионер");
    assert.ok(!dc.runArgs.some((a) => /--network/.test(a)), "--network НЕ в манифесте");
    assert.ok(!("workspaceMount" in dc), "workspaceMount (host-bind) убран — workspace = том провизионера");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge-фрагмент = значения seed → на чистом init merge no-op, --check чист (DEVOPSER-187)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    const frag = FRAGMENT();
    // Каждый лист фрагмента уже присутствует в seed-материализации (иначе merge дрейфил бы сразу).
    assert.deepEqual(dc.runArgs, frag.runArgs, "runArgs фрагмента == seed");
    assert.deepEqual(dc.mounts, frag.mounts, "mounts фрагмента == seed (порядок/строки)");
    for (const [k, v] of Object.entries(frag.containerEnv))
      assert.equal(dc.containerEnv[k], v, `containerEnv.${k} фрагмента == seed`);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stdout + c.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge-каскад: стоячий манифест без secrets-mount/env → --check краснеет → init синкает (DEVOPSER-187)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    // Симулируем УСТАРЕВШИЙ потребитель (рассинхрон «манифест ↔ живой контейнер», гага DEVOPSER-188):
    // выкидываем канон-инфру, сохраняя продукт-ключи (image/postCreate/customizations).
    const dc = readDevcontainer(repo);
    delete dc.containerEnv;
    dc.mounts = ["source=omnifield-pnpm-store,target=/home/vscode/.local/share/pnpm/store,type=volume"];
    const custom = "my-product-value";
    dc.image = custom; // продукт-ключ, merge его НЕ трогает
    writeFileSync(join(repo, ".devcontainer/devcontainer.json"), `${JSON.stringify(dc, null, 2)}\n`);
    // drift-check краснеет на отсутствующем managed-фрагменте.
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "неполный манифест → exit 1");
    assert.match(c.stderr, /devcontainer\.json/, "drift называет devcontainer.json");
    // init синкает фрагмент обратно, СОХРАНЯЯ продукт-ключи (deep-merge, не overwrite).
    assert.equal(run(repo).status, 0);
    const fixed = readDevcontainer(repo);
    assert.equal(fixed.containerEnv.CLAUDE_CONFIG_DIR, "/home/vscode/.secrets/claude", "env-wiring восстановлен");
    assert.match(JSON.stringify(fixed.mounts), /omnifield-secrets/, "secrets-mount восстановлен");
    assert.equal(fixed.image, custom, "продукт-ключ image сохранён (merge, не overwrite)");
    assert.equal(run(repo, "--check").status, 0, "после синка --check чист");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("recover.sh — managed exact exec (создан, 0755); devbox.sh volume-модель (DEVOPSER-188)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const rp = join(repo, "scripts/recover.sh");
    assert.ok(existsSync(rp), "scripts/recover.sh материализован");
    assert.equal(statSync(rp).mode & 0o777, 0o755, "recover.sh exec-бит 0755");
    // recover.sh объявлен managed exact exec в манифесте рамки.
    const e = TEMPLATE.managed.find((m) => m.dest === "scripts/recover.sh");
    assert.ok(e && e.mode === "exact" && e.exec === true, "recover.sh = managed exact exec");
    // devbox.sh переведён на named-volume workspace + fail-loud guard (DEVOPSER-188).
    const devbox = readFileSync(join(repo, "scripts/devbox.sh"), "utf8");
    assert.match(devbox, /WORKSPACE_VOLUME=/, "devbox.sh: workspace = named-volume");
    assert.match(devbox, /guard_workspace/, "devbox.sh: fail-loud ext4-guard присутствует");
    assert.doesNotMatch(devbox, /type=bind,source=\$REPO_ROOT/, "host-bind $REPO_ROOT убран");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-192: bootstrap clone/chown под root (-u 0) — свежий том root-owned ------------

test("devbox.sh: оба bootstrap-run (clone+chown) под root (-u 0); финальный create — юзер образа (DEVOPSER-192)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0); // материализует scripts/devbox.sh + .devcontainer (эмиттер-манифест)
    // Гоняем РЕАЛЬНЫЙ материализованный devbox.sh в DRY (docker не исполняется; user-флаг виден в печати).
    const r = spawnSync("sh", [join(repo, "scripts/devbox.sh"), "up", "testrepo"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DEVBOX_DRY_RUN: "1", DEVBOX_EMITTER_LOCAL: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stderr.split("\n"); // dry-печать docker-команд → stderr
    // git-clone bootstrap-run под root: свежий named-том root-owned, 1000 не пишет (Permission denied).
    const clone = lines.find((l) => l.includes("git clone"));
    assert.ok(clone, "clone-команда напечатана");
    assert.match(clone, /docker run --rm -u 0\b/, "clone bootstrap-run под -u 0");
    // chown bootstrap-run под root: 1000 не chown'ит root-owned клон.
    const chown = lines.find((l) => l.includes("chown -R 1000:1000"));
    assert.ok(chown, "chown-команда напечатана");
    assert.match(chown, /docker run --rm -u 0\b/, "chown bootstrap-run под -u 0");
    // Финальный create — БЕЗ -u 0 (юзер образа vscode; файлы уже 1000-owned после chown).
    const create = lines.find((l) => l.includes("docker create"));
    assert.ok(create, "create-команда напечатана");
    assert.doesNotMatch(create, /\s-u 0\b/, "финальный docker create — дефолтный юзер образа (без -u 0)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-191: mode:merge array-UNION для co-owned mounts/runArgs -----------------------

test("merge union: продукт-mount/runArg сохраняются, managed канон энфорсится (DEVOPSER-191)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0); // seed+merge → канон mounts/runArgs
    const dc = readDevcontainer(repo);
    // Продукт добавляет свой data-mount + runArg (живой кейс tasker-data), сохраняя канон.
    dc.mounts.push("source=tasker-data,target=/data/tasker,type=volume");
    dc.runArgs.push("--shm-size=2g");
    writeFileSync(join(repo, ".devcontainer/devcontainer.json"), `${JSON.stringify(dc, null, 2)}\n`);
    // --check: продукт-элементы НЕ дрейф (managed present) → чисто.
    assert.equal(run(repo, "--check").status, 0, "продукт-mount/runArg не краснит drift");
    // init идемпотентен: продукт сохранён + канон на месте.
    assert.equal(run(repo).status, 0);
    const after = readDevcontainer(repo);
    const mstr = JSON.stringify(after.mounts);
    assert.match(mstr, /tasker-data/, "продукт-mount сохранён (union, НЕ replace)");
    assert.match(mstr, /omnifield-secrets/, "managed secrets-mount на месте");
    assert.ok(after.runArgs.includes("--shm-size=2g"), "продукт-runArg сохранён");
    assert.ok(
      after.runArgs.includes("--add-host=host.docker.internal:host-gateway"),
      "managed --add-host на месте",
    );
    assert.equal(run(repo, "--check").status, 0, "после init повторный --check чист (идемпотентно)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge union: отсутствие managed-mount краснит; init восстанавливает, продукт цел (DEVOPSER-191)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    // Продукт-mount есть, но канон secrets/registry выкинуты (стоячий/адоптящий манифест).
    dc.mounts = [
      "source=omnifield-pnpm-store,target=/home/vscode/.local/share/pnpm/store,type=volume",
      "source=tasker-data,target=/data/tasker,type=volume",
    ];
    writeFileSync(join(repo, ".devcontainer/devcontainer.json"), `${JSON.stringify(dc, null, 2)}\n`);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "отсутствие managed-mount → drift red");
    assert.match(c.stderr, /devcontainer\.json/, "drift называет devcontainer.json");
    // init восстанавливает managed (secrets/registry), СОХРАНЯЯ продукт tasker-data.
    assert.equal(run(repo).status, 0);
    const mstr = JSON.stringify(readDevcontainer(repo).mounts);
    assert.match(mstr, /omnifield-secrets/, "secrets восстановлен");
    assert.match(mstr, /omnifield-registry/, "registry восстановлен");
    assert.match(mstr, /tasker-data/, "продукт tasker-data сохранён при восстановлении");
    assert.equal(run(repo, "--check").status, 0, "после init drift чист");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge union: совпадение target → managed-форма авторитетна (энфорс канон-mount) DEVOPSER-191", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    // Потребитель испортил канон secrets-mount (ТОТ ЖЕ target, кривой source/type) → managed энфорсит.
    dc.mounts = dc.mounts.map((m) =>
      m.includes("target=/home/vscode/.secrets")
        ? "source=WRONG,target=/home/vscode/.secrets,type=bind"
        : m,
    );
    writeFileSync(join(repo, ".devcontainer/devcontainer.json"), `${JSON.stringify(dc, null, 2)}\n`);
    assert.equal(run(repo, "--check").status, 1, "кривой managed-mount (тот же target) → drift");
    assert.equal(run(repo).status, 0);
    const mstr = JSON.stringify(readDevcontainer(repo).mounts);
    assert.match(mstr, /source=omnifield-secrets,target=\/home\/vscode\/\.secrets/, "канон-форма энфорснута");
    assert.doesNotMatch(mstr, /WRONG/, "кривой source вытеснен managed-формой (union по target)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge union: containerEnv-ключи — прежний replace-лист (НЕ union); managed авторитетен, продукт цел (DEVOPSER-191)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const dc = readDevcontainer(repo);
    dc.containerEnv.CLAUDE_CONFIG_DIR = "/wrong/path"; // managed-лист уехал
    dc.containerEnv.PRODUCT_ENV = "keep"; // продукт-ключ (object-merge сохраняет)
    writeFileSync(join(repo, ".devcontainer/devcontainer.json"), `${JSON.stringify(dc, null, 2)}\n`);
    assert.equal(run(repo, "--check").status, 1, "уехавший managed containerEnv-ключ → drift (replace-лист)");
    assert.equal(run(repo).status, 0);
    const env = readDevcontainer(repo).containerEnv;
    assert.equal(env.CLAUDE_CONFIG_DIR, "/home/vscode/.secrets/claude", "managed-лист replace (авторитетен)");
    assert.equal(env.PRODUCT_ENV, "keep", "продукт-env-ключ сохранён (object deep-merge, не union/replace массива)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-53: gitleaks — единая точка пина, composite вместо 6× inline-curl ------------

const CI_WORKFLOWS = ["web-ci.yml", "node-ci.yml", "go-ci.yml", "python-ci.yml"];

test("gitleaks: 3 reusable-воркфлоу зовут composite (ноль inline-curl-пина) — DEVOPSER-53", () => {
  for (const wf of CI_WORKFLOWS) {
    const src = readFileSync(join(REPO_ROOT, ".github/workflows", wf), "utf8");
    assert.match(
      src,
      /uses:\s*omnifield\/devopser\/\.github\/actions\/gitleaks@main/,
      `${wf} зовёт composite gitleaks`,
    );
    assert.doesNotMatch(src, /releases\/download\/v8\.30\.1/, `${wf} без inline-пина версии gitleaks`);
  }
});

test("gitleaks composite: версия запинена ровно 1× + поведение секрет-скана сохранено — DEVOPSER-53", () => {
  const src = readFileSync(join(REPO_ROOT, ".github/actions/gitleaks/action.yml"), "utf8");
  assert.equal((src.match(/8\.30\.1/g) ?? []).length, 1, "версия gitleaks — ЕДИНАЯ точка пина");
  assert.match(
    src,
    /gitleaks detect --source \. --redact --no-banner/,
    "поведение секрет-скана (от корня, --redact) сохранено",
  );
});

// --- DEVOPSER-54: web/frontend-caller требует packages:read (README = реальность) ---------

test("frontend-caller ci.yml: permissions включают packages:read, но НЕ actions (README:221) — DEVOPSER-54", () => {
  const base = mkRepo();
  const repo = join(base, "chater"); // go+frontend (без node) → contents+packages, без actions
  mkdirSync(repo, { recursive: true });
  try {
    assert.equal(run(repo).status, 0);
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    assert.match(ci, /packages: read/, "frontend-caller несёт packages:read (тянет @omnifield-пресеты)");
    assert.doesNotMatch(ci, /actions: read/, "go+frontend без node → без actions:read");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- drift-check исполняет рамку из манифеста ----------------------------------

test("--check после init: чисто (exit 0)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stdout + c.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--check краснеет на дрейфе managed-файла из манифеста (уехать нельзя)", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const victim = TEMPLATE.managed[0].dest; // .editorconfig
    writeFileSync(join(repo, victim), "// drifted\n");
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "дрейф managed → exit 1");
    assert.match(c.stderr, new RegExp(victim.replace(".", "\\.")), "дрейф называет уехавший файл");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--check не считает дрейфом правку init-only шаблона (сид, репо легитимно правит)", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // biome.json = init-only (в templates.node, не в managed) → правка легитимна.
    writeFileSync(join(repo, "biome.json"), '{ "extends": "local" }\n');
    const c = run(repo, "--check");
    assert.equal(c.status, 0, "правка init-only не должна валить drift-check");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Пресет-контракт (DEVOPSER-98): пресет = дефолты внутри рамки --------------

const PRESET_PKG = (name) =>
  JSON.parse(readFileSync(join(PKG_DIR, "..", name, "package.json"), "utf8"));

test("каждый пресет объявляет метаданные omnifield (kind/slot/stack/mechanism)", () => {
  for (const name of ["nx-preset", "biome-preset", "vite-preset"]) {
    const o = PRESET_PKG(name).omnifield;
    assert.ok(o, `${name}: блок omnifield обязателен`);
    assert.equal(o.kind, "preset");
    for (const k of ["slot", "stack", "mechanism"]) {
      assert.equal(typeof o[k], "string", `${name}.omnifield.${k} = string`);
    }
  }
});

test("template.json биндит слот → @omnifield/X-preset@^ver; slot совпал с метаданными пресета", () => {
  const presets = TEMPLATE.presets;
  assert.ok(presets, "template.json должен нести биндинг presets");
  const slotToLocal = { nx: "nx-preset", biome: "biome-preset", vite: "vite-preset" };
  for (const [slot, ref] of Object.entries(presets)) {
    if (slot.startsWith("$")) continue;
    // форма name@version (scoped: версия после последнего @).
    const at = ref.lastIndexOf("@");
    assert.ok(at > 0, `биндинг '${slot}' = '${ref}' должен нести версию`);
    const pkg = ref.slice(0, at);
    assert.match(ref.slice(at + 1), /^[\^~]?\d/, `версия в '${ref}'`);
    // slot биндинга == slot, объявленный пресетом (source-of-frame: DEVOPSER-95/108).
    const meta = PRESET_PKG(slotToLocal[slot]).omnifield;
    assert.equal(pkg, `@omnifield/${slotToLocal[slot]}`, `биндинг '${slot}' → правильный пакет`);
    assert.equal(meta.slot, slot, `пресет ${pkg} объявляет slot '${slot}'`);
  }
});

test("пресет ВНЕ рамки → loud-fail (node-пресет на go-репо)", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // стек репо = [go]
    run(repo);
    // Симулируем дрейф: в go-репо появился nx.json (тянет node-пресет @omnifield/nx-preset).
    writeFileSync(join(repo, "nx.json"), '{ "extends": "@omnifield/nx-preset/nx.json" }\n');
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "node-пресет на go-репо → exit 1");
    assert.match(c.stderr, /вне рамки/, "loud-fail называет выход за рамку");
    assert.match(c.stderr, /nx-preset/, "ошибка называет пресет");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("пресет В рамке → ok (node-пресет на node-репо; preset-check не срабатывает)", () => {
  const repo = mkRepo();
  try {
    const r = run(repo); // node-стек по дефолту → nx.json/biome.json из node-пресетов
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(repo, "nx.json")));
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stderr);
    assert.doesNotMatch(c.stderr, /вне рамки/, "пресет в рамке — без preset-fail");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Apply-режимы (DEVOPSER-99): mode объявлен + диспатчится -------------------

const MODES = new Set(["exact", "seed", "block", "pins", "merge"]);
const allFrameEntries = () => [
  ...TEMPLATE.managed,
  ...TEMPLATE.block,
  ...(TEMPLATE.merge ?? []),
  ...TEMPLATE.pins,
  ...TEMPLATE.templates.common,
  ...TEMPLATE.templates.node,
  ...TEMPLATE.templates.go,
  ...TEMPLATE.templates.python,
];

test("каждая frame-запись объявляет валидный mode (exact|seed|block|pins|merge)", () => {
  for (const e of allFrameEntries()) {
    assert.ok(MODES.has(e.mode), `запись ${e.dest}: mode '${e.mode}' вне {exact,seed,block,pins,merge}`);
  }
  // Ожидаемая раскладка режимов по группам (рамка enforced vs сид).
  assert.ok(
    TEMPLATE.managed.every((e) => e.mode === "exact"),
    "managed = exact",
  );
  for (const g of ["common", "node", "go", "python"])
    assert.ok(
      TEMPLATE.templates[g].every((e) => e.mode === "seed"),
      `templates.${g} = seed`,
    );
});

test(".gitignore задекларирован block, package.json-пины — pins (не хардкод)", () => {
  const gi = TEMPLATE.block.find((e) => e.dest === ".gitignore");
  assert.ok(gi && gi.mode === "block" && gi.src === "gitignore-block", ".gitignore = block");
  const pins = TEMPLATE.pins.find((e) => e.dest === "package.json");
  assert.ok(pins && pins.mode === "pins" && pins.stack === "node", "package.json = pins (node)");
});

test("mode block диспатчится: .gitignore splice вставляет managed-блок, СОХРАНЯЯ строки репо", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, ".gitignore"), "# repo-свой\n/local-only\n");
    assert.equal(run(repo).status, 0);
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    assert.match(gi, /omnifield-skeleton/, "managed-блок вставлен (block-хендлер)");
    assert.match(gi, /\/local-only/, "строки репо сохранены (splice, не overwrite)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("mode pins диспатчится: package.json merge чинит пины, СОХРАНЯЯ прочие ключи", () => {
  const repo = mkRepo();
  try {
    const tpl = JSON.parse(readFileSync(join(PKG_DIR, "files/package-template.json"), "utf8"));
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "x", packageManager: "npm@1.0.0", scripts: { foo: "bar" } }, null, 2)}\n`,
    );
    assert.equal(run(repo).status, 0); // node-стек по дефолту
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.equal(pkg.packageManager, tpl.packageManager, "packageManager подтянут к эталону");
    assert.equal(pkg.engines.node, tpl.engines.node, "engines.node подтянут");
    assert.equal(
      pkg.scripts.foo,
      "bar",
      "прочие ключи package.json сохранены (merge, не overwrite)",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("mode block/pins дрейфят в --check (managed-часть enforced, как раньше)", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // block: испортить managed-блок .gitignore → дрейф.
    writeFileSync(join(repo, ".gitignore"), "no-block-here\n");
    // pins: сломать пин packageManager → дрейф.
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    pkg.packageManager = "npm@1.0.0";
    writeFileSync(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "block+pins дрейф → exit 1");
    assert.match(c.stderr, /\.gitignore/, "block-дрейф в отчёте");
    assert.match(c.stderr, /package\.json пины/, "pins-дрейф в отчёте");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Версионирование пресетов (DEVOPSER-100): единый источник версий -----------

// Range из биндинга по имени пакета ("@omnifield/nx-preset@^0.1.1" → "^0.1.1").
const bindingRange = (pkgName) => {
  const ref = Object.values(TEMPLATE.presets).find(
    (r) => typeof r === "string" && r.startsWith(`${pkgName}@`),
  );
  return ref.slice(ref.lastIndexOf("@") + 1);
};

test("package-template.json НЕ хардкодит @omnifield ранги (единый источник = биндинг)", () => {
  const tpl = JSON.parse(readFileSync(join(PKG_DIR, "files/package-template.json"), "utf8"));
  for (const [key, range] of Object.entries(tpl.devDependencies ?? {})) {
    if (key.startsWith("@omnifield/"))
      assert.doesNotMatch(range, /\d+\.\d+\.\d+/, `${key}: ранг не должен быть хардкод-семвером`);
  }
});

test("consumer preset-деп дерайвится из биндинга (fresh init → range биндинга, не ^0.1.0)", () => {
  const repo = mkRepo();
  try {
    assert.equal(run(repo).status, 0); // node-стек → создаётся package.json
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.equal(pkg.devDependencies["@omnifield/nx-preset"], bindingRange("@omnifield/nx-preset"));
    assert.equal(
      pkg.devDependencies["@omnifield/biome-preset"],
      bindingRange("@omnifield/biome-preset"),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("биндинг ≠ потребитель → drift-fail; init синкает (propagation через drift-гейт)", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // Симулируем отставшего потребителя: сбить ранг ниже биндинга.
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    pkg.devDependencies["@omnifield/nx-preset"] = "^0.1.0";
    writeFileSync(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "ранг ≠ биндинг → exit 1");
    assert.match(c.stderr, /@omnifield\/nx-preset/, "drift называет preset-деп");
    // init синкает обратно к биндингу.
    assert.equal(run(repo).status, 0);
    const fixed = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.equal(
      fixed.devDependencies["@omnifield/nx-preset"],
      bindingRange("@omnifield/nx-preset"),
    );
    assert.equal(run(repo, "--check").status, 0, "после синка --check чист");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("локальный протокол (workspace:*) НЕ дрейфит (монорепо/линк не версионный пин)", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    pkg.devDependencies["@omnifield/nx-preset"] = "workspace:*";
    writeFileSync(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, "workspace:* не должен считаться дрейфом");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("version-guard: warn, если УСТАНОВЛЕННАЯ версия пресета ниже биндинга", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // Фейковый node_modules с версией ниже биндинга (^0.1.1 → min 0.1.1).
    const nm = join(repo, "node_modules/@omnifield/nx-preset");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "package.json"),
      '{ "name": "@omnifield/nx-preset", "version": "0.1.0" }\n',
    );
    const c = run(repo, "--check");
    assert.match(c.stderr, /preset-version/, "version-guard warn напечатан");
    assert.match(c.stderr, /nx-preset/, "warn называет отставший пресет");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Таргеты пресетов (DEVOPSER-101): категория того, что пресет настраивает ---

test("каждый пресет объявляет target = repo-config", () => {
  for (const name of ["nx-preset", "biome-preset", "vite-preset"]) {
    assert.equal(PRESET_PKG(name).omnifield.target, "repo-config", `${name}.omnifield.target`);
  }
});

test("template.json таксономия: repo-config active, release active, git-flow bound (DEVOPSER-194)", () => {
  const t = TEMPLATE.targets;
  assert.ok(t, "template.json должен нести таксономию targets");
  assert.equal(t["repo-config"], "active");
  assert.equal(t.release, "active"); // managed release-меха (release.yml + publish-idempotent)
  assert.equal(t["git-flow"], "bound"); // пресет привязан (DEVOPSER-103), процессор — следом
});

test("init репортит группировку по target (repo-config: nx,biome,vite; release: active — DEVOPSER-194)", () => {
  const repo = mkRepo();
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[skeleton targets\]/, "репорт по target печатается");
    assert.match(r.stdout, /repo-config: nx, biome, vite/, "repo-config группирует свои slots");
    assert.match(r.stdout, /release: active/, "release активирован (не declared-empty «—»)");
    assert.doesNotMatch(r.stdout, /release: —/, "«release: —» убран (DEVOPSER-194)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-194: release-меха managed, каскадит ВСЕМ репо без стек-гейта (kb:ADR-17) ---------

const RELEASE_DESTS = [
  ".github/workflows/release.yml",
  "scripts/publish-idempotent.mjs",
  "scripts/publish-idempotent.test.mjs",
];

test("release-меха объявлена managed (release.yml + publish-idempotent + тест), без стек-гейта", () => {
  for (const dest of RELEASE_DESTS) {
    const e = TEMPLATE.managed.find((m) => m.dest === dest);
    assert.ok(e, `${dest} объявлен в managed`);
    assert.equal(e.mode, "exact", `${dest} — exact (drift-managed)`);
    assert.ok(!e.stack, `${dest} без стек-гейта (материализуется в любой репо)`);
  }
});

for (const [label, setup] of [
  ["node-корень", () => {}], // пустой репо → node-дефолт
  ["go-корень", (repo) => writeFileSync(join(repo, "go.mod"), "module x\n")],
  ["python-корень", (repo) => writeFileSync(join(repo, "pyproject.toml"), "[project]\nname='x'\n")],
]) {
  test(`release-меха материализована на стеке «${label}» (root-agnostic, DEVOPSER-194)`, () => {
    const repo = mkRepo();
    try {
      setup(repo);
      assert.equal(run(repo).status, 0);
      for (const dest of RELEASE_DESTS)
        assert.ok(existsSync(join(repo, dest)), `${dest} создан на стеке ${label}`);
      // release.yml root-agnostic: пиннит версию, НЕ node-version-file из корня.
      const rel = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
      assert.doesNotMatch(rel, /node-version-file:/, "release.yml не прибит к корневому package.json");
      assert.match(rel, /node-version:\s*22/, "release.yml пиннит node-рантайм явно");
      assert.equal(run(repo, "--check").status, 0, "release-меха drift чист после init");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

// --- DEVOPSER-196: release.yml отвязан от pnpm/action-setup (coupling с корневым packageManager) --
// Регресс 194: `pnpm/action-setup` + version-input падает ERR_PNPM_BAD_PM_VERSION на репо с
// корневым `packageManager`. 194 тестил ЛОГИКУ скана, но НЕ форму setup против packageManager —
// регресс вскрылся только вживую. Этот блок ловит его на `--check`/CI, без живого publish.

test("release.yml НЕ использует pnpm/action-setup; pnpm ставится run-шагом, пин в одной точке (DEVOPSER-196)", () => {
  const rel = readFileSync(join(PKG_DIR, "files", "release.yml"), "utf8");
  assert.doesNotMatch(
    rel,
    /uses:\s*pnpm\/action-setup/,
    "action-setup коллизит с корневым packageManager (ERR_PNPM_BAD_PM_VERSION) — отвязан",
  );
  assert.match(rel, /npm install -g pnpm@/, "pnpm ставится root-agnostic run-шагом (npm -g)");
  // Пин версии pnpm — ЕДИНАЯ точка (env PNPM_VERSION); литерал версии встречается ровно 1×.
  const pin = rel.match(/PNPM_VERSION:\s*([\d.]+)/);
  assert.ok(pin, "версия pnpm пиннится через env PNPM_VERSION");
  assert.equal(
    (rel.match(new RegExp(pin[1].replace(/\./g, "\\."), "g")) ?? []).length,
    1,
    "версия pnpm — единая точка пина (одно вхождение литерала)",
  );
  // Install-if-owning-workspace (вариант A architect): build-bearing пакету нужен install ЕГО
  // workspace. Есть корневой package.json → pnpm install; go-корень-без-него → скип.
  assert.match(rel, /if \[ -f package\.json \]/, "install гейтится наличием корневого node-workspace");
  assert.match(rel, /pnpm install --frozen-lockfile/, "корневой workspace → pnpm install (prepublishOnly-сборка резолвится)");
});

test("release.yml материализуется на node-корне С корневым packageManager без action-setup-конфликта (DEVOPSER-196)", () => {
  const repo = mkRepo();
  try {
    // Точный кейс живого регресса: node-корень с packageManager (раскладка devopser/потребителей).
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "x", packageManager: "pnpm@10.11.0" }, null, 2)}\n`,
    );
    assert.equal(run(repo).status, 0);
    const rel = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
    // Никакого coupling'а setup↔packageManager: pnpm НЕ ставится version-input-экшеном.
    assert.doesNotMatch(rel, /uses:\s*pnpm\/action-setup/, "нет action-setup → нет version↔packageManager конфликта");
    assert.match(rel, /npm install -g pnpm@/, "pnpm ставится packageManager-агностичным run-шагом");
    assert.equal(run(repo, "--check").status, 0, "release-меха drift чист на packageManager-репо");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("пресет с unknown target → loud-fail (target вне таксономии)", () => {
  const repo = mkRepo();
  try {
    run(repo); // node-стек; nx.json присутствует
    // Фейковый node_modules-пресет с валидными slot/stack, но target вне таксономии.
    const nm = join(repo, "node_modules/@omnifield/nx-preset");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "package.json"),
      `${JSON.stringify({
        name: "@omnifield/nx-preset",
        version: "0.1.1",
        omnifield: { kind: "preset", slot: "nx", stack: "node", target: "bogus-target" },
      })}\n`,
    );
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "unknown target → exit 1");
    assert.match(c.stderr, /target 'bogus-target'/, "loud-fail называет неизвестный target");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- git-flow пресет (DEVOPSER-103/-113): вендоренный, language-agnostic --------

// git-flow.json = вендоренный эталон (managed-файл, не npm; DEVOPSER-113).
const GIT_FLOW_JSON = () => JSON.parse(readFileSync(join(PKG_DIR, "files/git-flow.json"), "utf8"));

test("git-flow.json.omnifield: target git-flow, slot git-flow, stack any, mechanism read", () => {
  const o = GIT_FLOW_JSON().omnifield;
  assert.equal(o.kind, "preset");
  assert.equal(o.target, "git-flow");
  assert.equal(o.slot, "git-flow");
  assert.equal(o.stack, "any", "флоу не привязан к стеку");
  assert.equal(o.mechanism, "read", "новый режим потребления (читается тулингом)");
});

test("git-flow.json: frame (frozen) {mainProtected,prRequired} + defaults (overridable)", () => {
  const cfg = GIT_FLOW_JSON();
  assert.equal(cfg.frame.mainProtected, true);
  assert.equal(cfg.frame.prRequired, true);
  for (const k of ["merge", "branchNaming", "requiredChecks", "commitConvention"])
    assert.ok(k in cfg.defaults, `defaults.${k} объявлен (overridable)`);
  // agent-agnostic: ни один КЛЮЧ конфига не про actor/owner/роли/права ($comment-доки исключаем).
  // Проверяем имена полей, не значения (regex-значение с "refactor" — легитимные данные).
  const keys = [];
  const walk = (o) => {
    if (o && typeof o === "object")
      for (const [k, v] of Object.entries(o)) {
        if (k !== "$comment") keys.push(k.toLowerCase());
        walk(v);
      }
  };
  walk(cfg);
  for (const forbidden of ["owner", "role", "actor", "push", "permission", "who"])
    assert.ok(
      !keys.some((k) => k.includes(forbidden)),
      `ни один ключ конфига не про '${forbidden}' (agent-agnostic)`,
    );
});

test("git-flow вендорится managed (не npm); движок валидирует + репортит (DEVOPSER-113)", () => {
  // git-flow БОЛЬШЕ не в presets (npm-биндинг) — доставка вендоренным managed-файлом.
  assert.ok(!("git-flow" in TEMPLATE.presets), "git-flow не npm-пресет");
  assert.ok(
    TEMPLATE.managed.some((m) => m.dest === "git-flow.json" && m.mode === "exact"),
    "git-flow.json — managed вендоренный (mode exact)",
  );
  const repo = mkRepo();
  try {
    run(repo);
    assert.ok(existsSync(join(repo, "git-flow.json")), "git-flow.json вендорится в репо");
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stderr); // git-пресет распознан, в рамке (stack:any) — не валит
    assert.match(c.stdout, /git-flow: git-flow/, "git-flow target группирует свой пресет (bound)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("mechanism-enum: read валиден; unknown mechanism → loud-fail", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // Фейк с валидным target, но mechanism вне enum.
    const nm = join(repo, "node_modules/@omnifield/nx-preset");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      join(nm, "package.json"),
      `${JSON.stringify({
        name: "@omnifield/nx-preset",
        version: "0.1.1",
        omnifield: {
          kind: "preset",
          slot: "nx",
          stack: "node",
          mechanism: "bogus-mech",
          target: "repo-config",
        },
      })}\n`,
    );
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "unknown mechanism → exit 1");
    assert.match(c.stderr, /mechanism 'bogus-mech'/, "loud-fail называет неизвестный mechanism");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- git-инструмент git-flow.mjs (DEVOPSER-106): agent-agnostic, по пресету -----

const GIT_PRESET = resolvePreset(); // вендоренный git-flow.json (эталон files/, DEVOPSER-113)

test("git-flow: go-репо БЕЗ node_modules резолвит вендоренный пресет (language-agnostic)", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // go-стек, нет package.json/node_modules
    assert.equal(run(repo).status, 0); // init вендорит git-flow.json + scripts/git-flow.mjs
    assert.ok(existsSync(join(repo, "git-flow.json")), "git-flow.json вендорен в go-репо");
    assert.ok(!existsSync(join(repo, "node_modules")), "go-репо без node_modules");
    // git-flow.mjs (вендоренный в scripts/) резолвит пресет из локального git-flow.json.
    const r = spawnSync(
      process.execPath,
      [join(repo, "scripts/git-flow.mjs"), "start", "bad name"],
      {
        cwd: repo,
        encoding: "utf8",
      },
    );
    // не «пресет не найден», а валидация имени по вендоренному branchNaming → резолв сработал.
    assert.match(r.stderr, /branchNaming/, "резолв вендоренного пресета сработал (без npm)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Мок-executor: пишет вызовы, отдаёт канон-ответы по префиксу команды (без реального git/gh).
function mockExec(responses = {}) {
  const calls = { git: [], gh: [], log: [] };
  const respond = (bin, args) => {
    const key = `${bin} ${args.join(" ")}`;
    let best = null; // самый длинный совпавший префикс (nested rulesets/{id} vs список)
    for (const [pat, val] of Object.entries(responses))
      if (key.startsWith(pat) && (!best || pat.length > best[0].length)) best = [pat, val];
    return best ? best[1] : { code: 0, out: "", err: "" };
  };
  return {
    calls,
    git: (a) => {
      calls.git.push(a.join(" "));
      return respond("git", a);
    },
    gh: (a) => {
      calls.gh.push(a.join(" "));
      return respond("gh", a);
    },
    log: (m) => calls.log.push(m),
  };
}

test("git-flow: пресет резолвится (frame frozen + defaults overridable)", () => {
  assert.equal(GIT_PRESET.frame.mainProtected, true);
  assert.equal(GIT_PRESET.frame.prRequired, true);
  assert.equal(typeof GIT_PRESET.defaults.merge, "string");
  assert.equal(typeof GIT_PRESET.defaults.branchNaming, "string");
});

test("git-flow: validateBranchName по defaults.branchNaming (valid ok, invalid → throw)", () => {
  const p = GIT_PRESET.defaults.branchNaming;
  assert.equal(validateBranchName("feat/my-slug", p), "feat/my-slug");
  assert.throws(() => validateBranchName("random-branch", p), /branchNaming/);
  assert.throws(() => validateBranchName("feat/BadCaps", p), /branchNaming/);
});

test("git-flow: validateCommitMessage по commitConvention (conventional)", () => {
  const c = GIT_PRESET.defaults.commitConvention;
  // сабж со строчной ASCII — канон (DEVOPSER-130, зеркало pr-title ^[a-z]).
  assert.equal(validateCommitMessage("feat: add feature x", c), "feat: add feature x");
  assert.equal(validateCommitMessage("fix(skeleton): tweak y", c), "fix(skeleton): tweak y");
  assert.throws(() => validateCommitMessage("просто сообщение", c), /conventional/);
});

// DEVOPSER-130: локальный commit-гейт зеркалит CI pr-title.yml subjectPattern ^[a-zа-яё] —
// сабж с ЗАГЛАВНОЙ отвергается тут, а не сюрпризом на land. Строчная Latin И кириллица — ОК
// (ASCII-only ^[a-z] резал русские сабжи, #53 «приземлить»).
test("git-flow: сабж коммита СО СТРОЧНОЙ (^[a-zа-яё], Latin ИЛИ кириллица) — зеркало CI pr-title", () => {
  const c = GIT_PRESET.defaults.commitConvention;
  assert.equal(validateCommitMessage("feat: add x", c), "feat: add x");
  assert.equal(validateCommitMessage("fix(scope): tweak y", c), "fix(scope): tweak y");
  assert.equal(validateCommitMessage("feat: приземлить продукт", c), "feat: приземлить продукт");
  assert.equal(validateCommitMessage("fix(skeleton): ёмкий фикс", c), "fix(skeleton): ёмкий фикс");
  assert.throws(() => validateCommitMessage("feat: Add x", c), /conventional/, "заглавная Latin → reject");
  assert.throws(() => validateCommitMessage("chore: Bump", c), /conventional/);
  assert.throws(() => validateCommitMessage("feat: Приземлить x", c), /conventional/, "заглавная кириллица → reject");
});

test("git-flow: типы commit-regex == pr-title.yml default types (сверка DEVOPSER-130)", () => {
  const c = GIT_PRESET.defaults.commitConvention;
  // 11 типов из pr-title.yml inputs.types.default — каждый проходит локальный гейт.
  const TYPES = ["feat", "fix", "refactor", "docs", "chore", "build", "ci", "test", "perf", "style", "revert"];
  for (const t of TYPES) assert.equal(validateCommitMessage(`${t}: lower subj`, c), `${t}: lower subj`);
  assert.throws(() => validateCommitMessage("bogus: x", c), /conventional/, "неизвестный тип → reject");
});

// DEVOPSER-129: pr ВСЕГДА валидный non-interactive gh (title И body). Матрица.
test("git-flow: buildPrArgs — ноль флагов → --fill (title+body из коммитов)", () => {
  const a = buildPrArgs({}, ["c1"], "feat/x");
  assert.deepEqual(a, ["pr", "create", "--base", "main", "--fill"]);
});

test("git-flow: buildPrArgs — --title без --body → title + derived body из коммитов", () => {
  const a = buildPrArgs({ title: "feat: t" }, ["c1", "c2"], "feat/x");
  assert.deepEqual(a, ["pr", "create", "--base", "main", "--title", "feat: t", "--body", "- c1\n- c2"]);
});

test("git-flow: buildPrArgs — --title без --body и без коммитов → body фолбэк = сам title", () => {
  const a = buildPrArgs({ title: "feat: t" }, [], "feat/x");
  assert.deepEqual(a, ["pr", "create", "--base", "main", "--title", "feat: t", "--body", "feat: t"]);
});

test("git-flow: buildPrArgs — --title + --body → оба явные (без --fill)", () => {
  const a = buildPrArgs({ title: "feat: t", body: "B" }, [], "feat/x");
  assert.deepEqual(a, ["pr", "create", "--base", "main", "--title", "feat: t", "--body", "B"]);
  assert.ok(!a.includes("--fill"), "--fill НЕ мешаем с явным --title");
});

test("git-flow: buildPrArgs — --body без --title → title определён из коммитов (фолбэк branch)", () => {
  assert.deepEqual(
    buildPrArgs({ body: "B" }, ["c1"], "feat/x"),
    ["pr", "create", "--base", "main", "--title", "c1", "--body", "B"],
  );
  // без коммитов → title фолбэк = branch (всегда непусто, инвариант).
  assert.deepEqual(
    buildPrArgs({ body: "B" }, [], "feat/x"),
    ["pr", "create", "--base", "main", "--title", "feat/x", "--body", "B"],
  );
});

test("git-flow: dispatch pr --title без --body → gh-вызов с --title И непустым --body", async () => {
  const ex = mockExec({
    "git rev-parse --abbrev-ref HEAD": { code: 0, out: "feat/x\n", err: "" },
    "git log --reverse": { code: 0, out: "feat: first\nfix: second\n", err: "" },
  });
  await dispatch(["pr", "--title", "feat: t"], ex, GIT_PRESET, {});
  const call = ex.calls.gh.find((c) => c.startsWith("pr create"));
  assert.ok(call, "gh pr create вызван");
  assert.ok(call.includes("--title feat: t"), "явный --title");
  assert.ok(/--body [^]+/.test(call) && call.includes("first"), "непустой --body из коммитов");
  assert.ok(!call.includes("--fill"), "--fill НЕ смешан с --title");
});

test("git-flow: mergeFlag маппит defaults.merge; неизвестный → throw", () => {
  assert.equal(mergeFlag("squash"), "--squash");
  assert.equal(mergeFlag("merge"), "--merge");
  assert.equal(mergeFlag("rebase"), "--rebase");
  assert.throws(() => mergeFlag("fast-forward"), /merge неизвестен/);
});

test("git-flow: frame.mainProtected блокит прямой коммит в main", async () => {
  const ex = mockExec({ "git rev-parse --abbrev-ref HEAD": { code: 0, out: "main\n", err: "" } });
  await assert.rejects(
    dispatch(["commit", "feat: прямой в main"], ex, GIT_PRESET, {}),
    /mainProtected/,
    "commit на main при mainProtected → throw",
  );
  assert.ok(!ex.calls.git.some((c) => c.startsWith("commit")), "коммит НЕ выполнен");
});

test("git-flow: land — auto-merge (PR OPEN → gh pr merge --auto, БЕЗ локального wait/sync) DEVOPSER-157", async () => {
  const ex = mockExec({
    "git rev-parse --abbrev-ref HEAD": { code: 0, out: "feat/x\n", err: "" },
    "gh pr view": { code: 0, out: "OPEN\n", err: "" },
  });
  await dispatch(["land"], ex, GIT_PRESET, {});
  const flag = mergeFlag(GIT_PRESET.defaults.merge);
  assert.ok(
    ex.calls.gh.some((c) => c === `pr merge --auto ${flag} --delete-branch`),
    "gh pr merge --auto по пресету + delete-branch (серверный гейт по required-checks)",
  );
  assert.ok(
    !ex.calls.gh.some((c) => c === "pr checks"),
    "land НЕ поллит checks локально — auto-merge ждёт на сервере",
  );
  assert.ok(
    !ex.calls.git.includes("reset --hard origin/main"),
    "land НЕ синкает main (мерж асинхронный; свежесть — start/sync)",
  );
});

test("git-flow: land требует OPEN PR (frame.prRequired) — нет PR → throw", async () => {
  const ex = mockExec({
    "git rev-parse --abbrev-ref HEAD": { code: 0, out: "feat/x\n", err: "" },
    "gh pr view": { code: 1, out: "", err: "no pull requests found" },
  });
  await assert.rejects(dispatch(["land"], ex, GIT_PRESET, {}), /prRequired/);
  assert.ok(!ex.calls.gh.some((c) => c.startsWith("pr merge")), "merge НЕ вызван без PR");
});

test("git-flow: --dry-run печатает мутации, git/gh НЕ выполняет", async () => {
  const ex = mockExec();
  await dispatch(["start", "feat/foo"], ex, GIT_PRESET, { dry: true });
  assert.equal(ex.calls.git.length, 0, "dry-run: ноль реальных git-вызовов");
  assert.ok(
    ex.calls.log.some((l) => l.includes("[dry-run] git checkout -b feat/foo origin/main")),
    "печатает намеренную мутацию (ветка от origin/main)",
  );
});

test("git-flow: агент-agnostic — в инструменте ноль actor/owner/ролей/gate", () => {
  const src = readFileSync(join(PKG_DIR, "files/git-flow.mjs"), "utf8");
  // Комментарии-доки легитимно называют «agent-agnostic»/«owner/ролей» в дисклеймере —
  // проверяем, что нет КОДА про actor: идентификаторов роли/владельца/гейта.
  for (const forbidden of [/\browner\b/i, /\brole\b/i, /\bgit-gate\b/i, /\bpermission\b/i]) {
    // разрешаем в строках-комментариях disclaimer'а: проверяем именно объявления/обращения.
    const codeLines = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(codeLines, forbidden, `код git-flow.mjs не про ${forbidden}`);
  }
});

// --- Rulesets-материализация (DEVOPSER-110): git-пресет → GitHub-rulesets ------

// Мок check-run/repo окружения для rulesets-пути (DEVOPSER-117: реальные check-run имена).
// reusable-caller'ы GitHub именует '<job> / <inner>' — голых go/web НЕТ.
const REAL_CHECKS = ["go / Go (build·vet·test)", "web / Web (build)"];
const rulesetsEnv = (nwo, extra = {}) => ({
  "gh repo view --json nameWithOwner": { code: 0, out: `${nwo}\n`, err: "" },
  "gh repo view --json defaultBranchRef": { code: 0, out: "main\n", err: "" },
  [`gh api repos/${nwo}/commits/main/check-runs`]: {
    code: 0,
    out: `${REAL_CHECKS.join("\n")}\n`,
    err: "",
  },
  // repo-settings (DEVOPSER-157): по умолчанию мок отдаёт СОВПАДАЮЩИЕ с пресетом настройки →
  // check-режим чист по repo-части (дрейф проверяется отдельным тестом).
  [`gh api repos/${nwo}`]: { code: 0, out: JSON.stringify(buildRepoSettings(GIT_PRESET)), err: "" },
  ...extra,
});

test("git-flow rulesets: buildRulesetSpec из frame+defaults (mainProtected/prRequired/checks)", () => {
  const spec = buildRulesetSpec(GIT_PRESET, ["node"]);
  assert.equal(spec.name, "omnifield-git-flow");
  assert.equal(spec.enforcement, "active");
  assert.deepEqual(spec.conditions.ref_name.include, ["~DEFAULT_BRANCH"]);
  const types = spec.rules.map((r) => r.type);
  assert.ok(
    types.includes("deletion") && types.includes("non_fast_forward"),
    "mainProtected → защита",
  );
  assert.ok(types.includes("pull_request"), "prRequired → require-PR");
  // ПОЛНЫЙ набор pull_request-параметров (GitHub Rulesets API иначе 422; DEVOPSER-116):
  // count + 4 булевых (дефолты сохраняют смысл prRequired — мерж через PR, без обяз. ревью).
  const pr = spec.rules.find((r) => r.type === "pull_request").parameters;
  assert.equal(pr.required_approving_review_count, 0);
  for (const k of [
    "dismiss_stale_reviews_on_push",
    "require_code_owner_review",
    "require_last_push_approval",
    "required_review_thread_resolution",
  ]) {
    assert.strictEqual(pr[k], false, `pull_request.${k} = false`);
  }
  const rsc = spec.rules.find((r) => r.type === "required_status_checks");
  assert.deepEqual(
    rsc.parameters.required_status_checks.map((c) => c.context),
    ["node"],
    "requiredChecks from-stack → контексты из стека",
  );
  // strict OFF (DEVOPSER-157): auto-merge не требует «ветка up-to-date с base».
  assert.strictEqual(rsc.parameters.strict_required_status_checks_policy, false, "strict OFF");
});

test("git-flow rulesets: diffRulesets — отсутствие/дрейф/совпадение", () => {
  const desired = buildRulesetSpec(GIT_PRESET, ["node"]);
  assert.match(diffRulesets(null, desired)[0], /отсутствует/);
  assert.deepEqual(diffRulesets(desired, desired), [], "current==desired → чисто");
  const drifted = buildRulesetSpec(GIT_PRESET, ["go"]); // другой набор checks
  assert.ok(
    diffRulesets(drifted, desired).some((d) => d.startsWith("required_checks")),
    "дрейф checks",
  );
});

test("git-flow rulesets: required-контексты = РЕАЛЬНЫЕ check-run имена, не ключи job'ов (DEVOPSER-117)", async () => {
  // desired строится из фактических check-run'ов ('go / Go …'), а ruleset с ключами [go,web] → дрейф.
  const desired = buildRulesetSpec(GIT_PRESET, REAL_CHECKS);
  const byKeys = buildRulesetSpec(GIT_PRESET, ["go", "web"]); // старое (неверное) поведение
  const ex = mockExec(
    rulesetsEnv("o/r", {
      "gh api repos/o/r/rulesets/9": { code: 0, out: JSON.stringify(byKeys), err: "" },
      "gh api repos/o/r/rulesets": {
        code: 0,
        out: JSON.stringify([{ name: "omnifield-git-flow", id: 9 }]),
        err: "",
      },
    }),
  );
  // desired несёт реальные контексты; ruleset с голыми ключами → drift → loud-fail.
  assert.deepEqual(
    desired.rules
      .find((r) => r.type === "required_status_checks")
      .parameters.required_status_checks.map((c) => c.context),
    REAL_CHECKS,
    "desired = реальные check-run имена",
  );
  await assert.rejects(dispatch(["rulesets"], ex, GIT_PRESET, {}), /дрейф против git-пресета/);
});

test("git-flow rulesets: isStackCiCheck — stack-CI true, CodeQL/pr-title/инфра false (DEVOPSER-138)", () => {
  for (const ok of [
    "node / Node (hygiene + nx …)",
    "go / Go (build·vet·test)",
    "web / Web (build)",
    "python / Python (ruff + pytest, backend)", // DEVOPSER-159: python-контур = stack-CI (required)
  ])
    assert.equal(isStackCiCheck(ok), true, `stack-CI: ${ok}`);
  for (const no of ["Analyze (javascript-typescript)", "Analyze (actions)", "pr-title", "CodeQL"])
    assert.equal(isStackCiCheck(no), false, `не stack-CI: ${no}`);
});

test("git-flow rulesets: check-runs с CodeQL+pr-title → required = только stack-CI (DEVOPSER-138)", async () => {
  // default-ветка несёт stack-CI + CodeQL + pr-title; desired обязан взять ЛИШЬ stack-CI —
  // иначе транзиент CodeQL/инфры блокирует мерж (регресс сужения from-stack).
  const NOISY = [...REAL_CHECKS, "Analyze (javascript-typescript)", "Analyze (actions)", "pr-title"];
  const stackOnly = buildRulesetSpec(GIT_PRESET, REAL_CHECKS); // ruleset на GitHub = только stack-CI
  const ex = mockExec({
    "gh repo view --json nameWithOwner": { code: 0, out: "o/r\n", err: "" },
    "gh repo view --json defaultBranchRef": { code: 0, out: "main\n", err: "" },
    "gh api repos/o/r/commits/main/check-runs": { code: 0, out: `${NOISY.join("\n")}\n`, err: "" },
    "gh api repos/o/r/rulesets/7": { code: 0, out: JSON.stringify(stackOnly), err: "" },
    "gh api repos/o/r/rulesets": {
      code: 0,
      out: JSON.stringify([{ name: "omnifield-git-flow", id: 7 }]),
      err: "",
    },
    "gh api repos/o/r": { code: 0, out: JSON.stringify(buildRepoSettings(GIT_PRESET)), err: "" },
  });
  // чисто: desired (сужен до stack-CI) == ruleset (stack-CI). Не сузили бы → CodeQL в desired → дрейф.
  await dispatch(["rulesets"], ex, GIT_PRESET, {});
  assert.ok(ex.calls.log.some((l) => l.includes("совпадает с пресетом")));
  const reqLog = ex.calls.log.find((l) => l.includes("required checks"));
  assert.ok(
    reqLog && !reqLog.includes("Analyze") && !reqLog.includes("pr-title"),
    "CodeQL/pr-title НЕ в required-контекстах",
  );
});

test("git-flow rulesets (check): ruleset с реальными контекстами → чисто (no throw)", async () => {
  const desired = buildRulesetSpec(GIT_PRESET, REAL_CHECKS);
  const ex = mockExec(
    rulesetsEnv("o/r", {
      "gh api repos/o/r/rulesets/42": { code: 0, out: JSON.stringify(desired), err: "" },
      "gh api repos/o/r/rulesets": {
        code: 0,
        out: JSON.stringify([{ name: "omnifield-git-flow", id: 42 }]),
        err: "",
      },
    }),
  );
  await dispatch(["rulesets"], ex, GIT_PRESET, {});
  assert.ok(ex.calls.log.some((l) => l.includes("совпадает с пресетом")));
});

test("git-flow rulesets: check-run'ов ещё нет → loud-warn (не молча ключи job'ов)", async () => {
  const ex = mockExec({
    "gh repo view --json nameWithOwner": { code: 0, out: "o/r\n", err: "" },
    "gh repo view --json defaultBranchRef": { code: 0, out: "main\n", err: "" },
    "gh api repos/o/r/commits/main/check-runs": { code: 0, out: "\n", err: "" }, // прогонов нет
    "gh api repos/o/r/rulesets": { code: 0, out: "[]", err: "" },
  });
  await assert.rejects(dispatch(["rulesets"], ex, GIT_PRESET, {}), /дрейф/); // ruleset отсутствует
  assert.ok(
    ex.calls.log.some((l) => l.includes("check-run'ов на default-ветке нет")),
    "loud-warn о пустых прогонах",
  );
});

test("git-flow rulesets --apply: идемпотентно (нет → POST; есть → PUT) через gh api", async () => {
  const post = mockExec(
    rulesetsEnv("o/r", { "gh api repos/o/r/rulesets": { code: 0, out: "[]", err: "" } }),
  );
  await dispatch(["rulesets", "--apply"], post, GIT_PRESET, {});
  assert.ok(
    post.calls.gh.some((c) => c.startsWith("api repos/o/r/rulesets --method POST")),
    "нет ruleset → POST",
  );
  assert.ok(
    post.calls.gh.some((c) => c.startsWith("api repos/o/r --method PATCH")),
    "apply материализует repo-settings (PATCH repos/{nwo}) — DEVOPSER-157",
  );
  const put = mockExec(
    rulesetsEnv("o/r", {
      "gh api repos/o/r/rulesets": {
        code: 0,
        out: JSON.stringify([{ name: "omnifield-git-flow", id: 7 }]),
        err: "",
      },
    }),
  );
  await dispatch(["rulesets", "--apply"], put, GIT_PRESET, {});
  assert.ok(
    put.calls.gh.some((c) => c.startsWith("api repos/o/r/rulesets/7 --method PUT")),
    "есть ruleset → PUT (идемпотентно)",
  );
});

// --- repo-settings-материализация (DEVOPSER-157): squash-only + auto-merge -------

test("git-flow repo-settings: buildRepoSettings — метод мержа дерайвится из defaults.merge (squash-only)", () => {
  const rs = buildRepoSettings(GIT_PRESET); // defaults.merge = squash
  assert.strictEqual(rs.allow_squash_merge, true, "squash → allow_squash_merge");
  assert.strictEqual(rs.allow_merge_commit, false, "squash → merge-commit OFF (squash-only)");
  assert.strictEqual(rs.allow_rebase_merge, false, "squash → rebase OFF (squash-only)");
  // auto-merge + delete-branch — из defaults.repoSettings.
  assert.strictEqual(rs.allow_auto_merge, true, "repoSettings.autoMerge → allow_auto_merge (land --auto)");
  assert.strictEqual(rs.delete_branch_on_merge, true, "repoSettings.deleteBranchOnMerge → delete_branch_on_merge");
});

test("git-flow repo-settings: merge=rebase → rebase-only; отсутствие repoSettings → флаги OFF", () => {
  const rebase = buildRepoSettings({ defaults: { merge: "rebase", repoSettings: {} } });
  assert.deepEqual(rebase, {
    allow_squash_merge: false,
    allow_merge_commit: false,
    allow_rebase_merge: true,
    allow_auto_merge: false,
    delete_branch_on_merge: false,
  });
});

test("git-flow repo-settings: diffRepoSettings — совпадение → [], расхождение называет поле", () => {
  const desired = buildRepoSettings(GIT_PRESET);
  assert.deepEqual(diffRepoSettings(desired, desired), [], "current==desired → чисто");
  const drifted = { ...desired, allow_merge_commit: true, allow_auto_merge: false };
  const drift = diffRepoSettings(drifted, desired);
  assert.ok(drift.some((d) => d.startsWith("repo.allow_merge_commit")), "дрейф merge-commit назван");
  assert.ok(drift.some((d) => d.startsWith("repo.allow_auto_merge")), "дрейф auto-merge назван");
});

test("git-flow rulesets (check): repo-settings дрейф → loud-fail (DEVOPSER-157)", async () => {
  // ruleset совпадает с пресетом, но repo-settings уехали (auto-merge выключён вручную) → дрейф.
  const cleanRuleset = buildRulesetSpec(GIT_PRESET, REAL_CHECKS);
  const drifted = { ...buildRepoSettings(GIT_PRESET), allow_auto_merge: false };
  const ex = mockExec(
    rulesetsEnv("o/r", {
      "gh api repos/o/r/rulesets/42": { code: 0, out: JSON.stringify(cleanRuleset), err: "" },
      "gh api repos/o/r/rulesets": {
        code: 0,
        out: JSON.stringify([{ name: "omnifield-git-flow", id: 42 }]),
        err: "",
      },
      "gh api repos/o/r": { code: 0, out: JSON.stringify(drifted), err: "" },
    }),
  );
  await assert.rejects(dispatch(["rulesets"], ex, GIT_PRESET, {}), /дрейф против git-пресета/);
  assert.ok(
    ex.calls.log.some((l) => l.includes("repo.allow_auto_merge")),
    "дрейф-отчёт называет уехавшую repo-настройку",
  );
});

test("git-flow: ошибка gh прокидывает stderr наружу, не 'code 1' (DEVOPSER-114 #3)", async () => {
  const repo = mkRepo();
  try {
    const ex = mockExec({
      "git rev-parse --show-toplevel": { code: 0, out: `${repo}\n`, err: "" },
      "gh repo view": {
        code: 1,
        out: "",
        err: "gh: HTTP 403: Resource not accessible (admin scope)",
      },
    });
    await assert.rejects(
      dispatch(["rulesets"], ex, GIT_PRESET, {}),
      /403/,
      "реальный stderr виден",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Plugin-контракт (DEVOPSER-108, knowledger DEVOPSER-6) ---------------------
// Третий примитив (template/preset/plugin): внешняя продукт-owned капабилити, движок
// материализует её вслепую через тот же DISPATCH. Тесты — на FIXTURE-плагине (тест-дубль по
// контракту), ноль реального brainer-контента в devopser-репо (DEVOPSER-167).

// Фикстура npm-плагина: пакет в node_modules потребителя (omnifield-блок + контент-файлы).
function writeNpmPlugin(repo, pkg, omnifield, content = {}) {
  const dir = join(repo, "node_modules", pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: pkg, version: "0.1.0", omnifield }, null, 2)}\n`,
  );
  for (const [rel, body] of Object.entries(content)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

// Биндинг плагинов в omnifield.yaml потребителя (единственный путь для чужих продуктов).
function bindPlugins(repo, refs) {
  writeFileSync(
    join(repo, "omnifield.yaml"),
    `apiVersion: omnifield.dev/v1\nname: consumer\ntype: service\nplugins:\n${refs
      .map((r) => `  - "${r}"`)
      .join("\n")}\n`,
  );
}

// --- DEVOPSER-162: метаданные плагина + обобщённая валидация (kind:plugin) -----

test("plugin: невалидные метаданные (нет contentRoot/frame) → loud-fail (contract-first) DEVOPSER-162", () => {
  const repo = mkRepo();
  try {
    run(repo); // node-дефолт
    writeNpmPlugin(repo, "@x/bad-plugin", { kind: "plugin", target: "agent-harness", stack: "any" });
    bindPlugins(repo, ["@x/bad-plugin@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "плагин без contentRoot/frame → exit 1");
    assert.match(c.stderr, /contentRoot/, "loud-fail называет отсутствующий contentRoot");
    assert.match(c.stderr, /frame/, "loud-fail называет отсутствующий frame");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: frame-запись с mode вне DISPATCH → loud-fail DEVOPSER-162", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(repo, "@x/badmode", {
      kind: "plugin",
      target: "agent-harness",
      stack: "any",
      contentRoot: "content",
      frame: [{ src: "a.md", dest: ".x/a.md", mode: "bogus" }],
    });
    bindPlugins(repo, ["@x/badmode@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "frame.mode вне {exact,seed,block,pins} → exit 1");
    assert.match(c.stderr, /mode 'bogus'/, "loud-fail называет невалидный mode записи frame");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: metadata-парс plugins из omnifield.yaml (block-seq И inline-flow) DEVOPSER-162", () => {
  // block-sequence уже покрыт bindPlugins; здесь — inline-flow ["a", "b"] тоже читается.
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(repo, "@x/bad-plugin", { kind: "plugin", target: "agent-harness", stack: "any" });
    writeFileSync(
      join(repo, "omnifield.yaml"),
      'apiVersion: omnifield.dev/v1\nname: consumer\ntype: service\nplugins: ["@x/bad-plugin@^0.1.0"]\n',
    );
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "inline-flow plugins-список тоже дискаверится → плагин валидируется");
    assert.match(c.stderr, /@x\/bad-plugin/, "плагин из inline-flow достигает валидации");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-165: открытая таксономия — admit plugin-registered target + collision ----

test("plugin: валидный плагин с НОВЫМ target админтится (открытая таксономия) DEVOPSER-165", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness", // вне core-таксономии — admit'ится регистрацией плагина
        stack: "any",
        contentRoot: "content",
        frame: [{ src: "a.md", dest: ".x/a.md", mode: "seed" }],
      },
      { "content/a.md": "hi\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stderr); // novel target admit'нут → контракт-гейт чист
    assert.doesNotMatch(c.stderr, /вне контракта/, "novel target не валит (devopser не держит список продуктов)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: target КОЛЛИЗИТ с core-таргетом → loud-fail DEVOPSER-165", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/collide",
      {
        kind: "plugin",
        target: "repo-config", // core-таргет → коллизия
        stack: "any",
        contentRoot: "content",
        frame: [{ src: "a.md", dest: ".x/a.md", mode: "seed" }],
      },
      { "content/a.md": "hi\n" },
    );
    bindPlugins(repo, ["@x/collide@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "plugin target == core → exit 1");
    assert.match(c.stderr, /КОЛЛИЗ/i, "loud-fail называет коллизию с core");
    assert.match(c.stderr, /repo-config/, "коллизия называет core-target");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-163: контент-рут плагина — src из пакета плагина, не files/ devopser ----

test("plugin: контент материализуется ИЗ ПАКЕТА плагина (contentRoot), не из files/ devopser DEVOPSER-163", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const marker = "# контент из ПАКЕТА плагина (харнесс-роль)\n";
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "harness",
        frame: [{ src: "roles/architect.md", dest: ".claude/agents/architect.md", mode: "exact" }],
      },
      { "harness/roles/architect.md": marker },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    const dest = join(repo, ".claude/agents/architect.md");
    assert.ok(existsSync(dest), "плагин-managed файл материализован в потребителе");
    assert.equal(
      readFileSync(dest, "utf8"),
      marker,
      "контент резолвлен из ПАКЕТА плагина (contentRoot/harness), не из files/ devopser",
    );
    // Инвариант контракта: контент плагина в репо devopser НЕ заезжает.
    assert.ok(
      !existsSync(join(PKG_DIR, "files/roles/architect.md")),
      "src плагина НЕ в files/ devopser (контент чужого продукта не в devopser-репо)",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-164: фрагмент рамки → DISPATCH; drift SoT = эталон плагина + версия ----

test("plugin: exact-managed файл дрейфит против эталона ПЛАГИНА (SoT = пакет+версия), re-init синкает DEVOPSER-164", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "h",
        frame: [{ src: "a.md", dest: ".claude/a.md", mode: "exact" }],
      },
      { "h/a.md": "эталон плагина v1\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    assert.equal(run(repo).status, 0);
    assert.equal(run(repo, "--check").status, 0, "материализованный plugin-файл == эталон плагина → чисто");
    // Уехать нельзя: правим потребительскую копию → дрейф против эталона ПЛАГИНА (не devopser).
    writeFileSync(join(repo, ".claude/a.md"), "drifted\n");
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "дрейф plugin-managed → exit 1");
    assert.match(c.stderr, /\.claude\/a\.md/, "дрейф называет уехавший plugin-файл");
    assert.match(c.stderr, /эталон плагина @x\/harness/, "SoT атрибутирован ПЛАГИНУ (пакет+версия), не devopser");
    // re-init синкает обратно к эталону ПАКЕТА плагина.
    assert.equal(run(repo).status, 0);
    assert.equal(
      readFileSync(join(repo, ".claude/a.md"), "utf8"),
      "эталон плагина v1\n",
      "re-init восстановил из пакета плагина",
    );
    assert.equal(run(repo, "--check").status, 0, "после синка чисто");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: exact+seed в одном frame диспатчатся; seed init-only (правка не дрейфит) DEVOPSER-164", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "h",
        frame: [
          { src: "managed.md", dest: ".claude/managed.md", mode: "exact" },
          { src: "seed.md", dest: ".claude/seed.md", mode: "seed" },
        ],
      },
      { "h/managed.md": "m\n", "h/seed.md": "s\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    assert.equal(run(repo).status, 0);
    assert.ok(existsSync(join(repo, ".claude/managed.md")), "exact-запись плагина материализована (DISPATCH)");
    assert.ok(existsSync(join(repo, ".claude/seed.md")), "seed-запись плагина материализована (DISPATCH)");
    // seed init-only: правка легитимна, НЕ дрейф (репо владеет); exact managed.md не тронут → чисто.
    writeFileSync(join(repo, ".claude/seed.md"), "правка репо\n");
    assert.equal(run(repo, "--check").status, 0, "правка plugin-seed не валит drift (init-only)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-169: mechanism = поле ПРЕСЕТА; у плагина не в контракте (per-entry mode несёт всё) ----
// Контракт knowledger DEVOPSER-6: mechanism (extends|import|read) — КАК пресет потребляется тулингом.
// У плагина материализацию несёт per-entry frame[].mode → top-level mechanism вестигиален: НЕ обязан,
// present → игнорируется (не роняет). KNOWN_MECHANISMS остаётся пресет-энумом (тест 750 не тронут).

test("plugin: валиден БЕЗ mechanism (поле пресета, не плагина) DEVOPSER-169", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "content",
        frame: [{ src: "a.md", dest: ".x/a.md", mode: "seed" }],
      },
      { "content/a.md": "hi\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stderr); // плагин без mechanism — валиден (контракт его не требует)
    assert.doesNotMatch(c.stderr, /mechanism/, "движок не требует mechanism у плагина");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: mechanism ПРИСУТСТВУЕТ → игнорируется, не роняет (вестигиально) DEVOPSER-169", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        mechanism: "bogus-mech", // вне пресет-энума — но у плагина mechanism вне контракта → игнор
        contentRoot: "content",
        frame: [{ src: "a.md", dest: ".x/a.md", mode: "seed" }],
      },
      { "content/a.md": "hi\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 0, c.stderr); // present mechanism (даже вне enum) не валит плагин
    assert.doesNotMatch(c.stderr, /mechanism 'bogus-mech'/, "mechanism плагина не сверяется с enum (не пресет)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-170: mode:merge — JSON-aware deep-merge managed-фрагмента в co-owned JSON ----
// Плагин поставляет ТОЛЬКО данные (JSON-фрагмент) + frame-запись {mode:"merge"}; merge-логика
// живёт в движке (applyMerge). KNOWN_MODES (= Object.keys(DISPATCH)) авто-подхватывает merge →
// plugin-frame валидация admit'ит его без правок. Драйвер — brainer harness (.claude/settings.json).

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Фикстура: плагин с merge-фрагментом в co-owned .claude/settings.json.
function mergePlugin(repo, fragment) {
  writeNpmPlugin(
    repo,
    "@x/harness",
    {
      kind: "plugin",
      target: "agent-harness",
      stack: "any",
      contentRoot: "h",
      frame: [{ src: "settings.hooks.json", dest: ".claude/settings.json", mode: "merge" }],
    },
    { "h/settings.hooks.json": `${JSON.stringify(fragment)}\n` },
  );
  bindPlugins(repo, ["@x/harness@^0.1.0"]);
}

test("merge: deep-merge в существующий JSON СОХРАНЯЕТ ключи потребителя + добавляет managed DEVOPSER-170", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const dest = join(repo, ".claude/settings.json");
    mkdirSync(dirname(dest), { recursive: true });
    // Потребитель ТОЖЕ правит этот файл: свои ключи + вложенный объект, часть которого managed.
    writeFileSync(dest, `${JSON.stringify({ model: "opus", permissions: { allow: ["Bash"] } }, null, 2)}\n`);
    mergePlugin(repo, { hooks: { SessionStart: [{ command: "scope.mjs" }] }, permissions: { deny: ["Web"] } });
    assert.equal(run(repo).status, 0);
    const out = readJson(dest);
    assert.deepEqual(out.model, "opus", "скалярный ключ потребителя сохранён");
    assert.deepEqual(out.permissions.allow, ["Bash"], "вложенный ключ потребителя сохранён (deep-merge, не replace объекта)");
    assert.deepEqual(out.permissions.deny, ["Web"], "managed-лист добавлен в существующий объект");
    assert.deepEqual(out.hooks, { SessionStart: [{ command: "scope.mjs" }] }, "managed-фрагмент зарегистрирован");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge: идемпотентность — 2й прогон/--check после синка = ноль дрейфа DEVOPSER-170", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const dest = join(repo, ".claude/settings.json");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `${JSON.stringify({ model: "opus" }, null, 2)}\n`);
    mergePlugin(repo, { hooks: { SessionStart: [{ command: "scope.mjs" }] } });
    assert.equal(run(repo).status, 0);
    assert.equal(run(repo).status, 0, "повторный init — идемпотентен");
    assert.equal(run(repo, "--check").status, 0, "после синка --check чист (ноль дрейфа)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge: drift когда managed-лист изменён/удалён; ключи потребителя НЕ дрейфят; re-init синкает DEVOPSER-170", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const dest = join(repo, ".claude/settings.json");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `${JSON.stringify({ model: "opus" }, null, 2)}\n`);
    mergePlugin(repo, { hooks: { SessionStart: [{ command: "scope.mjs" }] } });
    assert.equal(run(repo).status, 0);
    // Потребитель правит СВОЙ ключ — merge его не трогает → НЕ дрейф.
    writeFileSync(dest, `${JSON.stringify({ ...readJson(dest), model: "sonnet" }, null, 2)}\n`);
    assert.equal(run(repo, "--check").status, 0, "правка ключа потребителя не дрейфит (managed = только листья фрагмента)");
    // Уводим managed-лист — фрагмент больше не полностью присутствует → дрейф.
    const drifted = readJson(dest);
    drifted.hooks.SessionStart = [{ command: "hacked.mjs" }];
    writeFileSync(dest, `${JSON.stringify(drifted, null, 2)}\n`);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "изменённый managed-лист → exit 1");
    assert.match(c.stderr, /\.claude\/settings\.json/, "дрейф называет co-owned JSON");
    assert.match(c.stderr, /эталон плагина @x\/harness/, "SoT атрибутирован плагину (пакет+версия)");
    // re-init восстанавливает managed-лист, ключ потребителя (model) сохранён.
    assert.equal(run(repo).status, 0);
    const synced = readJson(dest);
    assert.deepEqual(synced.hooks.SessionStart, [{ command: "scope.mjs" }], "re-init восстановил managed-лист");
    assert.equal(synced.model, "sonnet", "правка потребителя пережила re-init");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge: create когда dest отсутствует — файл с одним фрагментом DEVOPSER-170", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const dest = join(repo, ".claude/settings.json");
    assert.ok(!existsSync(dest), "предусловие: dest отсутствует");
    mergePlugin(repo, { hooks: { SessionStart: [{ command: "scope.mjs" }] } });
    assert.equal(run(repo).status, 0);
    assert.ok(existsSync(dest), "отсутствующий dest создан");
    assert.deepEqual(readJson(dest), { hooks: { SessionStart: [{ command: "scope.mjs" }] } }, "создан с одним фрагментом");
    assert.equal(run(repo, "--check").status, 0, "после create --check чист");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("merge: массив/скаляр фрагмента АВТОРИТЕТНЫ (replace managed-листа, не concat) DEVOPSER-170", () => {
  const repo = mkRepo();
  try {
    run(repo);
    const dest = join(repo, ".claude/settings.json");
    mkdirSync(dirname(dest), { recursive: true });
    // Потребитель держит массив + скаляр под теми же ключами, что managed-фрагмент.
    writeFileSync(dest, `${JSON.stringify({ enableAllProjectMcpServers: false, order: ["z", "y"] }, null, 2)}\n`);
    mergePlugin(repo, { enableAllProjectMcpServers: true, order: ["a"] });
    assert.equal(run(repo).status, 0);
    const out = readJson(dest);
    assert.equal(out.enableAllProjectMcpServers, true, "скаляр фрагмента авторитетен (replace)");
    assert.deepEqual(out.order, ["a"], "массив фрагмента авторитетен (replace managed-листа, НЕ merge/concat)");
    assert.equal(run(repo, "--check").status, 0, "идемпотентно после синка");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-166: дискавери/биндинг — двойная доставка + self-dogfood + version-pin ----

test("plugin: template.json.plugins публикуется null (чужой биндинг — omnifield.yaml) DEVOPSER-166", () => {
  assert.equal(TEMPLATE.plugins, null, "self-dogfood слот null → у потребителей эффекта нет");
  const repo = mkRepo();
  try {
    run(repo); // нет omnifield.yaml → ноль плагинов
    const c = run(repo, "--check");
    assert.equal(c.status, 0, "без биндинга плагинов — чисто");
    assert.doesNotMatch(c.stdout, /\[skeleton plugins\]/, "нет плагинов → нет plugin-репорта");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: ВЕНДОРНАЯ доставка — plugin.json из .omnifield/plugins/<local> (go/не-npm репо) DEVOPSER-166", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // go-стек, нет node_modules
    run(repo);
    // Вендорим бандл плагина: .omnifield/plugins/<local>/plugin.json + контент (как git-flow.json).
    const vdir = join(repo, ".omnifield/plugins/agent-harness-plugin");
    mkdirSync(join(vdir, "h"), { recursive: true });
    writeFileSync(
      join(vdir, "plugin.json"),
      `${JSON.stringify(
        {
          name: "@brainer/agent-harness-plugin",
          version: "0.1.0",
          omnifield: {
            kind: "plugin",
            target: "agent-harness",
            stack: "any",
                contentRoot: "h",
            frame: [{ src: "a.md", dest: ".claude/a.md", mode: "exact" }],
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(vdir, "h/a.md"), "вендор-эталон\n");
    bindPlugins(repo, ["@brainer/agent-harness-plugin@^0.1.0"]);
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(repo, "node_modules")), "go-репо без node_modules");
    assert.equal(
      readFileSync(join(repo, ".claude/a.md"), "utf8"),
      "вендор-эталон\n",
      "контент резолвлен из ВЕНДОР-бандла (language-agnostic доставка)",
    );
    assert.equal(run(repo, "--check").status, 0, "вендор-плагин: drift чист после init");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: version-guard — установленная версия < пин omnifield.yaml → warn (реюз DEVOPSER-100) DEVOPSER-166", () => {
  const repo = mkRepo();
  try {
    run(repo);
    // writeNpmPlugin пишет version 0.1.0; пин ^0.2.0 → отставание.
    writeNpmPlugin(
      repo,
      "@x/harness",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "h",
        frame: [{ src: "a.md", dest: ".claude/a.md", mode: "exact" }],
      },
      { "h/a.md": "x\n" },
    );
    bindPlugins(repo, ["@x/harness@^0.2.0"]);
    const c = run(repo, "--check");
    assert.match(c.stderr, /plugin-version/, "version-guard warn напечатан");
    assert.match(c.stderr, /@x\/harness/, "warn называет отставший плагин");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- DEVOPSER-167: e2e-обкатка — fixture-плагин материализуется в потребителя СНАРУЖИ ----

test("e2e: fixture-плагин (тест-дубль по контракту) материализуется в потребителя СНАРУЖИ; ноль контента в devopser DEVOPSER-167", () => {
  const repo = mkRepo();
  try {
    run(repo); // node-потребитель
    // Fixture-плагин = published-бандл в node_modules потребителя (СНАРУЖИ devopser). Мульти-mode frame.
    writeNpmPlugin(
      repo,
      "@brainer/agent-harness-plugin",
      {
        kind: "plugin",
        target: "agent-harness",
        stack: "any",
        contentRoot: "harness",
        frame: [
          { src: "agents/architect.md", dest: ".claude/agents/architect.md", mode: "exact" },
          { src: "settings.json", dest: ".claude/settings.json", mode: "seed" },
        ],
      },
      {
        "harness/agents/architect.md": "# роль architect (fixture)\n",
        "harness/settings.json": '{ "hooks": {} }\n',
      },
    );
    bindPlugins(repo, ["@brainer/agent-harness-plugin@^0.1.0"]);
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    // (1) внешний контент материализован ИЗ ПАКЕТА плагина (exact + seed записи диспатчатся).
    assert.equal(
      readFileSync(join(repo, ".claude/agents/architect.md"), "utf8"),
      "# роль architect (fixture)\n",
      "exact-запись плагина = контент из пакета плагина",
    );
    assert.ok(existsSync(join(repo, ".claude/settings.json")), "seed-запись плагина материализована");
    // (2) плагин зарепорчен по target (открытая таксономия наблюдаема).
    assert.match(
      r.stdout,
      /\[skeleton plugins\] agent-harness: @brainer\/agent-harness-plugin/,
      "плагин в репорте по target",
    );
    // (3) drift managed-записи краснеет против эталона ПЛАГИНА (SoT = пакет+версия).
    writeFileSync(join(repo, ".claude/agents/architect.md"), "взломано\n");
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "дрейф plugin-managed → exit 1");
    assert.match(c.stderr, /эталон плагина @brainer\/agent-harness-plugin/, "drift SoT = плагин, не devopser");
    // (4) ноль контента плагина в репо devopser (files/ его НЕ несёт — контент чужого продукта не заезжает).
    assert.ok(!existsSync(join(PKG_DIR, "files/harness")), "contentRoot плагина НЕ в files/ devopser");
    assert.ok(
      !existsSync(join(PKG_DIR, "files/agents/architect.md")),
      "dest плагина НЕ в files/ devopser",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("plugin: незарегистрированный target (плагин без target) → loud-fail DEVOPSER-167", () => {
  const repo = mkRepo();
  try {
    run(repo);
    writeNpmPlugin(
      repo,
      "@x/notarget",
      {
        kind: "plugin",
        stack: "any",
        contentRoot: "h",
        frame: [{ src: "a.md", dest: ".claude/a.md", mode: "exact" }],
      },
      { "h/a.md": "x\n" },
    );
    bindPlugins(repo, ["@x/notarget@^0.1.0"]);
    const c = run(repo, "--check");
    assert.equal(c.status, 1, "плагин без target (незарегистрирован) → exit 1");
    assert.match(c.stderr, /target/, "loud-fail называет незарегистрированный target");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

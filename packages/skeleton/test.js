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
  buildRulesetSpec,
  diffRulesets,
  dispatch,
  expectsChecks,
  isStackCiCheck,
  mergeFlag,
  resolvePreset,
  validateBranchName,
  validateCommitMessage,
  waitChecks,
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

test("template.json объявляет per-stack templates (common/node/go) и CI-jobs (go/node/frontend)", () => {
  assert.ok(Array.isArray(TEMPLATE.templates.common));
  assert.ok(Array.isArray(TEMPLATE.templates.node));
  assert.ok(Array.isArray(TEMPLATE.templates.go));
  for (const s of ["go", "node", "frontend"]) {
    assert.equal(typeof TEMPLATE.ci.jobs[s].name, "string");
    assert.equal(typeof TEMPLATE.ci.jobs[s].reusable, "string");
  }
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

// --- DEVOPSER-53: gitleaks — единая точка пина, composite вместо 6× inline-curl ------------

const CI_WORKFLOWS = ["web-ci.yml", "node-ci.yml", "go-ci.yml"];

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

const MODES = new Set(["exact", "seed", "block", "pins"]);
const allFrameEntries = () => [
  ...TEMPLATE.managed,
  ...TEMPLATE.block,
  ...TEMPLATE.pins,
  ...TEMPLATE.templates.common,
  ...TEMPLATE.templates.node,
  ...TEMPLATE.templates.go,
];

test("каждая frame-запись объявляет валидный mode (exact|seed|block|pins)", () => {
  for (const e of allFrameEntries()) {
    assert.ok(MODES.has(e.mode), `запись ${e.dest}: mode '${e.mode}' вне {exact,seed,block,pins}`);
  }
  // Ожидаемая раскладка режимов по группам (рамка enforced vs сид).
  assert.ok(
    TEMPLATE.managed.every((e) => e.mode === "exact"),
    "managed = exact",
  );
  for (const g of ["common", "node", "go"])
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

test("template.json таксономия: repo-config active, release declared, git-flow bound", () => {
  const t = TEMPLATE.targets;
  assert.ok(t, "template.json должен нести таксономию targets");
  assert.equal(t["repo-config"], "active");
  assert.equal(t.release, "declared"); // пустая plug-in точка
  assert.equal(t["git-flow"], "bound"); // пресет привязан (DEVOPSER-103), процессор — следом
});

test("init репортит группировку по target (repo-config: nx,biome,vite; release/git-flow пусты)", () => {
  const repo = mkRepo();
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[skeleton targets\]/, "репорт по target печатается");
    assert.match(r.stdout, /repo-config: nx, biome, vite/, "repo-config группирует свои slots");
    assert.match(r.stdout, /release: —/, "release — declared-empty plug-in");
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
    sleep: () => {}, // no-op в тестах: waitChecks-цикл не спит реальным spawnSync.
    log: (m) => calls.log.push(m),
  };
}

// Мок-exec для waitChecks: `gh pr checks` отдаёт по очереди из sequence (последний повторяется).
function checksExec(sequence) {
  const calls = { gh: [], log: [], sleep: 0 };
  let i = 0;
  return {
    calls,
    gh: (a) => {
      calls.gh.push(a.join(" "));
      return sequence[Math.min(i++, sequence.length - 1)];
    },
    sleep: () => {
      calls.sleep++;
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

test("git-flow: land-оркестрация по пресету (PR OPEN + checks зелёные → merge+delete → sync)", async () => {
  const ex = mockExec({
    "git rev-parse --abbrev-ref HEAD": { code: 0, out: "feat/x\n", err: "" },
    "gh pr view": { code: 0, out: "OPEN\n", err: "" },
    "gh pr checks": { code: 0, out: "node / Node (ci)\tpass\t21s\thttps://…\n", err: "" },
  });
  await dispatch(["land"], ex, GIT_PRESET, {});
  // merge-флаг из пресета (squash), + удаление ветки.
  const flag = mergeFlag(GIT_PRESET.defaults.merge);
  assert.ok(
    ex.calls.gh.some((c) => c === `pr merge ${flag} --delete-branch`),
    "gh pr merge по пресету + delete-branch",
  );
  assert.ok(ex.calls.git.includes("reset --hard origin/main"), "sync: local main = origin/main");
});

test("git-flow: land требует OPEN PR (frame.prRequired) — нет PR → throw", async () => {
  const ex = mockExec({
    "git rev-parse --abbrev-ref HEAD": { code: 0, out: "feat/x\n", err: "" },
    "gh pr view": { code: 1, out: "", err: "no pull requests found" },
  });
  await assert.rejects(dispatch(["land"], ex, GIT_PRESET, {}), /prRequired/);
  assert.ok(!ex.calls.gh.some((c) => c.startsWith("pr merge")), "merge НЕ вызван без PR");
});

// --- waitChecks: «no checks reported» vs реальный fail (DEVOPSER-115) ------------

test("git-flow: expectsChecks — from-stack/непустой → true, пустой/прочее → false", () => {
  assert.equal(expectsChecks("from-stack"), true);
  assert.equal(expectsChecks(["ci / build"]), true);
  assert.equal(expectsChecks([]), false);
  assert.equal(expectsChecks(undefined), false);
});

const NO_CHECKS = { code: 1, out: "", err: "no checks reported on the 'feat/x' branch\n" };
// waitChecks гейтится по stack-CI-чекам (DEVOPSER-139) — мок несёт строку `gh pr checks`
// (name\tstate\t…) со stack-CI-именем "node / Node …".
const GREEN = { code: 0, out: "node / Node (ci)\tpass\t21s\thttps://…\n", err: "" };
const PENDING = { code: 8, out: "node / Node (ci)\tpending\t0\thttps://…\n", err: "" };
const FAILED = { code: 1, out: "node / Node (ci)\tfail\thttps://…\n", err: "" };

test("git-flow: waitChecks — «no checks reported» транзиент → ждёт → зелёные (НЕ падает)", () => {
  // Догфуд-баг: land сразу после pr падал на «no checks reported». Теперь ждём регистрации.
  const ex = checksExec([NO_CHECKS, NO_CHECKS, GREEN]);
  assert.doesNotThrow(() => waitChecks(ex, "from-stack"));
  assert.equal(ex.calls.gh.length, 3, "две итерации ожидания регистрации, затем зелёные");
  assert.equal(ex.calls.sleep, 2, "спал между итерациями (замокан no-op)");
});

test("git-flow: waitChecks — реальный fail (проверки есть, не зелёные, не маркер) → throw", () => {
  const ex = checksExec([FAILED]);
  assert.throws(() => waitChecks(ex, "from-stack"), /не зелёные/);
});

test("git-flow: waitChecks — pending (code 8) → ждёт → зелёные", () => {
  const ex = checksExec([PENDING, PENDING, GREEN]);
  assert.doesNotThrow(() => waitChecks(ex, "from-stack"));
  assert.equal(ex.calls.sleep, 2);
});

test("git-flow: waitChecks — «no checks» навсегда + пресет ЖДЁТ чеки → внятный throw за кап", () => {
  const ex = checksExec([NO_CHECKS]); // маркер повторяется бесконечно
  assert.throws(() => waitChecks(ex, "from-stack"), /не зарегистрировались за кап/);
});

test("git-flow: waitChecks — «no checks» навсегда + пресет чеков НЕ ждёт → успех (return)", () => {
  const ex = checksExec([NO_CHECKS]);
  assert.doesNotThrow(() => waitChecks(ex, [])); // пустой набор → «no checks» = ок
});

test("git-flow: waitChecks — красный/pending НЕ-stack (CodeQL, pr-title) + зелёный stack-CI → проходит (DEVOPSER-139)", () => {
  // Инфра-флейк (CodeQL fail, pr-title pending) не держит land — гейт по stack-CI, симметрично merge.
  const NOISY_GREEN = {
    code: 1, // gh отдаёт non-zero из-за красного CodeQL — но это НЕ stack-CI-чек
    out:
      "node / Node (ci)\tpass\t21s\thttps://…\n" +
      "Analyze (javascript-typescript)\tfail\t8s\thttps://…\n" +
      "pr-title\tpending\t0\thttps://…\n",
    err: "",
  };
  const ex = checksExec([NOISY_GREEN]);
  assert.doesNotThrow(() => waitChecks(ex, "from-stack"), "не-stack чеки не держат land");
  assert.equal(ex.calls.sleep, 0, "stack-CI зелёный сразу → без ожидания флейка");
});

test("git-flow: waitChecks — stack-CI pending при зелёном CodeQL → ждёт stack-CI (не ранний return)", () => {
  // Обратная сторона: зелёный не-stack чек НЕ должен давать ранний return, пока stack-CI не зелёный.
  const ex = checksExec([
    { code: 8, out: "node / Node (ci)\tpending\t0\t…\nCodeQL\tpass\t3s\t…\n", err: "" },
    { code: 0, out: "node / Node (ci)\tpass\t20s\t…\nCodeQL\tpass\t3s\t…\n", err: "" },
  ]);
  assert.doesNotThrow(() => waitChecks(ex, "from-stack"));
  assert.equal(ex.calls.sleep, 1, "ждал именно stack-CI, не вернулся по зелёному CodeQL");
});

test("git-flow: land — «no checks reported» транзиент → дожидается → merge (регрессия -115)", async () => {
  // Интеграция через dispatch(land): PR OPEN, checks сначала «no checks», затем зелёные → merge.
  let n = 0;
  const ex = {
    calls: { git: [], gh: [], log: [] },
    git: (a) => {
      ex.calls.git.push(a.join(" "));
      return a.join(" ").startsWith("rev-parse --abbrev-ref")
        ? { code: 0, out: "feat/x\n", err: "" }
        : { code: 0, out: "", err: "" };
    },
    gh: (a) => {
      const s = a.join(" ");
      ex.calls.gh.push(s);
      if (s.startsWith("pr view")) return { code: 0, out: "OPEN\n", err: "" };
      if (s === "pr checks") return n++ === 0 ? NO_CHECKS : GREEN;
      return { code: 0, out: "", err: "" };
    },
    sleep: () => {},
    log: (m) => ex.calls.log.push(m),
  };
  await dispatch(["land"], ex, GIT_PRESET, {});
  const flag = mergeFlag(GIT_PRESET.defaults.merge);
  assert.ok(
    ex.calls.gh.some((c) => c === `pr merge ${flag} --delete-branch`),
    "land НЕ упал на транзиентном «no checks» и дошёл до merge",
  );
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
  for (const ok of ["node / Node (hygiene + nx …)", "go / Go (build·vet·test)", "web / Web (build)"])
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

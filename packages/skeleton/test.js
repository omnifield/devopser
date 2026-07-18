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

test("template.json таксономия: repo-config active, release/git-flow declared (plug-in точки)", () => {
  const t = TEMPLATE.targets;
  assert.ok(t, "template.json должен нести таксономию targets");
  assert.equal(t["repo-config"], "active");
  assert.equal(t.release, "declared");
  assert.equal(t["git-flow"], "declared");
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

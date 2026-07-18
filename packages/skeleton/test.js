// @omnifield/skeleton — прог init/drift против temp-репо (Docker в сессии недоступен,
// [[no-docker-in-session]] — доказываем формой материализации/дрейфа; живой devbox-провижн
// доказывает ревьюер). Ядро теста — «манифест = источник рамки» (DEVOPSER-97): состав
// managed/init-only/CI берётся из template.json, init.mjs его исполняет.
//   node --test
//
// НЕ публикуется (нет в package.json files[]).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

#!/usr/bin/env node
// init.mjs — материализация / синк / drift-check skeleton-набора devopser
// (briefs/repo-skeleton-product.md D3 + briefs/skeleton-stack-aware-sync.md, Шаг 1).
// Zero-deps, только node:*.
//
//   node init.mjs [target]           — init/sync: вендорит managed-набор ПО СТЕКУ репо,
//                                      создаёт stack-шаблоны (только если отсутствуют),
//                                      чинит пины, раскатывает CI-caller'ы per stack.
//   node init.mjs --check [target]   — drift-check: ничего не пишет, exit 1 + список
//                                      расхождений (шаг reusable CI, action drift-check).
//
// СТЕК репо (node / go / frontend; репо может быть мульти-стек, напр. go+frontend) —
// источник правды platform/repo-flow.json (поле `stack`), фолбэк — детект по фактам
// репо (go.mod→go, package.json→node). Ветвление — ПО СТЕКУ, НЕ по имени репо
// (north-star брифа): go-путь работает для любого go-репо, node — для любого node.
//   node     = nx-монорепо (pnpm+nx в корне) → node-ci + корневой nx/package/biome-набор.
//   frontend = standalone-фронт (свой pnpm-воркспейс, vite, БЕЗ nx) → web-ci-caller,
//              БЕЗ навязывания корневого nx-набора (у фронта свои конфиги в воркспейсе).
//              working-directory фронта — из repo-flow.json (frontend.working-directory).
//
// Managed-набор (сверяется drift-check'ом; синк — только явной командой, не молча):
//   общий (все стеки): .editorconfig / .gitattributes / .npmrc / .husky/* / devbox-* /
//                      .gitignore managed-блок;  node: package.json пины.
// Init-only (создаются, если отсутствуют; НЕ drift-managed — репо легитимно правит):
//   общий: .devcontainer / devbox.services.json / CI-caller'ы (ci.yml + pr-title.yml);
//   node: nx.json / biome.json / dependabot;  go: .golangci.yml / sqlc.yaml.
// nx.json / biome.json — репо расширяет пресеты (пример: python-таргеты brainer);
// go-шаблоны — продукт правит пути/движок БД (sqlite→postgres drop-in).

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = join(PKG_DIR, "files");
// devopser-side конфиг стеков; при запуске из published-пакета (node_modules) его нет →
// фолбэк на детект. Источник правды, когда доступен.
const REPO_FLOW = join(PKG_DIR, "..", "..", "platform", "repo-flow.json");

// К2-guard (briefs/repo-skeleton-product.md): печатаем свою версию при старте —
// тихий откат эталона (stale dist-tag) становится видимым в логе синка/CI.
function printVersion() {
  const { name, version } = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
  console.log(`${name} ${version}`);
}

// Рамка темплейта (состав managed / init-only / per-stack / CI-callers) — ДЕКЛАРАЦИЯ,
// не хардкод: читаем из template.json (DEVOPSER-95: темплейт = жёсткая рамка). init.mjs —
// исполнитель рамки, не её источник. Смысл/rationale каждого файла — в README.md.
//   managed      — точная копия эталона, drift-fail (уехать нельзя); exec:true → mode 0755
//                  (B7: launcher теряет exec-бит при правке через \\wsl.localhost → init
//                  ставит бит, husky-pre-commit сторожит). Общий набор — для ВСЕХ стеков.
//   templates.*  — init-only (создаётся, если отсутствует; НЕ drift-managed): common —
//                  devbox-инфра всем стекам; node/go — по стеку репо.
//   ci.jobs      — CI-caller per stack (go→go-ci.yml, node→node-ci.yml nx-монорепо,
//                  frontend→web-ci.yml standalone, БЕЗ nx). ci.permOrder — канон permissions
//                  (go/frontend: contents:read; node: +actions,+packages).
const TEMPLATE = JSON.parse(readFileSync(join(PKG_DIR, "template.json"), "utf8"));
const MANAGED = TEMPLATE.managed; // mode exact
const BLOCK = TEMPLATE.block; // mode block (.gitignore splice)
const PINS = TEMPLATE.pins; // mode pins (package.json merge)
const COMMON_TEMPLATES = TEMPLATE.templates.common; // mode seed
const NODE_TEMPLATES = TEMPLATE.templates.node; // mode seed
const GO_TEMPLATES = TEMPLATE.templates.go; // mode seed
const CI_JOB = TEMPLATE.ci.jobs;
const PERM_ORDER = TEMPLATE.ci.permOrder;

const BLOCK_START =
  "# >>> omnifield-skeleton (managed by devopser; синк: init.mjs, не редактировать руками) >>>";
const BLOCK_END = "# <<< omnifield-skeleton <<<";

const norm = (s) => s.replace(/\r\n/g, "\n");
const readEtalon = (name) => norm(readFileSync(join(FILES, name), "utf8"));
const readTarget = (p) => (existsSync(p) ? norm(readFileSync(p, "utf8")) : null);

function writeLf(path, content, exec = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  if (exec) chmodSync(path, 0o755);
}

// Гарантируем exec-бит даже если контент уже совпал (init-путь, не check).
// Возвращает true, если бит пришлось починить.
function ensureExec(path) {
  if ((statSync(path).mode & 0o777) === 0o755) return false;
  chmodSync(path, 0o755);
  return true;
}

// --- Стек репо ---------------------------------------------------------------

// Детект по фактам репо — фолбэк, когда repo-flow.json недоступен/без записи.
function detectStacks(target) {
  const s = [];
  if (existsSync(join(target, "go.mod"))) s.push("go");
  if (existsSync(join(target, "package.json"))) s.push("node");
  return s.length ? s : ["node"]; // пустой репо — безопасный дефолт (текущее поведение)
}

// Источник правды — repo-flow.json[<basename>]; иначе детект. Возвращаем и запись флоу
// (нужна frontend-конфигу: working-directory).
function resolveStacks(target) {
  const name = basename(target);
  if (existsSync(REPO_FLOW)) {
    const entry = JSON.parse(readFileSync(REPO_FLOW, "utf8"))[name];
    const st = entry?.stack;
    if (Array.isArray(st) && st.length)
      return { stacks: st, source: `repo-flow.json[${name}]`, entry };
  }
  return { stacks: detectStacks(target), source: "детект (facts)", entry: null };
}

// Сборка ci.yml-caller по стеку: один job на reusable, permissions — объединение канонов.
// frontend-job передаёт working-directory (сабдир-фронт), если он не корень.
function buildCiYml({ hasGo, hasNode, hasFrontend, frontendWorkdir }) {
  const jobs = [];
  const perms = new Set(["contents: read"]);
  if (hasGo) jobs.push(CI_JOB.go);
  if (hasNode) {
    jobs.push(CI_JOB.node);
    perms.add("actions: read");
    perms.add("packages: read");
  }
  if (hasFrontend) {
    jobs.push({ ...CI_JOB.frontend, workdir: frontendWorkdir });
    perms.add("packages: read"); // фронт может тянуть @omnifield-пресет (web-ci auth)
  }
  const permStr = PERM_ORDER.filter((p) => perms.has(p)).join(", ");
  const head = readEtalon("ci-caller/head.yml").replace("__PERMISSIONS__", permStr);
  const body = jobs
    .map((j) => {
      let s = `  ${j.name}:\n    uses: omnifield/devopser/.github/workflows/${j.reusable}@main\n`;
      if (j.workdir && j.workdir !== ".") s += `    with:\n      working-directory: ${j.workdir}\n`;
      return s;
    })
    .join("");
  return head + body;
}

// --- .gitignore managed-блок -------------------------------------------------

function gitignoreBlock(src) {
  return `${BLOCK_START}\n${readEtalon(src).trimEnd()}\n${BLOCK_END}\n`;
}

// Возвращает { expected } содержимого .gitignore после синка блока (src эталона блока — из манифеста).
function spliceGitignore(current, src) {
  const block = gitignoreBlock(src);
  if (current === null) return { expected: block };
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  if (start === -1 || end === -1) {
    const sep = current.endsWith("\n") ? "\n" : "\n\n";
    return { expected: current + sep + block };
  }
  return {
    expected:
      current.slice(0, start) + block + current.slice(end + BLOCK_END.length).replace(/^\n/, ""),
  };
}

function pins(src) {
  const tpl = JSON.parse(readEtalon(src));
  return { packageManager: tpl.packageManager, node: tpl.engines.node };
}

// --- Apply-хендлеры по режиму (DEVOPSER-99) ----------------------------------
// mode в template.json ВЫБИРАЕТ хендлер (диспатч), не массив/секция. Поведение — как было.
// ctx = { target, check, drift, actions, name }. Хендлеры пишут в drift[] (--check) / actions[].

// exact — managed: точная копия эталона, drift-fail; exec:true → mode 0755 (сверяется и в --check).
function applyExact(e, { target, check, drift, actions }) {
  const expected = readEtalon(e.src);
  const path = join(target, e.dest);
  const current = readTarget(path);
  if (current !== expected) {
    if (check)
      drift.push(`${e.dest}: ${current === null ? "отсутствует" : "отличается от эталона"}`);
    else {
      writeLf(path, expected, e.exec);
      actions.push(`${e.dest}: ${current === null ? "создан" : "синкнут"}`);
    }
  }
  // exec-бит гарантируем независимо от совпадения контента (init); в --check — сверяем как дрейф.
  if (e.exec && existsSync(path)) {
    if (check) {
      if ((statSync(path).mode & 0o777) !== 0o755) drift.push(`${e.dest}: exec-бит ≠ 0755`);
    } else if (ensureExec(path)) {
      actions.push(`${e.dest}: exec-бит (0755) починен`);
    }
  }
}

// block — splice managed-блока в файл, который репо ТОЖЕ правит (.gitignore): дрейфит только блок.
function applyBlock(e, { target, check, drift, actions }) {
  const path = join(target, e.dest);
  const current = readTarget(path);
  const { expected } = spliceGitignore(current, e.src);
  if (current === expected) return;
  if (check)
    drift.push(
      `${e.dest}: managed-блок ${current?.includes(BLOCK_START) ? "отличается" : "отсутствует"}`,
    );
  else {
    writeLf(path, expected);
    actions.push(`${e.dest}: managed-блок синкнут`);
  }
}

// pins — merge отдельных ключей (packageManager + engines.node): дрейф только на них, остальное
// package.json — зона репо. Отсутствует файл → создаём из шаблона (тот же src).
function applyPins(e, { target, check, drift, actions, name }) {
  const path = join(target, e.dest);
  const raw = readTarget(path);
  const { packageManager, node } = pins(e.src);
  if (raw === null) {
    if (check) drift.push(`${e.dest}: отсутствует`);
    else {
      // Создаём из шаблона; ранги @omnifield preset-деп дерайвим из template.json.presets
      // (единый источник версий, DEVOPSER-100) — шаблон их НЕ хардкодит (__PRESET_VERSION__).
      const pkg = JSON.parse(readEtalon(e.src).replace("__NAME__", name));
      setPresetDeps(pkg);
      writeLf(path, `${JSON.stringify(pkg, null, 2)}\n`);
      actions.push(`${e.dest}: создан из шаблона`);
    }
    return;
  }
  const pkg = JSON.parse(raw);
  const bad = [];
  if (pkg.packageManager !== packageManager)
    bad.push(`packageManager: ${pkg.packageManager ?? "нет"} → ${packageManager}`);
  if (pkg.engines?.node !== node) bad.push(`engines.node: ${pkg.engines?.node ?? "нет"} → ${node}`);
  // @omnifield preset-деп: ранг managed против биндинга (bump биндинга → потребитель краснеет
  // на --check → синкает init'ом; propagation через drift-гейт, не пассивный caret).
  for (const d of presetDepDrift(pkg)) bad.push(`${d.key}: ${d.from} → ${d.to}`);
  if (!bad.length) return;
  if (check) drift.push(`${e.dest} пины: ${bad.join("; ")}`);
  else {
    pkg.packageManager = packageManager;
    pkg.engines = { ...pkg.engines, node };
    setPresetDeps(pkg);
    writeLf(path, `${JSON.stringify(pkg, null, 2)}\n`);
    actions.push(`${e.dest}: пины починены (${bad.join("; ")})`);
  }
}

// seed — init-only: создать, только если отсутствует; НЕ drift-managed (репо легитимно правит).
// __NAME__ → basename(target): package.json name, devcontainer network-alias (single-origin).
function applySeed(e, { target, actions, name }) {
  const path = join(target, e.dest);
  if (existsSync(path)) return;
  writeLf(path, readEtalon(e.src).replaceAll("__NAME__", name));
  actions.push(`${e.dest}: создан из шаблона`);
}

const DISPATCH = { exact: applyExact, block: applyBlock, pins: applyPins, seed: applySeed };
// Пресет живёт в рамке (stack=any или ∩ стек репо).
const inStack = (e, stacks) => !e.stack || asList(e.stack).some((s) => stacks.includes(s));

// --- Пресет-контракт (DEVOPSER-98) -------------------------------------------
// Пресет = дефолты ВНУТРИ рамки (DEVOPSER-95); template.json.presets биндит слот → пакет@ver,
// пресет сам объявляет метаданные (блок omnifield его package.json): kind/slot/stack/mechanism.
// Контракт ОБЩИЙ — не только repo-config (nx/biome/vite), но и будущие git-flow/release-пресеты
// (DEVOPSER-108): composition ссылкой name@version, направление consumer→provider.

// "@scope/name@^1.2.3" → { pkg, range }. Scoped-пакет: имя с ведущим @, версия — после ПОСЛЕДНЕГО @.
function parsePresetRef(ref) {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { pkg: ref, range: null };
  return { pkg: ref.slice(0, at), range: ref.slice(at + 1) };
}

// Метаданные пресета (блок omnifield его package.json). Резолв: node_modules целевого репо
// (потребитель после install) → packages/<name> клона devopser (self-check/дев). null, если
// не резолвится (напр. init до pnpm install) — валидация best-effort, жёсткий гейт живёт в
// CI --check, где зависимости стоят.
function resolvePresetMeta(pkg, target) {
  const local = pkg.replace(/^@[^/]+\//, ""); // @omnifield/nx-preset → nx-preset
  for (const c of [
    join(target, "node_modules", pkg, "package.json"),
    join(PKG_DIR, "..", local, "package.json"),
  ]) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, "utf8")).omnifield ?? null;
  }
  return null;
}

const asList = (v) => (Array.isArray(v) ? v : [v]);
// Пресет-стек в рамке репо, если stack=any или пересекается со стеком репо.
const stackInFrame = (presetStack, stacks) => {
  const ps = asList(presetStack);
  return ps.includes("any") || ps.some((s) => stacks.includes(s));
};

// Известные таргеты (DEVOPSER-101): target = КАТЕГОРИЯ того, что пресет настраивает (ось
// группировки slots). Набор = ключи template.json.targets; пресет с target вне набора → loud-fail.
const knownTargets = () =>
  new Set(Object.keys(TEMPLATE.targets ?? {}).filter((t) => !t.startsWith("$")));

// Enum mechanism (пресет-контракт -98): КАК пресет потребляется. extends (nx/biome) / import
// (vite) / read (git-preset ЧИТАЕТСЯ тулингом — не extends/import; DEVOPSER-103). Расширяемо.
const KNOWN_MECHANISMS = new Set(["extends", "import", "read"]);

// «Пресет в рамке»: для каждого bound-пресета — (а) slot биндинга == slot, объявленный пресетом;
// (б) если конфиг слота ПРИСУТСТВУЕТ в репо, declared stack пресета обязан быть в рамке стека
// репо (node-пресет на go-репо = вне рамки → loud-fail). Возвращает список ошибок.
function validatePresets(target, stacks) {
  const errors = [];
  const presets = TEMPLATE.presets ?? {};
  // slot → dest материализуемого конфига (проверка «конфиг присутствует → пресет в рамке»).
  const slotDest = {};
  for (const t of [...NODE_TEMPLATES, ...GO_TEMPLATES, ...COMMON_TEMPLATES])
    if (t.slot) slotDest[t.slot] = t.dest;

  for (const [slot, ref] of Object.entries(presets)) {
    if (slot.startsWith("$")) continue; // $comment — не слот
    const { pkg, range } = parsePresetRef(ref);
    if (!range) errors.push(`биндинг слота '${slot}': '${ref}' без версии (нужно ${pkg}@^ver)`);
    const meta = resolvePresetMeta(pkg, target);
    if (!meta) continue; // не резолвится (до install) — гейт в CI, где deps стоят
    if (meta.kind && meta.kind !== "preset")
      errors.push(`биндинг '${slot}' → ${pkg}: kind '${meta.kind}' ≠ preset`);
    if (meta.slot !== slot)
      errors.push(`биндинг '${slot}' → ${pkg}, но пресет объявляет slot '${meta.slot}'`);
    // target пресета обязан быть из известной таксономии (DEVOPSER-101). unknown → loud-fail.
    const targets = knownTargets();
    if (!targets.has(meta.target))
      errors.push(
        `биндинг '${slot}' → ${pkg}: target '${meta.target}' ∉ известные {${[...targets].join(", ")}}`,
      );
    // mechanism пресета — из enum контракта (DEVOPSER-103: + read). unknown → loud-fail.
    if (meta.mechanism && !KNOWN_MECHANISMS.has(meta.mechanism))
      errors.push(
        `биндинг '${slot}' → ${pkg}: mechanism '${meta.mechanism}' ∉ {${[...KNOWN_MECHANISMS].join(", ")}}`,
      );
    const dest = slotDest[slot];
    if (dest && existsSync(join(target, dest)) && !stackInFrame(meta.stack, stacks))
      errors.push(
        `${dest} тянет ${pkg} (stack ${JSON.stringify(meta.stack)}) — вне рамки репо [${stacks.join(", ")}]`,
      );
  }
  return errors;
}

// Группировка bound-пресетов по declared target (репорт; DEVOPSER-101). Только resolvable мета;
// показывает активные (repo-config) и declared-empty (release/git-flow) plug-in точки.
function reportTargets(target) {
  const groups = {};
  for (const t of knownTargets()) groups[t] = [];
  for (const [slot, ref] of Object.entries(TEMPLATE.presets ?? {})) {
    if (slot.startsWith("$")) continue;
    const meta = resolvePresetMeta(parsePresetRef(ref).pkg, target);
    if (meta?.target && groups[meta.target]) groups[meta.target].push(slot);
  }
  const line = Object.entries(groups)
    .map(([t, slots]) => `${t}: ${slots.length ? slots.join(", ") : "—"}`)
    .join(" | ");
  console.log(`[skeleton targets] ${line}`);
}

// --- Версионирование пресетов (DEVOPSER-100) ---------------------------------
// template.json.presets = ЕДИНЫЙ источник версий пресетов. Consumer preset-деп (@omnifield/*)
// дерайвится из биндинга (не хардкодится в package-template.json) и managed drift-гейтом:
// bump биндинга → потребитель краснеет на --check → синкает init'ом. Version-guard (warn)
// ловит отставание УСТАНОВЛЕННОЙ версии. Zero-dep, без changeset.

// pkgName → range из биндинга (реестр версий пресетов).
function presetRanges() {
  const out = {};
  for (const [slot, ref] of Object.entries(TEMPLATE.presets ?? {})) {
    if (slot.startsWith("$")) continue;
    const { pkg, range } = parsePresetRef(ref);
    if (range) out[pkg] = range;
  }
  return out;
}

// Локальный протокол (монорепо/линк) — НЕ версионный пин, не трогаем (devopser сам = workspace:*).
const LOCAL_DEP = /^(?:workspace|link|file|catalog|portal):/;

// Расхождения preset-деп потребителя vs биндинг: [{key,from,to}]. Только семвер-ранги.
function presetDepDrift(pkg) {
  const ranges = presetRanges();
  const bad = [];
  for (const bucket of ["dependencies", "devDependencies"]) {
    for (const [key, cur] of Object.entries(pkg[bucket] ?? {}))
      if (ranges[key] && !LOCAL_DEP.test(cur) && cur !== ranges[key])
        bad.push({ key, from: cur, to: ranges[key] });
  }
  return bad;
}

// Проставить preset-деп ранги из биндинга (init-фикс/сид). Локальные протоколы не трогаем.
function setPresetDeps(pkg) {
  const ranges = presetRanges();
  for (const bucket of ["dependencies", "devDependencies"]) {
    const deps = pkg[bucket];
    for (const key of Object.keys(deps ?? {}))
      if (ranges[key] && !LOCAL_DEP.test(deps[key])) deps[key] = ranges[key];
  }
}

// Мин-версия из ранга "^0.1.1" → [0,1,1]; cmp по major/minor/patch.
const minVer = (r) => {
  const m = String(r).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmpVer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Version-guard за пределы skeleton (K2): warn, если УСТАНОВЛЕННАЯ версия пресета (node_modules)
// ниже биндинга. Best-effort — только когда пресет реально установлен.
function warnStalePresets(target) {
  for (const [pkg, range] of Object.entries(presetRanges())) {
    const p = join(target, "node_modules", pkg, "package.json");
    if (!existsSync(p)) continue;
    const inst = minVer(JSON.parse(readFileSync(p, "utf8")).version);
    const want = minVer(range);
    if (inst && want && cmpVer(inst, want) < 0)
      console.warn(
        `[skeleton preset-version] ${pkg}: установлено ${inst.join(".")} < биндинг ${range} — обнови (pnpm install).`,
      );
  }
}

function main() {
  printVersion();
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const target = resolve(args.filter((a) => !a.startsWith("--"))[0] ?? ".");
  const { stacks, source, entry } = resolveStacks(target);
  // node = nx-монорепо (корневой nx/package/biome + node-ci); frontend = standalone-фронт
  // (свой воркспейс + web-ci, БЕЗ навязывания корневого nx-набора) — стеки РАЗВЕДЕНЫ.
  const hasNode = stacks.includes("node");
  const hasGo = stacks.includes("go");
  const hasFrontend = stacks.includes("frontend");
  const frontendWorkdir = entry?.frontend?.["working-directory"] ?? ".";
  console.log(`[skeleton] стек: [${stacks.join(", ")}] (${source})`);
  const drift = [];
  const actions = [];

  // 1-4. Рамка применяется ДИСПАТЧЕМ по declared mode (DEVOPSER-99), не по секции/массиву.
  // Порядок применения (как прежде): exact (managed, все стеки) → block (.gitignore) →
  // pins (package.json, node) → seed (init-only, per stack; только init, НЕ drift). Каждая
  // запись несёт mode → DISPATCH выбирает хендлер. seed в --check не участвует (init-only).
  const ctx = { target, check, drift, actions, name: basename(target) };
  const seed = check
    ? []
    : [...COMMON_TEMPLATES, ...(hasNode ? NODE_TEMPLATES : []), ...(hasGo ? GO_TEMPLATES : [])];
  const frame = [...MANAGED, ...BLOCK, ...PINS.filter((e) => inStack(e, stacks)), ...seed];
  for (const e of frame) DISPATCH[e.mode](e, ctx);

  // 5. CI-caller'ы per stack (mode seed по смыслу, но ci.yml — вычисляемый per-stack артефакт:
  //    отдельный код-хендлер). ci.yml по стеку + pr-title всем; init-only.
  if (!check) {
    const ciPath = join(target, ".github/workflows/ci.yml");
    if (!existsSync(ciPath)) {
      writeLf(ciPath, buildCiYml({ hasGo, hasNode, hasFrontend, frontendWorkdir }));
      actions.push(".github/workflows/ci.yml: создан (caller per stack)");
    }
    const prPath = join(target, ".github/workflows/pr-title.yml");
    if (!existsSync(prPath)) {
      writeLf(prPath, readEtalon("ci-caller/pr-title.yml"));
      actions.push(".github/workflows/pr-title.yml: создан (caller)");
    }
  }

  // Version-guard (DEVOPSER-100): warn при отставании УСТАНОВЛЕННОЙ версии пресета от биндинга
  // (в обоих режимах, best-effort — не гейт, дрейф ловит preset-деп package.json).
  warnStalePresets(target);
  // Группировка пресетов по target (DEVOPSER-101): repo-config активен, release/git-flow — пусты.
  reportTargets(target);

  // 6. Пресет-контракт (DEVOPSER-98): каждый bound-пресет живёт ВНУТРИ рамки. Hard-гейт в
  //    ОБОИХ режимах (init после материализации / --check по факту репо) — loud-fail, не дрейф.
  const presetErrors = validatePresets(target, stacks);
  if (presetErrors.length) {
    console.error(`[skeleton preset-check] пресет ВНЕ рамки (${presetErrors.length}):`);
    for (const e of presetErrors) console.error(`  - ${e}`);
    console.error(
      "Пресет не выходит за рамку (DEVOPSER-95): стек пресета обязан совпадать со стеком репо.",
    );
    process.exit(1);
  }

  if (check) {
    if (drift.length) {
      console.error(`[skeleton drift-check] ДРЕЙФ против эталона devopser (${drift.length}):`);
      for (const d of drift) console.error(`  - ${d}`);
      console.error(
        "Синк (явной командой): node node_modules/@omnifield/skeleton/init.mjs  # или из клона devopser",
      );
      process.exit(1);
    }
    console.log("[skeleton drift-check] чисто — вендоренные копии совпадают с эталоном.");
    return;
  }

  if (actions.length) {
    console.log(`[skeleton init] ${target}:`);
    for (const a of actions) console.log(`  - ${a}`);
    // husky ставится pnpm prepare-хуком → хинт только node/frontend-репо (у go-репо pnpm нет).
    if (hasNode) console.log("Дальше: pnpm install (поставит husky prepare-хуком).");
  } else {
    console.log("[skeleton init] всё уже в актуале, изменений нет.");
  }
}

main();

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
// СТЕК репо (node / go / frontend / python; репо может быть мульти-стек, напр. go+frontend или
// node+python — brainer) — источник правды platform/repo-flow.json (поле `stack`), фолбэк — детект
// по фактам репо (go.mod→go, package.json→node, pyproject.toml|uv.lock→python). Ветвление — ПО
// СТЕКУ, НЕ по имени репо (north-star брифа): go-путь работает для любого go-репо, node — для любого.
//   node     = nx-монорепо (pnpm+nx в корне) → node-ci + корневой nx/package/biome-набор.
//   frontend = standalone-фронт (свой pnpm-воркспейс, vite, БЕЗ nx) → web-ci-caller,
//              БЕЗ навязывания корневого nx-набора (у фронта свои конфиги в воркспейсе).
//              working-directory фронта — из repo-flow.json (frontend.working-directory).
//   python   = uv-репо (FastAPI+uv прототип brainer, DEVOPSER-159) → python-ci-caller +
//              seed-канон (pyproject ruff/uv-пин + .python-version); аддитивно, полиглот с node.
//
// Managed-набор (сверяется drift-check'ом; синк — только явной командой, не молча):
//   общий (все стеки): .editorconfig / .gitattributes / .npmrc / devbox-* /
//                      .gitignore managed-блок;
//   node: .husky/* (nx-хуки: sherif / nx affected — валидны только в nx-монорепо; go/frontend
//         их не тянут, иначе drift-red / падающий хук — DEVOPSER-45) + package.json пины.
// Init-only (создаются, если отсутствуют; НЕ drift-managed — репо легитимно правит):
//   общий: .devcontainer / devbox.services.json / CI-caller'ы (ci.yml + pr-title.yml);
//   node: nx.json / biome.json / dependabot;  go: .golangci.yml / sqlc.yaml;
//   python: pyproject.toml (ruff/uv-пин канон) / .python-version — repo-owned, uv.lock тоже.
// nx.json / biome.json — репо расширяет пресеты (pythonSources/test:py — @omnifield/nx-preset);
// go-шаблоны — продукт правит пути/движок БД; python-канон — seed (как biome.json, не exact).

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
const PYTHON_TEMPLATES = TEMPLATE.templates.python; // mode seed (DEVOPSER-159)
const CI_JOB = TEMPLATE.ci.jobs;
const PERM_ORDER = TEMPLATE.ci.permOrder;

const BLOCK_START =
  "# >>> omnifield-skeleton (managed by devopser; синк: init.mjs, не редактировать руками) >>>";
const BLOCK_END = "# <<< omnifield-skeleton <<<";

const norm = (s) => s.replace(/\r\n/g, "\n");
// Эталон записи. root по умолчанию — files/ devopser; для frame-записи плагина root = корень
// КОНТЕНТА пакета плагина (DEVOPSER-163) — src резолвится оттуда, не из files/ devopser.
const readEtalon = (name, root = FILES) => norm(readFileSync(join(root, name), "utf8"));
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
  // python аддитивно + полиглот (DEVOPSER-159): pyproject.toml ИЛИ uv.lock → python. Стеки НЕ
  // взаимоисключающие — brainer = node+python одновременно (nx-монорепо с py-пакетами). go/node-
  // детект выше НЕ трогаем.
  if (existsSync(join(target, "pyproject.toml")) || existsSync(join(target, "uv.lock")))
    s.push("python");
  if (s.length) return s;
  // Голый репо без объявленного стека (нет go.mod/package.json И нет repo-flow.json[<name>].stack —
  // resolveStacks зовёт detect только без записи). НЕ гадаем МОЛЧА (DEVOPSER-131): молчаливый
  // node-дефолт затягивал node-инфру в Go-репо без go.mod на момент провижна. Loud WARN в stderr;
  // node-дефолт сохраняем для обратной совместимости (hard-require ломал бы пустые репо).
  const name = basename(target);
  console.error(
    `[skeleton] ⚠ стек для «${name}» не объявлен — по умолчанию node.\n` +
      `           Задай platform/repo-flow.json[${name}].stack ИЛИ добавь go.mod/package.json ПЕРЕД провижном.`,
  );
  return ["node"];
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
function buildCiYml({ hasGo, hasNode, hasFrontend, hasPython, frontendWorkdir }) {
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
  // python-контур (DEVOPSER-159): deps из PyPI (не @omnifield Packages) + нет nx-set-shas →
  // сверх contents:read прав не требует. Дефолтная matrix python-ci = корень (["."]); uv-workspace-
  // репо докручивает `with: packages` в своём (init-only) ci.yml.
  if (hasPython) jobs.push(CI_JOB.python);
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

function gitignoreBlock(src, root) {
  return `${BLOCK_START}\n${readEtalon(src, root).trimEnd()}\n${BLOCK_END}\n`;
}

// Возвращает { expected } содержимого .gitignore после синка блока (src эталона блока — из манифеста).
function spliceGitignore(current, src, root) {
  const block = gitignoreBlock(src, root);
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

function pins(src, root) {
  const tpl = JSON.parse(readEtalon(src, root));
  return { packageManager: tpl.packageManager, node: tpl.engines.node };
}

// --- Apply-хендлеры по режиму (DEVOPSER-99) ----------------------------------
// mode в template.json ВЫБИРАЕТ хендлер (диспатч), не массив/секция. Поведение — как было.
// ctx = { target, check, drift, actions, name }. Хендлеры пишут в drift[] (--check) / actions[].

// Атрибуция SoT в drift-сообщении: managed-запись плагина дрейфит против эталона ПЛАГИНА
// (пакет+версия), не devopser (DEVOPSER-164). Core-записи (без pluginRef) → пусто.
const sotSuffix = (e) => (e.pluginRef ? ` (SoT: эталон плагина ${e.pluginRef})` : "");

// exact — managed: точная копия эталона, drift-fail; exec:true → mode 0755 (сверяется и в --check).
function applyExact(e, { target, check, drift, actions }) {
  const expected = readEtalon(e.src, e.root);
  const path = join(target, e.dest);
  const current = readTarget(path);
  if (current !== expected) {
    if (check)
      drift.push(
        `${e.dest}: ${current === null ? "отсутствует" : "отличается от эталона"}${sotSuffix(e)}`,
      );
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
  const { expected } = spliceGitignore(current, e.src, e.root);
  if (current === expected) return;
  if (check)
    drift.push(
      `${e.dest}: managed-блок ${current?.includes(BLOCK_START) ? "отличается" : "отсутствует"}${sotSuffix(e)}`,
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
  const { packageManager, node } = pins(e.src, e.root);
  if (raw === null) {
    if (check) drift.push(`${e.dest}: отсутствует${sotSuffix(e)}`);
    else {
      // Создаём из шаблона; ранги @omnifield preset-деп дерайвим из template.json.presets
      // (единый источник версий, DEVOPSER-100) — шаблон их НЕ хардкодит (__PRESET_VERSION__).
      const pkg = JSON.parse(readEtalon(e.src, e.root).replace("__NAME__", name));
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
  if (check) drift.push(`${e.dest} пины: ${bad.join("; ")}${sotSuffix(e)}`);
  else {
    pkg.packageManager = packageManager;
    pkg.engines = { ...pkg.engines, node };
    setPresetDeps(pkg);
    writeLf(path, `${JSON.stringify(pkg, null, 2)}\n`);
    actions.push(`${e.dest}: пины починены (${bad.join("; ")})`);
  }
}

// Node/frontend-хвост postCreateCommand devcontainer'а (DEVOPSER-45): npm-whoami-гейт (@omnifield-PAT)
// + pnpm install — ТОЛЬКО для node/frontend-стека. go-only → пустой хвост (devcontainer без npm/pnpm,
// иначе go-репо без PAT падает на старте). Воркдир pnpm-install — из repo-flow (frontendWorkdir),
// не хардкод 'web'. Только одинарные кавычки в шелле → валидный JSON без экранирования.
function nodePostCreate(stacks, frontendWorkdir) {
  if (!stacks.includes("node") && !stacks.includes("frontend")) return ""; // go-only: ноль npm/pnpm
  const auth =
    "(timeout 20 npm whoami --registry=https://npm.pkg.github.com >/dev/null 2>&1 || " +
    "{ echo '✖ npm.pkg.github.com: нет валидного PAT в $NPM_CONFIG_USERCONFIG (секрет-volume " +
    "omnifield-secrets) — @omnifield-пакеты не встанут. Занос кредов: devbox/README §Пост-шаги'; exit 1; })";
  // Корень (nx-монорепо) покрывает root pnpm install; фронт-в-сабдире — воркдир из repo-flow
  // (не хардкод 'web'). Воркдир-ветка только когда фронт живёт НЕ в корне.
  const wd = frontendWorkdir;
  const subdir =
    wd && wd !== "." ? `{ [ -f ${wd}/package.json ] && pnpm -C ${wd} install --frozen-lockfile; } || ` : "";
  const install = `{ [ -f package.json ] && pnpm install || ${subdir}echo 'no pnpm workspace — skip'; }`;
  return ` && ${auth} && ${install}`;
}

// Токены сида, вычисляемые по стеку репо. __NAME__ → basename(target) (package.json name,
// devcontainer network-alias — single-origin); __NODE_SETUP__ → стек-хвост devcontainer.
function seedTokens({ name, stacks, frontendWorkdir }) {
  return { __NAME__: name, __NODE_SETUP__: nodePostCreate(stacks, frontendWorkdir) };
}

// seed — init-only: создать, только если отсутствует; НЕ drift-managed (репо легитимно правит).
// Токены (__NAME__/__NODE_SETUP__) подставляются по стеку репо — тот же шаблон даёт стек-чистый
// артефакт (go-devcontainer без node-утечек). Токен, отсутствующий в файле, → replaceAll no-op.
function applySeed(e, { target, actions, tokens }) {
  const path = join(target, e.dest);
  if (existsSync(path)) return;
  let content = readEtalon(e.src, e.root);
  for (const [tok, val] of Object.entries(tokens)) content = content.replaceAll(tok, val);
  writeLf(path, content);
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
// группировки slots). Core-набор = ключи template.json.targets. Таксономия ОТКРЫТА
// (DEVOPSER-165): `extra` — таргеты, admit'нутые РЕГИСТРАЦИЕЙ забинженных плагинов (devopser
// не держит список target'ов продуктов). Без extra → закрытый core-набор (пресеты).
const knownTargets = (extra = []) =>
  new Set([...Object.keys(TEMPLATE.targets ?? {}).filter((t) => !t.startsWith("$")), ...extra]);

// Enum mechanism (пресет-контракт -98): КАК пресет потребляется. extends (nx/biome) / import
// (vite) / read (git-flow ЧИТАЕТСЯ тулингом — не extends/import; DEVOPSER-103). Расширяемо.
const KNOWN_MECHANISMS = new Set(["extends", "import", "read"]);

// --- Plugin-контракт (DEVOPSER-108, knowledger DEVOPSER-6) --------------------
// Третий примитив рядом с template(рамка)/preset(дефолты слота): plugin — НОВАЯ капабилити
// СНАРУЖИ, продукт-провайдер публикует её сам, движок материализует вслепую через тот же
// DISPATCH. Метаданные плагина — обобщённый omnifield-блок:
//   { kind:plugin, target, stack, mechanism, contentRoot, frame:[{src,dest,mode,stack?}] }.
// contentRoot — папка контента ВНУТРИ пакета плагина; frame-запись = байт-в-байт shape
// записи template.json (src/dest/mode[/stack]). У плагина mechanism = словарь DISPATCH
// (mode доставки контента), а не потребление-тулингом (как у пресета).
const KNOWN_KINDS = new Set(["preset", "plugin"]);
// Режимы доставки контента плагина = словарь хендлеров DISPATCH (exact|seed|block|pins).
const KNOWN_MODES = new Set(Object.keys(DISPATCH));

// git-flow-пресет доставляется ВЕНДОРЕННЫМ managed-файлом git-flow.json (не npm; language-agnostic,
// DEVOPSER-113) — его метаданные (omnifield) движок читает из эталона, а не из node_modules.
function vendoredGitFlowMeta() {
  try {
    return JSON.parse(readEtalon("git-flow.json")).omnifield ?? null;
  } catch {
    return null;
  }
}

// Валидация метаданных капабилити — ОБЩАЯ для preset и plugin (DEVOPSER-162, обобщение
// validatePresetMeta). kind ∈ {preset,plugin}; target ∈ переданный набор известных (для плагина
// набор ОТКРЫТ регистрацией — DEVOPSER-165, поэтому targets приходит снаружи, валидатор не
// знает, откуда набор); mechanism-enum зависит от kind. Для плагина — плюс plugin-shape
// (contentRoot + frame). Contract-first: невалидные метаданные → плагин/пресет не грузится.
function validateMeta(label, meta, targets) {
  const errors = [];
  const kind = meta.kind ?? "preset";
  if (!KNOWN_KINDS.has(kind)) {
    errors.push(`${label}: kind '${meta.kind}' ∉ {${[...KNOWN_KINDS].join(", ")}}`);
    return errors; // неизвестный kind — валидировать остальное нечем
  }
  if (!targets.has(meta.target))
    errors.push(`${label}: target '${meta.target}' ∉ известные {${[...targets].join(", ")}}`);
  // mechanism: пресет потребляется тулингом (extends/import/read); плагин доставляет контент
  // режимом DISPATCH (exact/seed/block/pins).
  const mechEnum = kind === "plugin" ? KNOWN_MODES : KNOWN_MECHANISMS;
  if (meta.mechanism && !mechEnum.has(meta.mechanism))
    errors.push(`${label}: mechanism '${meta.mechanism}' ∉ {${[...mechEnum].join(", ")}}`);
  if (kind === "plugin") errors.push(...validatePluginShape(label, meta));
  return errors;
}

// Плагин-специфичная форма: contentRoot (откуда контент) + непустой frame; каждая frame-запись =
// {src,dest,mode∈DISPATCH}. Без валидной формы плагин не грузится (contract-first).
function validatePluginShape(label, meta) {
  const errors = [];
  if (typeof meta.contentRoot !== "string" || !meta.contentRoot)
    errors.push(`${label}: plugin обязан объявить contentRoot (папка контента в пакете плагина)`);
  if (!Array.isArray(meta.frame) || meta.frame.length === 0) {
    errors.push(`${label}: plugin обязан объявить непустой frame [{src,dest,mode}]`);
    return errors;
  }
  meta.frame.forEach((e, i) => {
    if (typeof e.src !== "string" || !e.src) errors.push(`${label}: frame[${i}].src обязателен`);
    if (typeof e.dest !== "string" || !e.dest) errors.push(`${label}: frame[${i}].dest обязателен`);
    if (!KNOWN_MODES.has(e.mode))
      errors.push(`${label}: frame[${i}].mode '${e.mode}' ∉ {${[...KNOWN_MODES].join(", ")}}`);
  });
  return errors;
}

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
    errors.push(...validateMeta(`биндинг '${slot}' → ${pkg}`, meta, knownTargets()));
    if (meta.slot !== slot)
      errors.push(`биндинг '${slot}' → ${pkg}, но пресет объявляет slot '${meta.slot}'`);
    const dest = slotDest[slot];
    if (dest && existsSync(join(target, dest)) && !stackInFrame(meta.stack, stacks))
      errors.push(
        `${dest} тянет ${pkg} (stack ${JSON.stringify(meta.stack)}) — вне рамки репо [${stacks.join(", ")}]`,
      );
  }

  // Вендоренный git-flow-пресет (DEVOPSER-113): метаданные из git-flow.json.omnifield — валидируем
  // так же (target/mechanism/kind ∈ известные). stack:any → всегда в рамке, dest-проверки нет.
  const gf = vendoredGitFlowMeta();
  if (gf) errors.push(...validateMeta("git-flow.json (вендоренный пресет)", gf, knownTargets()));

  return errors;
}

// --- Plugin-дискавери и биндинг (DEVOPSER-162 npm; вендор/version-pin — DEVOPSER-166) --------
// Биндинг плагинов — в манифесте потребителя omnifield.yaml (plugins:[...]), ЕДИНСТВЕННЫЙ путь
// для чужих продуктов (истина в манифестах, registry-ретайр DEVOPSER-135). template.json.plugins —
// ТОЛЬКО self-dogfood devopser (DEVOPSER-166). init.mjs — zero-dep, поэтому парсит plugins-список
// из omnifield.yaml сам (не тянет zod-схему contract-manifest).

const stripQuotes = (s) => s.replace(/^["']|["']$/g, "");

// Мини-парсер `plugins:`-списка из omnifield.yaml (zero-dep, целевой — не общий YAML). Поддержка:
// блок-последовательность (`plugins:\n  - "a@^1"`) и inline-flow (`plugins: ["a@^1", "b@^2"]`).
function parseYamlPlugins(text) {
  const lines = norm(text).split("\n");
  const i = lines.findIndex((l) => /^plugins:/.test(l));
  if (i === -1) return [];
  const inline = lines[i].slice("plugins:".length).trim();
  if (inline.startsWith("[")) {
    return inline
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === "" || /^\s*#/.test(l)) continue;
    const m = l.match(/^\s+-\s+(.*\S)\s*$/);
    if (!m) break; // дедент / следующий ключ верхнего уровня → конец списка
    out.push(stripQuotes(m[1].trim()));
  }
  return out;
}

function readOmnifieldPlugins(target) {
  const p = join(target, "omnifield.yaml");
  return existsSync(p) ? parseYamlPlugins(readFileSync(p, "utf8")) : [];
}

// Забинженные refs = манифест потребителя omnifield.yaml (ЕДИНСТВЕННЫЙ путь для чужих продуктов,
// DEVOPSER-135) ∪ template.json.plugins (ТОЛЬКО self-dogfood devopser на своём репо; публикуется
// null → у потребителей пусто). Dedup по ref.
function boundPluginRefs(target) {
  const selfDogfood = Array.isArray(TEMPLATE.plugins) ? TEMPLATE.plugins : [];
  return [...new Set([...readOmnifieldPlugins(target), ...selfDogfood])];
}

// Резолв метаданных+контент-рута+версии плагина — ДВОЙНАЯ доставка (DEVOPSER-166, как git-flow
// DEVOPSER-113, language-agnostic):
//   npm    — пакет в node_modules потребителя, метаданные из package.json.omnifield (JS-репо);
//   вендор — бандл вендорится файлами, метаданные из plugin.json.omnifield (go/не-npm репо, куда
//            npm не долетает). Конвенция: .omnifield/plugins/<localName>/plugin.json (+ контент).
// null → не резолвится (напр. до install) → best-effort skip, как у пресетов; жёсткий гейт в CI.
function resolvePlugin(pkg, target) {
  const local = pkg.replace(/^@[^/]+\//, "");
  const candidates = [
    { dir: join(target, "node_modules", pkg), file: "package.json", source: `node_modules/${pkg}` },
    {
      dir: join(target, ".omnifield/plugins", local),
      file: "plugin.json",
      source: `.omnifield/plugins/${local}`,
    },
  ];
  for (const c of candidates) {
    const p = join(c.dir, c.file);
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.omnifield)
      return { dir: c.dir, meta: j.omnifield, version: j.version ?? null, source: c.source };
  }
  return null;
}

// Забинженные плагины (ref → {pkg,range,dir,meta,version,source}). Нерезолвленные несут meta:null.
function discoverPlugins(target) {
  return boundPluginRefs(target).map((ref) => {
    const { pkg, range } = parsePresetRef(ref);
    const res = resolvePlugin(pkg, target);
    return {
      ref,
      pkg,
      range,
      dir: res?.dir ?? null,
      meta: res?.meta ?? null,
      version: res?.version ?? null,
      source: res?.source ?? null,
    };
  });
}

// Frame-записи забинженных плагинов → плоский список {src,dest,mode,stack?,root} (DEVOPSER-163/164).
// root = корень КОНТЕНТА плагина (пакет плагина + contentRoot): readEtalon берёт src ОТТУДА, не
// из files/ devopser — контент чужого продукта в репо devopser не заезжает. Записи текут через
// ТОТ ЖЕ DISPATCH (shape байт-в-байт как template.json), движок не знает, что это плагин.
function pluginFrames(plugins) {
  const frames = [];
  for (const p of plugins) {
    if (!p.meta || !Array.isArray(p.meta.frame)) continue;
    const root = join(p.dir, p.meta.contentRoot);
    // pluginRef (напр. "@x/harness@^0.1.0") — атрибуция drift SoT: managed-запись плагина
    // дрейфит против эталона ПЛАГИНА (пакет+версия), не devopser (DEVOPSER-164).
    for (const e of p.meta.frame) frames.push({ ...e, root, pluginRef: p.ref });
  }
  return frames;
}

// Валидация забинженных плагинов (DEVOPSER-162/165): метаданные ∈ контракт (validateMeta
// kind:plugin), stack плагина совместим со стеком репо, открытая таксономия + collision-check.
// `plugins` — уже резолвленные (meta present); нерезолвленные отсеяны в main (гейт в CI, где deps стоят).
function validateBoundPlugins(plugins, stacks) {
  const errors = [];
  const core = knownTargets(); // core-таргеты (закрытый набор пресетов)
  // Открытая таксономия (DEVOPSER-165): target admit'ится РЕГИСТРАЦИЕЙ плагина (= биндинг
  // потребителя). Набор известных для плагин-валидации = core ∪ таргеты забинженных плагинов.
  const registered = plugins.map((p) => p.meta.target).filter(Boolean);
  const open = knownTargets(registered);
  for (const { ref, meta, source } of plugins) {
    const label = `plugin '${ref}' (${source})`;
    errors.push(...validateMeta(label, meta, open));
    // Коллизия plugin-target ↔ core → loud-fail: плагин не вправе переопределять core-капабилити.
    if (core.has(meta.target))
      errors.push(
        `${label}: target '${meta.target}' КОЛЛИЗИТ с core-таргетом {${[...core].join(", ")}} — переопределение запрещено`,
      );
    if (meta.stack && !stackInFrame(meta.stack, stacks))
      errors.push(
        `${label}: stack ${JSON.stringify(meta.stack)} — вне рамки репо [${stacks.join(", ")}]`,
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
  // вендоренный git-flow-пресет (не npm, DEVOPSER-113)
  const gf = vendoredGitFlowMeta();
  if (gf?.target && groups[gf.target]) groups[gf.target].push(gf.slot);
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

// Version-guard плагинов (DEVOPSER-166, реюз модели DEVOPSER-100): warn, если УСТАНОВЛЕННАЯ версия
// плагина (npm package.json / вендор plugin.json) ниже пина omnifield.yaml. Best-effort (только
// когда версия резолвится). Жёсткая propagation — content-drift managed-записей против эталона
// плагина (bump → новый контент → --check краснеет → re-init синкает).
function warnStalePlugins(plugins) {
  for (const { pkg, range, version } of plugins) {
    if (!range || !version) continue;
    const inst = minVer(version);
    const want = minVer(range);
    if (inst && want && cmpVer(inst, want) < 0)
      console.warn(
        `[skeleton plugin-version] ${pkg}: установлено ${inst.join(".")} < пин ${range} (omnifield.yaml) — обнови.`,
      );
  }
}

// Репорт забинженных плагинов по target (открытая таксономия видна; DEVOPSER-166). Пусто → тихо.
function reportPlugins(plugins) {
  if (!plugins.length) return;
  const line = plugins.map((p) => `${p.meta.target}: ${p.ref} (${p.source})`).join(" | ");
  console.log(`[skeleton plugins] ${line}`);
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
  const hasPython = stacks.includes("python");
  const frontendWorkdir = entry?.frontend?.["working-directory"] ?? ".";
  console.log(`[skeleton] стек: [${stacks.join(", ")}] (${source})`);
  const drift = [];
  const actions = [];

  // 0. Plugin-контракт (DEVOPSER-108/162/165): дискаверим забинженные плагины ОДИН раз (для
  //    валидации И для рамки). Валидируем ДО материализации — контракт-first: плагин без
  //    валидного контракта НЕ грузится (его контент не заезжает в репо). В отличие от пресета
  //    (валидируется в конце — он не пишет внешний контент), плагин пишет ЧУЖОЙ контент → гейт
  //    раньше записи. Нерезолвленные (до install) отсеиваем — best-effort, гейт в CI --check.
  const plugins = discoverPlugins(target).filter((p) => p.meta);
  const pluginErrors = validateBoundPlugins(plugins, stacks);
  if (pluginErrors.length) {
    console.error(`[skeleton plugin-check] плагин вне контракта (${pluginErrors.length}):`);
    for (const e of pluginErrors) console.error(`  - ${e}`);
    console.error(
      "Плагин без валидного контракта не грузится (knowledger DEVOPSER-6): kind:plugin + target " +
        "(не коллизит с core) + contentRoot + frame[{src,dest,mode}] обязательны.",
    );
    process.exit(1);
  }

  // 1-4. Рамка применяется ДИСПАТЧЕМ по declared mode (DEVOPSER-99), не по секции/массиву.
  // Порядок применения (как прежде): exact (managed, по стеку) → block (.gitignore) →
  // pins (package.json, node) → seed (init-only, per stack; только init, НЕ drift). Каждая
  // запись несёт mode → DISPATCH выбирает хендлер. seed в --check не участвует (init-only).
  const name = basename(target);
  const tokens = seedTokens({ name, stacks, frontendWorkdir });
  const ctx = { target, check, drift, actions, name, tokens };
  const seed = check
    ? []
    : [
        ...COMMON_TEMPLATES,
        ...(hasNode ? NODE_TEMPLATES : []),
        ...(hasGo ? GO_TEMPLATES : []),
        ...(hasPython ? PYTHON_TEMPLATES : []),
      ];
  // MANAGED тоже фильтруется по стеку (DEVOPSER-45): .husky/* — node-only (nx-хуки), не всем стекам.
  const frame = [
    ...MANAGED.filter((e) => inStack(e, stacks)),
    ...BLOCK,
    ...PINS.filter((e) => inStack(e, stacks)),
    ...seed,
  ];
  for (const e of frame) DISPATCH[e.mode](e, ctx);

  // Frame-фрагмент от плагинов (DEVOPSER-163/164): те же mode → ТОТ ЖЕ DISPATCH, но src берётся
  // из корня контента ПАКЕТА плагина (e.root), а drift managed-записей краснеет против эталона
  // ПЛАГИНА (не devopser). seed плагина — init-only (как core-seed, в --check не участвует).
  // Контент плагина verbatim — БЕЗ devopser-токенов (__NAME__/__NODE_SETUP__ — концерн скелетона).
  const pf = pluginFrames(plugins).filter((e) => inStack(e, stacks));
  const pluginFrame = check ? pf.filter((e) => e.mode !== "seed") : pf;
  const pctx = { ...ctx, tokens: {} };
  for (const e of pluginFrame) DISPATCH[e.mode](e, pctx);

  // 5. CI-caller'ы per stack (mode seed по смыслу, но ci.yml — вычисляемый per-stack артефакт:
  //    отдельный код-хендлер). ci.yml по стеку + pr-title всем; init-only.
  if (!check) {
    const ciPath = join(target, ".github/workflows/ci.yml");
    if (!existsSync(ciPath)) {
      writeLf(ciPath, buildCiYml({ hasGo, hasNode, hasFrontend, hasPython, frontendWorkdir }));
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
  warnStalePlugins(plugins); // version-guard плагинов (DEVOPSER-166)
  // Группировка пресетов по target (DEVOPSER-101): repo-config активен, release/git-flow — пусты.
  reportTargets(target);
  reportPlugins(plugins); // забинженные плагины по target (открытая таксономия, DEVOPSER-166)

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

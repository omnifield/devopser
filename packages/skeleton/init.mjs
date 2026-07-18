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
const MANAGED = TEMPLATE.managed;
const COMMON_TEMPLATES = TEMPLATE.templates.common;
const NODE_TEMPLATES = TEMPLATE.templates.node;
const GO_TEMPLATES = TEMPLATE.templates.go;
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

function gitignoreBlock() {
  return `${BLOCK_START}\n${readEtalon("gitignore-block").trimEnd()}\n${BLOCK_END}\n`;
}

// Возвращает { expected } содержимого .gitignore после синка блока.
function spliceGitignore(current) {
  const block = gitignoreBlock();
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

function pins() {
  const tpl = JSON.parse(readEtalon("package-template.json"));
  return { packageManager: tpl.packageManager, node: tpl.engines.node };
}

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
    const dest = slotDest[slot];
    if (dest && existsSync(join(target, dest)) && !stackInFrame(meta.stack, stacks))
      errors.push(
        `${dest} тянет ${pkg} (stack ${JSON.stringify(meta.stack)}) — вне рамки репо [${stacks.join(", ")}]`,
      );
  }
  return errors;
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

  // 1. Точные managed-копии (общий набор, все стеки).
  for (const { src, dest, exec } of MANAGED) {
    const expected = readEtalon(src);
    const path = join(target, dest);
    const current = readTarget(path);
    if (current !== expected) {
      if (check)
        drift.push(`${dest}: ${current === null ? "отсутствует" : "отличается от эталона"}`);
      else {
        writeLf(path, expected, exec);
        actions.push(`${dest}: ${current === null ? "создан" : "синкнут"}`);
      }
    }
    // exec-бит гарантируем независимо от совпадения контента (init-путь);
    // в --check — сверяем его как дрейф (файл с совпавшим контентом, но 100644
    // проходил бы зелёным, а launcher сломан: husky ловит, CI-drift был слеп).
    if (exec && existsSync(path)) {
      if (check) {
        if ((statSync(path).mode & 0o777) !== 0o755) drift.push(`${dest}: exec-бит ≠ 0755`);
      } else if (ensureExec(path)) {
        actions.push(`${dest}: exec-бит (0755) починен`);
      }
    }
  }

  // 2. Managed-блок .gitignore (общий).
  const giPath = join(target, ".gitignore");
  const giCurrent = readTarget(giPath);
  const { expected: giExpected } = spliceGitignore(giCurrent);
  if (giCurrent !== giExpected) {
    if (check)
      drift.push(
        `.gitignore: managed-блок ${giCurrent?.includes(BLOCK_START) ? "отличается" : "отсутствует"}`,
      );
    else {
      writeLf(giPath, giExpected);
      actions.push(".gitignore: managed-блок синкнут");
    }
  }

  // 3. package.json пины — только node-стек (nx-монорепо в корне). go-репо и standalone-фронт
  //    корневой package.json не несут (у фронта он в своём воркспейсе).
  if (hasNode) {
    const pkgPath = join(target, "package.json");
    const pkgRaw = readTarget(pkgPath);
    const { packageManager, node } = pins();
    if (pkgRaw === null) {
      if (check) drift.push("package.json: отсутствует");
      else {
        const tpl = readEtalon("package-template.json").replace("__NAME__", basename(target));
        writeLf(pkgPath, tpl);
        actions.push("package.json: создан из шаблона");
      }
    } else {
      const pkg = JSON.parse(pkgRaw);
      const bad = [];
      if (pkg.packageManager !== packageManager)
        bad.push(`packageManager: ${pkg.packageManager ?? "нет"} → ${packageManager}`);
      if (pkg.engines?.node !== node)
        bad.push(`engines.node: ${pkg.engines?.node ?? "нет"} → ${node}`);
      if (bad.length) {
        if (check) drift.push(`package.json пины: ${bad.join("; ")}`);
        else {
          pkg.packageManager = packageManager;
          pkg.engines = { ...pkg.engines, node };
          writeLf(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
          actions.push(`package.json: пины починены (${bad.join("; ")})`);
        }
      }
    }
  }

  // 4. Init-only шаблоны — по стеку, только если отсутствуют. НЕ drift-managed.
  // __NAME__ → basename(target): package.json name, devcontainer network-alias (single-origin).
  if (!check) {
    const templates = [
      ...COMMON_TEMPLATES,
      ...(hasNode ? NODE_TEMPLATES : []),
      ...(hasGo ? GO_TEMPLATES : []),
    ];
    for (const { src, dest } of templates) {
      const path = join(target, dest);
      if (existsSync(path)) continue;
      writeLf(path, readEtalon(src).replaceAll("__NAME__", basename(target)));
      actions.push(`${dest}: создан из шаблона`);
    }

    // 5. CI-caller'ы per stack (init-only): ci.yml по стеку + pr-title всем.
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

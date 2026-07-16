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

// exec: true → материализуется с mode 0755 (B7, brief devbox-first-run-dx: launcher теряет
// exec-бит при правке через \\wsl.localhost → init ставит бит, husky-pre-commit его сторожит).
// Общий набор — для ВСЕХ стеков (brief §1: editorconfig/gitattributes/husky/devbox-*).
const MANAGED = [
  { src: "editorconfig", dest: ".editorconfig" },
  { src: "gitattributes", dest: ".gitattributes" },
  { src: "npmrc", dest: ".npmrc" },
  { src: "husky-pre-commit", dest: ".husky/pre-commit" },
  { src: "husky-pre-push", dest: ".husky/pre-push" },
  // dev-services оркестратор + session-launcher + headless-провижинер (+ его манифест-эмиттер)
  // — чистый механизм (brief A2/A3/B6 + Шаг 2), drift-managed как husky: фикс обязан
  // пропагироваться во все продукт-devbox'ы.
  { src: "devbox-services.mjs", dest: "scripts/devbox-services.mjs" },
  { src: "devbox-session.sh", dest: "scripts/devbox-session.sh", exec: true },
  { src: "devbox.sh", dest: "scripts/devbox.sh", exec: true },
  { src: "devbox-manifest.mjs", dest: "scripts/devbox-manifest.mjs" },
  // publish-volume (Шаг 5 §A): чистый механизм публикации манифеста в registry-volume —
  // drift-managed, фикс обязан пропагироваться во все продукт-devbox'ы (как devbox-services).
  { src: "devbox-publish.mjs", dest: "scripts/devbox-publish.mjs" },
];

// Init-only шаблоны. Общий — devbox-инфра всем стекам; node/go — по стеку репо.
const COMMON_TEMPLATES = [
  { src: "devcontainer-template.json", dest: ".devcontainer/devcontainer.json" },
  // Декларация dev-сервисов (brief A1): набор сервисов = зона продукт-owner'а;
  // скелет ставит пустой пример ([]), содержимое пишет продукт.
  { src: "devbox.services.json", dest: "devbox.services.json" },
];
const NODE_TEMPLATES = [
  { src: "nx-template.json", dest: "nx.json" },
  { src: "biome-template.json", dest: "biome.json" },
  { src: "dependabot-template.yml", dest: ".github/dependabot.yml" },
];
const GO_TEMPLATES = [
  { src: "go/golangci-template.yml", dest: ".golangci.yml" },
  { src: "go/sqlc-template.yaml", dest: "sqlc.yaml" },
];

// CI-caller per stack: go→go-ci.yml, node→node-ci.yml (nx-монорепо),
// frontend→web-ci.yml (standalone-фронт, БЕЗ nx). pr-title — всем.
// permissions — по канону каждого reusable (go/frontend: contents:read; node: +actions,+packages).
const CI_JOB = {
  go: { name: "go", reusable: "go-ci.yml" },
  node: { name: "node", reusable: "node-ci.yml" },
  frontend: { name: "web", reusable: "web-ci.yml" },
};
const PERM_ORDER = ["contents: read", "actions: read", "packages: read"];

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
      if (j.workdir && j.workdir !== ".")
        s += `    with:\n      working-directory: ${j.workdir}\n`;
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

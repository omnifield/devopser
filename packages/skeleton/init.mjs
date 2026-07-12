#!/usr/bin/env node
// init.mjs — материализация / синк / drift-check skeleton-набора devopser
// (briefs/repo-skeleton-product.md D3). Zero-deps, только node:*.
//
//   node init.mjs [target]           — init/sync: вендорит managed-набор, создаёт
//                                      package.json/nx.json/biome.json из шаблонов
//                                      (только если отсутствуют), чинит пины.
//   node init.mjs --check [target]   — drift-check: ничего не пишет, exit 1 + список
//                                      расхождений (шаг reusable CI, action drift-check).
//
// Managed-набор (сверяется drift-check'ом; синк — только явной командой, не молча):
//   .editorconfig / .gitattributes / .npmrc / .husky/pre-commit — точная копия эталона;
//   .gitignore — managed-блок между маркерами (ниже блока репо дописывает своё);
//   package.json — пины packageManager + engines.node равны эталону.
// nx.json / biome.json — создаются init'ом, но НЕ drift-managed: репо легитимно
// расширяет пресеты (пример: python-таргеты brainer).

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = join(PKG_DIR, "files");

// К2-guard (briefs/repo-skeleton-product.md): печатаем свою версию при старте —
// тихий откат эталона (stale dist-tag) становится видимым в логе синка/CI.
function printVersion() {
  const { name, version } = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
  console.log(`${name} ${version}`);
}

// exec: true → материализуется с mode 0755 (B7, brief devbox-first-run-dx: launcher теряет
// exec-бит при правке через \\wsl.localhost → init ставит бит, husky-pre-commit его сторожит).
const MANAGED = [
  { src: "editorconfig", dest: ".editorconfig" },
  { src: "gitattributes", dest: ".gitattributes" },
  { src: "npmrc", dest: ".npmrc" },
  { src: "husky-pre-commit", dest: ".husky/pre-commit" },
  { src: "husky-pre-push", dest: ".husky/pre-push" },
  // dev-services оркестратор + session-launcher — чистый механизм (brief A2/A3/B6),
  // drift-managed как husky: фикс обязан пропагироваться во все продукт-devbox'ы.
  { src: "devbox-services.mjs", dest: "scripts/devbox-services.mjs" },
  { src: "devbox-session.sh", dest: "scripts/devbox-session.sh", exec: true },
];

const TEMPLATES = [
  { src: "package-template.json", dest: "package.json" },
  { src: "nx-template.json", dest: "nx.json" },
  { src: "biome-template.json", dest: "biome.json" },
  { src: "dependabot-template.yml", dest: ".github/dependabot.yml" },
  { src: "devcontainer-template.json", dest: ".devcontainer/devcontainer.json" },
  // Декларация dev-сервисов (brief A1): TEMPLATE init-only — набор сервисов = зона
  // продукт-owner'а; скелет ставит пример, содержимое пишет продукт. НЕ drift-managed.
  { src: "devbox.services.json", dest: "devbox.services.json" },
];

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

function gitignoreBlock() {
  return `${BLOCK_START}\n${readEtalon("gitignore-block").trimEnd()}\n${BLOCK_END}\n`;
}

// Возвращает { current, expected } содержимого .gitignore после синка блока.
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
  const drift = [];
  const actions = [];

  // 1. Точные managed-копии.
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

  // 2. Managed-блок .gitignore.
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

  // 3. package.json: шаблон (если нет) либо пины.
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

  // 4. Остальные шаблоны — только init, только если отсутствуют.
  // __NAME__ → basename(target): package.json name, devcontainer network-alias (single-origin).
  if (!check) {
    for (const { src, dest } of TEMPLATES.filter((t) => t.dest !== "package.json")) {
      const path = join(target, dest);
      if (existsSync(path)) continue;
      writeLf(path, readEtalon(src).replaceAll("__NAME__", basename(target)));
      actions.push(`${dest}: создан из шаблона`);
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
    console.log("Дальше: pnpm install (поставит husky prepare-хуком).");
  } else {
    console.log("[skeleton init] всё уже в актуале, изменений нет.");
  }
}

main();

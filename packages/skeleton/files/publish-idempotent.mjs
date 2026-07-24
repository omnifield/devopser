#!/usr/bin/env node
// Idempotent publish (DEVOPSER-132) — УНИВЕРСАЛЬНАЯ, root-agnostic (kb:ADR-17).
// Издаёт каждый публикуемый пакет по отдельности; уже опубликованную версию трактует как
// no-op (skip с логом), не как fail. Канон publish-must-be-idempotent (user, «каждый тянет
// что хочет»): инфра-publish выкатывает НОВЫЕ версии, дубликаты пропускает — не ломает
// продукты при партиал-бампе.
//
// Скан ПО ПАКЕТАМ, не по корню (kb:ADR-17): находит все `@omnifield/*` не-`private` пакеты
// ГДЕ БЫ ни лежали (пакет в подпапке go/python-корня — ок), БЕЗ корневого pnpm-workspace.
// Ноль публикуемых → зелёный no-op. Издаёт каждый `pnpm publish` в его директории
// (workspace-независимо; pnpm переписывает `workspace:*` в реальные версии).
//
// Реестр — источник правды: не пред-проверяем (TOCTOU), а трактуем conflict самой публикации
// (npm EPUBLISHCONFLICT / GitHub Packages 409 «cannot publish over») как skip.
//
//   node scripts/publish-idempotent.mjs [--dry-run]
//   node --test scripts/publish-idempotent.test.mjs   # skip-логика + скан, без сети
//
// NODE_AUTH_TOKEN наследуется из окружения (release.yml прокидывает GITHUB_TOKEN).

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// --- Чистая логика (юнит-тестируемо, без сети) -----------------------------

// Признаки «версия уже в реестре» — оба диалекта (npmjs + GitHub Packages).
const DUPLICATE_PATTERNS = [
  /EPUBLISHCONFLICT/i,
  /cannot publish over/i, // GH: «Cannot publish over existing version»
  /over existing version/i,
  /previously published version/i, // npm: «cannot publish over the previously published versions»
  /\bE?409\b/,
  /409 Conflict/i,
  /already exists/i,
];

// Только для НЕнулевого выхода — на успехе не вызывается, ложных срабатываний нет.
export function isDuplicateVersionError(output) {
  const text = String(output ?? "");
  return DUPLICATE_PATTERNS.some((re) => re.test(text));
}

export function classifyResult({ status, output }) {
  if (status === 0) return "published";
  if (isDuplicateVersionError(output)) return "skipped";
  return "failed";
}

// Публикуемый пакет = не-`private` И имя в scope `@omnifield` (единственный owner-неймспейс
// GH Packages, kb:DEVOPSER-6). Чужой scope в @omnifield-реестр не издаётся — не трогаем.
export function isPublishable(pkg) {
  return !pkg?.private && typeof pkg?.name === "string" && pkg.name.startsWith("@omnifield/");
}

// runPublish: (pkg) => { status, output } — инъектируется в тестах.
export function publishAll(packages, { runPublish, log = console.log } = {}) {
  const results = [];
  for (const pkg of packages) {
    const label = `${pkg.name}@${pkg.version}`;
    const { status, output } = runPublish(pkg);
    const outcome = classifyResult({ status, output });
    if (outcome === "published") log(`✔ published ${label}`);
    else if (outcome === "skipped") log(`↷ skip ${label} — уже в реестре (idempotent)`);
    else log(`✖ FAILED ${label}\n${(output ?? "").trim()}`);
    results.push({ pkg: label, outcome });
  }
  return results;
}

// Джоба зелёная, если нет ни одного genuine-fail; дубликаты не роняют.
export function exitCodeFor(results) {
  return results.some((r) => r.outcome === "failed") ? 1 : 0;
}

// --- Скан пакетов (root-agnostic, kb:ADR-17) -------------------------------
// Обходит дерево репо, находит `package.json` публикуемых пакетов ГДЕ БЫ ни лежали (пакет в
// подпапке go-корня — ок; корневой pnpm-workspace НЕ требуется — тот же корень, что GRABLI-13).
// Не спускается в вендор/сборку. Чистая (fs-only) — тестируется на temp-дереве, без сети.

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".omnifield",
]);

function readPkgJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function scanPackages(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) {
      const pkg = readPkgJson(join(dir, "package.json"));
      if (isPublishable(pkg)) out.push({ name: pkg.name, version: pkg.version, dir });
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
  };
  walk(root);
  return out;
}

// --- IO (сеть/процессы) ----------------------------------------------------

// Издаём одиночный пакет В ЕГО директории (cwd), без `--filter` → не требует workspace-корня
// (root-agnostic). `--no-git-checks` — publish из CI без чистого дерева.
function runPublish(pkg, { dryRun }) {
  const args = ["publish", "--no-git-checks"];
  if (dryRun) args.push("--dry-run");
  const res = spawnSync("pnpm", args, { cwd: pkg.dir, encoding: "utf8" });
  return { status: res.status ?? 1, output: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const packages = scanPackages(process.cwd());
  if (packages.length === 0) {
    console.log("Нет публикуемых @omnifield/* пакетов — зелёный no-op (kb:ADR-17).");
    process.exit(0);
  }
  console.log(
    `Публикуем ${packages.length} @omnifield/* пакет(ов) идемпотентно${dryRun ? " (dry-run)" : ""}:`,
  );
  const results = publishAll(packages, {
    runPublish: (p) => runPublish(p, { dryRun }),
  });
  const count = (o) => results.filter((r) => r.outcome === o).length;
  console.log(
    `\nИтог: опубликовано ${count("published")}, пропущено ${count("skipped")}, провалено ${count("failed")}.`,
  );
  process.exit(exitCodeFor(results));
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

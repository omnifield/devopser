#!/usr/bin/env node
// Idempotent publish (DEVOPSER-132): публикует каждый workspace-пакет по отдельности;
// уже опубликованную версию трактует как no-op (skip с логом), не как fail.
// Канон publish-must-be-idempotent (user, «каждый тянет что хочет»): инфра-publish
// выкатывает НОВЫЕ версии, дубликаты пропускает — не ломает продукты при партиал-бампе.
//
// Реестр — источник правды: не пред-проверяем (TOCTOU), а трактуем conflict самой
// публикации (npm EPUBLISHCONFLICT / GitHub Packages 409 «cannot publish over») как skip.
//
//   node scripts/publish-idempotent.mjs [--dry-run]
//   node --test scripts/publish-idempotent.test.mjs   # skip-логика, без сети
//
// NODE_AUTH_TOKEN наследуется из окружения (release.yml прокидывает GITHUB_TOKEN).

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
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

// --- IO (сеть/процессы) ----------------------------------------------------

function listPackages() {
  const res = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`pnpm ls failed:\n${res.stderr ?? ""}`);
  }
  return JSON.parse(res.stdout).filter((p) => !p.private);
}

function runPublish(pkg, { dryRun }) {
  const args = ["--filter", pkg.name, "publish", "--no-git-checks"];
  if (dryRun) args.push("--dry-run");
  const res = spawnSync("pnpm", args, { encoding: "utf8" });
  return { status: res.status ?? 1, output: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const packages = listPackages();
  console.log(
    `Публикуем ${packages.length} пакет(ов) идемпотентно${dryRun ? " (dry-run)" : ""}:`,
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

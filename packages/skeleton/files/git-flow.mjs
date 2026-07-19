#!/usr/bin/env node
// git-flow.mjs — agent-agnostic git-ИНСТРУМЕНТ (DEVOPSER-106). Managed-скрипт (как
// devbox-services.mjs): вендорится в каждый репо, ЧИТАЕТ связанный git-пресет (@omnifield/git-preset,
// DEVOPSER-103) и делает полный луп git без ручных команд. Zero-deps (node:* + шелл git/gh).
//
//   git-flow start <type>/<slug>   — ветка ОТ origin/main (свежий fetch; урок PR#26: не от грязного
//                                    local); имя валидируется против defaults.branchNaming.
//   git-flow commit <msg>          — коммит; defaults.commitConvention валидируется.
//   git-flow push                  — push текущей ветки в origin.
//   git-flow pr [--title T --body B] — открыть PR через gh (--base main).
//   git-flow land                  — frame.prRequired: требует открытый PR; ждёт зелёные
//                                    defaults.requiredChecks; defaults.merge через gh; удаляет
//                                    ветку; sync локальный main = origin/main.
//   git-flow sync                  — локальный main = origin/main.
//   (любая) --dry-run              — печатает мутации (git/gh write), не выполняет.
//
// Политики — ВСЕ из пресета (branchNaming / commitConvention / merge / requiredChecks;
// frame.mainProtected / frame.prRequired enforce). Хардкода флоу нет.
//
// ⚠️ AGENT-AGNOSTIC: инструмент про «кого» НЕ знает — просто выполняет операции. Кто вызывает и
//    кому что можно = концерн ПОТРЕБИТЕЛЯ (не devopser, не инструмент). Ноль owner/ролей/прав/gate.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

// --- Резолв git-пресета (как init.mjs resolvePresetMeta) ----------------------
// Идём вверх от cwd И от расположения скрипта, на каждом уровне пробуя node_modules потребителя
// (после install) → packages/git-preset монорепо (дев/dogfood). Робастно и для vendored scripts/,
// и для эталона files/.
const PRESET_REL = [
  "node_modules/@omnifield/git-preset/git-flow.json",
  "packages/git-preset/git-flow.json",
];
export function resolvePreset(startDir = process.cwd()) {
  for (const base of [startDir, HERE]) {
    let dir = base;
    for (;;) {
      for (const rel of PRESET_REL) {
        const p = join(dir, rel);
        if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  die(
    "[git-flow] git-пресет не найден: @omnifield/git-preset (git-flow.json). Установлен ли пресет?",
  );
}

// --- Политики пресета (чистые функции — бросают Error, main ловит) -------------

export function validateBranchName(name, pattern) {
  if (!name) throw new Error("start требует <type>/<slug>");
  if (!new RegExp(pattern).test(name))
    throw new Error(`имя ветки "${name}" не по branchNaming ${pattern} (напр. feat/my-slug).`);
  return name;
}

export function validateCommitMessage(msg, convention) {
  if (!msg) throw new Error("commit требует сообщение");
  if (convention === "conventional") {
    const re =
      /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([\w./-]+\))?!?: .+/;
    if (!re.test(msg)) throw new Error(`коммит "${msg}" не conventional (type(scope): описание).`);
  }
  return msg;
}

// frame.mainProtected: прямой коммит/пуш в main запрещён — работай на ветке.
export function assertNotMain(branch, frame) {
  if (frame?.mainProtected && branch === "main")
    throw new Error(
      "frame.mainProtected: прямой коммит/пуш в main запрещён — работай на ветке (git-flow start).",
    );
  return branch;
}

export function mergeFlag(merge) {
  const map = { squash: "--squash", merge: "--merge", rebase: "--rebase" };
  if (!map[merge]) throw new Error(`defaults.merge неизвестен: ${merge} (squash|merge|rebase).`);
  return map[merge];
}

// --- Executor: тонкая обёртка git/gh (инъектируется — тесты подсовывают мок) ---

export function realExec() {
  const call = (bin) => (args) => {
    const r = spawnSync(bin, args, { encoding: "utf8" });
    return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  return { git: call("git"), gh: call("gh"), log: (m) => console.log(m) };
}

// Мутация (write git/gh): --dry-run печатает, не выполняет; ненулевой код → Error.
function mutate(exec, dry, kind, args) {
  if (dry) {
    exec.log(`[dry-run] ${kind} ${args.join(" ")}`);
    return { code: 0, out: "", err: "" };
  }
  const r = exec[kind](args);
  if (r.code !== 0)
    throw new Error(`${kind} ${args.join(" ")} → ${(r.err || r.out || `code ${r.code}`).trim()}`);
  return r;
}

// Чтение (read): ненулевой код → Error с контекстом.
function read(exec, kind, args, what) {
  const r = exec[kind](args);
  if (r.code !== 0) throw new Error(`${what}: ${kind} ${args.join(" ")} → code ${r.code}`);
  return r.out.trim();
}

const currentBranch = (exec) => read(exec, "git", ["rev-parse", "--abbrev-ref", "HEAD"], "ветка");
const repoRoot = (exec) => {
  const r = exec.git(["rev-parse", "--show-toplevel"]);
  return r.code === 0 ? r.out.trim() : process.cwd();
};

// --- Субкоманды ---------------------------------------------------------------

function start(exec, preset, name, { dry }) {
  validateBranchName(name, preset.defaults.branchNaming);
  // ветка ОТ origin/main — свежий fetch, не от грязного local (урок PR#26).
  mutate(exec, dry, "git", ["fetch", "origin", "main"]);
  mutate(exec, dry, "git", ["checkout", "-b", name, "origin/main"]);
  exec.log(`[git-flow] ветка ${name} от origin/main.`);
}

function commit(exec, preset, msg, { dry }) {
  assertNotMain(currentBranch(exec), preset.frame);
  validateCommitMessage(msg, preset.defaults.commitConvention);
  mutate(exec, dry, "git", ["commit", "-m", msg]);
  exec.log("[git-flow] коммит создан.");
}

function push(exec, preset, { dry }) {
  const branch = assertNotMain(currentBranch(exec), preset.frame);
  mutate(exec, dry, "git", ["push", "-u", "origin", branch]);
  exec.log(`[git-flow] ${branch} → origin.`);
}

function pr(exec, preset, flags, { dry }) {
  assertNotMain(currentBranch(exec), preset.frame);
  const args = ["pr", "create", "--base", "main"];
  if (flags.title) args.push("--title", flags.title);
  if (flags.body) args.push("--body", flags.body);
  if (!flags.title) args.push("--fill"); // тайтл/тело из коммитов
  mutate(exec, dry, "gh", args);
  exec.log("[git-flow] PR открыт.");
}

// frame.prRequired: приземляем ТОЛЬКО через открытый PR.
function requireOpenPr(exec) {
  const r = exec.gh(["pr", "view", "--json", "state", "-q", ".state"]);
  if (r.code !== 0) throw new Error("frame.prRequired: открытого PR нет (git-flow pr).");
  if (r.out.trim() !== "OPEN") throw new Error(`frame.prRequired: PR не OPEN (${r.out.trim()}).`);
}

// Ждём зелёные checks. requiredChecks: "from-stack" → все проверки PR; массив → тоже ждём все
// зелёными (набор из стека — надмножество). gh pr checks: exit 0 = все прошли, 8 = pending.
const CHECKS_TRIES = 60;
const CHECKS_INTERVAL_S = 10;
function waitChecks(exec, _requiredChecks) {
  for (let i = 0; i < CHECKS_TRIES; i++) {
    const r = exec.gh(["pr", "checks"]);
    if (r.code === 0) return;
    if (r.code === 8) {
      exec.log("[git-flow] checks pending — ждём…");
      spawnSync("sleep", [String(CHECKS_INTERVAL_S)]);
      continue;
    }
    throw new Error(`checks не зелёные:\n${(r.out || r.err).trim()}`);
  }
  throw new Error("checks не дождались зелёного (timeout).");
}

function syncMain(exec, { dry } = {}) {
  mutate(exec, dry, "git", ["fetch", "origin", "main"]);
  mutate(exec, dry, "git", ["checkout", "main"]);
  mutate(exec, dry, "git", ["reset", "--hard", "origin/main"]);
  exec.log("[git-flow] local main = origin/main.");
}

async function land(exec, preset, _flags, { dry }) {
  const branch = assertNotMain(currentBranch(exec), preset.frame);
  if (preset.frame.prRequired) requireOpenPr(exec);
  waitChecks(exec, preset.defaults.requiredChecks);
  mutate(exec, dry, "gh", ["pr", "merge", mergeFlag(preset.defaults.merge), "--delete-branch"]);
  exec.log(`[git-flow] ${branch}: merge (${preset.defaults.merge}) + ветка удалена.`);
  syncMain(exec, { dry });
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--title") f.title = argv[++i];
    else if (argv[i] === "--body") f.body = argv[++i];
  }
  return f;
}

// Диспатч субкоманды (экспортируется — тесты гоняют с мок-exec, без реального git).
export async function dispatch(argv, exec, preset, opts = {}) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "start":
      return start(exec, preset, rest[0], opts);
    case "commit":
      return commit(exec, preset, rest[0], opts);
    case "push":
      return push(exec, preset, opts);
    case "pr":
      return pr(exec, preset, parseFlags(rest), opts);
    case "land":
      return await land(exec, preset, parseFlags(rest), opts);
    case "sync":
      return syncMain(exec, opts);
    default:
      throw new Error(`неизвестная команда: ${cmd} (start|commit|push|pr|land|sync)`);
  }
}

function printHelp() {
  console.log(
    "git-flow <start|commit|push|pr|land|sync> [args] [--dry-run]\n" +
      "  start <type>/<slug>   ветка от origin/main (по branchNaming)\n" +
      "  commit <msg>          коммит (по commitConvention)\n" +
      "  push                  push ветки в origin\n" +
      "  pr [--title --body]   открыть PR (gh)\n" +
      "  land                  зелёные checks → merge (по пресету) → удалить ветку → sync main\n" +
      "  sync                  local main = origin/main",
  );
}

async function main() {
  const raw = process.argv.slice(2);
  if (!raw[0] || ["-h", "--help", "help"].includes(raw[0])) {
    printHelp();
    return;
  }
  const dry = raw.includes("--dry-run");
  const argv = raw.filter((a) => a !== "--dry-run");
  const exec = realExec();
  try {
    const preset = resolvePreset(repoRoot(exec));
    await dispatch(argv, exec, preset, { dry });
  } catch (e) {
    die(`[git-flow] ${e.message}`);
  }
}

// main только при прямом запуске (node git-flow.mjs …); при import (тесты) — не выполняется.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

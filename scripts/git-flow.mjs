#!/usr/bin/env node
// git-flow.mjs — agent-agnostic git-ИНСТРУМЕНТ (DEVOPSER-106). Managed-скрипт (как
// devbox-services.mjs): вендорится в каждый репо, ЧИТАЕТ ВЕНДОРЕННЫЙ git-flow.json (managed-файл,
// DEVOPSER-113 — language-agnostic, любой стек, ноль npm) и делает полный луп git без ручных
// команд. Zero-deps (node:* + шелл git/gh).
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

// --- Резолв git-flow пресета (DEVOPSER-113: вендоренный, language-agnostic) -----
// Читаем ЛОКАЛЬНЫЙ вендоренный git-flow.json (managed-файл в корне репо — есть в ЛЮБОМ стеке,
// ноль node_modules; go-primary/polyglot тоже). Идём вверх от cwd И от расположения скрипта
// (робастно для vendored scripts/ и эталона files/). Fallback — legacy npm (@omnifield/git-preset
// ретайрен, но для транзишна).
export function resolvePreset(startDir = process.cwd()) {
  for (const base of [startDir, HERE]) {
    let dir = base;
    for (;;) {
      const p = join(dir, "git-flow.json");
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  const legacy = join(startDir, "node_modules/@omnifield/git-preset/git-flow.json");
  if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf8"));
  die("[git-flow] git-flow.json не найден (вендоренный пресет). Синк: node init.mjs .");
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
    // сабж СО СТРОЧНОЙ — Latin ИЛИ кириллица (`: [a-zа-яё]`) — ЗЕРКАЛО CI-гейта
    // .github/workflows/pr-title.yml subjectPattern `^[a-zа-яё].+$` (DEVOPSER-130). НЕ ASCII-only
    // `^[a-z]` — тот резал русские сабжи (живой регресс, #53 «приземлить»); НЕ `\p{Ll}` — amannn
    // гоняет regex без `u`-флага. Иначе `feat: Add x` проходил локальный commit, но падал на
    // pr-title при land — сюрприз на самом дорогом шаге. PAIRED RULE: правишь тут — правь и
    // pr-title.yml (типы уже совпадают: те же 11, вкл. revert). Типы branchNaming (9, без
    // style/revert) намеренно уже — ветка ≠ сабж коммита.
    const re =
      /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([\w./-]+\))?!?: [a-zа-яё].+/;
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

// --- Rulesets-материализация (DEVOPSER-110): git-пресет → GitHub-rulesets ------
// Единый источник enforcement = пресет (замещает ручные rulesets). Чистые функции —
// генерация desired-спеки + drift-диф; apply/check шелит gh api (мок в тестах).

const RULESET_NAME = "omnifield-git-flow";

// git-пресет (frame+defaults) + required-checks → desired ruleset-спека (GitHub rulesets API).
// frame.mainProtected → защита ветки по умолчанию (без удаления/force-push); frame.prRequired →
// мерж только через PR; requiredChecks → required status checks. Ноль actor/ролей.
export function buildRulesetSpec(preset, checks) {
  const rules = [];
  if (preset.frame?.mainProtected) {
    rules.push({ type: "deletion" });
    rules.push({ type: "non_fast_forward" });
  }
  if (preset.frame?.prRequired)
    // GitHub Rulesets API требует ПОЛНЫЙ набор pull_request-параметров (иначе 422; DEVOPSER-116).
    // Дефолты сохраняют смысл frame.prRequired = мерж только через PR, без обязательных ревью.
    rules.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  if (checks.length)
    rules.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: checks.map((c) => ({ context: c })),
      },
    });
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules,
  };
}

// Каноничный срез ruleset'а для сравнения (GitHub добавляет id/_links/… — игнорируем).
function normalizeRuleset(rs) {
  const rules = rs?.rules ?? [];
  const checks =
    rules.find((r) => r.type === "required_status_checks")?.parameters?.required_status_checks ??
    [];
  return {
    enforcement: rs?.enforcement,
    target: rs?.target,
    include: rs?.conditions?.ref_name?.include ?? [],
    ruleTypes: rules.map((r) => r.type).sort(),
    checks: checks.map((c) => c.context).sort(),
  };
}

// Дрейф текущего ruleset против desired (пресет) → список расхождений ([] = чисто).
export function diffRulesets(current, desired) {
  if (!current) return [`ruleset ${RULESET_NAME} отсутствует (не материализован)`];
  const a = normalizeRuleset(current);
  const b = normalizeRuleset(desired);
  const drift = [];
  const cmp = (field, x, y) => {
    if (JSON.stringify(x) !== JSON.stringify(y))
      drift.push(`${field}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  };
  cmp("enforcement", a.enforcement, b.enforcement);
  cmp("target", a.target, b.target);
  cmp("ref_name.include", a.include, b.include);
  cmp("rules", a.ruleTypes, b.ruleTypes);
  cmp("required_checks", a.checks, b.checks);
  return drift;
}

// --- Executor: тонкая обёртка git/gh (инъектируется — тесты подсовывают мок) ---

export function realExec() {
  const call =
    (bin) =>
    (args, opts = {}) => {
      const r = spawnSync(bin, args, { encoding: "utf8", ...opts });
      return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
    };
  return {
    git: call("git"),
    gh: call("gh"),
    // sleep — тот же inject-seam, что git/gh (тесты подсовывают no-op; иначе waitChecks не
    // юнит-тестируем — реальный spawnSync("sleep") завис бы на CHECKS_INTERVAL_S).
    sleep: (s) => spawnSync("sleep", [String(s)]),
    log: (m) => console.log(m),
  };
}

// Мутация (write git/gh): --dry-run печатает, не выполняет; ненулевой код → Error. Опц. input —
// тело запроса (stdin, для gh api --input -).
function mutate(exec, dry, kind, args, input) {
  if (dry) {
    exec.log(`[dry-run] ${kind} ${args.join(" ")}`);
    return { code: 0, out: "", err: "" };
  }
  const r = input === undefined ? exec[kind](args) : exec[kind](args, { input });
  if (r.code !== 0)
    throw new Error(`${kind} ${args.join(" ")} → ${(r.err || r.out || `code ${r.code}`).trim()}`);
  return r;
}

// Чтение (read): ненулевой код → Error с контекстом. Прокидываем stderr git/gh наружу
// (DEVOPSER-114 #3: 403/auth-ошибки видны, а не схлопнуты в "code 1").
function read(exec, kind, args, what) {
  const r = exec[kind](args);
  if (r.code !== 0)
    throw new Error(
      `${what}: ${kind} ${args.join(" ")} → ${(r.err || r.out || `code ${r.code}`).trim()}`,
    );
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

// Сабжекты коммитов ветки (origin/<base>..HEAD, старые→новые). [] если пусто/ошибка — pr НЕ
// падает на этом (робастно; инвариант ниже всё равно даёт непустые title/body).
function branchCommits(exec, base) {
  const r = exec.git(["log", "--reverse", "--format=%s", `origin/${base}..HEAD`]);
  if (r.code !== 0) return [];
  return r.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Инвариант (DEVOPSER-129): pr ВСЕГДА порождает валидный non-interactive gh — title И body
// удовлетворены (иначе `gh pr create` в non-interactive требует тело → падает).
//  • ноль флагов          → `--fill` (gh выводит title+body из коммитов; чисто non-interactive).
//  • иначе                → явные `--title`/`--body`; недостающее выводим из коммитов ветки,
//                           фолбэк = сам title (затем branch). `--fill` НЕ мешаем с явным
//                           `--title` (gh их не совмещает).
// commits — сабжекты ветки (пустой массив ок); branch — фолбэк последней инстанции.
export function buildPrArgs(flags, commits, branch, base = "main") {
  const args = ["pr", "create", "--base", base];
  if (!flags.title && !flags.body) {
    args.push("--fill");
    return args;
  }
  const derivedBody = commits.length ? commits.map((c) => `- ${c}`).join("\n") : "";
  const title = flags.title || commits[0] || branch; // всегда непусто
  const body = flags.body || derivedBody || flags.title || branch; // фолбэк = сам title
  args.push("--title", title, "--body", body);
  return args;
}

function pr(exec, preset, flags, { dry }) {
  const branch = assertNotMain(currentBranch(exec), preset.frame);
  const base = "main";
  // Коммиты нужны ТОЛЬКО в derive-пути (ровно один из title/body задан). Оба заданы или ни одного
  // (--fill) — чтение лишнее.
  const needDerive = (flags.title || flags.body) && !(flags.title && flags.body);
  const commits = needDerive ? branchCommits(exec, base) : [];
  const args = buildPrArgs(flags, commits, branch, base);
  mutate(exec, dry, "gh", args);
  exec.log("[git-flow] PR открыт.");
}

// frame.prRequired: приземляем ТОЛЬКО через открытый PR.
function requireOpenPr(exec) {
  const r = exec.gh(["pr", "view", "--json", "state", "-q", ".state"]);
  // stderr прокинут (#3): нет PR vs 403/auth — видно причину, не «code 1».
  if (r.code !== 0)
    throw new Error(
      `frame.prRequired: PR не проверить — gh: ${(r.err || r.out || `code ${r.code}`).trim()}`,
    );
  if (r.out.trim() !== "OPEN") throw new Error(`frame.prRequired: PR не OPEN (${r.out.trim()}).`);
}

// Ждёт ли пресет вообще проверок? "from-stack" или непустой массив → да (эти проверки ОБЯЗАНЫ
// прийти зелёными); пустой массив / прочее → нет. Придаёт смысл исходу «no checks reported»:
// ждём проверок vs проверок и не должно быть (DEVOPSER-115).
export function expectsChecks(requiredChecks) {
  if (requiredChecks === "from-stack") return true;
  if (Array.isArray(requiredChecks)) return requiredChecks.length > 0;
  return false;
}

// Состояние строки `gh pr checks` (колонка 2, tab-sep): зелёные / в процессе / всё прочее = провал.
const CHECK_GREEN = /^(pass|skipping|neutral|success)$/i;
const CHECK_PENDING = /^(pending|queued|in_progress|waiting|requested)$/i;

// Вывод `gh pr checks` («name\tstate\t…») → map ТОЛЬКО stack-CI-чек → состояние. Не-stack-CI
// (CodeQL default-setup, pr-title, инфра) отбрасывает isStackCiCheck — land гейтится тем же
// набором, что и merge (required-контексты ruleset после DEVOPSER-138). Дедуп по имени (gh может
// продублировать строку в out и err). Строка «no checks reported» табов не несёт (cols<2) → в map
// не попадает → трактуется как «ещё не зарегистрированы».
function stackCiStates(text) {
  const states = new Map();
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 2) continue;
    const name = cols[0].trim();
    if (name && isStackCiCheck(name)) states.set(name, cols[1].trim());
  }
  return states;
}

// Ждём зелёные STACK-CI checks (DEVOPSER-139: land симметричен merge — не-required чеки
// CodeQL/pr-title/инфра НЕ держат land, их флейк не подвешивает приземление; вторая половина -138).
// Исходы:
//  • ни одного stack-CI-чека → ЕЩЁ не зарегистрированы (транзиент после `pr`, или «no checks
//    reported») → ждём с капом на регистрацию (CHECKS_REG_TRIES). По исчерпании решает
//    expectsChecks: пресет ждёт проверки а их нет → throw; не ждёт → отсутствие = успех (DEVOPSER-115).
//  • все stack-CI зелёные (pass/skipping) → return (не-stack чеки игнорируем).
//  • есть stack-CI pending (и нет упавших) → ждём (CHECKS_TRIES).
//  • есть stack-CI НЕ зелёный и НЕ pending → реальный fail → throw (не ослабляем).
const CHECKS_TRIES = 60;
const CHECKS_INTERVAL_S = 10;
const CHECKS_REG_TRIES = 12; // отдельный кап на РЕГИСТРАЦИЮ проверок (≈2 мин), не бесконечно.
export function waitChecks(exec, requiredChecks) {
  let reg = 0; // итераций подряд без единого stack-CI-чека — кап на регистрацию.
  for (let i = 0; i < CHECKS_TRIES; i++) {
    const r = exec.gh(["pr", "checks"]);
    const states = stackCiStates(`${r.out}\n${r.err}`);
    if (states.size === 0) {
      if (++reg > CHECKS_REG_TRIES) {
        if (expectsChecks(requiredChecks))
          throw new Error(
            `checks: stack-CI проверки (${JSON.stringify(requiredChecks)}) не зарегистрировались за кап — на PR нет ни одного stack-CI-чека.`,
          );
        return; // пресет проверок не ждёт → отсутствие = успех.
      }
      exec.log("[git-flow] stack-CI проверки ещё не зарегистрированы — ждём…");
      exec.sleep(CHECKS_INTERVAL_S);
      continue;
    }
    const notGreen = [...states].filter(([, s]) => !CHECK_GREEN.test(s));
    if (notGreen.length === 0) return; // все stack-CI зелёные
    const failed = notGreen.filter(([, s]) => !CHECK_PENDING.test(s));
    if (failed.length === 0) {
      exec.log("[git-flow] stack-CI checks pending — ждём…");
      exec.sleep(CHECKS_INTERVAL_S);
      continue;
    }
    throw new Error(
      `stack-CI checks не зелёные:\n${failed.map(([n, s]) => `${n}\t${s}`).join("\n")}`,
    );
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

// nameWithOwner текущего репо (в переменной — литерала-плейсхолдера {owner} нет).
function repoNwo(exec) {
  return read(
    exec,
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    "репо",
  );
}

// Каллер-джобы skeleton stack-CI — зеркалит template.json ci.jobs[*].name (+ init.mjs CI_JOB):
// go→"go", node→"node", frontend→"web". GitHub именует check-run reusable-caller'а
// "<caller-job> / <inner-job>" — ТОЛЬКО они субстантивны (сборка/тест/drift per stack) и годятся
// в required. CodeQL default-setup ("Analyze (…)"), pr-title/semantic и прочая инфра этого
// stack-префикса НЕ несут → в required не попадают by construction.
const STACK_CI_JOBS = ["go", "node", "web"];
export const isStackCiCheck = (name) => STACK_CI_JOBS.some((job) => name.startsWith(`${job} / `));

// Required-контексты = РЕАЛЬНЫЕ имена stack-CI check-run'ов default-ветки (ground truth,
// DEVOPSER-117), СУЖЕННЫЕ до stack-CI (DEVOPSER-138). GitHub именует проверки reusable-caller'ов
// '<job> / <inner-job-name>', голых ключей job'а нет — берём фактические check-run'ы (не ключи
// ci.yml, самокорректируется), но оставляем лишь stack-CI (isStackCiCheck): CodeQL/pr-title/инфра
// отсеиваются, их флейк не блокирует мерж. Прогонов ещё нет → пусто (звонящий делает loud-warn).
function resolveCheckRunNames(exec, nwo) {
  const branch = read(
    exec,
    "gh",
    ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
    "default-ветка",
  );
  const names = read(
    exec,
    "gh",
    ["api", `repos/${nwo}/commits/${branch}/check-runs`, "-q", ".check_runs[].name"],
    "check-runs",
  );
  return [
    ...new Set(
      names
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter(isStackCiCheck), // сузить до stack-CI: CodeQL/pr-title/инфра — не required (DEVOPSER-138)
    ),
  ];
}

// rulesets — материализатор enforcement из git-пресета. Дефолт = check (дрейф → loud-fail);
// --apply применяет через gh api (идемпотентно: PUT если ruleset есть, иначе POST). Admin-scope
// токен для apply — env-инжект (gh читает GH_TOKEN), НЕ хардкодится.
async function rulesets(exec, preset, { apply, dry }) {
  const nwo = repoNwo(exec);
  const rc = preset.defaults?.requiredChecks;
  // "from-stack" → required = РЕАЛЬНЫЕ check-run имена репо (не ключи job'ов; DEVOPSER-117).
  const checks =
    rc === "from-stack" ? resolveCheckRunNames(exec, nwo) : Array.isArray(rc) ? rc : [];
  if (rc === "from-stack" && checks.length === 0)
    exec.log(
      "[git-flow] ⚠ check-run'ов на default-ветке нет — required-checks ПУСТ. Прогони CI, затем rulesets --apply (иначе проверки не станут required).",
    );
  const desired = buildRulesetSpec(preset, checks);
  const path = `repos/${nwo}/rulesets`;
  const list = JSON.parse(read(exec, "gh", ["api", path], "rulesets") || "[]");
  const existing = list.find((r) => r.name === RULESET_NAME);
  exec.log(`[git-flow] ruleset ${RULESET_NAME}: required checks [${checks.join(", ")}].`);

  if (apply) {
    const method = existing ? "PUT" : "POST";
    const at = existing ? `${path}/${existing.id}` : path;
    if (dry) exec.log(`[dry-run] gh api ${at} --method ${method} (ruleset ${RULESET_NAME})`);
    else
      mutate(
        exec,
        false,
        "gh",
        ["api", at, "--method", method, "--input", "-"],
        JSON.stringify(desired),
      );
    exec.log(`[git-flow] ruleset ${RULESET_NAME} применён (${method}).`);
    return;
  }

  const current = existing
    ? JSON.parse(read(exec, "gh", ["api", `${path}/${existing.id}`], "ruleset"))
    : null;
  const drift = diffRulesets(current, desired);
  if (drift.length) {
    for (const d of drift) exec.log(`  - ${d}`);
    throw new Error(
      `ruleset дрейф против git-пресета (${drift.length}) — синк: git-flow rulesets --apply`,
    );
  }
  exec.log(`[git-flow] ruleset ${RULESET_NAME}: совпадает с пресетом (чисто).`);
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
    case "rulesets":
      return await rulesets(exec, preset, { apply: rest.includes("--apply"), dry: opts.dry });
    default:
      throw new Error(`неизвестная команда: ${cmd} (start|commit|push|pr|land|sync|rulesets)`);
  }
}

function printHelp() {
  console.log(
    "git-flow <start|commit|push|pr|land|sync|rulesets> [args] [--dry-run]\n" +
      "  start <type>/<slug>   ветка от origin/main (по branchNaming)\n" +
      "  commit <msg>          коммит (по commitConvention)\n" +
      "  push                  push ветки в origin\n" +
      "  pr [--title --body]   открыть PR (gh)\n" +
      "  land                  зелёные checks → merge (по пресету) → удалить ветку → sync main\n" +
      "  sync                  local main = origin/main\n" +
      "  rulesets [--apply]    материализовать GitHub-rulesets из git-пресета (дефолт: check-дрейф)",
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

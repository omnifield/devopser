#!/usr/bin/env node
// apply-rulesets.mjs — раскатка ruleset-шаблонов на репо org (settings-as-code,
// briefs/github-platform-hardening.md D1). Идемпотентно: ruleset ищется по имени,
// есть → PUT-обновление, нет → POST. Механизм — devopser; СОДЕРЖАНИЕ флоу-правил
// (require PR, checks, ...) — параметры пресета репо (D1 v1, контракт brainer).
//
// Базлайн main-integrity — на ВСЕ репо. Флоу-правила — ПЕР-РЕПО параметры
// (принцип user «весь флоу настраиваемый»): platform/repo-flow.json помечает,
// какому репо какой флоу-ruleset нужен (первый параметр — require-pr, В6
// local-agents / заказ chater-go-prereqs.md). Снятие флага НЕ удаляет ruleset
// на GitHub — снести руками/API и убрать из конфига (осознанная операция).
//
// required-checks (Foundation Шаг 6): red субстантивный CI блокирует мерж. Контексты
// (имена required-чеков) ВЫВОДЯТСЯ ИЗ repo-flow.json.stack — ноль хардкода per-repo:
// стек go/node/frontend → чек "<caller-job> / <job-name reusable>", имя джобы читается
// из самого reusable-воркфлоу. Раскатывается на репо с require-pr И непустым stack.
// pr-title/«мягкие» чеки в required НЕ попадают (флейки не блокируют мерж).
//
//   node platform/apply-rulesets.mjs                 # базлайн на все + флоу по repo-flow.json
//   node platform/apply-rulesets.mjs repo ...        # то же, но только для перечисленных
//   node platform/apply-rulesets.mjs --ruleset platform/rulesets/x.json repo ...  # явный шаблон
//   (нужен gh с auth: admin на репо org)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORG = "omnifield";
const PLATFORM = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = join(PLATFORM, "..", ".github", "workflows");

// флаг в repo-flow.json → шаблон ruleset'а
const FLOW_RULESETS = {
  "require-pr": join(PLATFORM, "rulesets", "require-pr.json"),
};

// Стек → { job: id caller-джобы в ci.yml-caller, reusable: файл reusable-воркфлоу }.
// Единый источник = стек (repo-flow.json.stack), как CI-caller. Зеркалит CI_JOB в
// packages/skeleton/init.mjs (тот же контракт стек→джоба) — держать в синке при правке.
const STACK_CI = {
  go: { job: "go", reusable: "go-ci.yml" },
  node: { job: "node", reusable: "node-ci.yml" },
  frontend: { job: "web", reusable: "web-ci.yml" },
};

// Синхронный sleep (execFileSync — синхронный, между ретраями нельзя await).
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Раскатка на флот = много последовательных вызовов; одна транзиент-сетевая ошибка
// (TLS timeout) не должна ронять весь прогон — «одной командой» обязан быть надёжным.
// Ретраим только транзиент (не 4xx-ответы gh: их stderr не пустой и осмысленный).
const gh = (args, input, tries = 4) => {
  for (let i = 1; ; i++) {
    try {
      return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      const transient = /timeout|handshake|EOF|reset by peer|temporarily|ECONN|ETIMEDOUT/i.test(
        String(e.stderr || e.message),
      );
      if (!transient || i >= tries) throw e;
      console.error(`  (транзиент, попытка ${i}/${tries}: ${String(e.stderr).trim()})`);
      sleepSync(1000 * i);
    }
  }
};

// GitHub именует чек-раны reusable-воркфлоу "<caller-job> / <job-name reusable>".
// job-name НЕ хардкодим — читаем из самого reusable (единый источник имени = воркфлоу),
// чтобы переименование джобы не рассинхронило required-контекст с фактическим чеком.
function reusableJobName(reusable) {
  const src = readFileSync(join(WORKFLOWS, reusable), "utf8").replace(/\r\n/g, "\n");
  const jobs = src.slice(src.indexOf("\njobs:"));
  const head = jobs.split(/\n\s+steps:/)[0]; // секция джобы — до первого steps:
  const m = head.match(/\n\s+name:\s*(.+)/);
  if (!m) throw new Error(`reusable ${reusable}: job-level name: не найден`);
  return m[1].trim();
}

// Контексты required-чеков репо, выведенные ИЗ СТЕКА (ноль имён per-repo).
function contextsForStack(stack) {
  return stack
    .filter((s) => STACK_CI[s])
    .map((s) => `${STACK_CI[s].job} / ${reusableJobName(STACK_CI[s].reusable)}`);
}

// Шаблон required-checks + впрыск stack-контекстов. pr-title и прочие «мягкие» чеки
// СЮДА не попадают by construction (только go/node/web из стека) — флейки не блокируют.
function requiredChecksRuleset(template, contexts) {
  const rs = JSON.parse(JSON.stringify(template));
  rs.rules.find((r) => r.type === "required_status_checks").parameters.required_status_checks =
    contexts.map((context) => ({ context }));
  return rs;
}

function applyRuleset(repo, ruleset) {
  const existing = JSON.parse(
    gh(["api", `repos/${ORG}/${repo}/rulesets`, "--jq", "[.[] | {id, name}]"]),
  ).find((r) => r.name === ruleset.name);

  const path = existing
    ? `repos/${ORG}/${repo}/rulesets/${existing.id}`
    : `repos/${ORG}/${repo}/rulesets`;
  gh(["api", "-X", existing ? "PUT" : "POST", path, "--input", "-"], JSON.stringify(ruleset));
  console.log(`${repo}: ruleset "${ruleset.name}" ${existing ? "обновлён" : "создан"}`);
}

function main() {
  const args = process.argv.slice(2);
  const rsIdx = args.indexOf("--ruleset");
  const explicit = rsIdx !== -1 ? args.splice(rsIdx, 2)[1] : null;

  const repos = args.length
    ? args
    : JSON.parse(gh(["api", `orgs/${ORG}/repos`, "--jq", "[.[].name]"]));

  // явный шаблон — только он, на перечисленные репо (или все)
  if (explicit) {
    const ruleset = JSON.parse(readFileSync(explicit, "utf8"));
    for (const repo of repos) applyRuleset(repo, ruleset);
    return;
  }

  const baseline = JSON.parse(readFileSync(join(PLATFORM, "rulesets", "main-integrity.json"), "utf8"));
  const reqChecksTpl = JSON.parse(
    readFileSync(join(PLATFORM, "rulesets", "required-checks.json"), "utf8"),
  );
  const flow = JSON.parse(readFileSync(join(PLATFORM, "repo-flow.json"), "utf8"));

  for (const repo of repos) {
    applyRuleset(repo, baseline);
    for (const [flag, file] of Object.entries(FLOW_RULESETS)) {
      if (flow[repo]?.[flag]) applyRuleset(repo, JSON.parse(readFileSync(file, "utf8")));
    }
    // required-checks: гейт живёт в PR-флоу (required_status_checks кусают только под
    // pull_request-мерж) → раскатываем только на репо с require-pr И стеком. Контексты —
    // из стека (единый источник), поэтому новый репо получает гейт той же одной командой.
    const stack = flow[repo]?.stack;
    if (flow[repo]?.["require-pr"] && Array.isArray(stack) && stack.length) {
      const contexts = contextsForStack(stack);
      if (contexts.length) applyRuleset(repo, requiredChecksRuleset(reqChecksTpl, contexts));
    }
  }
}

main();

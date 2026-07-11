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

// флаг в repo-flow.json → шаблон ruleset'а
const FLOW_RULESETS = {
  "require-pr": join(PLATFORM, "rulesets", "require-pr.json"),
};

const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });

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
  const flow = JSON.parse(readFileSync(join(PLATFORM, "repo-flow.json"), "utf8"));

  for (const repo of repos) {
    applyRuleset(repo, baseline);
    for (const [flag, file] of Object.entries(FLOW_RULESETS)) {
      if (flow[repo]?.[flag]) applyRuleset(repo, JSON.parse(readFileSync(file, "utf8")));
    }
  }
}

main();

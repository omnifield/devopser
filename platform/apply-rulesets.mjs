#!/usr/bin/env node
// apply-rulesets.mjs — раскатка ruleset-шаблонов на репо org (settings-as-code,
// briefs/github-platform-hardening.md D1). Идемпотентно: ruleset ищется по имени,
// есть → PUT-обновление, нет → POST. Механизм — devopser; СОДЕРЖАНИЕ флоу-правил
// (require PR, checks, ...) — параметры пресета репо (D1 v1, контракт brainer).
//
//   node platform/apply-rulesets.mjs [--ruleset platform/rulesets/main-integrity.json] [repo ...]
//   (без repo — все репо org omnifield; нужен gh с auth)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ORG = "omnifield";

const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });

function main() {
  const args = process.argv.slice(2);
  const rsIdx = args.indexOf("--ruleset");
  const file = rsIdx !== -1 ? args.splice(rsIdx, 2)[1] : "platform/rulesets/main-integrity.json";
  const ruleset = JSON.parse(readFileSync(file, "utf8"));

  const repos = args.length
    ? args
    : JSON.parse(gh(["api", `orgs/${ORG}/repos`, "--jq", "[.[].name]"]));

  for (const repo of repos) {
    const existing = JSON.parse(
      gh(["api", `repos/${ORG}/${repo}/rulesets`, "--jq", "[.[] | {id, name}]"]),
    ).find((r) => r.name === ruleset.name);

    const path = existing
      ? `repos/${ORG}/${repo}/rulesets/${existing.id}`
      : `repos/${ORG}/${repo}/rulesets`;
    gh(["api", "-X", existing ? "PUT" : "POST", path, "--input", "-"], JSON.stringify(ruleset));
    console.log(`${repo}: ruleset "${ruleset.name}" ${existing ? "обновлён" : "создан"}`);
  }
}

main();

// Тест skip-логики idempotent-publish (DEVOPSER-132) — без сети.
//   node --test scripts/publish-idempotent.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyResult,
  exitCodeFor,
  isDuplicateVersionError,
  publishAll,
} from "./publish-idempotent.mjs";

test("isDuplicateVersionError: ловит conflict обоих реестров", () => {
  // GitHub Packages
  assert.ok(
    isDuplicateVersionError(
      "npm error 409 Conflict - PUT https://npm.pkg.github.com/@omnifield%2fnx-preset - Cannot publish over existing version.",
    ),
  );
  // npmjs
  assert.ok(
    isDuplicateVersionError(
      "npm error code EPUBLISHCONFLICT\nnpm error You cannot publish over the previously published versions: 0.1.1.",
    ),
  );
});

test("isDuplicateVersionError: НЕ ловит посторонние ошибки", () => {
  assert.equal(isDuplicateVersionError("npm error code ENEEDAUTH\nneed auth"), false);
  assert.equal(isDuplicateVersionError("network error ETIMEDOUT"), false);
  assert.equal(isDuplicateVersionError(""), false);
});

test("classifyResult: успех / дубликат / реальный провал", () => {
  assert.equal(classifyResult({ status: 0, output: "+ @omnifield/skeleton@0.8.0" }), "published");
  assert.equal(
    classifyResult({ status: 1, output: "409 Conflict Cannot publish over existing version" }),
    "skipped",
  );
  assert.equal(classifyResult({ status: 1, output: "ENEEDAUTH" }), "failed");
});

test("partial-bump (DoD): новый опубликован, дубликаты пропущены → джоба зелёная", () => {
  const packages = [
    { name: "@omnifield/skeleton", version: "0.8.0" }, // новый
    { name: "@omnifield/contract-manifest", version: "0.1.1" }, // новый
    { name: "@omnifield/nx-preset", version: "0.1.3" }, // старый → dup
    { name: "@omnifield/biome-preset", version: "0.1.2" }, // старый → dup
    { name: "@omnifield/vite-preset", version: "0.1.1" }, // старый → dup
  ];
  const fresh = new Set(["@omnifield/skeleton", "@omnifield/contract-manifest"]);
  const runPublish = (p) =>
    fresh.has(p.name)
      ? { status: 0, output: `+ ${p.name}@${p.version}` }
      : { status: 1, output: "409 Conflict - Cannot publish over existing version." };

  const logs = [];
  const results = publishAll(packages, { runPublish, log: (m) => logs.push(m) });

  assert.equal(exitCodeFor(results), 0, "партиал-бамп не роняет джобу");
  assert.deepEqual(
    results.map((r) => r.outcome),
    ["published", "published", "skipped", "skipped", "skipped"],
  );
  assert.equal(logs.filter((l) => l.startsWith("✔ published")).length, 2);
  assert.equal(logs.filter((l) => l.startsWith("↷ skip")).length, 3);
});

test("exitCodeFor: реальный провал роняет джобу", () => {
  assert.equal(exitCodeFor([{ outcome: "published" }, { outcome: "skipped" }]), 0);
  assert.equal(exitCodeFor([{ outcome: "skipped" }, { outcome: "failed" }]), 1);
});

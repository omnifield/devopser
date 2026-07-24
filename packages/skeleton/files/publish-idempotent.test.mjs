// Тест idempotent-publish (DEVOPSER-132) + root-agnostic скана (kb:ADR-17) — без сети.
//   node --test scripts/publish-idempotent.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyResult,
  exitCodeFor,
  isDuplicateVersionError,
  isPublishable,
  publishAll,
  scanPackages,
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

test("isPublishable: @omnifield/* не-private да; private / чужой scope нет", () => {
  assert.equal(isPublishable({ name: "@omnifield/skeleton", version: "1.0.0" }), true);
  assert.equal(isPublishable({ name: "@omnifield/skeleton", private: true }), false);
  assert.equal(isPublishable({ name: "@brainer/harness" }), false); // чужой scope
  assert.equal(isPublishable({ name: "some-app" }), false);
  assert.equal(isPublishable({}), false);
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

// --- Root-agnostic скан (kb:ADR-17) — на temp-дереве, без сети ---------------

function mkRepo() {
  return mkdtempSync(join(tmpdir(), "pub-scan-"));
}
function pkg(dir, obj) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(obj));
}

test("scanPackages (go-подпапка DoD): пакет в подпапке go-корня найден БЕЗ корневого workspace", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n"); // go-корень, НЕТ корневого package.json
    pkg(join(repo, "packages", "harness"), {
      name: "@omnifield/brainer-agent-harness-plugin",
      version: "0.1.0",
    });
    const found = scanPackages(repo);
    assert.equal(found.length, 1, "нашёл ровно пакет из подпапки");
    assert.equal(found[0].name, "@omnifield/brainer-agent-harness-plugin");
    assert.equal(found[0].version, "0.1.0");
    assert.equal(found[0].dir, join(repo, "packages", "harness"), "dir указывает на пакет (cwd publish)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("scanPackages (node-корень): корневой + вложенные @omnifield-пакеты, private/чужой scope отсеян", () => {
  const repo = mkRepo();
  try {
    pkg(repo, { name: "root-app", private: true }); // приватный корень (devopser-раскладка) — отсеян
    pkg(join(repo, "packages", "a"), { name: "@omnifield/a", version: "1.0.0" });
    pkg(join(repo, "packages", "b"), { name: "@omnifield/b", version: "2.0.0" });
    pkg(join(repo, "packages", "c"), { name: "@omnifield/c", version: "3.0.0", private: true }); // отсеян
    pkg(join(repo, "apps", "web"), { name: "@brainer/web", version: "1.0.0" }); // чужой scope — отсеян
    const names = scanPackages(repo)
      .map((p) => p.name)
      .sort();
    assert.deepEqual(names, ["@omnifield/a", "@omnifield/b"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("scanPackages (пусто DoD): нет @omnifield-пакетов → [] (release.yml = зелёный no-op)", () => {
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "go.mod"), "module x\n");
    pkg(join(repo, "svc"), { name: "just-a-service", version: "1.0.0" }); // не @omnifield
    assert.deepEqual(scanPackages(repo), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("scanPackages: не спускается в node_modules / .git (вендор не издаётся)", () => {
  const repo = mkRepo();
  try {
    pkg(join(repo, "packages", "real"), { name: "@omnifield/real", version: "1.0.0" });
    pkg(join(repo, "node_modules", "@omnifield", "dep"), {
      name: "@omnifield/dep",
      version: "9.9.9",
    });
    const names = scanPackages(repo).map((p) => p.name);
    assert.deepEqual(names, ["@omnifield/real"], "вложенный node_modules-пакет не сканируется");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

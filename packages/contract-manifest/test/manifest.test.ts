import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { ProductManifest } from "../src/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = (f: string) => parseYaml(readFileSync(resolve(here, "..", "examples", f), "utf8"));

test("пример weber (frontend, порт 5173) валиден и парсится с дефолтами", () => {
  const parsed = ProductManifest.parse(example("weber.omnifield.yaml"));
  assert.equal(parsed.name, "weber");
  assert.equal(parsed.type, "frontend");
  assert.equal(parsed.reach?.routes[0]?.port, 5173);
  assert.equal(parsed.reach?.routes[0]?.path, "/weber");
  // дефолты integration достраиваются
  assert.deepEqual(parsed.integration.deps, ["brainer"]);
  assert.equal(parsed.integration.spawnEligible, false);
  assert.deepEqual(parsed.integration.scopes, []);
});

test("пример brainer (fullstack, реальные внутренние порты 3500/8010 на /brainer) валиден", () => {
  const parsed = ProductManifest.parse(example("brainer.omnifield.yaml"));
  assert.equal(parsed.type, "fullstack");
  const paths = parsed.reach?.routes.map((r) => r.path);
  assert.deepEqual(paths, ["/brainer", "/api/brainer"]);
  const ports = parsed.reach?.routes.map((r) => r.port);
  assert.deepEqual(ports, [3500, 8010]);
  // продукт за своим префиксом, НЕ на корне /
  assert.ok(!paths?.includes("/"));
  assert.equal(parsed.integration.spawnEligible, true);
});

test(".strict() ловит лишнее поле (structural guard тонкости)", () => {
  const withExtra = { ...example("weber.omnifield.yaml"), foo: "leak" };
  const res = ProductManifest.safeParse(withExtra);
  assert.equal(res.success, false);
  assert.ok(
    res.error?.issues.some((i) => i.code === "unrecognized_keys"),
    "ожидали unrecognized_keys на лишнем поле",
  );
});

test(".strict() ловит лишнее поле и внутри Route", () => {
  const bad = {
    apiVersion: "omnifield.dev/v1",
    name: "x",
    type: "frontend",
    reach: { routes: [{ path: "/x", port: 1, autostart: true }] },
  };
  assert.equal(ProductManifest.safeParse(bad).success, false);
});

test('superRefine: frontend без reach — ошибка на path ["reach"]', () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "headless-fe",
    type: "frontend",
  });
  assert.equal(res.success, false);
  assert.ok(res.error?.issues.some((i) => i.path[0] === "reach"));
});

test("superRefine: fullstack без reach — тоже ошибка", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "fs",
    type: "fullstack",
  });
  assert.equal(res.success, false);
});

test("headless service без reach — валиден (дверь не обязательна)", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "worker",
    type: "service",
  });
  assert.equal(res.success, true);
  // тончайший манифест: integration целиком дефолтится
  assert.deepEqual(res.data?.integration, { scopes: [], spawnEligible: false, deps: [] });
});

test("backend без reach — валиден", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "lang-svc",
    type: "backend",
  });
  assert.equal(res.success, true);
});

test("UI-вход: fullstack без /<name> (только /api/name) — fail", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "brainer",
    type: "fullstack",
    reach: { routes: [{ path: "/api/brainer", port: 8010 }] },
  });
  assert.equal(res.success, false);
  assert.ok(
    res.error?.issues.some((i) => String(i.message).includes("UI-вход")),
    "ожидали loud fail про UI-вход",
  );
});

test("UI-вход: UI-путь повешен под /api/ — fail", () => {
  // единственный UI-маршрут = /api/weber → нет /<name>-входа → fail
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "weber",
    type: "frontend",
    reach: { routes: [{ path: "/api/weber", port: 5173 }] },
  });
  assert.equal(res.success, false);
  assert.ok(res.error?.issues.some((i) => i.path.includes("routes")));
});

test("UI-вход: корректный fullstack (/name + /api/name) — pass", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "brainer",
    type: "fullstack",
    reach: {
      routes: [
        { path: "/brainer", port: 3500 },
        { path: "/api/brainer", port: 8010 },
      ],
    },
  });
  assert.equal(res.success, true);
});

test("UI-вход: трейлинг-слеш /<name>/ тоже принимается", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "weber",
    type: "frontend",
    reach: { routes: [{ path: "/weber/", port: 5173 }] },
  });
  assert.equal(res.success, true);
});

test("UI-вход: backend-only (только /api/, type≠fullstack/frontend) — pass", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "lang-svc",
    type: "backend",
    reach: { routes: [{ path: "/api/lang-svc", port: 8020 }] },
  });
  assert.equal(res.success, true);
});

test("apiVersion пинит мажор: чужой apiVersion — ошибка", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v2",
    name: "x",
    type: "service",
  });
  assert.equal(res.success, false);
});

test("name-регекс: заглавные/подчёркивания отклоняются", () => {
  for (const name of ["Weber", "we_ber", "1weber", "-weber"]) {
    const res = ProductManifest.safeParse({
      apiVersion: "omnifield.dev/v1",
      name,
      type: "service",
    });
    assert.equal(res.success, false, `имя '${name}' должно быть отклонено`);
  }
});

test("Route.path обязан начинаться с /", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "x",
    type: "frontend",
    reach: { routes: [{ path: "weber", port: 5173 }] },
  });
  assert.equal(res.success, false);
});

test("reach.routes не может быть пустым (.min(1))", () => {
  const res = ProductManifest.safeParse({
    apiVersion: "omnifield.dev/v1",
    name: "x",
    type: "frontend",
    reach: { routes: [] },
  });
  assert.equal(res.success, false);
});

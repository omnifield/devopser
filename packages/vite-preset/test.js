// @omnifield/vite-preset — прог пресета против стаб-манифестов (Docker в сессии недоступен —
// доказываем формой конфига/деривации, [[no-docker-in-session]]). Живой :8080/<name> → SPA 200
// доказывает ревьюер/Канал в хабе (DoD live-прог, handoff chater).
//   node --test
//
// НЕ публикуется (нет в package.json files[]).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defineOmnifieldVite, readManifest, resolveBase, resolveFrontRoute } from "./index.js";

const CHATER = {
  apiVersion: "omnifield.dev/v1",
  name: "chater",
  type: "fullstack",
  reach: {
    routes: [
      { path: "/chater", port: 5173 },
      { path: "/api/chater", port: 8787 },
    ],
  },
};

test("resolveBase: front-route /chater → base '/chater/' (ведущий+завершающий слэш)", () => {
  assert.equal(resolveBase(CHATER), "/chater/");
});

test("resolveFrontRoute: берёт первый маршрут ВНЕ /api/ (зеркало двери), даже если /api первый", () => {
  const m = {
    reach: {
      routes: [
        { path: "/api/x", port: 1 },
        { path: "/x", port: 2 },
      ],
    },
  };
  assert.equal(resolveFrontRoute(m).path, "/x");
  assert.equal(resolveBase(m), "/x/");
});

test("resolveBase: одиночный маршрут (нет не-/api) — берётся он же", () => {
  const m = { reach: { routes: [{ path: "/solo", port: 3 }] } };
  assert.equal(resolveBase(m), "/solo/");
});

test("resolveBase: нормализует отсутствие слэшей", () => {
  assert.equal(resolveBase({ reach: { routes: [{ path: "weber" }] } }), "/weber/");
});

test("нет reach.routes — внятная ошибка (неоткуда взять base, а не тихий дефолт)", () => {
  assert.throws(() => resolveBase({ name: "x" }), /reach\.routes/);
  assert.throws(() => resolveBase({ reach: { routes: [] } }), /reach\.routes/);
});

test("defineOmnifieldVite: base из переданного манифеста, server-канон, слот пуст по дефолту", () => {
  const cfg = defineOmnifieldVite({ manifest: CHATER });
  assert.equal(cfg.base, "/chater/");
  assert.equal(cfg.server.host, true);
  assert.equal(cfg.server.allowedHosts, true);
  assert.deepEqual(cfg.plugins, []);
});

test("defineOmnifieldVite: плагин-слот — плагины продукта компонуются", () => {
  const solid = { name: "solid" };
  const cfg = defineOmnifieldVite({ manifest: CHATER, plugins: [solid] });
  assert.deepEqual(cfg.plugins, [solid]);
});

test("defineOmnifieldVite: server-оверрайд мержится поверх канона (host остаётся)", () => {
  const cfg = defineOmnifieldVite({
    manifest: CHATER,
    server: { port: 5173, allowedHosts: ["door"] },
  });
  assert.equal(cfg.server.host, true, "канон host сохранён");
  assert.equal(cfg.server.port, 5173, "продуктовый порт добавлен");
  assert.deepEqual(cfg.server.allowedHosts, ["door"], "оверрайд allowedHosts применён");
});

test("defineOmnifieldVite: прочий vite-канон пробрасывается (build и т.п.)", () => {
  const cfg = defineOmnifieldVite({ manifest: CHATER, build: { sourcemap: true } });
  assert.deepEqual(cfg.build, { sourcemap: true });
});

test("defineOmnifieldVite: явный base — escape hatch поверх манифеста", () => {
  const cfg = defineOmnifieldVite({ manifest: CHATER, base: "/override/" });
  assert.equal(cfg.base, "/override/");
});

test("defineOmnifieldVite: env OMNIFIELD_BASE — escape hatch", () => {
  const prev = process.env.OMNIFIELD_BASE;
  process.env.OMNIFIELD_BASE = "/env-base/";
  try {
    assert.equal(defineOmnifieldVite({ manifest: CHATER }).base, "/env-base/");
  } finally {
    if (prev === undefined) delete process.env.OMNIFIELD_BASE;
    else process.env.OMNIFIELD_BASE = prev;
  }
});

test("readManifest: находит omnifield.yaml вверх по дереву от cwd (vite.config в web/)", () => {
  const root = mkdtempSync(join(tmpdir(), "vite-preset-"));
  try {
    writeFileSync(
      join(root, "omnifield.yaml"),
      "apiVersion: omnifield.dev/v1\nname: chater\ntype: fullstack\nreach:\n  routes:\n    - path: /chater\n      port: 5173\n",
    );
    const web = join(root, "web");
    mkdirSync(web);
    const m = readManifest({ cwd: web });
    assert.equal(m.name, "chater");
    assert.equal(resolveBase(m), "/chater/");
    // сквозной прог: пресет без явного manifest — читает файл сам
    assert.equal(defineOmnifieldVite({ cwd: web }).base, "/chater/");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readManifest: манифест не найден — внятная ошибка (не тихий дефолт base)", () => {
  const root = mkdtempSync(join(tmpdir(), "vite-preset-empty-"));
  try {
    assert.throws(() => readManifest({ cwd: root }), /omnifield\.yaml не найден/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

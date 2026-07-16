// @omnifield/vite-preset — manifest.js (BUILDER-AGNOSTIC ядро)
//
// Читает omnifield.yaml продукта (ЕДИНЫЙ ИСТОЧНИК маршрута) и выводит single-origin base
// (front-route). Ноль vite-специфики здесь: этот модуль переиспользует и defineOmnifieldVite,
// и любой БУДУЩИЙ фреймворк-пресет — деривация base живёт ОДИН раз, builder-binding отдельно
// (briefs/vite-preset-single-origin-base.md, north star: миграция = конфиг, не rewrite).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const MANIFEST_NAME = "omnifield.yaml";

// Ищем omnifield.yaml вверх от cwd до корня ФС: product vite.config лежит в web/,
// манифест — в корне репо. Возвращает абсолютный путь или null.
export function findManifest(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (;;) {
    const p = join(dir, MANIFEST_NAME);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return null; // достигли корня ФС
    dir = parent;
  }
}

// Читает + парсит манифест. manifestPath — явный путь; иначе поиск вверх от cwd.
export function readManifest({ manifestPath, cwd } = {}) {
  const p = manifestPath ? resolve(manifestPath) : findManifest(cwd);
  if (!p || !existsSync(p)) {
    const from = resolve(cwd ?? process.cwd());
    throw new Error(
      `[@omnifield/vite-preset] ${MANIFEST_NAME} не найден (искал вверх от ${from}). ` +
        `Пресет берёт base из манифеста продукта — он единый источник маршрута. ` +
        `Передай manifestPath, если манифест лежит нестандартно.`,
    );
  }
  let raw;
  try {
    raw = parseYaml(readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`[@omnifield/vite-preset] ${MANIFEST_NAME} не парсится (${p}): ${err.message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`[@omnifield/vite-preset] ${MANIFEST_NAME} пуст / не объект (${p}).`);
  }
  return raw;
}

// Выбор front-route — ЗЕРКАЛО двери (hub-core/generate.mjs genLanding): фронт = первый
// маршрут ВНЕ /api/, иначе первый маршрут. Route-VALUE живёт один раз в манифесте — здесь
// лишь выбор, какой из объявленных маршрутов фронтовый (та же конвенция, что дверь; правишь
// конвенцию — правь обе стороны контракта, это точка эскалации к architect).
export function resolveFrontRoute(manifest) {
  const routes = manifest?.reach?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error(
      `[@omnifield/vite-preset] в манифесте нет reach.routes — неоткуда взять front-route/base. ` +
        `Фронт-продукт обязан объявить маршрут /<name> в ${MANIFEST_NAME} (тот же контракт, что дверь).`,
    );
  }
  const front = routes.find((r) => r?.path && !String(r.path).startsWith("/api/")) ?? routes[0];
  if (!front?.path) {
    throw new Error(`[@omnifield/vite-preset] front-route без поля path в reach.routes.`);
  }
  return front;
}

// base = path front-route'а с гарантированными ведущим и ЗАВЕРШАЮЩИМ слэшем. Vite требует
// trailing slash в base — без него ассеты клеятся мимо префикса двери (:8080/<name>/… → 404).
export function resolveBase(manifest) {
  let base = String(resolveFrontRoute(manifest).path);
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return base;
}

// @omnifield/vite-preset — гибкий frontend-пресет экосистемы
// (briefs/vite-preset-single-origin-base.md).
//
// NORTH STAR: ноль хардкода vite-специфики в продукте; base из манифеста (единый источник);
// плагин-слот под будущий фреймворк (миграция = конфиг, не rewrite). Builder-binding (vite)
// отделён от base-деривации (manifest.js) — будущий фреймворк-пресет переиспользует manifest.js,
// меняя только это связующее. Продукт расширяет пресет ≤5 строками vite.config.
//
// Зачем single-origin base: дверь (hub-core, Шаг 5.3) монтирует фронт под :8080/<name>, а vite
// по дефолту отдаёт SPA под / → :8080/<name> = 404. base = front-route манифеста чинит это
// БЕЗ per-product хардкода и переживает миграцию на свой фреймворк (тот же base из того же файла).

import { readManifest, resolveBase } from "./manifest.js";

// Общий vite-канон пресета (server.*). Продукт может переопределить через opts.server.
const SERVER_DEFAULTS = {
  // G1-канон: dev-server слушает 0.0.0.0 — иначе недостижим по docker-сети (дверь → <name>:port).
  host: true,
  // single-origin: Host приходит от двери (:8080), не от vite-хоста — не блокируем host-guard vite
  // (иначе :8080/<name> ловит 403 «host not allowed»). Внутренняя dev-дверь, доверенный периметр.
  allowedHosts: true,
};

/**
 * Фабрика vite-конфига экосистемы. Продукт: `export default defineOmnifieldVite({ plugins: [...] })`.
 *
 * @param {object} [opts]
 * @param {unknown} [opts.manifest]     Уже распарсенный манифест (иначе читается omnifield.yaml вверх от cwd).
 * @param {string}  [opts.manifestPath] Явный путь к omnifield.yaml (если лежит нестандартно).
 * @param {string}  [opts.cwd]          Старт поиска манифеста (дефолт process.cwd()).
 * @param {string}  [opts.base]         Явный base — escape hatch; по дефолту из манифеста (front-route).
 * @param {any[]}   [opts.plugins]      Плагины продукта (solid/…) и/или будущего фреймворка — слот расширения.
 * @param {object}  [opts.server]       Оверрайды vite server.* поверх канона пресета.
 * @returns {object} vite UserConfig
 */
export function defineOmnifieldVite(opts = {}) {
  const {
    manifest,
    manifestPath,
    cwd,
    base: baseOverride,
    plugins = [],
    server = {},
    ...rest
  } = opts;

  // base: единый источник — front-route манифеста. Явный base / env OMNIFIELD_BASE — escape hatch
  // (CI-крайние случаи), но ДЕФОЛТ всегда из манифеста, без per-product хардкода vite-специфики.
  const base =
    baseOverride ??
    process.env.OMNIFIELD_BASE ??
    resolveBase(manifest ?? readManifest({ manifestPath, cwd }));

  return {
    base,
    // ПЛАГИН-СЛОТ. Продукт передаёт свои плагины — пресет их компонует. Будущий фреймворк
    // подключается ТЕМ ЖЕ слотом (свой vite-плагин / вариант пресета) — не rewrite конфига.
    plugins: [...plugins],
    server: { ...SERVER_DEFAULTS, ...server },
    ...rest,
  };
}

export default defineOmnifieldVite;
export { findManifest, readManifest, resolveBase, resolveFrontRoute } from "./manifest.js";

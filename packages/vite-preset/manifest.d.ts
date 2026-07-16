// Типы builder-agnostic ядра (manifest.js). Совместимо с @omnifield/contract-manifest
// (omnifield.dev/v1), но БЕЗ рантайм-зависимости от него: пресет читает reach.routes из файла,
// полная Zod-валидация — авторитет двери (hub-core).

/** Маршрут продукта (reach.routes[]) — форма omnifield.dev/v1. */
export interface ManifestRoute {
  path: string;
  port?: number;
  service?: string;
}

/** Минимальная форма манифеста, нужная пресету для деривации base. */
export interface ProductManifestLike {
  name?: string;
  reach?: { routes?: ManifestRoute[] };
  [k: string]: unknown;
}

export interface ReadManifestOptions {
  /** Явный путь к omnifield.yaml. */
  manifestPath?: string;
  /** Старт поиска вверх по дереву (дефолт process.cwd()). */
  cwd?: string;
}

/** Ищет omnifield.yaml вверх от cwd; абсолютный путь или null. */
export function findManifest(cwd?: string): string | null;

/** Читает + парсит omnifield.yaml (throws с внятным сообщением, если не найден/битый). */
export function readManifest(opts?: ReadManifestOptions): ProductManifestLike;

/** Front-route (первый вне /api/, иначе первый) — зеркало двери hub-core. */
export function resolveFrontRoute(manifest: ProductManifestLike): ManifestRoute;

/** base из front-route: ведущий + завершающий слэш (vite-требование). */
export function resolveBase(manifest: ProductManifestLike): string;

import type { PluginOption, UserConfig } from "vite";
import type { ProductManifestLike } from "./manifest.js";

export interface OmnifieldViteOptions extends Omit<UserConfig, "base" | "plugins"> {
  /** Уже распарсенный манифест (иначе читается omnifield.yaml вверх от cwd). */
  manifest?: ProductManifestLike;
  /** Явный путь к omnifield.yaml (если лежит нестандартно). */
  manifestPath?: string;
  /** Старт поиска манифеста (дефолт process.cwd()). */
  cwd?: string;
  /** Явный base — escape hatch; по дефолту берётся из манифеста (front-route). */
  base?: string;
  /** Плагины продукта (solid/…) и/или будущего фреймворка — слот расширения. */
  plugins?: PluginOption[];
}

/**
 * Фабрика vite-конфига экосистемы: base из манифеста продукта (единый источник),
 * server-канон (host/allowedHosts), плагин-слот под будущий фреймворк.
 */
export function defineOmnifieldVite(opts?: OmnifieldViteOptions): UserConfig;
export default defineOmnifieldVite;

export type { ManifestRoute, ProductManifestLike, ReadManifestOptions } from "./manifest.js";
export { findManifest, readManifest, resolveBase, resolveFrontRoute } from "./manifest.js";

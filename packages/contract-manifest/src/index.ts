/**
 * @omnifield/contract-manifest — публичный barrel.
 *
 * Экспорт: Zod-схемы (валидация + z.infer-типы) и константа мажора контракта.
 * Кросс-язычный артефакт `omnifield.schema.json` лежит в корне пакета и
 * доступен потребителям через `@omnifield/contract-manifest/omnifield.schema.json`.
 */

export type {
  Integration as IntegrationT,
  ProductManifest as ProductManifestT,
  ProductType as ProductTypeT,
  Route as RouteT,
} from "./schema.js";
export {
  API_VERSION,
  Integration,
  ProductManifest,
  ProductType,
  Route,
} from "./schema.js";

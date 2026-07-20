/**
 * Эмит `omnifield.schema.json` из Zod-схемы (канон types-from-zod).
 *
 * ЕДИНСТВЕННЫЙ способ получить JSON-Schema — прогон этого скрипта. Файл в репо
 * — выведенный артефакт, руками не правится (как sqlc/codegen). Ноль дрейфа:
 * схема меняется в src/schema.ts → `pnpm run emit-schema` перегенерит артефакт.
 *
 * Артефакт кладётся в КОРЕНЬ пакета и шипается (package.json "files"): не-JS
 * продукты и `$schema` редактора валидируют им (ingest-gate любого языка).
 *
 * ⚠️ superRefine (frontend/fullstack ⇒ reach обязателен) — JS-сайд правило Zod;
 * в выведенной JSON-Schema оно не выражается (structural guard `.strict()` →
 * additionalProperties:false — выражается и сохраняется). Кросс-язычный
 * ingest-gate ловит структуру; условную обязательность reach досматривает
 * потребитель через Zod либо доп. проверку.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { API_VERSION, ProductManifest } from "../src/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "..", "omnifield.schema.json");

const jsonSchema = zodToJsonSchema(ProductManifest, {
  name: "ProductManifest",
  $refStrategy: "root",
});

// Пришиваем $id/заголовок мажора контракта — потребитель видит версию схемы.
const doc = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: `https://omnifield.dev/schema/${API_VERSION}/product-manifest.json`,
  title: `Omnifield product manifest (${API_VERSION})`,
  ...jsonSchema,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(`✓ emitted ${OUT}`);

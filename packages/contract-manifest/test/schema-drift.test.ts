import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { API_VERSION, ProductManifest } from "../src/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Ноль дрейфа схема↔артефакт: коммитнутый omnifield.schema.json обязан быть
 * побайтово равен свежему эмиту из Zod. Если тест красный — забыли
 * `pnpm run emit-schema` после правки src/schema.ts.
 */
test("omnifield.schema.json синхронен с Zod (ноль дрейфа)", () => {
  const committed = readFileSync(resolve(here, "..", "omnifield.schema.json"), "utf8");

  const jsonSchema = zodToJsonSchema(ProductManifest, {
    name: "ProductManifest",
    $refStrategy: "root",
  });
  const fresh = `${JSON.stringify(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: `https://omnifield.dev/schema/${API_VERSION}/product-manifest.json`,
      title: `Omnifield product manifest (${API_VERSION})`,
      ...jsonSchema,
    },
    null,
    2,
  )}\n`;

  assert.equal(committed, fresh, "omnifield.schema.json устарел — прогони `pnpm run emit-schema`");
});

test("артефакт несёт структурный guard (.strict → additionalProperties:false)", () => {
  const doc = JSON.parse(readFileSync(resolve(here, "..", "omnifield.schema.json"), "utf8"));
  const root = doc.$ref ? (doc.definitions?.ProductManifest ?? doc) : doc;
  assert.equal(root.additionalProperties, false, "корень манифеста должен запрещать лишние ключи");
});

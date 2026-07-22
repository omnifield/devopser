# @omnifield/contract-manifest

Тонкий **product-manifest** контракт экосистемы Omnifield — визитка `omnifield.yaml`,
из которой хаб/оркестрация узнают о продукте ровно **необходимое, не больше**.

- **Мажор контракта:** `apiVersion: omnifield.dev/v1`.
- **Источник правды:** Zod-схема (`src/schema.ts`). Канон
  [types-from-zod](../../standards/canon/principles/types-from-zod.md).
- **Кросс-язычный артефакт:** `omnifield.schema.json` **выводится** из Zod
  (`pnpm run emit-schema`) — им валидируют не-JS продукты (ingest-gate любого
  языка) и подсвечивает редактор. Ноль дрейфа: артефакт руками не правится.
- **Дизайн (первоисточник):** [`briefs/inc1-product-manifest-design.md`](../../briefs/inc1-product-manifest-design.md).

## Установка

```sh
pnpm add @omnifield/contract-manifest
```

## Использование — JS/TS (валидация + типы)

```ts
import { ProductManifest, type ProductManifestT } from '@omnifield/contract-manifest'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'

const raw = parseYaml(readFileSync('omnifield.yaml', 'utf8'))
const manifest: ProductManifestT = ProductManifest.parse(raw) // бросит на невалидном
```

Тип берётся из Zod (`z.infer`), не пишется руками — один источник, ноль дрейфа
схема↔тип.

## Использование — не-JS продукт (ingest-gate по JSON-Schema)

Продукт на Go/Python/… несёт тот же `omnifield.yaml` в корне и валидируется
`omnifield.schema.json` (в любом языке есть JSON-Schema-валидатор):

```
@omnifield/contract-manifest/omnifield.schema.json
```

> ⚠️ JSON-Schema несёт **структурный** guard (`.strict()` → `additionalProperties:false`)
> и типы полей. Условное правило «`frontend`/`fullstack` обязаны объявить `reach`»
> — это Zod-`superRefine` (JS-сайд); кросс-язычный gate досматривает его
> отдельной проверкой либо прогоняет манифест через Zod.

## Форма манифеста

| Поле | Обяз.? | Default |
|---|---|---|
| `apiVersion` (`omnifield.dev/v1`) | ✅ | — |
| `name` (`^[a-z][a-z0-9-]*$`) | ✅ | — |
| `type` (`frontend`·`backend`·`fullstack`·`service`) | ✅ | — |
| `reach.routes[]` (`path`·`port`·`service?`) | ✅ для `frontend`/`fullstack` | — |
| `title` / `description` | ⬜ | `title` = `name` |
| `integration.scopes` / `spawnEligible` / `deps` | ⬜ | `[]` / `false` / `[]` |

`.strict()` — **любое лишнее поле = ошибка валидации**: соблазн утечь
расширенное внутрь манифеста ловит валидатор, не память. Границу
«в манифесте / внутри продукта» см. дизайн §3.

Примеры: [`examples/weber.omnifield.yaml`](examples/weber.omnifield.yaml) (frontend),
[`examples/brainer.omnifield.yaml`](examples/brainer.omnifield.yaml) (fullstack).

`reach.routes[].port` — **реальный внутренний listening-порт** продукта (weber `5173`,
brainer `3500`/`8010`), НЕ host-published: единственная внешняя дверь — `gateway :8080`,
внутрь nginx проксирует `http://<service>:<port>`. Требование контракта:
`manifest.reach.port` === реальный порт продукта (иначе upstream промахнётся —
ловит port-consistency-gate на стороне devopser). Числа — не «канон номеров»
(порты внутренние, на разных контейнерах могут совпадать): каждый порт живёт в
манифесте своего продукта (`omnifield.yaml`), не в registry-зеркале devopser.

## Разработка

```sh
pnpm install
pnpm run emit-schema   # Zod → omnifield.schema.json (выведенный артефакт)
pnpm run build         # emit-schema + tsc → dist/
pnpm test              # схема, примеры, drift-guard
```

`omnifield.schema.json` коммитится (шипается в пакет), но **генерится** —
после любой правки `src/schema.ts` прогони `emit-schema`, иначе drift-тест
покраснеет.

## Версионирование

Contracts = версионируемые мосты (`@omnifield/contract-*`, semver). Ломающая
смена поля = major-bump + новый `apiVersion` = **видимый брейк**, точка
синхронизации ([integration-protocol](../../standards/integration-protocol.md)).
Аддитивное опциональное поле = minor. Живёт в `contracts/`, НЕ наследуется
через `standards/` (это шов между репо, не дисциплина).

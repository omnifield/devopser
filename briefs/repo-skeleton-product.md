# Brief — Repo-skeleton как продукт devopser (пресеты + reusable CI + init/drift-sync)

| | |
|---|---|
| **Адресат** | devopser-архитектор (запускает user) |
| **От** | оракул-архитектор, 2026-07-09 (решение user: параллелим devopser + фронт-миграцию weber) |
| **Порядок** | ФАЗА 2 — ПОСЛЕ закрытия текущих дыр очереди (workstation e2e Q2, config.py Q3, vite-port Q4, infra-migration Q5). Дыры first — foundation-first канон |
| **Потребители** | weber (первый, уже строится с in-repo копиями), brainer (мигрирует следом), writer, все будущие репо |

## Контекст / боль

Скелет продукт-репо (pnpm+nx+biome+husky+CI+пины) уже размножен РУКАМИ три раза:
writer → brainer → weber. Каждая копия дрейфует независимо; фиксы (пример: husky
bootstrap-fallback, см. §Init ниже) не доезжают до соседей. Одновременно оракул-скрипты
показали анти-паттерн «самопис поверх стандартного тулинга» — в v2 это не тащим.

**Решение user:** конфиги/скелет = деливерабл devopser. Источник правды у продукта-владельца,
репо получают артефакты + sync. Ровно паттерн «харнесс = дистрибутив brainer», применённый
к инфре.

## Граница (канон, не нарушать)

Репо зависят ТОЛЬКО от **опубликованных артефактов** devopser (npm-пресеты, workflow-ref,
вендоренные копии с drift-check) — НИКОГДА от живого devopser-сервиса. Любой репо:
clone → install → работает. Самодостаточность — P0 экосистемы.

## Деливераблы

### D1 — Reusable CI workflows (наибольший дедуп)
`devopser/.github/workflows/`: `node-ci.yml` (pnpm+nx affected lint/typecheck/test/build;
версии читает из пинов репо-вызывателя — pnpm/action-setup без версии, setup-node из engines)
+ `pr-title.yml` (semantic gate). Репо-потребитель держит 5-строчный caller
`uses: omnifield/devopser/.github/workflows/node-ci.yml@main`. Референс текущего содержимого —
weber `.github/workflows/` (свежее brainer'а: +sherif-шаг, +`permissions: {contents: read,
actions: read}` — без него `nx-set-shas` падает «Resource not accessible by integration» на
репо с урезанным дефолт-токеном; грабля поймана в weber 2026-07-09).

### D2 — Пресет-пакеты (npm, publish в наш registry)
- **nx-пресет**: `nx.json` поддерживает `extends` из установленного пакета → пакет с базовыми
  `targetDefaults` (build dependsOn ^build, cache, outputs) + `namedInputs` (default/production/
  sharedGlobals). Референс — brainer/weber nx.json.
- **biome-пресет** (уровень экосистемы, для продукт-репо; weber-фреймворк издаёт свой
  собственный для потребителей фреймворка — не конфликтует).
- Scope пакетов — рекомендация: `@omnifield/*` (инфра уровня зонтика, не продукта);
  твоё право предложить иное.

### D3 — Init-материализация + drift-check
Файлы, которые обязаны лежать копией в репо (husky-хуки, пины `packageManager`/`engines`/
`.npmrc engine-strict`, `.editorconfig`, `.gitignore`, `.gitattributes`):
- **init**: команда/скрипт devopser материализует набор в новый репо;
- **drift-check**: шаг в reusable CI сверяет копии с эталоном devopser — расхождение видно
  сразу, синк по явной команде (не молча).
- ⚠️ В husky-шаблон включить **bootstrap-fallback**: если `origin/main` ещё не существует
  (первый пуш нового репо) — `nx run-many` вместо `nx affected` (иначе первый коммит любого
  нового репо валится; фикс уже обкатан в weber).

### D4 — Оценки (после D1-D3, отдельными решениями)
- **devcontainer**-шаблон — канонический ответ «разворачивать где угодно» (Docker/Codespaces);
- **Renovate self-hosted** — автообновление deps по всем репо;
- **mise** — единый тулчейн-менеджер: оценить против наших self-managing пинов (pnpm/uv/go
  сами себя ставят — возможно, не нужен);
- **self-hosted nx remote cache** (Nx Cloud отвергнут — внешний сервис против self-host-first).

## Что devopser НЕ забирает
- `feature-report.mjs` оракула (токены Claude по фичам) — это телеметрия агентов = **brainer**.
- Release-механика пакетов — это `nx release` внутри репо (стандартный тулинг, не самопис);
  devopser даёт только registry (уже в Q5 infra-migration).
- Agent-харнесс (.claude, claude-scope, пресеты ролей) — **brainer** (решено 2026-07-08).

## Порядок и координация
1. Сначала дыры Q2–Q5 (не из этого брифа).
2. D1 → D3 → D2 (CI-дедуп самый ценный и самый простой; пресет-пакеты требуют registry из Q5).
3. Миграция потребителей: weber первым (строится сейчас с in-repo копиями — переключение =
   мелкий PR), brainer вторым, writer при пробуждении.
4. Спорное/расхождение с брифом — эскалация оракул-архитектору через user.

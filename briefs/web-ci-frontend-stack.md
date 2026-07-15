# Бриф: reusable web-ci + разведение frontend-стека (standalone-фронт)

> **Трек:** Foundation — Шаг 1, достройка frontend-стека (пробел, вскрыт green-proof'ом chater)
> **Адресат:** архитектор / owner **devopser** (зона: `.github/workflows/` + `packages/skeleton/` + `platform/`)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ (ветка → PR → CI → ревью → мерж)

## North star
**web-ci — универсальный гейт для ЛЮБОГО standalone-фронта** (vite/pnpm-воркспейс, без nx-монорепо).
Версии тулчейна — из пинов вызывателя; рабочий каталог — конфиг. Инфра не требует, чтобы фронт был
nx-монорепо в корне: продукт со своим `web/`-воркспейсом ложится влитым. Любой хардкод (pnpm/node-версия,
имя продукта, путь) = дефект.

## Зачем (факты сняты через Канал)
Шаг 1 **схлопнул стек `frontend` в `node`** (`hasNode = node || frontend` → оба на `node-ci`, который ждёт
nx-монорепо в корне). Но:
- `node-ci` = CI для **nx-монорепо** (pnpm+nx в корне: brainer/devopser/weber/writer).
- Фронт chater — **самостоятельный pnpm-воркспейс в `web/`** (свой `pnpm-lock.yaml`/`pnpm-workspace.yaml`/
  `biome.json`, vite+solid+vitest, **без nx**). На node-ci не ложится (красный/пустой no-op = костыль).
- План перечислял **web-ci** отдельным reusable и `frontend` — отдельным стеком. **web-ci не построен.**

Ретайренный in-repo `chater/.github/workflows/web-ci.yml` — эталон флоу: `working-directory: web`,
pnpm+node, шаги `install --frozen-lockfile` → `lint`(biome) → `typecheck`(tsc) → `test`(vitest) → `build`(vite),
path-filter `web/**`. **Но pnpm 11 / node 22 захардкожены** (в `web/package.json` пинов нет).

## Скоуп (только репо devopser)

1. **Reusable `.github/workflows/web-ci.yml`** (`on: workflow_call`) — зеркалит node-ci canon-shape, но для
   standalone-фронта:
   - **Версии — только из пинов вызывателя** (канон toolchain-pins): pnpm из `packageManager`, node из
     `engines.node` в `package.json` **фронт-воркспейса**. Ноль хардкода pnpm/node.
   - Инпут **`working-directory`** (дефолт `.`; сабдир-фронт передаёт `web`) — применяется к install/lint/
     typecheck/test/build; `cache-dependency-path: <wd>/pnpm-lock.yaml`.
   - Шаги: `install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build` (pnpm-скрипты воркспейса).
   - Инпуты `drift-check` / `secret-scan` (как node-ci); gitleaks — `fetch-depth: 0`.
   - `permissions` задаёт CALLER: `contents: read` (web-флоу не тянет nx-set-shas/@omnifield → `actions`/
     `packages` не нужны, как go-ci).
   - Ноль nx. Ноль имён продукта.

2. **Разведение frontend-стека в `init.mjs`** — `frontend` ≠ `node`:
   - `node` = nx-монорепо: `node-ci` + root `nx.json`/`package.json`/`biome.json` (как сейчас).
   - `frontend` = standalone-фронт: **`web-ci`-caller**, БЕЗ навязывания корневых `nx.json`/`package.json`/
     `biome.json` (у фронта свои в его воркспейсе). Добавить `CI_JOB.frontend = { name: "web", reusable:
     "web-ci.yml" }`; `buildCiYml` собирает go/node/frontend-комбо + объединение `permissions`.
   - Frontend-job в `ci.yml` передаёт `working-directory` — из пер-репо конфига `repo-flow.json`
     (напр. `chater: { "frontend": { "working-directory": "web" } }`).

3. **`platform/repo-flow.json`** — модель frontend-конфига (working-directory) + `chater` остаётся
   `stack: ["go","frontend"]`, но `frontend` теперь ведёт на web-ci, не node-ci.

4. **README** — web-секция: caller-сниппет (`uses: …/web-ci.yml@main` + `working-directory`), пины
   (`packageManager`/`engines.node` в воркспейсе фронта), грабли.

## Вне скоупа
- Ретайр chater web-ci + добавление пинов в `web/package.json` + чистка ошибочно раскатанных корневых
  `nx/package/biome` — **handoff chater** (после мержа этого + go-ci-фикса).
- go-ci-фиксы (sqlc/goinstall) — отдельный бриф `fix-go-ci-pins-greenproof.md`.

## DoD (зона devopser)
- [ ] reusable `web-ci.yml`: версии из пинов вызывателя, `working-directory`-инпут, шаги lint/typecheck/
      test/build, ноль nx/хардкода/имён продукта.
- [ ] `init.mjs`: `frontend` разведён с `node` (web-ci-caller, без навязывания корневого nx-набора);
      `buildCiYml` поддерживает frontend; догфуд devopser (node) остаётся зелёным (drift чист).
- [ ] frontend-путь покрыт (dry-run материализации frontend-набора на временный target: ci.yml с web-job
      + working-directory, БЕЗ корневого nx).
- [ ] README web-секция; PR зелёный → ревью → мерж.

## Handoff → chater (после мержа)
Ретайр in-repo `web-ci.yml` на reusable (`working-directory: web`); добавить `packageManager`/`engines.node`
в `web/package.json` (канон пинов); убрать ошибочно раскатанные корневые `nx.json`/`package.json`/`biome.json`.
Вместе с go-ретайром → chater полностью ретайрен (ноль in-repo CI, только `ci.yml`-caller + product-owned).

## Проверка north star (перед мержем)
Если web-ci хардкодит pnpm/node-версию (не из пинов), требует nx, завязан на `web/` жёстко (не конфиг),
или знает имя продукта — **дефект, не мержим.** Любой standalone-фронт обязан лечь одной строкой caller'а.

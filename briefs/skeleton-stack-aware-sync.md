# Бриф: skeleton `init|sync` — стек-осознанный + reusable CI caller

> **Трек:** Foundation — Шаг 1 (Skeleton / шаблоны + reusable CI)
> **Адресат:** архитектор / owner **devopser** (зона: репо devopser, `packages/skeleton/` + `.github/workflows/` + `platform/`)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ на исполнение (ветка → PR → CI → ревью → мерж)

## North star (критерий приёмки — read first)
**Инфра не подстраивается под продукт. `init|sync` — универсальная меха: раскатывает managed-набор
по СТЕКУ репо (node / go / frontend) из конфига, не зная ни одного имени продукта.** Любой `if repo ==
'chater'` в механизме = дефект. Go-путь обязан работать для любого go-репо, node-путь — для любого node.

## Зачем (контекст, факты сняты через Канал)
- `packages/skeleton/init.mjs` — **плоский, node-ориентированный**: `MANAGED`/`TEMPLATES` материализуются
  безусловно, **понятия стека нет**. Go-шаблоны Шага 0 (`files/go/golangci-template.yml`,
  `files/go/sqlc-template.yaml`, layout) **лежат, но не вживлены** в init.
- Reusable-набор в devopser: `node-ci.yml` (= frontend/web CI), `go-ci.yml` (Шаг 0), `pr-title.yml`.
  **Продуктам нужен `.github/workflows/ci.yml`-caller** (5 строк, вызывает reusable) — шаблона в `files/` нет.
- `platform/repo-flow.json` — пер-репо конфиг (сейчас `{ "chater": { "require-pr": true } }`), **поля стека
  нет**.
- chater/brainer держат **in-repo копии CI** (go-ci/web-ci/.golangci/sqlc у chater) с NOTE «уедет в devopser».

## Скоуп (только репо devopser)

1. **Стек-осознанный `init.mjs`.** Ввести понятие стека: **`node` / `go` / `frontend`** (репо может быть
   мульти-стек, напр. chater = go+frontend). Стек репо берётся из **`platform/repo-flow.json`** (поле
   `stack`, напр. `["go","frontend"]`); при отсутствии — дефолт-детект по фактам репо (`go.mod`→go,
   `package.json`→node/frontend), но **источник правды — конфиг** (принцип «конфигурируемо, предсказуемо»).
   - Общий набор (editorconfig/gitattributes/husky/gitignore-блок/devbox-*) — для всех.
   - **go-набор** (только для `go`-стека): вживить `files/go/golangci-template.yml`→`.golangci.yml`,
     `files/go/sqlc-template.yaml`→`sqlc.yaml` (init-only, продукт правит), layout — по README.
   - **node/frontend-набор** — текущие TEMPLATES (package/nx/biome/dependabot/devcontainer).

2. **Reusable CI caller per stack.** Добавить в `files/` шаблон(ы) `ci.yml`-caller и раскатывать по стеку:
   go-репо → caller вызывает `go-ci.yml`; node/frontend → `node-ci.yml`; `pr-title.yml` — всем (языко-
   независим). Сниппеты уже задокументированы в `.github/workflows/README.md` (Шаг 0) — привести caller-шаблон
   в соответствие. `permissions` в caller'е — по канону каждого reusable (go: `contents: read`; node: +`actions`).

3. **`init|sync` одной командой.** `node init.mjs [target]` (sync) и `--check` (drift) раскатывают/сверяют
   **полный managed-набор по стеку** идемпотентно. Ноль ручных копирований.

## Вне скоупа (явно)
- **Свап продуктов на reusable-caller** (ретайр in-repo CI) — **handoff'ы chater/brainer ниже**, отдельные
  PR в их зонах.
- Провижининг devbox (`devbox up|down`) — **Шаг 2**. Автостарт dev-сервисов — **Шаг 4**. Дверь/gateway — **Шаг 5**.
  CI-гейты/rulesets конфигом — **Шаг 6**. Не тянуть сюда.

## DoD (зона devopser)
- [ ] `init.mjs` стек-осознан: стек из `repo-flow.json` (детект-фолбэк), go-набор вживлён, node-набор сохранён.
- [ ] `ci.yml`-caller раскатывается per stack (go→go-ci, node/frontend→node-ci, pr-title всем); ноль хардкода имён.
- [ ] `init|sync` и `--check` идемпотентны; **догфуд на самом devopser (node) остаётся зелёным** (drift-check чист).
- [ ] Go-путь покрыт (юнит/dry-run материализации go-набора на временный target); **ноль продуктовой специфики**.
- [ ] PR: ветка → CI зелёный → ревью (workspace-архитектор + user) → мерж.

## Handoff'ы (чужие зоны — НЕ пункты DoD этого брифа)
- **→ chater (ретайр + GREEN-PROOF Шага 0):** прогнать `skeleton sync`; **ретайрить in-repo** `go-ci.yml` /
  `web-ci.yml` / `.golangci.yml` / `sqlc.yaml` на reusable-caller'ы (delete-and-call). Первый прогон reusable
  **`go-ci.yml` на живом go-модуле chater — это green-proof механизма Шага 0** (перенесён из Шага 0). Красный =
  баг в go-ci (напр. `setup-go@v6` / `tar -xz gitleaks` / `golangci-lint-action@v7`) вскрывается ЗДЕСЬ. chater =
  `flow-require-pr` → через PR.
- **→ brainer (ретайр):** `skeleton sync` + ретайр своих in-repo CI-копий на reusable. Питон-таргеты (`lint:py`)
  — репо-специфика, не drift-managed (остаются в brainer). Отдельный PR.

## Критерий выхода Шага 1 (§4 плана DoD)
Новый репо получает **полный managed-набор одной командой**; chater/brainer **ретайрят in-repo-копии на
reusable**; go-ci **подтверждён зелёным** первым реальным caller'ом (chater). Продукт не несёт инфру — только
декларации (манифест + `devbox.services.json` + стек в `repo-flow.json`).

## Проверка north star (перед мержем)
*«init|sync — универсальная стек-меха, или заточка под продукт?»* Если материализация ветвится по имени репо,
go-набор не раскатывается на произвольный go-репо, или caller хардкодит пути продукта — **дефект, не мержим.**

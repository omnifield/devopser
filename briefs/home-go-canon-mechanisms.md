# Бриф: Homing исполняющей части go-канона в devopser

> **Трек:** Foundation — Шаг 0 (Homing канона + перенос go-канона)
> **Адресат:** архитектор / owner **devopser** (зона: репо devopser)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ на исполнение (ветка → PR → ревью → мерж)

## North star (критерий приёмки — read first)
**Инфра НЕ подстраивается под chater или любой конкретный продукт. Мы задаём универсальную
основу, на которую ложится ЛЮБОЙ go-продукт.** Механизм тянет пины и специфику из репо-вызывателя,
сам не знает ни одного продуктового имени/пути. Любое имя `chater` (кроме секции handoff ниже) в
артефактах этого брифа = дефект.

## Зачем (контекст)
Go-канон сейчас разложен неправильно по §3 модели («принцип → knowledger, меха → devopser,
частный случай → продукт»):
- **Принципы** — уже в knowledger: `standards/canon/languages/go.md` (тулчейн-пины, gofumpt,
  golangci baseline). Это дом принципов. ✅
- **Исполняющие механизмы** — сейчас живут как **in-repo форк в продукте** (go-ci workflow,
  `.golangci.yml`, `sqlc.yaml`) с NOTE «temporary → уедет в reusable devopser go-ci
  (precedent: weber)». Дома в devopser у них **нет** — reusable `go-ci.yml` отсутствует,
  go-stack-шаблона нет. **Это гэп Шага 0.**

Эталон паттерна уже есть в devopser: `.github/workflows/node-ci.yml` — reusable, версии тулчейна
только из пинов вызывателя (`packageManager`, `engines.node`), инпуты `drift-check`/`secret-scan`,
`permissions` задаёт caller. Go-меха зеркалит этот паттерн один-в-один, но для go-пинов (`go.mod`).

## Скоуп (только репо devopser)

1. **Reusable `.github/workflows/go-ci.yml`** (`on: workflow_call`):
   - Джобы: build · vet · `test -race` · `golangci-lint` · **sqlc-drift** (проверка, что
     сгенерированный код в синхроне).
   - Версия Go — **только из пина вызывателя**: `actions/setup-go@v5` с `go-version-file: go.mod`,
     `check-latest: false`. Никаких хардкод-версий Go.
   - Версии инструментов (sqlc, golangci-lint, goose и т.п.) — пины комментарием-`tools` в шапке
     workflow, как канон toolchain-pins; НЕ хардкод в каждом продукте.
   - Инпуты (по образцу node-ci): `drift-check` (bool, default true — сверка вендоренных
     skeleton-копий с эталоном), `secret-scan` (bool, default true — gitleaks по истории).
   - `permissions` задаёт **caller** (reusable не расширяет права сам): минимум `contents: read`.
   - Ноль продуктовых имён/путей. Пути к пакетам/стору — из структуры репо-вызывателя, не хардкод.

2. **Go-stack шаблоны** (положить рядом с node-эталоном — `stacks/` или `packages/skeleton`,
   по месту существующего node-набора; на усмотрение owner):
   - Канон-`.golangci.yml` (schema v2) с baseline из `knowledger/.../go.md`:
     `errcheck, govet, staticcheck, unused, ineffassign, misspell, gocritic, revive, gofumpt`.
   - Шаблон `sqlc.yaml` (канон-форма, пины — комментарием).
   - Go-layout-skeleton (минимальный канон-layout go-сервиса: `cmd/`, `internal/`, `migrations/`).
   Всё — конфигурируемо/переиспользуемо; ноль заточки под конкретный продукт.

3. **README рядом с workflow** — 5-строчный caller-сниппет
   (`uses: omnifield/devopser/.github/workflows/go-ci.yml@main`) + известные грабли (по образцу
   `node-ci` README: `actions: read` для nx-set-shas и т.п., если применимо к go-флоу).

## Вне скоупа (явно)
- **Свап продуктов на reusable-caller и ретайр их in-repo копий** — это **Шаг 1** (delivery через
  `skeleton init|sync`); их DoD, не этот. Здесь свап продуктов не трогаем.
- `skeleton init|sync` команда как таковая — Шаг 1.

## DoD (зона devopser)
- [ ] reusable `go-ci.yml` существует, вызывается тестовым caller'ом, **зелёный**.
- [ ] версия Go и версии инструментов — только из пинов вызывателя / `tools`-пинов; ноль хардкода.
- [ ] go-stack шаблоны (`.golangci.yml`, `sqlc.yaml`, layout-skeleton) лежат рядом с node-эталоном.
- [ ] README с caller-сниппетом и граблями.
- [ ] **ноль продуктовой специфики** в артефактах (north-star-фильтр пройден).
- [ ] PR с описанием: ветка → CI → ревью (workspace-архитектор + user) → мерж.

## Handoff'ы (чужие зоны — НЕ пункты DoD этого брифа)
- **→ knowledger:** verify, что `standards/canon/languages/go.md` полон и перелинкован на
  **devopser-механизм** как исполняющий дом (а не на продукт-первопотребитель как на источник).
  Правки — отдельный микро-PR в зоне knowledger.
- **→ chater (Шаг 1):** свап in-repo `go-ci.yml` на reusable-caller + ретайр `.golangci.yml` /
  `sqlc.yaml` копий — **в Шаге 1**. В Шаге 0 со стороны продукта — максимум обновить NOTE
  («reusable существует здесь → …»); полный свап отложен, чтобы не делать работу дважды.

## Проверка north star (обязательный чек перед мержем)
Вопрос-фильтр: *«это универсальная go-меха — или заточка под продукт?»* Если любой артефакт
знает имя/путь конкретного продукта, тянет его пины иначе как из его же репо, или не переиспользуется
следующим go-продуктом без правок — **это дефект, не мержим.**

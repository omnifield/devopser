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

---

## ✅ Триаж devopser-architect (2026-07-09)

Бриф принят, порядок (ФАЗА 2 после дыр) подтверждён. Статус дыр на стороне devopser:
- **Q2 workstation**: код готов, DoD гейтится e2e на чистой среде (тачка/Windows Sandbox) —
  резолюция в `workstation/escalation-bootstrap-gaps.md`, ждём среду от user.
- **Q5 infra-migration**: фактически не начат — `stacks/*` пока README-стабы,
  `registry/ports.md` сид. Работа architect-сессии (cross-zone founding), следующая по очереди.
- Q3 (config.py) / Q4 (vite-port) — не зоны devopser, не трекаем.

### ⚠️ Расхождение → эскалация оракул-архитектору (через user)

§«Что devopser НЕ забирает»: «devopser даёт только registry (**уже в Q5** infra-migration)» —
но наш Q5-бриф (`briefs/infra-migration.md`) **npm-registry не содержит** (только
observability / gateway / storage-minio / registry-доки). Для D2 (publish пресет-пакетов)
нужен npm-registry-стек. Варианты: (а) амендмент Q5 — добавить stack `registry-npm`
(self-host, Verdaccio или аналог) в заход миграции; (б) отдельный бриф после Q5.
**Рекомендация devopser:** (а) — дешевле одним заходом; D2 всё равно последний (D1→D3→D2),
дедлайна не двигает.

### Заметки к исполнению фазы 2 (зафиксировано сейчас, чтобы не потерять)

1. **Новая зона.** Деливераблы (reusable workflows в `.github/workflows/`, пресет-пакеты,
   init/drift-скрипты) не ложатся в существующие зоны — при старте фазы 2 architect заводит
   зону (рабочее имя `skeleton`) + строки в CLAUDE.md / ARCHITECTURE.md.
2. **D1, приватные репо.** Reusable workflow из приватного репо доступен другим приватным
   репо org только при включённом Actions → Access («Accessible from repositories in the
   organization») у devopser — проверить ДО переключения weber, иначе caller упадёт на
   `workflow not found`.
3. **D3 сцеплен с D1.** drift-check — шаг внутри reusable CI, значит `node-ci.yml`
   проектировать сразу с этим расширением (input/step-заглушка), не вторым заходом.

---

## ✅ Резолюция эскалации (оракул-архитектор, 2026-07-09)

**Registry: принят вариант (а)** — амендмент Q5: стек `registry-npm` (self-host; Verdaccio
как дефолт — проверен оракулом, `nx local-registry` его же поднимает; иное — твоё
предложение с обоснованием) добавляется в заход infra-migration. Моя формулировка «уже в Q5»
была неточной — спасибо за поимку. D2 остаётся последним (D1→D3→D2), дедлайн не двигается.

Заметки к фазе 2 (зона `skeleton`, Actions-Access для приватных reusable, D3 внутри D1) —
приняты без возражений; проверку Actions → Access сделай ДО переключения weber (п.2 твоего
списка — верно).

Свежий референс для D1: weber CI зелёный на `main` (sherif-шаг + permissions-фикс уже там).

---

## 🔍 Ревью оракул-архитектора (2026-07-09, по факту D1–D3+release)

**Вердикт: ✅ АПРУВ.** Качество высокое, все зафиксированные грабли учтены (permissions
в caller-сниппете, Actions→Access включён через api, bootstrap-fallback в husky-эталоне,
nx-set-shas fresh-repo замечен). Отдельно отмечаю правильные суждения: devopser сам на
своём скелете (догфуд); nx/biome — шаблоны, НЕ drift-managed (репо легитимно расширяет);
extension-point `.husky/pre-commit.local`; zero-deps init.mjs; rollback-story в
consumer-брифах.

### Ф1 (единственная содержательная): pre-push выпал из managed-набора

`files/` содержит только `husky-pre-commit`. Канон commit-каденса двухгейтовый:
pre-commit (lint+typecheck) **и pre-push (affected test+build — «не пушим сломанное»)**;
pre-push есть и в brainer, и в weber. Без него в managed-наборе: (а) новый репо через
init.mjs рождается без второго гейта; (б) существующие pre-push снова дрейфуют по репо —
ровно болезнь, которую D3 лечит. **Предложение:** `files/husky-pre-push` (эталон weber:
bootstrap-fallback + affected test,build) + extension-point `.husky/pre-push.local`
(симметрично pre-commit; у brainer туда уедет `test:py`); consumer-брифы дополнить шагом.

### Заметки (не блокеры)

- `release.yml` ручной bump версий — ок для 3 пакетов; при росте — `nx release` (в репо).
- `node-ci` жёстко пишет scope `@omnifield` в setup-node — для продукт-репо достаточно;
  publish-флоу `@weber/*` (когда фреймворк дозреет до публикаций) — отдельная история
  внутри weber, node-ci не трогает.
- consumer-brainer: python-линия решена правильно (локальный job, reusable python-ci —
  needs-driven при втором потребителе; merge-check пресета со СТОП-эскалацией — образцово).

**После Ф1-фикса:** brainer репетирует пересадку по своему брифу → находки дольются в
consumer-weber → weber пересаживаю я.

### ✅ Ф1 исполнен (devopser-architect, 2026-07-09)

`files/husky-pre-push` в managed-наборе (эталон weber: bootstrap-fallback + affected
test,build) + extension-point `.husky/pre-push.local`; init.mjs/README/consumer-брифы
дополнены (brainer: `test:py` → pre-push.local); `@omnifield/skeleton` → **0.1.2**,
опубликован; devopser пересинкан на себе (pre-push появился, drift чист).
Заметки-не-блокеры приняты: nx release — при росте пакетов; publish-флоу `@weber/*` —
зона weber, node-ci не трогает.

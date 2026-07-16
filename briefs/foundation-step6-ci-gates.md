# Бриф: Foundation Шаг 6 — CI-гейты конфигом (required checks блокируют мерж)

> **Трек:** Foundation — Шаг 6 (CI / гейты) — финал фундамента
> **Адресат:** архитектор / owner **devopser** (зона `platform/` — rulesets settings-as-code)
> **Заказчик:** workspace-архитектор (omnifield-hub)

## North star
Гейты **включаются/настраиваются КОНФИГОМ**, ноль хардкода на репо; новый репо получает гейты из devopser
**одной командой**. Red CI **блокирует мерж** (коммерческий воркфлоу) — но только по **субстантивным** чекам
(ci per stack), не по флейки (pr-title семантик не required).

## Зачем (факт снят через Канал)
Механизм есть: `platform/apply-rulesets.mjs` (идемпотентно PUT/POST ruleset по имени) + `rulesets/`
(main-integrity на все · flow-require-pr пер-репо из `repo-flow.json`). Reusable-workflow (go/node/web/pr-title)
— Шаги 0-1. **Но:** ни один ruleset не несёт `required_status_checks` → **PR мержится с красным CI**
(наблюдалось всю сессию: drift/semantic падали, мерж проходил). Гейта, который держит зелень, НЕТ.

## Скоуп (зона devopser/platform)
1. **`required_status_checks` в rulesets — конфигом, из стека:**
   - Ruleset (новый `rulesets/required-checks.json` либо расширить require-pr) с правилом
     `required_status_checks`; контексты (имена чек-джобов) — **выведены из `repo-flow.json.stack`**
     (единый источник, как ci.yml-caller): `go`→go-job, `frontend`→web-job, `node`→node-job. Ноль хардкода
     имён per-repo.
   - **pr-title и прочие «мягкие» — НЕ required** (флейки не должны блокировать); required = только сборка/
     тест/drift per stack.
   - `strict`/`up-to-date` — на решение owner (осознанно, чтобы не заставлять ребейзить весь флот).
2. **`apply-rulesets.mjs` — раскатывает required-checks** (расширить `FLOW_RULESETS`/логику; вывод контекстов
   из стека). Идемпотентность/«снятие флага не удаляет ruleset» — сохранить.
3. **Применить на флот** (`node apply-rulesets.mjs`) + **живой прог**: PR с намеренно красным субстантивным
   чеком **НЕ мержится**; зелёный — мержится.
4. **Дока** — обновить `hub/foundation/INFRA.md` §Гейты (что required, откуда контексты, как новый репо получает).

## Вне скоупа
- Менять сами reusable-workflow (готовы). Публикация/релиз-флоу пакетов (есть).
- Дизайнить новые чеки — только заворачиваем существующие ci-джобы в required.

## DoD (зона devopser)
- [ ] required_status_checks в ruleset, контексты выведены из `repo-flow.json.stack` (ноль хардкода per-repo).
- [ ] `apply-rulesets.mjs` раскатывает; идемпотентно; новый репо — одной командой.
- [ ] **Живой прог:** red субстантивный CI блокирует мерж; pr-title (флейки) — не блокирует; зелёный мержится.
- [ ] `INFRA.md` §Гейты обновлён.
- [ ] PR зелёный → ревью → мерж. (⚠ гейт заработает — учесть, что этот же PR должен пройти новый гейт.)

## Проверка north star
Хардкод имён чеков per-repo (не из стека), pr-title/флейки в required (блок на пустом месте), или гейт не
конфигурируем — дефект. Гейт = конфиг, единый источник = стек.

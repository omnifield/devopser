# CLAUDE.md — Omnifield Devopser

Guidance для Claude Code в репо `devopser`. Канон-первоисточник — **`omnifield/commons/standards/`**.
Вижн/раскладка — `ARCHITECTURE.md`. Здесь — repo-специфика.

## Старт сессии

Канон containers-native (Шаг 2+3, ретайр `.ps1`) — из корня репо на хосте (нужен только `docker`):

```sh
scripts/devbox.sh up               # провижн devbox по канону, если ещё не поднят (идемпотентно)
scripts/devbox-session.sh <scope>  # вход агентом: ставит OMNIFIELD_SCOPE, model-pin, workdir
```

`<scope>` (дефолт `main`) читают SessionStart-хуки (`scope-identity`/`marker`/`scope-resolve`) —
кладут identity-баннер + git-gate:
- `main` → **architect** (full git, своя модель).
- `<zone>` → **owner-<zone>** (commit-only под git-gate; model-pin → `opus`, явный `--model` не трогается).

Перед первым действием: этот файл, `ARCHITECTURE.md`, (owner) README своей зоны.

## Роли (флоу как в оракуле, канон `commons/standards/agents/`)

| Роль | Что | Git |
|---|---|---|
| **architect** (main) | триаж, контракты, координация, **брифы** (`briefs/`), ревью | полный |
| **owner-\<zone\>** | зона + тесты + доки | commit-only (gate) |

- Architect НЕ пишет код зон — **ТЗ в tasker** (нода `DEVOPSER-<n>`) → owner-сессии (user
  запускает). Owner НЕ пишет cross-zone / контракты — упёрлось → STOP + эскалация к architect.
  Эскалация ВВЕРХ.

## Системы — где ТЗ и канон (доступ)

Задачи и знания живут в общих сервисах Omnifield (соседи по docker-сети; auth — заголовок
`Authorization: Bearer <handle>`, любой осмысленный handle, напр. `devopser`, пишется как actor).
⚠️ **Нативный префикс обязателен** (`/tasker/`, `/knowledger/`) — голый `:8030/`/`:8040/` даёт 404.

- **tasker** — задачи/ТЗ. База `http://tasker:8030/tasker/…`, workspace `DEVOPSER`.
  Твоя ТЗ = нода `DEVOPSER-<n>`: `curl -s -H "Authorization: Bearer devopser"
  http://tasker:8030/tasker/nodes/DEVOPSER-<n>`. Owner берёт ТЗ из ноды сам; architect туда
  её пишет; прогресс — через ноду (`PATCH status_id` / `POST …/activity`). Дерево ws —
  `GET /tasker/workspaces/DEVOPSER/nodes`. Контракт — `omnifield/tasker` `docs/api.md` (через `gh`).
- **knowledger** — канон/база знаний. База `http://knowledger:8040/knowledger/…`. Зоны
  FUND (концепт «что») / ADR (рационал «почему») / MECH (реестр мех) + продуктовый раздел
  `DEVOPSER` («как с X»). Читать: `GET /knowledger/workspaces/DEVOPSER/tree`. Продукт пишет
  в чужие зоны предложкой (accept-gate), в свою `DEVOPSER` — напрямую. Контракт —
  `omnifield/knowledger` `docs/api.md`.

## Зоны

| Scope | Path | Что |
|---|---|---|
| `skeleton` | `packages/` + `.github/workflows/` | repo-skeleton продукт: пресеты, reusable CI, init/drift (канон → knowledger: `DEVOPSER-2` «Skeleton», ADR `ADR-4` «артефакты-не-сервис») |
| `registry` | `registry/` | реестр портов/продуктов/маршрутов |
| `workstation` | `workstation/` | provisioning dev-машины (bootstrap + карта репо) |
| `hub-core` | `hub-core/` + `stacks/gateway/` | ядро хаба: реестр (скан манифестов) → дверь (nginx+лендинг). Потребитель = `omnifield-hub` (`briefs/hub-core-design.md`, `feedback-hub-core-as-hub-under-isolation.md`) |

Runtime-стеки (gateway/observability/storage) сняты 2026-07-09 (needs-driven, ревизия user —
канон → knowledger ADR `ADR-6` «Стеки needs-driven»): зона стека появляется только под
точечный заказ продукта-потребителя.

## POLICY (priority 0, из commons)

- Никаких костылей / временных решений — причина, не следствие.
- **DoD** = деливерабл реально работает (стек: `docker compose up -d` + smoke; пакет:
  publish → install с чистой машины; CI: зелёный прогон у потребителя) + доки + registry в актуале.
- Commit-каденс: этап → проверка → коммит.
- **stack-as-capability** (ARCHITECTURE): стек самодостаточен, стеки не знают друг о друге,
  связи — только через `registry/`. Не хардкодить продукт в стек — расширяемся registry-записью.
  Стек появляется ТОЛЬКО под заказ потребителя.
- **Инфра живёт здесь, не в продукт-репо.** Если продукту нужна runtime-инфра — зона devopser,
  брифом сюда, не docker-папкой туда.
- **Секреты — только env-инжект** (GH Environments / vault devopser): файлы с секретами
  в управляемых репо не появляются (репо публичные). Каждый деплой-бриф обязан содержать
  секцию секретов; гейт — gitleaks-шаг reusable CI.
- **Машина = cattle, containers-only** (канон user 2026-07-10): на тачке — только Docker
  и файлы; тулчейн/git/сессии — в devbox-контейнере. Поставил что-то на хост руками →
  нарушение канона (канон → knowledger: FUND `FUND-4` «Containers-only», DEVOPSER `DEVOPSER-3` «Devbox»); версии декларируют
  пины репо (`.python-version`, `packageManager`) — исполняются внутри контейнера.
- ⚠️ Изменение портов/маршрутов = **контракт** (потребители: brainer, writer, оракул) —
  только через architect + запись в `registry/`.

## Git-флоу — приземление через инструмент (DEVOPSER-103/115)

- **Все приземления — через `scripts/git-flow.mjs`** (вендоренный, agent-agnostic):
  `start <type>/<slug>` → `commit <msg>` → `push` → `pr` → `land` (ждёт зелёные checks →
  squash-merge → удаляет ветку → sync main). Ноль ручных `git`/`gh`-мутаций. **Architect тоже
  сидит на нём** (пилот tasker подтверждён 2026-07-19).
- **Пресет = единый источник enforcement:** `git-flow.json` (frame: mainProtected+prRequired;
  defaults: squash, conventional, requiredChecks=from-stack). GitHub-rulesets материализуются
  из него: `git-flow rulesets [--apply]` (ruleset `omnifield-git-flow`). Ручные rulesets не
  плодить — правка enforcement идёт через пресет.
- Прямой коммит/пуш в main запрещён рамкой (frame.mainProtected) — работай на ветке (`git-flow start`).

## Git-инфра (harness)

- `.claude/hooks/git-gate.mjs` — hard-gate git-write для не-main. `main-session-marker.mjs`
  пишет `.claude/.main-session-id` только для scope main. `scope-identity.mjs` — баннер роли.
- Как в brainer: без `governance.mjs` и `agents/*.md` — границу держит git-gate + промпт;
  добавим при параллельных owner'ах.

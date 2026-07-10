# CLAUDE.md — Omnifield Devopser

Guidance для Claude Code в репо `devopser`. Канон-первоисточник — **`omnifield/commons/standards/`**.
Вижн/раскладка — `ARCHITECTURE.md`. Здесь — repo-специфика.

## Старт сессии

Сессии — через `.\claude-scope.ps1 -Scope <name>` (ставит `OMNIFIELD_SCOPE`, SessionStart-хук
кладёт identity-баннер):
- `-Scope main` → **architect** (full git).
- `-Scope <zone>` → **owner-<zone>** (commit-only под git-gate).

Перед первым действием: этот файл, `ARCHITECTURE.md`, (owner) README своей зоны.

## Роли (флоу как в оракуле, канон `commons/standards/agents/`)

| Роль | Что | Git |
|---|---|---|
| **architect** (main) | триаж, контракты, координация, **брифы** (`briefs/`), ревью | полный |
| **owner-\<zone\>** | зона + тесты + доки | commit-only (gate) |

- Architect НЕ пишет код зон — брифы → owner-сессии (user запускает). Owner НЕ пишет
  cross-zone / контракты — упёрлось → STOP + эскалация к architect. Эскалация ВВЕРХ.

## Зоны

| Scope | Path | Что |
|---|---|---|
| `skeleton` | `packages/` + `.github/workflows/` | repo-skeleton продукт: пресеты, reusable CI, init/drift (`briefs/repo-skeleton-product.md`) |
| `registry` | `registry/` | реестр портов/продуктов/маршрутов |
| `workstation` | `workstation/` | provisioning dev-машины (bootstrap + карта репо) |

Runtime-стеки (gateway/observability/storage) сняты 2026-07-09 (needs-driven, ревизия user —
`briefs/devops-consolidated-backlog.md` v2): зона стека появляется только под точечный заказ
продукта-потребителя.

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
  нарушение канона (`briefs/containers-only-and-management.md`); версии декларируют
  пины репо (`.python-version`, `packageManager`) — исполняются внутри контейнера.
- ⚠️ Изменение портов/маршрутов = **контракт** (потребители: brainer, writer, оракул) —
  только через architect + запись в `registry/`.

## Git-инфра (harness)

- `.claude/hooks/git-gate.mjs` — hard-gate git-write для не-main. `main-session-marker.mjs`
  пишет `.claude/.main-session-id` только для scope main. `scope-identity.mjs` — баннер роли.
- Как в brainer: без `governance.mjs` и `agents/*.md` — границу держит git-gate + промпт;
  добавим при параллельных owner'ах.

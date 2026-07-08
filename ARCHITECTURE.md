# Architecture — Omnifield Devopser

Repo-local north star. Родственные решения — оракул `egor6-66/capsuleTech`
(ADR 068 gateway, 071/072 storage/containerize, `docs/_meta/migration/infra.md` — аудит,
из которого этот репо выведен). Дисциплина/канон — `omnifield/commons/standards/`.

## Что это

Продукт эксплуатации инфраструктуры: **поднимать / мониторить / маршрутизировать / деплоить**
продукты Omnifield. Devopser обслуживает все продукты экосистемы (включая себя) — мы юзер №0.
Это НЕ «папка docker в каждом репо»: инфра, нужная второму продукту без изменений, живёт здесь
централизованно. Продукт-репо не содержат runtime-инфры — только свой код и CI.

## Ключевая абстракция — **stack-as-capability** (тот же шов, что brainer/writer)

- **Capability** — контракт инфра-стека: `up / down / status / configure`.
- **Provider** — где стек исполняется:
  - `local-docker` — docker compose на dev-хосте. **MVP: только он.**
  - `vps` / `cloud` — удалённые среды. Позже, extension по готовому шву.
- **Registry** — декларативная карта: какие продукты, какие порты, какие маршруты gateway.

**MVP-честность:** на фазе 0 шов — в дизайне раскладки (stack = самодостаточная директория
с compose + конфигами), НЕ в коде. Код-шов (control-plane API над стеками) — фаза
продуктизации, contract-first, как в brainer.

## Раскладка

| Зона | Что | Происхождение |
|---|---|---|
| `stacks/gateway/` | nginx single-origin :8080, path-роутинг на `host.docker.internal:<port>`, тупой/stateless | оракул `docker/gateway/` |
| `stacks/observability/` | OTEL collector :4317 → Loki :3100 + Prometheus :9090 → Grafana :3333 (дашборд Agent Fleet) | оракул `docker/observability/` (БЕЗ `.claude/` — см. брифы) |
| `stacks/storage/` | minio (S3-совместимый) | оракул (ADR 071/072) |
| `registry/` | ports.md + products.md — единый source of truth портов/продуктов/маршрутов | консолидация из DEPLOY.md продуктов |
| `workstation/` | provisioning dev-машины: bootstrap базового слоя (git/node/uv/docker/claude) + карта репо | greenfield (инцидент 2026-07-08) |
| `packages/` | (позже) control-plane backend/frontend при продуктизации | фаза 1+ |

**Принцип стека:** каждый stack самодостаточен — `docker compose up -d` из его директории
поднимает его целиком. Стеки не знают друг о друге; связь (какой продукт куда проксируется) —
только через `registry/`.

## Существующий субстрат (переиспользуем, не greenfield)

- Оракул `capsule/docker/` — **живой** и в проде dev-флоу: brainer backend читает
  Loki :3100 / Prometheus :9090, инжектит OTEL на :4317; сессии Claude мониторятся через
  Grafana :3333. → миграция **copy-first**: devopser становится source of truth, оракул
  продолжает крутить своё до явного переключения. Порты 1:1, потребители не замечают.
- Паттерн «апы/бэки на ХОСТЕ, контейнеры — только тонкая инфра» (brainer `DEPLOY.md`) —
  обязателен для агент-продуктов (спавн claude-процессов = хостовое). Devopser его наследует.

## Фазы

- **Фаза 0 (MVP):** миграция стеков + registry (`briefs/infra-migration.md`) + workstation-bootstrap
  (`briefs/workstation-bootstrap.md` — capability `workstation`: provision/verify машины,
  provider `windows-winget`; macOS/linux — extension по шву).
- **Фаза 1:** control-plane (contract-first: список стеков / статус / up-down через API+UI).
- **Дальше:** провайдеры `vps`/`cloud`, деплой-пайплайны продуктов, entitlement для внешних юзеров.

## Границы (не строим сейчас)

Control-plane API/UI, cloud-провайдеры, CI/CD-раннеры, secrets-management, auth, биллинг.
Всё — фазами по готовому шву.

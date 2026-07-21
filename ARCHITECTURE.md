# Architecture — Omnifield Devopser

Repo-local north star. Дисциплина/канон — `omnifield/commons/standards/`. Канон/история
решений — knowledger KB (зоны FUND/ADR/MECH/DEVOPSER); `briefs/` — аудируется под ретайр.

## Что это

Продукт эксплуатации экосистемы Omnifield: **скелет репо (пресеты + reusable CI + init/drift),
provisioning машин, реестр контрактов** — и runtime-инфра строго под заказ потребителя.
Devopser обслуживает все продукты экосистемы (включая себя) — мы юзер №0.

## Главный флоу (ревизия user 2026-07-09 — needs-driven)

Готовим devopser как поставщика → сажаем потребителей (weber первым, brainer, writer):

1. **workstation** — новая машина: **Docker, точка** (containers-only канон, user
   2026-07-10): тулчейн/git/Claude-сессии — в devbox-контейнере, файлы — bind-mount;
   пины репо исполняются внутри контейнера.
2. **repo-skeleton** (канон → knowledger: DEVOPSER `DEVOPSER-2`, ADR `ADR-4`; порядок D1 → D3 → D2):
   reusable CI → init-материализация + drift-check → пресет-пакеты `@omnifield/*`
   (исходники в `packages/`, publish — GitHub Packages; решение user 2026-07-09).
3. Потребители переключаются с in-repo копий мелкими PR.

**Граница P0:** репо зависят ТОЛЬКО от опубликованных артефактов devopser (workflow-ref,
npm-пакеты, вендоренные копии с drift-check) — НИКОГДА от живого devopser-сервиса.
Любой репо: clone → install → работает.

**Секреты (репо публичные, 2026-07-09):** только env-инжект (GH Environments / vault
devopser) — файлы с секретами в управляемых репо не появляются; CI-гейт — gitleaks-шаг
reusable node-ci по всей истории. Секция секретов обязательна в каждом деплой-брифе.

## Раскладка

| Зона | Что |
|---|---|
| `packages/` + `.github/workflows/` | зона `skeleton` — пресеты, reusable CI, init/drift |
| `platform/` | per-repo конфиг репо (`repo-flow.json`: `stack`) — вход для `init.mjs`/CI. Rulesets-материализация переехала в git-flow-пресет (`scripts/git-flow.mjs rulesets`, DEVOPSER-137) — единый источник enforcement |
| `devbox/` | базовый dev-образ `ghcr.io/omnifield/devbox` — ЕДИНСТВЕННАЯ среда исполнения (containers-only; GPU — только у llm-engine-контейнера, не здесь) |
| `stacks/portainer/` | web-пульт docker-хостов (первый needs-driven стек; заказчик — user) |
| `registry/` | порты/продукты/маршруты — source of truth контрактов экосистемы |
| `workstation/` | bootstrap dev-машины + карта репо |
| `briefs/` | брифы architect → owner + история решений |

## Runtime-стеки — только под заказ

**stack-as-capability** остаётся швом на будущее: стек = самодостаточная директория
(compose + конфиги), `up / down / status`, стеки не знают друг о друге, связи — через
`registry/`. Но стек появляется ТОЛЬКО под точечный заказ продукта-потребителя с его
контрактом — «перенос из капсулы потому что было» отменён как класс работ
(ревизия 2026-07-09). Паттерн «апы/бэки на ХОСТЕ, контейнеры — тонкая инфра» —
обязателен для агент-продуктов, наследуется любым будущим стеком.

**Интерим:** телеметрия агент-сессий и gateway живут в оракуле (`capsule/docker/`,
Loki :3100 / Prometheus :9090 / OTEL :4317 / Grafana :3333) до заказа от brainer —
агент-наблюдаемость в v2 = продукт brainer, не Grafana-обвязка.

## Границы (не строим)

Control-plane API/UI, cloud/VPS-провайдеры, CI/CD-раннеры, secrets-management, auth,
биллинг · agent-харнесс и телеметрия агентов — **brainer** · release-механика — `nx release`
в репо-потребителях · доки/KB — knowledger.

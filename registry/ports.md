# Registry — Ports (source of truth)

Единый реестр портов dev-хоста экосистемы Omnifield. Изменение порта = контракт
(потребители зависят) — только через architect + запись здесь.

> Статус: **сид** (собран из brainer/DEPLOY.md + compose оракула, 2026-07-08).
> Актуализируется в founding-миграции (`briefs/infra-migration.md`).

## Инфра (стеки devopser)

| Порт | Что | Стек |
|---|---|---|
| 8080 | gateway nginx (single-origin) | `stacks/gateway` |
| 4317 | OTEL collector gRPC (сюда эмитят claude-сессии) | `stacks/observability` |
| 4318 | OTEL collector HTTP | `stacks/observability` |
| 3100 | Loki (читает brainer backend) | `stacks/observability` |
| 9090 | Prometheus (читает brainer backend) | `stacks/observability` |
| 3333 | Grafana (дашборд Agent Fleet) | `stacks/observability` |
| 9000 / 9001 | minio API / console | `stacks/storage` |

## Продукты (хост)

| Порт | Что | Репо |
|---|---|---|
| 3500 | brainer frontend (vite) | `omnifield/brainer` |
| 8010 | brainer backend (uvicorn, префикс `/brainer/`) | `omnifield/brainer` |

## Занято оракулом (capsule, до переключения)

3000 / 3050 / 3200 / 3400 · 8001–8007 (бэки капсулы). Уточнить карту при миграции —
сейчас перечень из brainer/DEPLOY.md («свободны относительно занятых»).

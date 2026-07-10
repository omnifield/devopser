# Registry — Ports (source of truth)

Единый реестр портов dev-хоста экосистемы Omnifield. Изменение порта = контракт
(потребители зависят) — только через architect + запись здесь.

> Статус: **сид** (собран из brainer/DEPLOY.md + compose оракула, 2026-07-08; перелейблен
> 2026-07-09 — миграция стеков снята, needs-driven).

## Инфра (владелец — оракул `capsule/docker/`, интерим до v2-заказов)

Стеки крутит капсула; порты зарезервированы здесь от коллизий, т.к. на них сидят
живые потребители (brainer backend, claude-scope-сессии). Devopser-стек на этих портах
появится только под заказ потребителя (тогда — новый контракт, запись обновится).

| Порт | Что | Где живёт |
|---|---|---|
| 4317 | OTEL collector gRPC (сюда эмитят claude-сессии) | `capsule/docker/observability` |
| 4318 | OTEL collector HTTP | `capsule/docker/observability` |
| 3100 | Loki host-порт (читает brainer backend; capsule PR #478) | `capsule/docker/observability` |
| 9090 | Prometheus (читает brainer backend) | `capsule/docker/observability` |
| 3333 | Grafana (дашборд Agent Fleet) | `capsule/docker/observability` |
| 9000 / 9001 | minio API / console | `capsule/docker/gateway` (compose там же) |

## Стеки devopser (containers-only)

| Порт | Что | Стек |
|---|---|---|
| **8080** | **gateway nginx — single-origin вход + хаб** (единственный порт в UX/доках; переехал из капсулы 2026-07-11, `gateway-hub-single-origin.md`; капсульный gateway — предыдущая эпоха, одновременно не поднимать) | `stacks/gateway` |
| 9443 | Portainer CE (web-пульт докера, HTTPS; только localhost-доступ) | `stacks/portainer` |

## Продукты (хост) — nginx-targets gateway, из UX/доков не фигурируют

| Порт | Что | Репо |
|---|---|---|
| 3500 | brainer frontend (vite; за gateway `/brainer/`) | `omnifield/brainer` |
| 8010 | brainer backend (uvicorn, префикс `/brainer/`; за gateway `/api/brainer/`) | `omnifield/brainer` |

⚠️ Фактические временные порты brainer — 5173/8000: освобождаются после исполнения
порт-контракта owner'ами (`brainer/briefs/gateway-parity-{frontend,backend}.md`).

## Занято оракулом (capsule, до переключения)

3000 / 3050 / 3200 / 3400 · 8001–8007 (бэки капсулы) · 4873 (verdaccio оракула, эфемерный
`nx local-registry`). Перечень из brainer/DEPLOY.md + compose/nginx капсулы
(«свободны относительно занятых»). ⚠️ Известная коллизия капсулы: :3100 — и Loki host-порт,
и learn-фронт в её nginx — проблема капсулы, к нам не тащить.

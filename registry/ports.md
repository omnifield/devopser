# Registry — Ports (source of truth)

Единый реестр портов экосистемы Omnifield. **`:8080` (gateway) — единственный
хост-контракт**; порты продуктов — внутренние (docker-сеть `omnifield-gateway`, апстрим
по docker-alias, не хост). Изменение порта = контракт (потребители зависят) — только
через architect + запись здесь.

> Статус: **сид** (собран из brainer/DEPLOY.md + compose оракула, 2026-07-08; перелейблен
> 2026-07-09 — миграция стеков снята, needs-driven).
> ✅ **Single-origin доведён** (`briefs/gateway-network-single-origin.md` → `owner-registry-ports-internal.md`,
> 2026-07-12): порты продуктов (3500/5173/8010/8020/…) — **внутренние** (docker-сеть
> `omnifield-gateway`, апстрим по docker-alias, не `host.docker.internal` и не per-service `-p`).
> Глобальная уникальность портов между продуктами больше НЕ требуется (разные контейнеры);
> единственный хост-контракт = `:8080`.

## Инфра (владелец — оракул `capsule/docker/`, легаси-эпоха, интерим до v2-заказов)

Порты **капсульной эпохи** (capsule host-публикует их у себя) — держим здесь от коллизий с
живыми потребителями (brainer backend, claude-scope-сессии). Это НЕ devopser single-origin
топология; devopser-стек на этих портах появится только под заказ потребителя (тогда — новый
контракт, запись обновится).

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

> `:8080` — **единственная хост-публикация всей системы** (`docker ps` → один проброшенный порт;
> `gateway-network-single-origin.md`). 9443 Portainer — только localhost, наружу не торчит.

## Продукты — внутренние апстримы gateway (docker-сеть `omnifield-gateway`)

Порты живут **внутри контейнеров продукта**; gateway достаёт их по **docker-alias = имя репо**
(= join-key `reach.routes[].service`, `liaison-inc1-manifest-boundary.md`). На хост НЕ
публикуются, в UX/доках не фигурируют. Уникальность требуется только В РАМКАХ одного devbox
(brainer 3500+8010 в одном контейнере — обязаны различаться); между продуктами (разные
контейнеры) уникальность НЕ требуется.

| Внутр. порт | upstream (`alias:port`) | Что | Репо |
|---|---|---|---|
| 3500 | `brainer:3500` | brainer frontend (vite; за gateway `/brainer/`) | `omnifield/brainer` |
| 8010 | `brainer:8010` | brainer backend (uvicorn, префикс `/brainer/`; за gateway `/api/brainer/`) | `omnifield/brainer` |
| 5173 | `weber:5173` | weber sandbox (vite dev; за gateway `/sandbox/` — полигон фреймворка, поднимается из weber-devbox) | `omnifield/weber` |
| 8020 | `chater:8020` | chater backend (Go, префикс `/chater/`; за gateway `/api/chater/` — маршрут появится с runtime, `chater-go-prereqs.md`) | `omnifield/chater` |

⚠️ Фактические временные порты brainer — 5173/8000: приводятся к контрактным 3500/8010 внутри
devbox owner'ами (`brainer/briefs/gateway-parity-{frontend,backend}.md`). Это порт КОНТЕЙНЕРА,
не хоста — класс «занятый хостовый порт» больше не при чём.

## Занято оракулом (capsule, до переключения)

⚠️ **Легаси-эпоха** — host-порты капсулы (её предыдущая инфра-эпоха). К single-origin разбору
devopser НЕ тащить; переключение на devopser-gateway — по `gateway-hub-single-origin.md`.

3000 / 3050 / 3200 / 3400 · 8001–8007 (бэки капсулы) · 4873 (verdaccio оракула, эфемерный
`nx local-registry`). Перечень из brainer/DEPLOY.md + compose/nginx капсулы
(«свободны относительно занятых»). ⚠️ Известная коллизия капсулы: :3100 — и Loki host-порт,
и learn-фронт в её nginx — проблема капсулы, к нам не тащить.

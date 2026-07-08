# Omnifield Devopser

Продукт **эксплуатации инфраструктуры** экосистемы Omnifield — и это продукт, не внутренний
хелпер. Он обслуживает все наши продукты (brainer, writer, …), мы — юзер №0 (догфуд);
позже те же возможности отдаём внешним пользователям. Принцип экосистемы: большинство того,
что мы используем сами — потенциальный продукт.

> Статус: **bootstrap** (founding-скелет). Рабочее имя. Реализация — по брифам (`briefs/`).

## Что делает

- **Стеки** (`stacks/`) — переиспользуемая runtime-инфра: gateway (nginx single-origin),
  observability (OTEL collector → Loki/Prometheus → Grafana), storage (minio).
- **Реестр** (`registry/`) — единый source of truth: порты, продукты, маршруты gateway.
- **Деплой-флоу** — как продукты попадают в среду (фазами; MVP = local-dev паттерн оракула).

## Ключевая идея — stack-as-capability

Тот же шов, что у brainer (agent-as-provider) и writer (kernel): инфра-стек = **capability**
(контракт: up / down / status / configure), за которой стоит **provider** — где исполняется:
`local-docker` (сейчас, MVP) · VPS / cloud (позже). Строим шов один раз — продуктизация
(control-plane API/UI над стеками) ложится на него фазой, не переписыванием.
См. [`ARCHITECTURE.md`](ARCHITECTURE.md).

## MVP — миграция живой инфры оракула

Перенос `capsule/docker/` (gateway + observability + minio) сюда как source of truth +
консолидация порт-реестра. Copy-first, порты 1:1 — потребители (brainer/writer/оракул) не
ломаются. См. `briefs/infra-migration.md`.

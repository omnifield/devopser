# hub-core — ядро хаба воркспейса (реестр → дверь)

Хаб = **тонкий менеджер воркспейса**, не продукт ([[hub-is-thin-workspace-manager]]).
Ядро = **реестр** (какие продукты есть) + **дверь** (nginx :8080 + лендинг) + **Канал** (ops,
Portainer — отдельно). Этот пакет — `реестр → дверь`. Дизайн: `briefs/hub-core-design.md`,
`briefs/feedback-hub-core-as-hub-under-isolation.md`, `briefs/hubcore-door-from-registry.md`.

## Поток (single-origin, под изоляцией хаба)

```
продукт-devbox  --publish-->  omnifield-registry (volume, *.yaml)  --glob-->  hub-core
                                                                                  |
                                                          generate.mjs (реестр→дверь)
                                                                                  v
                          gateway (nginx) <--mount--  omnifield-gateway-conf (volume: nginx.conf + hub/)
                                  |
                            :8080 (ЕДИНСТВЕННАЯ хост-публикация)
```

- **Вход — publish-volume, НЕ fs-скан.** Каждый продукт-devbox на старте кладёт свой
  `omnifield.yaml` → `omnifield-registry/<name>.yaml` (`scripts/devbox-publish.mjs`, Шаг 5 §A).
  hub-core глобит `*.yaml` — репо продуктов в хабе НЕ смонтированы, `readdirSync(/workspaces)`
  сломан под изоляцией. Реестр **не зависит от up-состояния**: наличие файла = продукт в двери,
  лёгший продукт держит маршрут (last-published-wins) — таблица маршрутов не моргает.
- **Валидация — Zod** (`@omnifield/contract-manifest`, вендорен в `vendor/`). Битый/отсутствующий
  манифест — loud-warn + skip, не роняет генерацию соседей.
- **Выход — door-volume.** `generate.mjs` пишет `nginx.conf` + `hub/index.html` в
  `omnifield-gateway-conf`; nginx монтирует его же. Рукописной двери нет; committed
  `stacks/gateway/nginx.conf` + `hub/` ретайрены — источник правды = генерация в volume.

## Конвенция маршрутов (форма из манифеста, без нового поля контракта)

| Маршрут манифеста | nginx | Семантика |
|---|---|---|
| `/<name>` (фронт) | `location = /<name> { return 301 /<name>/; }` + `location /<name>/` → `proxy_pass http://<name>:<port>;` | bare `/<name>` → 301 на `/<name>/`, затем pass-through (SPA под base `/<name>/` из пресета — иначе `/<name>` = 404); backend серверит под `/<name>/` |
| `/api/<name>` (backend) | `location /api/<name>` → `rewrite ^/api(/.*)?$ $1 break;` + `proxy_pass http://<name>:<port>;` | снимает `/api`, бьёт в нативный `/<name>/…` |

`/api/<name>/…` → `<name>:<port>/<name>/…`. **nginx-gotcha:** при переменной в `proxy_pass`
(`$up_…`, нужна для resolver) nginx НЕ подставляет URI из `location` — URI берётся из `rewrite …
break`. Потому api-форма = `rewrite` + `proxy_pass` без URI (не `proxy_pass http://$up/<name>/`).

## Конвенция карточки лендинга (кликабельность = наличие UI-фронта, канон ADR-9)

Карточка кликабельна **только** у продукта с UI-фронтом — маршрутом `/<name>/` (не под `/api/`);
клик ведёт на `/<name>/`. Продукт, достижимый лишь через `/api/` (backend), или вовсе без `reach`
(service/worker) — **не приложение**: некликабельная `div.card--headless` с явным тегом
(`<type> · api` / `<type> · headless`) и **без ссылки на `/api/`** (голый JSON). Иначе «карточка =
апп» врёт — симптом: knowledger-карточка вела на JSON (`genLanding`, DEVOPSER-143).

## Запуск

```sh
node generate.mjs           # регенерить дверь в door-volume (в хабе — docker compose run --rm hub-core)
node generate.mjs --check   # рантайм-идемпотентность: exit 1 при дрейфе door-volume vs реестр
node --test                 # эмиттер-прог формы nginx/лендинга против стаб-registry
```

Пути volume — env (дефолты = mount-таргеты в хабе):
`OMNIFIELD_REGISTRY_DIR` (ro, вход, `/omnifield-registry`), `OMNIFIELD_GATEWAY_DIR` (rw, выход,
`/omnifield-gateway`). `--check` — рантайм-assertion в хабе (кто-то правил дверь руками /
устаревший образ), НЕ CI-шаг репо: входы (манифесты) живут в volume, не в репо.

**Провод `--check` в хабе** (`stacks/gateway/compose.yml`, профиль `check`): drift-gate — это
профилированный сервис `hub-core-check` (тот же образ, `command: ["--check"]`, door-volume `ro`),
на обычном `up` НЕ поднимается; зовётся ops/Канал'ом или по расписанию:
`docker compose --profile check run --rm hub-core-check` → exit 1 при дрейфе. **Не Docker
HEALTHCHECK**: node-несущий hub-core одноразовый (exit после генерации), а long-running gateway —
чистый nginx (node тут нет). **Не CI-гейт**: манифесты живут в registry-volume, не в git.

## Исполнимость в `omnifield-hub`

Контракт `@omnifield/contract-manifest` **вендорен** (`vendor/@omnifield/contract-manifest`, dist)
— развязка `file:../../knowledger` под изоляцией. Образ (`Dockerfile`) самодостаточен, репо
продуктов не монтирует. Обновление контракта = копия свежего `dist/` из knowledger в `vendor/`
(альтернатива — публикация `@omnifield/contract-manifest`, handoff knowledger §C).

## Границы

- **Канал (liveStatus/ops)** — Portainer/docker-API, отдельно (дизайн §4). НЕ влияет на таблицу
  маршрутов (running/stopped — индикатор на карточке, follow-on).
- **Порты/маршруты = контракт** `registry/ports.md` (architect-gated) — не менять, только
  регенерить корректно. Продукт без манифеста просто вне двери (норма).

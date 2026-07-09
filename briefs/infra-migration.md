# Brief — Infra Migration (founding: перенос живой инфры оракула → devopser)

| | |
|---|---|
| **Scope** | cross-zone founding (`stacks/*` + `registry/`) — координирует **architect**; репо пустой, параллельных owner'ов ещё нет — можно одной architect-сессией |
| **Порядок** | ПЕРВЫЙ бриф репо. После него devopser = source of truth инфры |
| **Канон** | `omnifield/commons/standards/` + `ARCHITECTURE.md` (stack-as-capability, copy-first) |

## Цель

Перенести живую docker-инфру оракула (`capsuleTech/docker/`) в devopser так, чтобы **ни один
потребитель не заметил**: brainer backend (Loki :3100, Prometheus :9090, OTEL-инъекция :4317),
Grafana-мониторинг сессий (:3333), gateway-роутинг (:8080). Copy-first: оракул продолжает
крутить своё до явного переключения (переключение = отдельный заход, зона оракула).

## Источники (факты, проверены 2026-07-08)

- **`docker/observability/`** → `stacks/observability/`:
  `docker-compose.yml` — otel-collector-contrib 0.111.0 (**4317** gRPC, **4318** HTTP),
  Loki 3.1.1 (**3100**, host-порт доэкспожен оракул-PR #478), Prometheus v2.54.1 (**9090**,
  retention 7d), Grafana 11.2.2 (**3333**→3000). Конфиги: `otel-collector-config.yaml`,
  `loki-config.yaml`, `prometheus.yml`, `grafana/` (provisioning + дашборд Agent Fleet).
- **`docker/gateway/`**: `compose.yml` — nginx 1.27-alpine (**8080**→80, `nginx.conf` path-роутинг
  на `host.docker.internal:<port>`) **и minio** (**9000**/**9001**) в одном compose.
  → у нас разъезжаются: nginx → `stacks/gateway/`, minio → `stacks/storage/` (свой compose).
  Канон раскладки: стек самодостаточен, gateway не обязан тянуть за собой S3.
- **`docker/preview-server/`** — ⚠️ открытый вопрос infra-аудита оракула («живой ли flow»).
  НЕ переносить, пока не подтверждена нужность. Отметить в registry как «не мигрирован, TBD».

## ⚠️ КРИТИЧНО — что НЕ переносить

- **`docker/observability/.claude/`** — это harness-дом ОРАКУЛА (канон его CLAUDE.md §0.2:
  сессии капсулы стартуют оттуда). Стек = compose + конфиги + grafana provisioning. Никаких
  `.claude/`, `settings.json`, hooks из оракула.
- **`docker/observability/claude-scope.ps1|.sh`** — оракульный launcher (с OTEL-env блоком).
  Не наш файл; как **референс** OTEL-env он уже зафиксирован в brainer `briefs/backend-mvp.md`.
- Капсуло-специфика в конфигах (имена/пути оракула) — при копировании вычистить в
  brand-neutral (`omnifield-*` container names и т.п.), но **порты и лейбл-схему (`scope`,
  `package`) не трогать** — на них сидят потребители.

## Шаги

1. `stacks/observability/` — компоуз + 4 конфига + grafana provisioning. `docker compose up -d`
   из директории стека поднимает всё. README стека: порты, потребители, smoke-команды.
2. `stacks/gateway/` — nginx compose (без minio) + `nginx.conf`. Маршруты продуктов
   (`/learn/`, `/brainer/`, …) — сверить с registry, капсульные-мертвые вычистить только
   после переключения оракула (пока 1:1).
3. `stacks/storage/` — minio отдельным compose (9000/9001, volume под `data/` — gitignored).
4. `registry/ports.md` — актуализировать против реальных compose (сид уже лежит) +
   `registry/products.md` — карта продуктов (repo, frontend/backend порты, gateway-префикс).
5. Smoke: поднять observability из devopser (оракульный стек погасить на время теста —
   конфликт портов), прогнать brainer-флоу: сессия спавнится → видна в Loki → метрики
   в Prometheus → дашборд Grafana живой. Вернуть как было.

## Вне скоупа

Переключение оракула на devopser-стек (его зона, отдельный заход) · preview-server ·
control-plane (фаза 1) · cloud/VPS-провайдеры · CI для compose-валидации (можно TODO).

## Deliverable

Три самодостаточных стека в `stacks/` (up с чистого клона одной командой каждый) +
заполненный `registry/` (ports + products). Devopser = source of truth; в оракуле и brainer
TODO-заметки «порты → devopser/registry» (правки их доков — их architect'ы, брифом/PR).

## Verify (DoD)

- Чистый клон → `docker compose up -d` в каждом стеке → healthy.
- Smoke из шага 5 пройден (реальная claude-сессия видна через devopser-стек).
- `registry/ports.md` = реальность compose-файлов (ни одного расхождения).
- README на каждый стек (порты, потребители, smoke) + этот бриф закрыт галочкой.

## Заметки

- Конфликт портов при dual-run (оракул + devopser одновременно) — НЕ решаем хитростью,
  просто не гоняем оба: на dev-хосте активен один экземпляр стека.
- Изменение любого порта/маршрута = контракт (POLICY) — не «улучшать заодно».
- Git: обычный флоу architect'а, коммиты по стекам (observability → gateway → storage → registry).

---

## Амендмент 2026-07-09 (architect, по `devops-consolidated-backlog.md` §2/§4; registry-npm — резолюция оракула в `repo-skeleton-product.md`)

1. **+ стек `stacks/registry-npm/`** — self-hosted npm-registry. Дефолт **Verdaccio**
   (проверен оракулом, `nx local-registry` поднимает его же); иное — предложение с
   обоснованием. Потребитель — repo-skeleton D2 (publish пресет-пакетов `@omnifield/*`).
   Порт: кандидат **4873** (дефолт Verdaccio, по текущей карте свободен) — финально завести
   в `registry/ports.md` (контракт). Storage-volume gitignored. DoD стека: up с чистого
   клона + smoke `npm ping --registry` + publish/install dry-run тест-пакета.
2. **Паттерн под будущие сервис-контейнеры (CC-11 аудита).** Постура канона не меняется
   (апы/бэки на ХОСТЕ, gateway → `host.docker.internal:<port>`), но при переносе стеков
   заложить и задокументировать в README стеков конвенцию подключения будущих
   контейнеризованных бэков (именование сетей/контейнеров `omnifield-*`, порты — только
   из `registry/ports.md`), чтобы миграция бэков не перекраивала стеки. Dockerfile'ы
   сервисов — зона владельцев сервисов, сюда не тащить.
3. Порядок коммитов дополняется: … → storage → **registry-npm** → registry.
4. Координация: blueprint раскладки стеков — показать user ДО исполнения
   (канон из `devops-consolidated-backlog.md` §Координация).

# Brief — Консолидированный devops-бэклог экосистемы (всё в одном месте)

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | оракул-архитектор, 2026-07-09 (решение user: «всё что нужно для девопса — нести сюда») |
| **Природа** | сводный бэклог: НЕ заменяет существующие брифы (`infra-migration.md`, `repo-skeleton-product.md`) — связывает их + добирает всё девопс-хозяйство из инфра-аудита оракула (`capsule/docs/_meta/migration/infra.md`) |
| **Приоритеты** | таблица §1; порядок внутри пунктов — твоя техпроработка |

## §1. Сводный бэклог (приоритет сверху вниз)

| # | Пункт | Статус/бриф | Заметка |
|---|---|---|---|
| 1 | **Workstation e2e (Q2 DoD)** | `workstation/escalation-bootstrap-gaps.md` | ждёт среду от user (тачка/Sandbox) |
| 2 | **Infra-migration (Q5): стеки из оракула** | `briefs/infra-migration.md` + §2 ниже | + амендмент **registry-npm** (принят, вариант а) |
| 3 | **Repo-skeleton D1+D3** (reusable CI + init/drift) | `briefs/repo-skeleton-product.md` | референс — weber CI (зелёный) |
| 4 | **Repo-skeleton D2** (пресет-пакеты nx/biome) | там же | ЖДЁТ registry-npm из #2 |
| 5 | **Preview-server: решение о судьбе** | §3 | 🟠 аудита — вопрос user'у подготовить |
| 6 | **Backend containerization (CC-11)** | §4 | совместно с миграцией бэков, не сейчас |
| 7 | **D4-оценки** (devcontainer / Renovate self-hosted / mise / nx remote-cache) | repo-skeleton D4 | по мере свободы |

## §2. Состав Q5 (infra-migration) — уточнение из аудита оракула

Стеки, которые РЕАЛЬНО живут и переносятся (вердикт 🟢 REUSE):

- **gateway** — nginx single-origin (ADR 068 D6 оракула), path-роутинг на
  `host.docker.internal:<port>`, тупой/stateless. **Постура канона: апы/бэки на ХОСТЕ,
  стеки в docker** — критично для агент-продуктов (brainer/DEPLOY.md уже так живёт).
- **observability** — OTEL collector (:4317) → Prometheus + Loki → Grafana. **Живой
  потребитель — brainer** (телеметрия агент-сессий). Известная грабля оракула: host-порт
  Loki (capsule PR #478) — проверить при переносе.
- **storage** (minio, S3 — ADR 071/072 оракула).
- **registry-npm** — амендмент (Verdaccio дефолт; оракул юзает его же через `nx local-registry`).
- **`registry/ports.md`** — порт-карта экосистемы: держать единственным источником правды
  портов всех стеков/апов (у оракула порт-коллизии были болью — 3050 studio vs playground).

НЕ тащить: `deploy-preview` compose как есть (см. §3), оракульный CI (переписан per-repo,
+CC-7: ни одного ref на удалённый `shared-file-manager`).

## §3. Preview-server — подготовить решение user'у

Оракул: `docker/preview-server` + `scripts/deploy-preview.mjs` — заливка `apps/<app>/dist`
на self-hosted preview для тестеров. Аудит: 🟠 «проверить нужность». Вопрос к user (сформулируй
со своей оценкой стоимости): нужен ли preview-флоу в v2 сейчас (продукты до тестеров ещё не
дозрели) — или паркуем до первого продукта с внешними тестерами? Если берём — это твой стек
(рядом с gateway), скрипт заливки регенерится под v2.

## §4. Backend containerization (CC-11 аудита) — граница зон

ADR 072 §4 оракула («каждый бэк-сервис контейнеризуем с первого дня») НЕ выполнен: у python-
сервисов ноль Dockerfile'ов (крутятся `uv run uvicorn` на хосте). env-конфиг готов (pydantic
Settings) → контейнеризация механическая. **Граница:** Dockerfile каждого сервиса = зона
владельца сервиса (едет с миграцией бэков, не сейчас); **compose/стеки/сети/volumes — твоя
зона**. Твоя часть сейчас: заложить в стеки §2 паттерн подключения будущих сервис-контейнеров
(сеть, конвенция портов из ports.md), чтобы миграция бэков не перекраивала стеки.

## §5. Что devopser НЕ берёт (границы, повтор для полноты)

- Agent-харнесс (.claude/claude-scope/пресеты ролей) — **brainer**.
- `feature-report.mjs` (токены Claude) — **brainer**.
- Release-механика пакетов — `nx release` внутри репо; у тебя только registry.
- Канон-гейты кода (compliance/check-ownership/audit-exports) — живут в репо-потребителях.
- Доки/KB — knowledger.

## Координация

Расхождение/находка → комментарий в этот бриф (как с registry — сработало отлично) →
эскалация через user. Blueprint'ы больших кусков (Q5-стеки, reusable CI shape) — показ user
до исполнения.

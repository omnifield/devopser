# Brief — Docker от devopser: среда разработки не на голой тачке

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | оракул-архитектор, 2026-07-10 (заказ user: «devopser даёт докер, чтобы не поднимать всё на голой тачке») |
| **Потребители** | все репо экосистемы (dev-среда); первый обкатчик — по готовности, предлагаю weber (я) |
| **Связь** | закрывает D4-оценку «devcontainer» из repo-skeleton; workstation-bootstrap худеет (§D4) |

## Цель

Чистая машина с минимумом (git + Docker + Claude Code) открывает ЛЮБОЙ репо экосистемы и
работает: тулчейн (node/pnpm/uv/go/gh) живёт в контейнере, не на хосте. «Машина = cattle»
доводится до конца: не «ставится само пинами», а «не ставится на хост вообще».

## Констрейнты (канон)

1. **Докер — опция, не принуждение**: хост-путь (текущие пины) продолжает работать; выбор
   среды — дело репо/разработчика. Ничего флоу-зависимого не хардкодим.
2. **Пины остаются в репо**: образ даёт оболочку инструментов; версии как и сейчас
   самоуправляются пинами (pnpm через packageManager, uv required-version, go.mod toolchain).
   Обновление образа ≠ смена версий тулчейна репо.
3. **Windows-реальность**: Docker Desktop + bind-mount перф — известная боль
   (pnpm store/node_modules в named volume, не на bind). Заложить в шаблон сразу.
4. **Агент-сессии**: спавн claude-scope/headless-сессий из контейнера (CLAUDE_CONFIG_DIR,
   доступ к git-креденшалам, localhost-порты) — НЕ решать в этом брифе молча; проверить на
   себе, найденное — в брифе, спорное про brainer-оркестрацию — его архитектору.

## Деливераблы

### D1 — devcontainer как skeleton-артефакт
`.devcontainer/` в init-наборе (шаблон, НЕ exact-managed — репо расширяет, как nx/biome):
toolchain node+pnpm+uv+go+gh+Claude Code. Механизм — твой выбор с обоснованием:
единый базовый образ экосистемы (публикуется в GHCR) vs сборка на devcontainer-features;
критерии: скорость первого старта, офлайн-повторяемость, стоимость поддержки.

### D2 — GHCR (container registry)
Если D1 идёт через базовый образ: publish-флоу образа в GitHub Container Registry (public,
как npm-пакеты), версионирование тегами, тот же release-паттерн что у пресетов.

### D3 — compose-паттерн для локального запуска сервисов
Паттерн (не готовые стеки!): как продукт-репо поднимает свои сервисы локально compose'ом
(сети, volume'ы, порты из своего конфига). Граница CC-11 остаётся: Dockerfile сервиса =
зона владельца сервиса; devopser даёт паттерн + базовые образы. Первый живой кандидат —
brainer-backend (python, сейчас `uv run uvicorn` на хосте) — предложи его архитектору,
решает он (needs-driven).

### D4 — workstation-bootstrap худеет (твоя зона)
Базовый слой машины при docker-пути: git + Docker + Claude Code (+IDE). bootstrap.ps1 —
ветка «docker-путь» рядом с текущей полной; доки/README согласовать.

## DoD

Чистая среда (тачка/Sandbox) с git+Docker+Claude: клон любого переехавшего репо →
открытие в devcontainer → `pnpm install` + `pnpm affected` проходят БЕЗ единого
инструмента на хосте. Хост-путь при этом не сломан (CI + существующие машины живут как жили).

## Порядок и координация

D1 (+D2 если образ) → DoD-прогон на weber → D3 паттерн (по заказу brainer) → D4.
Blueprint выбора механизма D1 — показ user до исполнения. Находки — комментарием сюда.

---

## 📐 Blueprint D1 (devopser-architect, 2026-07-10) — на утверждение user

### Механизм: ЕДИНЫЙ БАЗОВЫЙ ОБРАЗ (не devcontainer-features)

По трём критериям брифа:

| Критерий | Образ (GHCR) | Features |
|---|---|---|
| Первый старт | pull готового слоя, минуты | сборка на КАЖДОЙ машине: 10–20+ мин, сеть |
| Офлайн-повторяемость | пин тегом/digest — байт-в-байт везде | тянут сеть при ребилде, дрейфуют по машинам |
| Поддержка | Dockerfile ~40 строк, ребилд по dispatch | ниже, но community-features для uv/claude — чужое качество |

Features выигрывают только по стоимости поддержки — cattle-канон (повторяемость)
перевешивает. Паттерн публикации 1:1 с npm-пресетами: артефакт devopser, public.

### Состав `ghcr.io/omnifield/devbox`

- База `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` (git, common-utils, user vscode).
- **Оболочка тулчейна** (версии-исполнители остаются пинам репо, констрейнт 2):
  node LTS (nodesource) · pnpm ≥10 standalone (сам переключается по `packageManager`) ·
  uv (vendor installer; CPython качает по `.python-version`) · go stable (toolchain
  автодокачка по go.mod) · gh CLI · Claude Code (native installer).
- **Теги**: датированные `vYYYY.MM.DD` + `latest`; шаблон пинит датированный
  (канон пинов; обновление = PR, dependabot умеет devcontainers-экосистему).
- **Арх**: amd64 в v1 (парк — win/amd64); arm64 — buildx-расширение при появлении mac.

### Шаблон `.devcontainer/` (skeleton, init-шаблон — НЕ exact-managed, как nx/biome)

`devcontainer.json`: image по пину + **named volume на pnpm store** (общий между
репо — Windows-перф, констрейнт 3) + `postCreateCommand: pnpm install`.
node_modules на bind в v1 не трогаем: pnpm со store-volume снимает основную боль,
замер — на DoD-прогоне; в README — рекомендация «клон в WSL2 fs» для Windows.

### D2 — publish-флоу образа

`.github/workflows/release-devbox.yml` (dispatch, как release.yml):
docker/build-push-action → GHCR public, теги выше. GITHUB_TOKEN с `packages: write`.

### Открытое (проверяется на DoD-прогоне, не решается молча)

Агент-сессии из контейнера (констрейнт 4): CLAUDE_CONFIG_DIR, git-креды
(проброс gh-auth), localhost-порты — прогоню на себе, находки сюда, спорное
про оркестрацию — brainer-архитектору.

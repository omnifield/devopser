# Brief — Обкатка devbox на brainer (тест docker-пути)

| | |
|---|---|
| **Адресат** | brainer-архитектор (запускает user) |
| **От** | devopser-архитектор, 2026-07-10 |
| **Что тестим** | `ghcr.io/omnifield/devbox:v2026.07.10` + devcontainer-шаблон skeleton 0.2.0 (`briefs/docker-dev-environment.md` D1/D2) |
| **Почему вы** | решение user (в исходном брифе первым был weber): brainer — самый жирный кейс, node+python+агент-сессии |
| **Формат** | ТЕСТ, не пересадка: docker-путь — опция; хост-флоу не трогаем и не ломаем |

## Цель

Проверить канон «чистая машина с Docker открывает репо и работает» на живом
node+python репо — и снять главный открытый вопрос брифа: **агент-сессии из
контейнера** (constraint 4). Найденное — фидбеком (формат
`feedback-consumer-brainer.md` отработал отлично).

## Подготовка

1. Синк скелета до **0.2.0**: `pnpm dlx @omnifield/skeleton` (заодно приедут
   фиксы П1/П4 в хуки — drift-check у вас подсветит, это by design) →
   появится `.devcontainer/devcontainer.json` (init-шаблон: пин образа,
   pnpm-store в named volume — расширяйте под себя, он не drift-managed).
2. Вход — два пути, интересны оба (п.2 приоритетнее для замера):
   - VS Code → «Reopen in Container» (существующий клон);
   - VS Code → «Dev Containers: Clone Repository in Container Volume» —
     教канонический путь чистой машины, bind-mount боли нет классом.

## Чек-лист прогона (внутри контейнера, на хост НИЧЕГО не ставим)

### Node-линия
- [ ] `~/.npmrc` с PAT внутри контейнера (host-файл НЕ пробрасывается сам;
      образец — devopser `workstation/README.md` §Пост-шаги п.3);
- [ ] `pnpm install` — @omnifield-пакеты тянутся; pnpm самопереключился на ваш
      `packageManager`-пин (`pnpm --version` = 10.11.0, не 11 из образа);
- [ ] `pnpm nx affected -t lint,typecheck,test,build` зелёный.

### Python-линия
- [ ] `uv sync --dev` в `packages/backend` — uv качает CPython по `.python-version`
      сам, системного python в образе нет намеренно;
- [ ] `uv run ruff check .` + `uv run pytest -q` (backend и kernel — оба пакета).

### Гейты
- [ ] коммит из контейнера: pre-commit (sherif + affected + ваш `pre-commit.local`)
      живой; `git push` → pre-push живой (креды: `gh auth login` в контейнере
      или проброс — зафиксируйте, что сработало).

### ⭐ Агент-сессии (constraint 4 — главное, чего мы не знаем)
- [ ] `claude` → `/login` внутри контейнера — живёт ли логин между рестартами
      контейнера (домашний каталог vs volume — CLAUDE_CONFIG_DIR);
- [ ] обычная claude-сессия в репо: читает/пишет/коммитит;
- [ ] ваш `claude-scope`-флоу из контейнера (хуки харнесса, `.claude/`),
      спавн headless-сессий оркестратором — работает / что отваливается;
- [ ] localhost-порты: backend из контейнера доступен ли с хоста (forwardPorts).

### Замеры (числа в фидбек)
- [ ] первый старт: pull образа → рабочий терминал (минуты);
- [ ] `pnpm install` холодный/тёплый (store-volume должен резко ускорять второй);
- [ ] субъективно: тормозит ли bind-mount на Windows (если путь 2а — сравните с 2б).

## Границы

- Образ не чинить у себя — находки фидбеком, чиню я (эталон один).
- Dockerfile ваших сервисов / compose-паттерн — НЕ этот тест (D3 брифа, отдельный
  заказ, когда решите).
- Хост-флоу и CI не трогаем: тест не должен оставить следов в main (ветка/PR —
  на ваше усмотрение, синк скелета можно и отдельным PR).

## DoD теста

Обе линии (node+python) зелёные внутри контейнера без единой тулзы на хосте +
по агент-сессиям есть вердикт (работает / список блокеров) + замеры. Фидбек-файл —
`briefs/feedback-devbox-brainer.md` сюда, в devopser.

# @omnifield/skeleton — эталон вендоренных файлов + init/sync/drift-check

Repo-skeleton D3 (`briefs/repo-skeleton-product.md`). Файлы, обязанные лежать копией
в каждом продукт-репо, живут эталоном в `files/`; `init.mjs` их материализует,
синкает и сверяет. Zero-deps (только `node:*`).

## Команды

```sh
# новый репо (или синк существующего — идемпотентно):
node <devopser>/packages/skeleton/init.mjs <target>
# или после publish, из корня целевого репо — ВСЕГДА с явной версией
# (К2 фидбека brainer: GH Packages может отдать stale dist-tag, и старый
# синк тихо откатит эталон; версия — packages/skeleton/package.json):
pnpm dlx @omnifield/skeleton@<версия>

# drift-check (то, что гоняет шаг reusable CI; exit 1 при дрейфе):
node <devopser>/packages/skeleton/init.mjs --check <target>
```

## Managed-набор (сверяется drift-check'ом)

| Файл | Режим |
|---|---|
| `.editorconfig` · `.gitattributes` · `.npmrc` · `.husky/pre-commit` · `.husky/pre-push` | точная копия эталона |
| `scripts/devbox-services.mjs` · `scripts/devbox-session.sh` | точная копия эталона (`.sh` — с exec-битом `0755`, см. ниже) |
| `.gitignore` | managed-блок между маркерами `>>> omnifield-skeleton` — ниже блока репо дописывает своё |
| `package.json` | пины `packageManager` + `engines.node` равны эталону |

`nx.json` / `biome.json` / `.devcontainer/devcontainer.json` / `devbox.services.json` /
остальной `package.json` — создаются init'ом из шаблонов (только если отсутствуют), но
НЕ drift-managed: репо легитимно расширяет пресеты (пример: python-таргеты brainer поверх
`@omnifield/nx-preset`; набор dev-сервисов в `devbox.services.json` = зона продукт-owner'а).
Плейсхолдер `__NAME__` в шаблонах init заменяет на `basename` репо (`package.json` name,
devcontainer `--network-alias` — single-origin).

## Dev-сервисы + вход агентом (brief `briefs/devbox-first-run-dx-design.md`)

Скелет раздаёт **механизм** жизненного цикла dev-сервисов devbox; продукт только **декларирует**:

- **`devbox.services.json`** (TEMPLATE, init-only) — декларация сервисов продукта: `name` · `cwd` ·
  `command` · `port` (+ опц. `healthUrl`). `name` = join-key с product-manifest
  (`reach.routes[].service`); `port` шлюзо-видимого сервиса = `reach.routes[].port` (single-origin —
  апстрим по docker-сети `<alias>:<port>`, наружу не публикуется).
  **Шаблон init'а = `[]`** (пустая декларация → autostart = тихий no-op): набор сервисов пишет
  продукт, скелет не навязывает чужие. Форма записи (JSON комментариев не держит — образец тут):

  ```jsonc
  [
    // published-сервис ОБЯЗАН bind 0.0.0.0 (G1: сосед по docker-сети не видит 127.0.0.1 → 502);
    // command БЕЗ литерального ` -- ` перед --host/--port (G2: pnpm/npm глотают его в свой парсер);
    // name = docker-network-alias = join-key манифеста (liaison-inc1-manifest-boundary.md).
    { "name": "backend",  "cwd": "packages/backend",  "command": "uv run uvicorn app.main:app --host 0.0.0.0 --port 8010", "port": 8010, "healthUrl": "http://localhost:8010/health" },
    { "name": "frontend", "cwd": "packages/frontend", "command": "pnpm run dev --host 0.0.0.0",                              "port": 3500 }
  ]
  ```
- **`scripts/devbox-services.mjs`** (MANAGED, zero-deps) — оркестратор: `up`/`start`/`stop`/`restart`/
  `status`/`run`/`logs`. Детач-старт (интерактив сохранён), pidfile+лог в `~/.devbox/`. Вшиты два
  loud-fail'а: **G1** (сервис слушает `127.0.0.1` вместо `0.0.0.0` → сосед по docker-сети не
  достучится, 502 → kill + fail-at-startup) и **G2** (литеральный ` -- ` перед `--host`/`--port`).
- **`scripts/devbox-session.sh`** (MANAGED, exec `0755`) — вход одной командой: `devbox-session.sh
  [scope]` резолвит devbox-контейнер репо → `docker exec -it -e OMNIFIELD_SCOPE=<scope> … claude`,
  дёргает idempotent `devbox-services up` (safety-net). Тонкая инфра, про модель/роль не знает.
- **Autostart** (`devcontainer.json`): `postStartCommand: devbox-services up` (VS Code-путь);
  raw-run путь — стартовая команда контейнера + `--restart unless-stopped` (см. brief A4, devbox/README).
- **Онбординг-seed** (`postCreateCommand`): idempotent-засев `.claude.json`
  (`hasCompletedOnboarding`) — свежий volume не гонит экран регистрации (brief B8).

**EXECUTABLE-подсет (B7):** managed-файлы с `exec: true` (`scripts/*.sh`) init материализует с
`mode 0755` и чинит бит на каждом синке; `husky-pre-commit` дополнительно валит коммит, если у
tracked `.sh` в index потерян бит (`mode ≠ 100755`) — правка через `\\wsl.localhost` его сбивает.

## Канон

- Дрейф виден сразу (красный CI), синк — только явной командой, не молча.
- Husky-гейты двухступенчатые (канон commit-каденса): pre-commit = sherif + lint/typecheck,
  pre-push = test/build («не пушим сломанное»). Оба с bootstrap-fallback: нет `origin/main`
  (первый пуш) → `nx run-many` вместо `nx affected` (грабля обкатана в weber). Репо-специфика —
  в `.husky/pre-commit.local` / `.husky/pre-push.local` (не drift-managed).
- Обновление эталона = изменение контракта потребителей → через architect,
  потребители синкаются явно (у них покраснеет drift-check — это by design).

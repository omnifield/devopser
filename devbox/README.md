# devbox — базовый dev-образ экосистемы (`ghcr.io/omnifield/devbox`)

**Containers-only канон** (`briefs/containers-only-and-management.md`): на машине —
только Docker и файлы; тулчейн (node LTS · pnpm ≥10 · uv · go · gh · Claude Code),
git-операции и сессии живут в этом контейнере. Образ — только **оболочка**:
версии-исполнители остаются пинам репо (`packageManager`, `.python-version`,
`go.mod`) — обновление образа не меняет тулчейн репо.

## Использование (потребитель)

`.devcontainer/devcontainer.json` приезжает init-шаблоном skeleton (пин датированного
тега + named volume под pnpm-store). **Дефолт — bind-mount рабочей папки** (файлы на
машине; Windows — клон в WSL2 FS, bind родного NTFS медленный). Пути входа:

1. **Чистая машина (git на хост НЕ ставится)** — клон изнутри контейнера в
   примонтированную папку, затем вход любым способом ниже:
   ```sh
   docker run -it --rm -v "<папка-проектов>:/workspaces" -w /workspaces \
     ghcr.io/omnifield/devbox:latest git clone https://github.com/omnifield/<repo>.git
   ```
2. **JetBrains (WebStorm/PyCharm) / CLI** — devcontainers CLI (JetBrains Gateway
   умеет devcontainer.json тоже); node для dlx не нужен на хосте — CLI можно гонять
   и из шага 1:
   ```sh
   pnpm dlx @devcontainers/cli up --workspace-folder .
   pnpm dlx @devcontainers/cli exec --workspace-folder . bash
   ```
3. **VS Code**: открыть папку → «Reopen in Container».
4. **Голый docker**:
   ```sh
   docker run -it --rm -v "$PWD:/workspaces/repo" -w /workspaces/repo \
     ghcr.io/omnifield/devbox:latest bash
   ```
5. **Clone in Container Volume** (VS Code) — fallback по перф-замеру: клон живёт
   в docker-volume, bind-mount боли нет классом; общий pnpm-store-volume работает
   именно тут (см. «Известное поведение»).

Пост-шаги внутри контейнера (один раз): `gh auth login`, `claude` → `/login`,
PAT для @omnifield-пакетов (workstation/README §Пост-шаги п.3 — тот же `.npmrc`,
только в home контейнера/volume).

## Обновление образа

`gh workflow run release-devbox.yml -f tag=vYYYY.MM.DD` → тег + `latest`. Репо пинят
датированный тег в devcontainer.json — обновление приезжает PR'ом (dependabot
умеет devcontainers), не молча. ⚠️ Пин в skeleton-шаблоне обновляется ТОЛЬКО на
фактически изданный тег — проверка: `docker manifest inspect ghcr.io/omnifield/devbox:<тег>`
(грабля Д1: локальная дата ≠ UTC-дата раннера). Containers-only: это ЕДИНСТВЕННАЯ
среда исполнения — хост-тулчейн не поддерживается (канон user 2026-07-10;
workstation ставит только Docker).

## Известное поведение

- **node — единственный НЕ самоуправляемый инструмент образа** (`ARG NODE_MAJOR=22`):
  репо с `engines.node` выше мажора образа потребует ребилд образа с новым ARG —
  причина не у вас в репо.
- **pnpm store на bind-mount (путь 2а)** падает в `<workspace>/.pnpm-store`, а не в
  volume — pnpm держит store на одном device с проектом (Д4); `.pnpm-store/` уже
  в gitignore-блоке скелета. Общий store-volume работает на пути clone-in-volume.
- **Доступ к хост-сервисам из контейнера** — `host.docker.internal:<port>` (шаблон
  добавляет `--add-host=…:host-gateway` для linux-parity); `localhost` внутри
  контейнера = сам контейнер (П-докер-1).

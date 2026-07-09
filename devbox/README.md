# devbox — базовый dev-образ экосистемы (`ghcr.io/omnifield/devbox`)

Среда разработки не на голой тачке (`briefs/docker-dev-environment.md`): тулчейн
(node LTS · pnpm ≥10 · uv · go · gh · Claude Code) живёт в контейнере. Образ — только
**оболочка**: версии-исполнители остаются пинам репо (`packageManager`, `.python-version`,
`go.mod`) — обновление образа не меняет тулчейн репо.

## Использование (потребитель)

`.devcontainer/devcontainer.json` приезжает init-шаблоном skeleton (пин датированного
тега + named volume под pnpm-store). Пути входа:

1. **Чистая машина (рекомендуется): VS Code + Docker Desktop, больше НИЧЕГО.**
   VS Code → «Dev Containers: Clone Repository in Container Volume» → URL репо.
   Клон живёт в docker-volume → Windows bind-mount боль отсутствует классом;
   git внутри образа.
2. **Существующий клон**: открыть папку в VS Code → «Reopen in Container».
   На Windows держите клон в WSL2-fs (bind родного NTFS медленный).
3. **JetBrains (WebStorm/PyCharm) / без VS Code** — через devcontainers CLI
   (JetBrains Gateway умеет devcontainer.json тоже):
   ```sh
   pnpm dlx @devcontainers/cli up --workspace-folder .
   pnpm dlx @devcontainers/cli exec --workspace-folder . bash
   ```
4. **Голый docker (CLI)**:
   ```sh
   docker run -it --rm -v "$PWD:/workspaces/repo" -w /workspaces/repo \
     ghcr.io/omnifield/devbox:latest bash
   ```

Пост-шаги внутри контейнера (один раз): `gh auth login`, `claude` → `/login`,
PAT для @omnifield-пакетов (workstation/README §Пост-шаги п.3 — тот же `.npmrc`,
только в home контейнера/volume).

## Обновление образа

`gh workflow run release-devbox.yml -f tag=vYYYY.MM.DD` → тег + `latest`. Репо пинят
датированный тег в devcontainer.json — обновление приезжает PR'ом (dependabot
умеет devcontainers), не молча. ⚠️ Пин в skeleton-шаблоне обновляется ТОЛЬКО на
фактически изданный тег — проверка: `docker manifest inspect ghcr.io/omnifield/devbox:<тег>`
(грабля Д1: локальная дата ≠ UTC-дата раннера). Хост-путь (workstation/bootstrap)
продолжает работать — докер-путь опция, не принуждение.

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

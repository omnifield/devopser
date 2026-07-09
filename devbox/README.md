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
3. **Без VS Code (CLI)**:
   ```sh
   docker run -it --rm -v "$PWD:/workspaces/repo" -w /workspaces/repo \
     ghcr.io/omnifield/devbox:latest bash
   ```

Пост-шаги внутри контейнера (один раз): `gh auth login`, `claude` → `/login`,
PAT для @omnifield-пакетов (workstation/README §Пост-шаги п.3 — тот же `.npmrc`,
только в home контейнера/volume).

## Обновление образа

`gh workflow run release-devbox.yml` → теги `vYYYY.MM.DD` + `latest`. Репо пинят
датированный тег в devcontainer.json — обновление приезжает PR'ом (dependabot
умеет devcontainers), не молча. Хост-путь (workstation/bootstrap) продолжает
работать — докер-путь опция, не принуждение.

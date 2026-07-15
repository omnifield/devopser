# devbox — базовый dev-образ экосистемы (`ghcr.io/omnifield/devbox`)

**Containers-only канон** (`briefs/containers-only-and-management.md`): на машине —
только Docker и файлы; тулчейн (node LTS · pnpm ≥10 · uv · go · gh · Claude Code),
git-операции и сессии живут в этом контейнере. Образ — только **оболочка**:
версии-исполнители остаются пинам репо (`packageManager`, `.python-version`,
`go.mod`) — обновление образа не меняет тулчейн репо.

## Использование (потребитель)

`.devcontainer/devcontainer.json` приезжает init-шаблоном skeleton (пин датированного
тега + машинные named volumes: pnpm-store и секрет-volume, §Роль-сессии). **Дефолт —
bind-mount рабочей папки** (файлы на
машине; Windows — клон в WSL2 FS, bind родного NTFS медленный). Пути входа:

0. **Headless-провижинер (канон, рекомендация)** — `scripts/devbox.sh up` поднимает devbox
   репо из его `.devcontainer/devcontainer.json` по канону ОДНОЙ командой (без ручных
   `docker run`): единственный bind своего репо, сеть `omnifield-gateway` alias=имя,
   ноль host-портов, `--restart unless-stopped`. `down` удаляет контейнер (volumes/данные
   переживают), `recreate` = `down`+`up`. На хосте нужен только `docker`; манифест парсит
   node внутри образа (`scripts/devbox-manifest.mjs`). См. `briefs/devbox-provision-lifecycle.md`.
   ```sh
   scripts/devbox.sh up        # создать+запустить (идемпотентно)
   scripts/devbox.sh recreate  # пересоздать, данные сохранить
   scripts/devbox.sh down      # удалить контейнер (volumes целы)
   ```
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

## Пост-шаги — занос кредов (один раз, ВНУТРИ контейнера)

Креды живут в машинном volume `omnifield-secrets` (§Роль-сессии и секрет-volume);
тулзы наведены на него штатными env шаблона — целевые пути НЕ изобретать руками, они
заданы `CLAUDE_CONFIG_DIR` / `NPM_CONFIG_USERCONFIG` / `GIT_CONFIG_GLOBAL` /
`GH_CONFIG_DIR`. Занос — файлом / штатной командой тулзы; интерактивный `/login`
не канон (D4: не-продуктовый флоу).

1. **Claude**: сначала `mkdir -p "$CLAUDE_CONFIG_DIR"` (volume монтируется пустым,
   подкаталог сам не появится — `docker cp` в несуществующий путь падает), затем
   положить `$CLAUDE_CONFIG_DIR/.credentials.json` (ровно то, что произвёл
   бы `/login`; проверенный путь — `docker cp` из донора) + `.claude.json` c
   `"hasTrustDialogAccepted": true` **и `"hasCompletedOnboarding": true`** в тот
   же каталог. Без `hasCompletedOnboarding` интерактивный `claude` гонит экран
   регистрации даже при валидных кредах (`-p`/SDK — не гонят; отсюда «пульт работал,
   а живой claude просил логин»). `postCreateCommand` шаблона сам сеет этот файл, если
   его нет — ручной занос нужен только для `.credentials.json`. После `docker cp` файлы
   root-owned — завершить `sudo chown -R vscode:vscode "$CLAUDE_CONFIG_DIR"`
   (К3). Никакого `/login`.
   > ⚠️ **Claude — ТОЛЬКО в Docker, на хосте не логиниться.** Токен протухает
   > (`expiresAt=0`) от **host↔volume расхождения**: если тот же аккаунт живёт и в
   > `~/.claude` хоста, и в volume — OAuth-refresh ротирует токен в одной копии,
   > вторая протухает. Один стор (volume) = проблемы нет. **Re-seed при протухании** —
   > повторить занос `.credentials.json` тем же `docker cp` (штатная операция, не баг).
2. **npm PAT** (@omnifield-пакеты; нужен даже для публичных — специфика GH Packages):
   записать в файл `$NPM_CONFIG_USERCONFIG` пару строк (образец — workstation/README
   §Пост-шаги п.3):
   ```
   @omnifield:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=<PAT c read:packages>
   ```
3. **gh + git**: `echo <PAT> | gh auth login --with-token` → `gh auth setup-git`;
   `git config --global user.name/user.email`. Конфиги лягут в секрет-каталог сами —
   env наведены (`GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`).

Занесённые креды переживают пересоздание контейнера — volume машинный, не home
(контрольный тест: пересоздать контейнер → сессия живёт без повторного заноса).

## Роль-сессии и секрет-volume

- **Вход в роль — env `OMNIFIELD_SCOPE`**, не `.ps1`. pwsh в образ не тащим (Д9):
  `claude-scope.ps1` остаётся хост-историей. Scope задаётся при запуске сессии —
  `OMNIFIELD_SCOPE=<scope>` (`containerEnv` / `docker exec -e`); identity-механика
  (scope-identity / marker / git-gate, `.mjs`-хуки из bind-mount рабочей копии)
  заводится от него, node образа их исполняет.
- **Секрет-volume** `omnifield-secrets` → `/home/vscode/.secrets` — ОДИН машинный
  volume на все репо (не пер-репо; занос кредов один раз, §Пост-шаги). Тулзы наведены
  на него env шаблона, home остаётся cattle. ⚠️ Граница доверия: volume читаем любым
  процессом с docker-доступом на машине — для single-user тачки принято; multi-user /
  сервер — отдельная проработка, не сейчас.
- **Порты продуктов наружу НЕ публикуются** (`gateway-network-single-origin.md`):
  single-origin — наружу машины только `:8080` (gateway). Сервисы (backend/frontend)
  живут на внутренних портах контейнера, gateway достаёт их **по docker-сети
  `omnifield-gateway`** по alias'у devbox'а (= имя репо) — шаблон вешает
  `--network=omnifield-gateway --network-alias=<repo>` (`runArgs`) + `initializeCommand`
  создаёт сеть. Никаких `appPort`/`-p` на продукт-порты — занятость порта у юзера
  системе безразлична (в namespace контейнера), единственный хост-порт — `:8080`.

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
- **uv и системный CPython** (Д8): uv берёт системный интерпретатор образа, ПОКА тот
  удовлетворяет `.python-version`; иначе качает нужный CPython. Поведение pin-driven —
  не «всегда системный» и не «всегда качает». `only-managed` намеренно НЕ включаем:
  uv-python кэш в cattle-home = перекачка на каждом пересоздании контейнера.
- **Windows: рабочая копия — клон в WSL2 FS** (канон), не bind родного NTFS. Переезд
  со СТАРОГО виндового клона: переклонируй в WSL2 FS — снимает платформенный конфликт
  классом (Д6). ☠ `node_modules` такого NTFS-bind клона из контейнера НЕ трогать —
  ни `rm -rf`, ни reinstall, который pnpm сам предложит при platform-mismatch:
  виндовые junction'ы pnpm видны из контейнера как обычные каталоги, удаление проходит
  СКВОЗЬ линк и выедает исходники workspace-пакетов (Д7; инцидент — 52 файла
  `packages/frontend`). Volume-overlay на `node_modules` —
  временная миграционная мера для застрявшего клона, в skeleton-шаблон НЕ идёт (П3).
- **pnpm store на bind-mount (путь 2а)** падает в `<workspace>/.pnpm-store`, а не в
  volume — pnpm держит store на одном device с проектом (Д4); `.pnpm-store/` уже
  в gitignore-блоке скелета. Общий store-volume работает на пути clone-in-volume.
- **Доступ к хост-сервисам из контейнера** — `host.docker.internal:<port>` (шаблон
  добавляет `--add-host=…:host-gateway` для linux-parity); `localhost` внутри
  контейнера = сам контейнер (П-докер-1).

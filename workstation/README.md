# workstation — provisioning dev-машины (containers-only)

Capability `workstation`: **provision / verify** машины одной идемпотентной командой.
Канон (user, P0, 2026-07-10 — `briefs/containers-only-and-management.md`):
**на тачке — только Docker и файлы**. Ни git, ни node/pnpm/uv, ни Claude Code на
хосте: всё исполняется в контейнере `ghcr.io/omnifield/devbox` (см. `devbox/README.md`),
файлы живут на машине через bind-mount.

История: v1 bootstrap ставил 6 хост-тулзов (инцидент 2026-07-08); containers-only
отменил хост-путь — история в git.

## Quickstart — новая тачка

```powershell
cd workstation
.\bootstrap.ps1            # Docker Desktop + WSL-дистрибутив Ubuntu + WSL-интеграция Desktop
.\bootstrap.ps1 -Verify    # read-only preflight, exit 0 когда всё зелёное
```

На совсем чистой машине прогон может быть двухпроходным (идемпотентно, просто
перезапусти bootstrap после каждого шага): `wsl --install` при первом включении
WSL-фич может попросить **reboot**; Docker Desktop надо **один раз запустить руками**
(лицензия + появление `settings-store.json`) — до этого шаг интеграции скипается
с подсказкой.

Не-Windows / без Desktop / серверы — [docker.md](docker.md). Дальше — клон и работа
**изнутри контейнера** по [repos.md](repos.md).

## Что делает bootstrap (Windows-провайдер)

Три идемпотентных шага — что уже сделано, скипается:

1. **Docker Desktop** (winget `Docker.DockerDesktop`).
2. **WSL-дистрибутив `Ubuntu`** — канон «клоны в WSL2 FS» требует полноценного
   дистрибутива, служебный `docker-desktop` им не является (К1 фидбека пересадки
   brainer). `wsl --install -d Ubuntu --no-launch` + non-interactive init:
   - user `ubuntu` с **uid 1000** — совпадает с `vscode` образа devbox, это
     контракт ownership'а bind-mount'а (файлы, созданные в контейнере, принадлежат
     тебе в дистрибутиве и наоборот); имя не важно, важен uid;
   - sudoers NOPASSWD (`/etc/sudoers.d/90-omnifield-nopasswd`);
   - `[user] default=<user>` в `/etc/wsl.conf` (применяется после terminate —
     bootstrap делает сам).
3. **WSL-интеграция Docker Desktop** для дистрибутива: в
   `%APPDATA%\Docker\settings-store.json` — `IntegratedWslDistros += "Ubuntu"`,
   `EnableIntegrationWithDefaultWslDistro: true`. Desktop перезапускается
   **только если значения реально менялись** (ничего не менялось — работающие
   контейнеры не трогаются).

`-Verify` (read-only, ничего не ставит и не меняет): docker найден + engine
отвечает · дистрибутив `Ubuntu` зарегистрирован · дефолтный user дистрибутива
uid=1000 · `wsl -d Ubuntu docker version` отвечает (интеграция жива). Exit 1
при любом гэпе — можно дёргать как preflight из сессий/CI.

## Что на хосте, что в контейнере

| Где | Что |
|---|---|
| Хост | Docker · рабочие папки (Windows: клоны в WSL2 FS дистрибутива `Ubuntu` из bootstrap — bind родного NTFS медленный) · IDE как окно в контейнер |
| Контейнер (devbox) | git-операции · тулчейн (node/pnpm/uv/go/gh) · Claude-сессии · сервисы/стеки |

Пины репо (`packageManager`, `.python-version`, `go.mod`) исполняются внутри
контейнера теми же механизмами, что и раньше — образ лишь оболочка
(`devbox/README.md` §Известное поведение).

## Пост-шаги (один раз, ВНУТРИ контейнера — секреты/логины)

Персистентность кредов между рестартами контейнера — предмет blueprint'а D4
(containers-only бриф); до него — санity-путь: home-каталог контейнера живёт,
пока жив контейнер (`devcontainer up` переиспользует его), при пересоздании —
повторить пост-шаги.

1. **git identity + auth**: `git config --global user.name/user.email`;
   push-креды — `gh auth login` (браузерная ссылка открывается на хосте).
2. **claude login**: `claude` → `/login`.
3. **GitHub Packages PAT** (@omnifield-пакеты; нужен даже для публичных —
   специфика npm-реестра GH Packages). В `~/.npmrc` контейнера ровно эта пара:
   ```
   @omnifield:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=<PAT c read:packages>
   ```
   ⚠️ Токен только в home контейнера, в репо не коммитить. Если в `~/.npmrc` уже
   есть чужие реестры — нужна именно ЭТА пара строк (Д5 фидбека devbox).
   Живость токена: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token <PAT>" https://api.github.com/user`
   (`200` — жив, `401` — дохлый).

## Troubleshooting

- **Нет winget** (LTSC / Server): «App Installer» из Microsoft Store, либо
  msixbundle с github.com/microsoft/winget-cli/releases, либо Docker руками
  ([docker.md](docker.md)).
- **docker поставился, но ENGINE-DOWN**: запустить Docker Desktop GUI один раз
  (лицензия, WSL2-инициализация), затем `.\bootstrap.ps1 -Verify`.
- **`wsl --install` просит перезагрузку / дистрибутив не появился**: WSL-фичи
  Windows только что включились — reboot, затем повторный `.\bootstrap.ps1`
  (идемпотентен, докатит оставшееся).
- ☠ **Desktop падает на старте: «formatting settings-store.json: invalid character 'ï'»** —
  в `settings-store.json` попал UTF-8 **BOM**. PS 5.1 `Set-Content`/`Out-File
  -Encoding utf8` пишут BOM — этот файл руками так править нельзя. Bootstrap пишет
  его только BOM-less (`[IO.File]::WriteAllText(..., [Text.UTF8Encoding]::new($false))`);
  если файл уже убит — перепиши его тем же способом без BOM (или удали: Desktop
  пересоздаст дефолтный, настройки слетят) и запусти Desktop заново.
- **Интеграция включена, но из дистрибутива docker не отвечает** («permission denied»
  на сокете, окно Desktop «running wsl distro proxy ... exit status 1») — гонка
  провижининга интеграции: `/mnt/wsl/docker-desktop/docker-desktop-user-distro`
  остался 0-байтным. Лечение: полный `wsl --shutdown`, запустить Desktop заново
  (bootstrap так и делает при рестарте). Проверка: `.\bootstrap.ps1 -Verify`
  (чек `wsl-docker`).
- **Медленный `pnpm install` в контейнере на Windows**: клон лежит на NTFS —
  перенести в WSL2 FS (`\\wsl$\...`) или путь clone-in-volume (`devbox/README.md`).

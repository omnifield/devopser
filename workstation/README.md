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
.\bootstrap.ps1            # ставит Docker Desktop (единственный хост-инструмент)
.\bootstrap.ps1 -Verify    # docker найден + engine отвечает, exit 0
```

Не-Windows / без Desktop / серверы — [docker.md](docker.md). Дальше — клон и работа
**изнутри контейнера** по [repos.md](repos.md).

## Что на хосте, что в контейнере

| Где | Что |
|---|---|
| Хост | Docker · рабочие папки (Windows: клоны в WSL2 FS — bind родного NTFS медленный) · IDE как окно в контейнер |
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
- **Медленный `pnpm install` в контейнере на Windows**: клон лежит на NTFS —
  перенести в WSL2 FS (`\\wsl$\...`) или путь clone-in-volume (`devbox/README.md`).

# Feedback — пересадка brainer на контейнер-сессии (DoD ✅)

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | brainer-архитектор, 2026-07-10 |
| **Re** | `container-sessions-brainer.md` (skeleton 0.2.2) |
| **Статус** | **DoD ДОСТИГНУТ**: обе роль-сессии end-to-end из контейнера (включая push), креды пережили пересоздание, хост-тулчейн не ставился |

## Итог прогона

- **architect (OMNIFIELD_SCOPE=main)**: headless-сессия в контейнере — identity-баннер,
  marker, commit+push в origin/main (`267e41c`, `58e20f3`); pre-commit/pre-push зелёные.
- **owner (OMNIFIELD_SCOPE=kernel)**: git-gate режет `git push` (deny с эскалацией,
  обхода не было), commit проходит; marker owner-сессию не получает.
- **Персистентность**: `docker rm` + новый `run` → claude / gh / npm / git работают
  без повторного заноса. Секрет-дизайн 0.2.2 подтверждён по всем трём проверкам оракула:
  (а) `.claude.json` И весь стейт claude уезжает в `CLAUDE_CONFIG_DIR`, home cattle;
  (б) pnpm/npm подхватывают `NPM_CONFIG_USERCONFIG` (whoami, install @omnifield);
  (в) `gh auth setup-git` пишет в `GIT_CONFIG_GLOBAL`, hosts — в `GH_CONFIG_DIR`.
- Вход в роль через env (Д9) работает: `docker exec -e OMNIFIELD_SCOPE=<scope>`;
  sh-обёртка у нас — `brainer/scripts/devbox-session.sh` (зеркало devcontainer.json
  для CLI-пути).
- Клон изнутри контейнера (README путь 1) работает; uid 1000 (vscode) = первый
  WSL-user → ownership bind-mount чистый.
- Хост-сессии brainer помечены легаси (CLAUDE.md), `claude-scope.ps1` — хост-история.

## Находки (нумерация К*, продолжение Д1–Д9)

### К1 — workstation-гэп: канон «клон в WSL2 FS» не обеспечен bootstrap'ом ⚠️

На машине НЕ БЫЛО полноценного WSL-дистрибутива (только служебный `docker-desktop`) —
шаг 2 чек-листа не исполним из коробки. `workstation/bootstrap.ps1` ставит Docker,
но не дистрибутив. Руками сделано (кандидат в bootstrap):
1. `wsl --install -d Ubuntu --no-launch`; non-interactive init: `useradd -m` (uid 1000 —
   совпадает с vscode образа, это важно для ownership), sudoers NOPASSWD,
   `[user] default=` в `/etc/wsl.conf`.
2. Docker Desktop WSL-интеграция для дистрибутива: `settings-store.json`
   (`IntegratedWslDistros: ["Ubuntu"]`, `EnableIntegrationWithDefaultWslDistro: true`)
   + рестарт Desktop.

Две грабли по пути:
- ☠ **BOM убивает Docker Desktop**: `settings-store.json`, записанный PowerShell 5.1
  `Set-Content -Encoding utf8` (пишет UTF-8 С BOM), валит Desktop на старте —
  «formatting settings-store.json: invalid character 'ï'». Писать только BOM-less
  (`[IO.File]::WriteAllText` + `UTF8Encoding($false)`).
- Гонка провижининга интеграции: `/mnt/wsl/docker-desktop/docker-desktop-user-distro`
  остаётся 0-байтным → proxy падает `Permission denied` / окно «running wsl distro
  proxy… exit status 1». Лечение: полный `wsl --shutdown` + старт Desktop заново.

### К2 — `pnpm dlx @omnifield/skeleton` без версии исполнил **0.1.2** ☠

Команда из чек-листа (п.1, без пина) на чистом контейнере притянула 0.1.2 вместо 0.2.2:
GH Packages отдал pnpm stale dist-tag (при этом `npm view @omnifield/skeleton version`
показывает 0.2.2, и tarball 0.2.2 корректный — проверен распаковкой). Эффект злой и
тихий: старый синк ОТКАТЫВАЕТ фиксы эталона — `!.husky/*.local` (П1), `.pnpm-store/`
(Д4), space-форму `nx run-many` (грабля 0.1.4). Обошли пином:
`pnpm dlx @omnifield/skeleton@0.2.2` → «всё уже в актуале».

Рекомендации: (а) канон-команда синка — всегда с явной версией; (б) разобраться со
stale dist-tag на GH Packages (abbreviated vs full metadata); (в) кандидат — guard в
init.mjs: печатать свою версию и/или сверяться с минимальной ожидаемой.

### К3 — мелочи

- `docker cp` в контейнер кладёт файлы root-owned — после заноса кредов нужен
  `chown -R vscode`. В README §Пост-шаги упоминания нет (mkdir есть, chown нет).
- `CLAUDE_CONFIG_DIR` = ВЕСЬ стейт claude (projects/sessions/backups), не только
  креды → секрет-volume будет расти транскриптами. Функционально ок, но заметка
  для будущего «кабинета» ключей: data-слой volume — не только секреты.
- Прогон `pnpm dlx` дописывает `minimumReleaseAgeExclude` в pnpm-workspace.yaml
  СВОЕГО dlx-контекста (не репо) — шума в дереве нет, но при запуске синка из корня
  репо с pnpm ≥10.11 стоит перепроверить.

## Просьба

К1 — в бэклог workstation (provisioning дистрибутива + интеграция); К2 — решить
судьбу dist-tag и поправить команду синка в канон-доках. Файл не закоммичен —
у себя закоммитьте по своему флоу.

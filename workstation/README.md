# workstation — provisioning dev-машины

Capability `workstation`: **provision / verify** рабочей машины одной идемпотентной командой.
Provider MVP — `windows-winget`; `macos-brew` / `linux-apt` — позже, extension по тому же шву
(тот же реестр инструментов, другой инсталлятор). `update` (апгрейд версий) — тоже позже,
v1 закрывает provision+verify.

Происхождение: инцидент 2026-07-08 — новая тачка без uv/python, полчаса ручной установки.
POLICY: поставил что-то на машину руками → это gap этого bootstrap'а, фиксится здесь.

## Quickstart — новая тачка, 2 команды

Обычный PowerShell достаточен — winget сам поднимает UAC-промпты на machine-scope
инсталляторы (Git, node, Docker Desktop), жать «да» по мере появления:

```powershell
cd workstation
.\bootstrap.ps1            # ставит базовый слой (идемпотентно, повторный запуск = все skip)
.\bootstrap.ps1 -Verify    # контроль: полная зелёная таблица, exit 0
```

Дальше: пост-шаги ниже → клон репо по [repos.md](repos.md) → работаешь.

## Что ставит bootstrap (базовый слой, ровно 6)

Канон набора — commons `standards/workflow/toolchain-pins.md`.

| Tool | Как | Зачем |
|---|---|---|
| git | winget `Git.Git` | всё |
| node LTS | winget `OpenJS.NodeJS.LTS` | JS-репо |
| pnpm ≥10 | winget `pnpm.pnpm` | сам исполняет пин `packageManager` репо (см. ниже) |
| uv | winget `astral-sh.uv` | Python-репо (сам качает CPython) |
| Docker Desktop | winget `Docker.DockerDesktop` | стеки devopser |
| claude CLI | нативный installer `claude.ai/install.ps1` | сессии |

⚠️ **Corepack — НЕ опора** (deprecated, выпиливается из Node, требует ручного enable):
`corepack enable` не выполняется нигде — ни здесь, ни в CI, ни в доках. pnpm <10 в
verify-таблице = OUTDATED (не умеет сам исполнять `packageManager`) — bootstrap обновит.

**Выбор способа установки claude CLI — нативный installer** (не `npm i -g`): не зависит от
того, подхватился ли node в PATH текущей сессии посреди bootstrap'а, и самообновляется.
Уже стоящий npm-вариант bootstrap не трогает (детект по PATH, любой способ = OK).

## Что bootstrap НЕ ставит (самособирается из пинов)

Граница ответственности — базовый слой на машину, остальное декларируют репо продуктов
(полный набор пинов — commons `standards/workflow/toolchain-pins.md`):

- `.python-version` → `uv sync` сам качает нужный CPython. **Никакого системного Python/pip.**
- `packageManager` в package.json → **сам pnpm ≥10** переключается на запиненную версию
  (`manage-package-manager-versions`, дефолт из коробки). Bootstrap ставит «любой 10.x+»,
  конкретную версию дальше исполняет пин.
- deps → `pnpm install` / `uv sync` в репо.

Хочется добавить инструмент в bootstrap → сначала вопрос «а не пин ли это в репо продукта?».

## `-Verify` — preflight

Ничего не ставит: таблица tool → OK/MISSING + версия, exit 1 если чего-то нет.
Дёргать из CI/сессий перед работой.

## Пост-шаги (руками, один раз — секреты/логины вне скоупа bootstrap'а)

1. **git auth**: `git config --global user.name/user.email` + credential
   (первый push спросит через Git Credential Manager — идёт с Git.Git).
2. **claude login**: `claude` → `/login` (браузерный OAuth).
3. **GitHub Packages auth** (@omnifield-пакеты: пресеты/скелет devopser'а):
   PAT (classic) со scope `read:packages` → в user-level `~/.npmrc`:
   ```
   //npm.pkg.github.com/:_authToken=<PAT>
   ```
   Без этого `pnpm install` в репо с `@omnifield/*`-deps упадёт 401. Маппинг
   scope→registry уже вендорен в `.npmrc` каждого репо (skeleton-набор), токен —
   только user-level, в репо не коммитить.
4. **Docker Desktop first-run**: запустить один раз GUI — принять лицензию,
   дождаться WSL2-инициализации. До этого `docker compose` не работает.
5. Клон репо → [repos.md](repos.md).

## Troubleshooting

- **Нет winget** (LTSC / Server / старый Win10): поставить «App Installer» из Microsoft Store,
  либо msixbundle с github.com/microsoft/winget-cli/releases.
- **Инструмент поставился, но MISSING в финальной таблице**: PATH-изменение не дошло до
  сессии — новый терминал → `.\bootstrap.ps1 -Verify`.
- **pnpm OUTDATED (<10)**: старый pnpm (npm-глобальный / corepack-шим) первым в PATH —
  bootstrap ставит winget-standalone; если OUTDATED остался, снести старый
  (`npm rm -g pnpm`) и новый терминал.
- **Docker Desktop поставился, `docker` MISSING**: до первого запуска GUI бинарь может не
  попасть в PATH — см. пост-шаг 3, затем новый терминал.

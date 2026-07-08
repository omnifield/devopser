# workstation — provisioning dev-машины

Capability `workstation`: **provision / verify** рабочей машины одной идемпотентной командой.
Provider MVP — `windows-winget`; `macos-brew` / `linux-apt` — позже, extension по тому же шву
(тот же реестр инструментов, другой инсталлятор). `update` (апгрейд версий) — тоже позже,
v1 закрывает provision+verify.

Происхождение: инцидент 2026-07-08 — новая тачка без uv/python, полчаса ручной установки.
POLICY: поставил что-то на машину руками → это gap этого bootstrap'а, фиксится здесь.

## Quickstart — новая тачка, 2 команды

PowerShell **от администратора** (инсталляторы Git/Docker просят UAC, `corepack enable`
пишет в Program Files; из обычного шелла тоже отработает — corepack допишется warning'ом):

```powershell
cd workstation
.\bootstrap.ps1            # ставит базовый слой (идемпотентно, повторный запуск = все skip)
.\bootstrap.ps1 -Verify    # контроль: полная зелёная таблица, exit 0
```

Дальше: пост-шаги ниже → клон репо по [repos.md](repos.md) → работаешь.

## Что ставит bootstrap (базовый слой, ровно 5)

| Tool | Как | Зачем |
|---|---|---|
| git | winget `Git.Git` | всё |
| node LTS (+corepack) | winget `OpenJS.NodeJS.LTS` | JS-репо; corepack идёт в комплекте |
| uv | winget `astral-sh.uv` | Python-репо (сам качает CPython) |
| Docker Desktop | winget `Docker.DockerDesktop` | стеки devopser |
| claude CLI | нативный installer `claude.ai/install.ps1` | сессии |

**Выбор способа установки claude CLI — нативный installer** (не `npm i -g`): не зависит от
того, подхватился ли node в PATH текущей сессии посреди bootstrap'а, и самообновляется.
Уже стоящий npm-вариант bootstrap не трогает (детект по PATH, любой способ = OK).

## Что bootstrap НЕ ставит (самособирается из пинов)

Граница ответственности — базовый слой на машину, остальное декларируют репо продуктов:

- `.python-version` → `uv sync` сам качает нужный CPython. **Никакого системного Python/pip.**
- `packageManager` в package.json → corepack сам ставит нужный pnpm. **Никакого глобального pnpm.**
- deps → `pnpm install` / `uv sync` в репо.

Хочется добавить инструмент в bootstrap → сначала вопрос «а не пин ли это в репо продукта?».

## `-Verify` — preflight

Ничего не ставит: таблица tool → OK/MISSING + версия, exit 1 если чего-то нет.
Дёргать из CI/сессий перед работой.

## Пост-шаги (руками, один раз — секреты/логины вне скоупа bootstrap'а)

1. **git auth**: `git config --global user.name/user.email` + credential
   (первый push спросит через Git Credential Manager — идёт с Git.Git).
2. **claude login**: `claude` → `/login` (браузерный OAuth).
3. **Docker Desktop first-run**: запустить один раз GUI — принять лицензию,
   дождаться WSL2-инициализации. До этого `docker compose` не работает.
4. Клон репо → [repos.md](repos.md).

## Troubleshooting

- **Нет winget** (LTSC / Server / старый Win10): поставить «App Installer» из Microsoft Store,
  либо msixbundle с github.com/microsoft/winget-cli/releases.
- **`corepack enable` failed / EPERM**: node в Program Files — нужен elevated shell;
  выполнить `corepack enable` от администратора один раз.
- **Инструмент поставился, но MISSING в финальной таблице**: PATH-изменение не дошло до
  сессии — новый терминал → `.\bootstrap.ps1 -Verify`.
- **corepack MISSING при живом node**: node поставлен без corepack (нестандартная сборка) —
  `npm i -g corepack`.
- **Docker Desktop поставился, `docker` MISSING**: до первого запуска GUI бинарь может не
  попасть в PATH — см. пост-шаг 3, затем новый терминал.

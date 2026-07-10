# Brief — Workstation Bootstrap (машина = cattle, не pet)

| | |
|---|---|
| **Scope** | `workstation` (`workstation/`) — новая зона |
| **Owner** | owner-workstation (запускает user; refine — devopser-архитектор) |
| **Порядок** | Параллельно `infra-migration.md` (не зависят друг от друга) |
| **Канон** | `omnifield/commons/standards/` + `ARCHITECTURE.md` (stack-as-capability) |

## Цель

Новая dev-машина → **одна идемпотентная команда** → через несколько минут работаешь с любым
репо экосистемы. Убираем класс проблем «пересел на другую тачку — полчаса ручной установки
и настройки путей» (инцидент 2026-07-08: тачка без uv/python, архитектор brainer ставил
руками — это gap, который закрывает этот бриф).

## Ключевая идея — capability `workstation`

Тот же шов: capability = `provision / verify / update` рабочей машины; provider =
`windows-winget` (**MVP: только он**); `macos-brew` / `linux-apt` — позже, extension по шву.
Мы юзер №0 (реально пересаживаемся между тачками); внешним юзерам это же — «поставь
экосистему одной командой».

## Разделение ответственности (важно, не смешивать)

- **Bootstrap (эта зона)** ставит только **базовый слой** — 6 вещей на машину
  (канон: commons `standards/workflow/toolchain-pins.md`):
  git · node LTS · **pnpm ≥10** · uv · Docker Desktop · claude CLI.
- **Всё остальное самособирается из пинов в репо продуктов** (зона их скелетов, см.
  brainer `briefs/repo-skeleton.md` §пины): `.python-version` → uv сам качает CPython;
  `packageManager` → **сам pnpm ≥10** переключается на запиненную версию
  (`manage-package-manager-versions`, дефолт); deps → `pnpm install` / `uv sync`.
  **Никаких системных Python/pip в bootstrap'е.** ⚠️ **Corepack — НЕ опора** (deprecated,
  выпиливается из Node; требует ручного enable) — никаких `corepack enable`.

## Шаги

1. `workstation/bootstrap.ps1`:
   - winget-установки (проверить точные ID при реализации): `Git.Git`,
     `OpenJS.NodeJS.LTS`, `pnpm.pnpm` (≥10), `astral-sh.uv`, `Docker.DockerDesktop`.
   - claude CLI: нативный installer (`irm https://claude.ai/install.ps1 | iex`) либо
     `npm i -g @anthropic-ai/claude-code` — owner выбирает по факту, зафиксировать выбор в README.
   - **Идемпотентность**: уже стоит → skip с версией в отчёте, не переустанавливать.
   - `-Verify` режим: ничего не ставит, печатает таблицу tool → found/missing/version,
     exit 1 если чего-то нет (можно дёргать из CI/сессий как preflight).
2. `workstation/repos.md` — карта экосистемы для новой машины: какие репо клонить
   (`omnifield/{brainer,commons,devopser}` + оракул `capsuleTech`), куда (канон-раскладка
   `projects/new/...`), что поднять после клона (observability-стек, `pnpm install`/`uv sync`).
   Клонирование в MVP — руками по карте; автоматизация clone — следующая итерация (не пихать в v1).
3. `workstation/README.md` — зона-док: quickstart («новая тачка → 2 команды»), что ставит
   bootstrap, что самособирается из пинов, troubleshooting (winget нет на LTSC и т.п.).

## Вне скоупа

macOS/linux-провайдеры · secrets/креды (git-auth, claude login — руками, задокументировать
в README как шаги после bootstrap) · dotfiles/шелл-кастомизация · автоклон репо · WSL.

## Deliverable

`workstation/` с bootstrap.ps1 + repos.md + README. На чистой машине (или через `-Verify`
на текущей): один запуск → все 5 инструментов доступны → `uv sync` в brainer/backend
проходит **без единой ручной установки Python и без настройки путей**.

## Verify (DoD)

- `-Verify` на настроенной машине: полная зелёная таблица, exit 0.
- Повторный запуск bootstrap: все skip, ничего не ломает (идемпотентность).
- Реальный e2e (лучшее — та самая вторая тачка): bootstrap → clone по repos.md →
  `uv sync` + `pnpm install` в brainer проходят с нуля.
- README покрывает quickstart + пост-шаги (git-auth, claude login, Docker Desktop first-run).

## Заметки

- POLICY-правило (уже в CLAUDE.md): поставил что-то на машину руками → это gap bootstrap'а,
  фиксить здесь, не оставлять в истории терминала.
- Точные winget-ID и способ установки claude CLI — проверить по факту, не доверять брифу вслепую.
- Git: commit-only, `feat(workstation): ...`; push/merge — architect после ревью.

---

## Амендмент 2026-07-08 №2 (решение architect, из brainer `escalation-toolchain-pins.md`)

v1 bootstrap'а (реализован до амендмента) построен на corepack — **переделать**:

1. **Corepack убрать целиком**: `corepack enable` из bootstrap.ps1, corepack-строки из
   README (таблица «что ставит», troubleshooting-пункты про corepack/EPERM).
2. **pnpm ≥10 добавить в базовый слой** (winget `pnpm.pnpm` — ID проверен, отдаёт latest,
   сейчас 11.x — ок) + в `-Verify` таблицу. Пин версии дальше исполняет сам pnpm по
   `packageManager` репо — bootstrap ставит **«любой ≥10»**, не конкретную версию
   (формулировка уточнена по эскалации `workstation/escalation-bootstrap-gaps.md`, дыра 3).
3. README «Что bootstrap НЕ ставит»: формулировку «corepack сам ставит pnpm» → «сам pnpm ≥10
   переключается на запиненную версию»; сослаться на commons `workflow/toolchain-pins.md`.
4. Побочный плюс: без corepack пропадает главная причина требовать admin-shell
   (`corepack enable` писал в Program Files) — перепроверить, что остаётся от UAC-требований
   в Quickstart.

---

## 📦 Заказ К1 — WSL-дистрибутив в bootstrap (architect → owner-workstation, 2026-07-10)

Фидбек пересадки brainer (`feedback-container-sessions-brainer.md`, К1): канон
«Windows: клон в WSL2 FS» не обеспечен bootstrap'ом — на референс-тачке не было
полноценного дистрибутива (только служебный `docker-desktop`). Дополнить
`bootstrap.ps1` (идемпотентно, Windows-провайдер):

1. **Дистрибутив**: `wsl --install -d Ubuntu --no-launch` + non-interactive init:
   user с uid 1000 (= `vscode` образа devbox — критично для ownership bind-mount),
   sudoers NOPASSWD, `[user] default=` в `/etc/wsl.conf`.
2. **Docker Desktop WSL-интеграция**: `settings-store.json` →
   `IntegratedWslDistros: ["Ubuntu"]` + `EnableIntegrationWithDefaultWslDistro: true`,
   рестарт Desktop.

⚠️ Обе грабли пойманы brainer'ом, обходы проверены на живой машине:
- ☠ **BOM валит Desktop**: PS 5.1 `Set-Content -Encoding utf8` пишет UTF-8 С BOM →
  Desktop падает на старте («invalid character 'ï'»). settings-store.json писать
  ТОЛЬКО BOM-less: `[IO.File]::WriteAllText(..., [Text.UTF8Encoding]::new($false))`.
- **Гонка провижининга интеграции**: `/mnt/wsl/docker-desktop/docker-desktop-user-distro`
  0-байтный → proxy «Permission denied» / «exit status 1». Лечение: полный
  `wsl --shutdown` + повторный старт Desktop; в `-Verify` добавить проверку живости
  интеграции (docker доступен ИЗ дистрибутива).

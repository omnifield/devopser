# Brief-заказ — VS Code Dev Container в скелет (canon IDE)

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | architect-координатор миграции (решение user, 2026-07-12) |
| **Основание** | Пивот IDE: бросаем WebStorm (by design не читает d.ts.map / не ходит `глобал→typeof import→исходник`), canon IDE = **VS Code в dev-контейнере**. tsserver навигирует наши глобалы в исходник в 1 клик (доказано живым прогоном). |
| **Класс** | DX скелета devbox — IDE-путь. **Инвертированный флоу** (см. ниже). |

## Смена флоу (важно)

Раньше план был: weber-owner добавляет `customizations.vscode` в свой `.devcontainer/devcontainer.json` как POC → devopser печёт в скелет после зелёного. **Решение user 2026-07-12: инвертируем.** VS Code = **часть скелета**, печём в devopser **сразу**, weber (и все продукты) **подтягивают** из скелета. weber остаётся **тест-полигоном навигации** (см. weber-бриф `vscode-devcontainer-poc.md`), но не источником.

## Заказ

1. **`customizations.vscode` в devcontainer.json-шаблон скелета** (`packages/skeleton/**` / `devbox/`-шаблон — devopser-архитектор знает точное место). Минимальный канон-блок:
   ```jsonc
   "customizations": {
     "vscode": {
       "extensions": [
         "biomejs.biome"        // линт/формат = канон; TS-навигация встроена в VS Code
       ],
       "settings": {
         "editor.defaultFormatter": "biomejs.biome",
         "editor.formatOnSave": true,
         "typescript.enablePromptUseWorkspaceTsdk": true,  // workspace-TS (монорепо)
         "typescript.tsserver.log": "verbose"              // диагностика, если навигация промахнётся
       }
     }
   }
   ```
   Набор расширений/настроек — **расширяемый контракт** (у продуктов разные стеки: Python-сервисы захотят `ms-python.*`, Rust — `rust-lang.rust-analyzer`). Продумать: базовый набор в скелете + продукт-специфика (декларацией продукта, как dev-сервисы в брифе `devbox-first-run-dx.md` — тот же manifest-driven принцип).
2. **Правило-канон:** расширения VS Code — **только через `devcontainer.json`**, ad-hoc установка на хост запрещена (воспроизводимость окружения = containers-only). Зафиксировать в skeleton-доке.
3. **Идемпотентная пропечка** через `skeleton:sync` — существующие продукты получают блок при следующем sync без ручной правки.
4. **Док:** пост-шаги user'а (VS Code на хост + расширения WSL + Dev Containers → «Reopen in Container»). Уже расписаны в weber-брифе — перенести в skeleton-README как канон.

## Границы
- Только IDE-customizations в скелете. Не трогает код продуктов, кодген, dev-сервисы (отдельный бриф).
- Верификация навигации (Ctrl+Click глобал → исходник) — на weber (тест-полигон), не здесь.

## После зелёной навигации на weber
- **architect:** ADR «canon IDE = VS Code Dev Container»; ревёрт declaration-map кодгена в weber (WebStorm-костыли больше не нужны).

## Связь
- `devbox-first-run-dx.md` — тот же DX-слой (сервера/auth/launcher). VS Code + CLI-launcher = два пути входа в один devbox.
- weber `vscode-devcontainer-poc.md` — downstream-верификация.

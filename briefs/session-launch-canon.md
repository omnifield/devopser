# Бриф: канон запуска scoped-сессии `session <scope>` (containers-native, ретайр .ps1)

> **Трек:** Foundation — Шаг 3 (Запуск scoped-сессии)
> **Адресат:** архитектор / owner **devopser** (зона: `scripts/devbox-session.sh` + `.claude/hooks/` + корень; skeleton-managed)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ (ветка → PR → CI → ревью → мерж)

## North star
**Любая роль-сессия стартует ОДНОЙ containers-native командой, одинаково для любого продукта/скоупа**,
из конфига (scope/model/workdir/identity). Ноль host-`.ps1`, ноль ручных `docker exec … claude` вразнобой,
ноль хардкода имён/путей. Меха универсальна (скелет), скоупы — per-product (их `scope-resolve`).

## Зачем (факты сняты через Канал)
- `claude-scope.ps1` — **мёртвый host-Windows лаунчер** (containers-only его не гоняет). В нём заперта
  логика **model-pin**: non-main (owner) → `--model opus`, `main` → своя модель. Больше model-pin **нигде нет**.
- `scripts/devbox-session.sh [scope]` — уже containers-native session-entry (resolve контейнера → gateway-connect
  → `devbox-services up` → `exec docker exec -it -e OMNIFIELD_SCOPE -w /workspaces/<repo> claude`), но
  **model-pin НЕ применяет** и резолвит контейнер по имя-конвенции `${repo}-devbox`.
- `scope-resolve.mjs` отдаёт `{kind: main|zone, scope, relativePath, name}` — **model не отдаёт**.
- Пресета (`.omnifield/preset.yaml`) и машиночитаемого реестра нет (products.md — markdown-каталог).

## Скоуп (только репо devopser; devbox-session.sh — skeleton-managed)
1. **Model-pin containers-native.** Перенести логику из `.ps1` в session-механизм: owner-скоуп (kind=zone) →
   `--model opus`; `main` → своя модель (не навязываем). Источник — из `scope-resolve` (пусть отдаёт `model`
   по kind) ЛИБО тонкий пресет; применяет `devbox-session.sh` на строке запуска claude (если юзер не задал
   `--model` явно — не перетирать).
2. **Ретайр `claude-scope.ps1`** — удалить файл; его роли (валидация scope + баннер + model-pin) уже
   containers-native (scope-хуки на SessionStart + п.1). Снять упоминания `.ps1` из `CLAUDE.md` (там уже стоит
   «мёртвый реликт» — заменить на канон-путь `devbox-session.sh`).
3. **Discovery без хардкода.** Резолв devbox — по **канон-конвенции `${repo}-devbox`** (её же ставит Step-2
   провижинер `devbox up`), + fallback VS Code-label. Задокументировать, что имя-контейнера = контракт
   конвенции (реестр `registry/products.md` — каталог продуктов; НЕ хардкодить имена в скрипте).
4. **Документация пути.** Канон-вход одной командой: `devbox up <repo>` (провижн, Шаг 2) → затем
   `scripts/devbox-session.sh <scope>` (сессия). Зафиксировать в `devbox/README.md` (или рядом).

## Вне скоупа (явно)
- **Пульт `launch()` из хаба/brainer** (запуск product-сессии через Канал) — примитив brainer (MODEL 2.3),
  отдельный трек. Здесь — per-repo session-entry на хосте.
- Полноценный `.omnifield/preset.yaml` (git-права/полный пресет) — если для model-pin хватает kind из
  scope-resolve, пресет не тянем (минимум ручных настроек). Материализуется need-driven.
- Автостарт сервисов (Шаг 4, уже дергается), дверь (Шаг 5).

## DoD (зона devopser)
- [ ] `devbox-session.sh <scope>` применяет model-pin (owner→opus, main→своя; явный `--model` юзера не трогаем);
      логика НЕ в `.ps1`.
- [ ] `claude-scope.ps1` **удалён**; `CLAUDE.md` указывает на containers-native путь.
- [ ] devbox-discovery по канон-конвенции `${repo}-devbox` (+label), ноль хардкод-имён; задокументировано.
- [ ] Канон-путь запуска сессии задокументирован (`devbox up` → `devbox-session.sh <scope>`).
- [ ] **Живой прог:** `devbox-session.sh <scope>` в реальном devbox поднимает сессию — верный identity-баннер,
      OMNIFIELD_SCOPE, model-pin, workdir (оставить ревьюеру/архитектору — Канал).
- [ ] PR зелёный → ревью → мерж.

## Handoff (после мержа)
- **→ все консюмеры (skeleton sync):** `devbox-session.sh` — managed; после мержа пересинк, иначе drift-red
  ([[skeleton-etalon-drift-cascade]]).

## Проверка north star (перед мержем)
Если запуск требует host-`.ps1`/не-docker, хардкодит имена devbox, дублирует model-pin в двух местах, или
per-product-развилка в скрипте — **дефект, не мержим.** Одна команда, любой скоуп, из конфига.

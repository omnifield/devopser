# Brief-заказ — owner-skeleton: шаблон `devbox.services.json` → пустой (footgun из dogfood)

| | |
|---|---|
| **Адресат** | owner-skeleton (`packages/skeleton/`) |
| **От** | devopser-архитектор, 2026-07-12 |
| **Основание** | dogfood `init.mjs` по корню devopser: шаблон приехал с ЖИВЫМ примером brainer (backend :8010 + frontend :3500) на инфра-репо, где сервисов нет |
| **Зона** | только `packages/skeleton/` |

## Дефект
`files/devbox.services.json` = живой brainer-набор → **каждый** репо после init получает
чужие сервисы в декларации. Autostart (`devbox-services up`) свежего репо (weber/chater/devopser)
ломанётся в несуществующие `packages/backend`/`packages/frontend` (loud-fail — по дизайну, но шумно
и вводит в заблуждение). Шаблон обязан быть нейтральным no-op по умолчанию.

## Задача
1. **`files/devbox.services.json` → `[]`** (пустая декларация = чистый no-op autostart). Продукт
   дописывает свои сервисы сам (A1 «содержимое пишет продукт»).
2. **Пример-набор — в `packages/skeleton/README.md`** (JSON комментариев не держит): показать форму
   `{name, cwd, command, port, healthUrl?}` иллюстрацией в доке, а не активным содержимым файла.
   Подчеркнуть: `command` **без литерального `--`** (G2), published-сервис **bind 0.0.0.0** (G1),
   `name` = docker-alias / join-key манифеста (`liaison-inc1-manifest-boundary.md`).

## DoD
Свежий `init.mjs <repo>` кладёт `devbox.services.json = []`; `devbox-services up` на нём — тихий no-op;
форма сервиса задокументирована в README. `init.mjs --check` чист. Коммит в `packages/skeleton/`.

## Границы
- Только `packages/skeleton/`. Корневой `devbox.services.json` devopser я уже поставил `[]` вручную —
  твой шаблон-фикс закрывает класс для остальных репо.
- Механику `devbox-services.mjs`/launcher НЕ трогаем — она принята и в git.

## Связь
- `devbox-first-run-dx-design.md` A1 — форма декларации.
- `feedback-owner-skeleton-cross-zone.md` — твой отчёт по исполнению (этот фикс — хвост оттуда).

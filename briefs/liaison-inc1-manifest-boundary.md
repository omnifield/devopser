# Liaison — граница `omnifield.yaml` ↔ `devbox.services.json`: ✅ ПОДТВЕРЖДЕНО + 1 поправка

| | |
|---|---|
| **Адресат** | knowledger-архитектор |
| **От** | devopser-архитектор, 2026-07-12 |
| **Основание** | ваш `knowledger/briefs/inc1-product-manifest-design.md` §7 — открытый пункт для devopser-liaison (три подтверждения) |
| **Мой дизайн** | `briefs/devbox-first-run-dx-design.md` A1 (`devbox.services.json`) |

## Вердикт по §7 (а/б/в)

- **(а) `devbox.services.json` — правильный дом внутренних dev-сервисов** — ✅ ПОДТВЕРЖДАЮ. Это ровно A1 моего дизайна: `{name, cwd, command, port, healthUrl}`. Внутренние НЕ-шлюзовые сервисы (redis/воркер/watcher) живут тут же и в манифест не попадают — совпадает с вашим §3.
- **(б) matching по имени `reach.routes[].service` ↔ сервис devopser** — ✅ ПОДТВЕРЖДАЮ, с явной фиксацией join-key (ниже).
- **(в) `reach` не дублирует `devbox.services.json`** — ⚠️ **почти**: одно поле разделено легитимно — `port`. См. поправку.

## Поправка — `port` разделён легитимно, не «ноль пересечений»

`port` присутствует в ОБОИХ файлах и для шлюзо-видимого сервиса это **одно и то же число**
(brainer frontend :3500):

| файл | зачем нужен `port` | читатель |
|---|---|---|
| `devbox.services.json` | G1-probe (loopback-bind → loud-fail), `status`, health | обёртка `devbox-services` (lifecycle) |
| `omnifield.yaml` `reach.routes[].port` | upstream gateway + deep-link хаба | devopser gateway-gen (инк 2), brainer (инк 4) |

Ни одна сторона НЕ может вывести порт из другой без нарушения канона:
- обёртка не должна читать манифест (ваш §3: «`docker compose up` не читает манифест»);
- манифест обязан быть самодостаточен для gateway/хаба (в т.ч. не-JS chater без `devbox.services.json`).

→ Порт **легитимно указан дважды**. Правильное лечение — не «убрать дубль», а **сделать дрейф громким**:

**Поправка 1 — join-key (пиним контракт):**
`devbox.services.json[].name` **===** `omnifield.yaml reach.routes[].service`
(или `=== manifest.name`, когда route опускает `service`). Это единственный ключ связи манифеста
с lifecycle-декларацией. Ваш «имя обязано совпадать» — принимаю, фиксирую как нормативный join-key.
⚠️ Ваш пример brainer использует `service: brainer-web`/`brainer-svc` — значит
`devbox.services.json` brainer'а обязан назвать сервисы **теми же** именами (не `frontend`/`backend`).
Это ложится на продукт-owner'а brainer.

**Поправка 2 — port-consistency gate (devopser-side, инк 2):**
devopser читает ОБА файла при агрегации → **ingest-gate сверяет** `reach.routes[].port` c `port`
сервиса того же `name` в `devbox.services.json`; расхождение = **loud-fail** (та же философия, что
мой G1: молчаливый дрейф → красный гейт, не 502 в проде). Это на стороне devopser, вам делать нечего —
просто знайте, что дубль под охраной, а не под честным словом.

**Поправка 3 (доковая, к вам) — примеры на канонных портах.**
§6-примеры расходятся с `registry/ports.md`: weber `4200` (канон **5173**), brainer `3000/8000`
(канон **3500/8010**). Иллюстративно, но это ровно тот дрейф, от которого поправка 2. Прошу
привести примеры к `registry/ports.md`, чтобы манифест не сеял неканонные числа.

## Что подтверждаю без изменений

- §3 таблица границы, §4 матрица читателей, §8 (реестр = выведенный тонкий индекс скана
  манифестов, `registry/products.md` перестаёт быть рукописным) — принимаю целиком. Мой C10-сид
  уже помечен «интерим, поглощается манифестом».
- Разрез читателей: devopser читает `identity`+`reach`+`deps` (compose/gateway-gen, инк 2), НЕ
  трогает `scopes`/`spawnEligible`. Согласен — это моя будущая инкремент-2 работа, не этот бриф.
- `healthUrl` остаётся только в `devbox.services.json` (lifecycle), в манифест не идёт — согласен.

## Итог
§7 можно снимать из draft, DoD-чекбокс «согласовано с devopser без дублирования» — **закрыт** с
уточнением: дубль ровно один (`port`), он под join-key + consistency-gate. Свою A1-декларацию
обновляю зеркально (join-key + гейт).

## Связь
- `knowledger/briefs/inc1-product-manifest-design.md` §7 (входящий открытый пункт).
- `briefs/devbox-first-run-dx-design.md` A1 (моя dev-services декларация) — обновлена зеркально.
- `registry/products.md` — интерим-индекс, выводится сканом манифестов (§8).

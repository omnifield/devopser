# Registry — Products (source of truth)

Единый каталог продуктов экосистемы Omnifield: репо · скоупы · gateway-маршруты ·
dev-сервисы · spawn-eligibility. Runtime-источник для пульта (снимает хардкод
`brainer config.py: BRAINER_REPOS`, `devbox-first-run-dx.md` C10). Изменение
маршрута/порта = контракт (потребители зависят) — только через architect + правка здесь.

> Статус: **сид / ИНТЕРИМ** (заказ `briefs/devbox-first-run-dx-design.md` C10, 2026-07-12). Порты —
> зеркалят `registry/ports.md` (там первоисточник портов, здесь — продуктовый разрез).
> Кросс-продуктовый спавн из пульта = platform/North Star, отдельный трек — тут только каталог.
> ⚠️ **Тонкий индекс — поглощается тонким product-manifest** (knowledger инкремент 1,
> `knowledger/briefs/inc1-product-manifest.md`), когда тот материализуется. Граница: манифест =
> визитка (identity+reach для хаба); dev-сервисы (полная команда/health) = `devbox.services.json`
> ВНУТРИ продукта, здесь НЕ дублируются. Не строить поверх этого файла постоянных зависимостей.

## Каталог

| Продукт | Репо | Скоупы (session) | gateway-маршрут | dev-сервисы (`devbox.services.json`) | spawn |
|---|---|---|---|---|---|
| **devopser** | `omnifield/devopser` | `main` · `skeleton` · `registry` · `workstation` · `hub-core` | хаб `:8080` (владелец gateway) | — (инфра-репо, dev-серверов нет) | ✅ |
| **brainer** | `omnifield/brainer` | `main` · owner-зоны | `/brainer/` (front) · `/api/brainer/` (back) | frontend :3500 · backend :8010 | ✅ |
| **weber** | `omnifield/weber` | `main` · owner-зоны | `/sandbox/` (полигон фреймворка) | sandbox :5173 | ✅ |
| **chater** | `omnifield/chater` | `main` · owner-зоны | `/chater/` · `/api/chater/` (с runtime, Go) | backend :8020 | ✅ |
| **tasker** | `omnifield/tasker` | `main` · owner-зоны | `/tasker/` · `/api/tasker/` (Go fullstack) | backend :8030 | ⏳ |
| **knowledger** | `omnifield/knowledger` | `main` · owner-зоны | — (маршрут под заказ) | — (декларирует при появлении) | ⏳ |
| **writer** | `omnifield/writer` | `main` · owner-зоны | — (маршрут под заказ) | — (декларирует при появлении) | ⏳ |

- **spawn** — зарегистрирован ли для агент-спавна из пульта. ✅ = в наборе; ⏳ = продукт есть,
  спавн-контракт ещё не заведён (был `BRAINER_REPOS=brainer;weber;chater` — devopser/knowledger/
  writer НЕ входили; расширяется по мере готовности продукта).
- **dev-сервисы** — набор задаёт продукт декларацией `devbox.services.json` в своём репо
  (скелет оркестрирует, `devbox-first-run-dx-design.md` A1). Здесь — только указатель.

## Оракул (capsule) — легаси-эпоха

`omnifield/oracle` (capsule) — предыдущая инфра-эпоха (стеки капсулы, `registry/ports.md`
§«Занято оракулом»). В продуктовый спавн-каталог не входит; переключение на devopser-gateway —
по `gateway-hub-single-origin.md`.

## Канон

- **UI-вход = `/<name>/`, `/api/<name>/` — только API** (knowledger ADR-9). UI продукта
  наружу двери ВСЕГДА торчит на `/<name>/`; `/api/<name>/` несёт только backend JSON. UI
  никогда не таргетит `/api/`-маршрут — иначе форк «как продукт придумал» (дверь не может
  единообразно понять: кликабельный апп или backend). Enforcement — contract-manifest (Zod).
- Источник портов — `registry/ports.md` (первоисточник); здесь продуктовый разрез, порты
  зеркалятся. Расхождение = баг реестра, чинить в `ports.md` первым.
- Gateway достаёт продукт по **docker-alias = имя репо** (сеть `omnifield-gateway`) = join-key
  `reach.routes[].service` (`liaison-inc1-manifest-boundary.md`). Порты продуктов — внутренние
  (не хост); единственный хост-контракт = `:8080`, см. `registry/ports.md`.
- Добавление продукта / маршрута / spawn-eligibility = контракт → через architect, запись здесь.
- Пульт (brainer) читает этот файл как runtime-источник; механика чтения + кросс-продуктовый
  спавн = platform-слой (North Star), не devopser.

# Feedback / reconciliation — hub-core под изоляцией: discovery через publish-volume, НЕ exec-Канал

| | |
|---|---|
| **Отвечает на** | `briefs/hub-core-as-hub-under-isolation.md` (хаб-архитектор в `omnifield-hub`, 2026-07-13) |
| **От** | devopser-архитектор, 2026-07-13 |
| **Вердикт** | **проблема принята, механизм §1/§3 развёрнут** (base-defect). Заменяет §1/§3 входящего брифа. §2 (dep contract-manifest) и границы — берём как есть |
| **Решение развилки** | user, 2026-07-13: источник реестра = **publish-volume** (не committed-aggregate, не exec-Канал). Обоснование = канон размещения ниже |
| **Статус** | на исполнение owner-hub-core; §A — prereq skeleton; §C — handoff knowledger |

## Что во входящем брифе верно (берём без спора)
- Диагноз: fs-скан сиблингов (`generate.mjs:37` `readdirSync(WORKSPACE)`) держался на god-mount; изоляция его убила — `✖ нечего генерить` реален.
- §2 развязка `@omnifield/contract-manifest` (`file:../../knowledger/contracts/manifest` из хаба не резолвится) — bundle `dist/` в образ hub-core. Публикация пакета (если выбрана) = зона knowledger, §C.
- §3: gateway биндит конфиг с хостового чекаута devopser (по факту `./nginx.conf` относительно места запуска compose — то же coupling). Реально.
- Границы: провижининг флота, Portainer как Канал, продукты без манифеста — держат канон, не трогаем.

## Base-defect входящего §1 (почему разворачиваю)
Механизм «discovery через Канал = `docker exec/cp` манифеста из живых контейнеров» отклонён:

1. **Реестр становится функцией runtime-состояния — регрессия против resolver-дизайна.** `genNginx` ставит `resolver 127.0.0.11 valid=10s` (`generate.mjs:93`) именно чтобы gateway держал маршруты для **НЕподнятых** продуктов. Discovery только по `up`-контейнерам → `generate` при лёгшем weber-devbox **вычёркивает маршрут weber**. Таблица маршрутов начинает моргать вместе с контейнерами. Прямо ломает «gateway стартует без поднятых продуктов».
2. **Манифест — декларативный контракт, не скрейп из процесса.** `omnifield.yaml` = product-owned интерфейс (дизайн §2). `exec/cp` требует up + известный in-container путь + exec-права + смонтированный репо. Хрупко и семантически неверно.
3. **Дизайн-первоисточник сам против.** `hub-core-design.md §2` разделяет: статика → **из манифеста (скан)**, `liveStatus` → **из Канала**. Входящий бриф схлопывает *получение манифеста* в Канал — дрейф от собственного дизайна. Канал остаётся для глаголов ops (status/start/stop) и `liveStatus`, манифест по нему не течёт.

## Канон размещения (почему volume, не committed — чтобы не релитигировать)
`omnifield.yaml` — **НЕ общий файл**. Он product-owned, git-коммитится в **репо каждого продукта**
(тот же канон, что `<p>/briefs/` → репо продукта, память `[[container-model-and-hub]]`). Одного общего
`omnifield.yaml` не существует. Правило размещения у нас одно:

| Класс данных | Где | Пример |
|---|---|---|
| Authored, product-scoped | git в **репо продукта** | `<p>/omnifield.yaml`, `<p>/briefs/` |
| Authored, workspace-контракт | git (`omnifield-docs` volume с git внутри; инфра-контракты — devopser-репо) | блюпринты, `registry/ports.md` |
| Runtime / secret / **derived-aggregate** cross-product | **named volume** (кэш, пересобираемо) | `omnifield-secrets`, стор, **агрегат реестра** |

Хабу нужен не «общий omnifield.yaml», а **агрегат** манифестов = *производное* (source-of-truth = репо
продуктов). Агрегат под изоляцией материализуется в volume `omnifield-registry` как кэш. Коммитить агрегат
в `devopser/registry` = дубль product-owned данных во втором репо (нарушение single-source) — **отклонено**.
`registry/ports.md` остаётся контрактом-леджером (architect-gated), которому манифесты ДОЛЖНЫ conform'ить;
агрегат-реестр в volume — производное от conform'ных манифестов, не второй источник.

## Механизм (замена §1 + §3): publish-volume
Разделяем два потока чисто, как требует дизайн §2/§4:

**Вход (манифест, декларатив):** именованный volume `omnifield-registry`.
- Каждый продукт-devbox на старте кладёт свой `/workspaces/<repo>/omnifield.yaml` → `omnifield-registry/<name>.yaml` (`<name>` = имя репо = network-alias = `manifest.name`, ключ уже канонический — §1 п.4 входящего). **Это prereq skeleton — §A, не DoD hub-core.**
- hub-core монтирует `omnifield-registry` (ro) и **глобит `*.yaml`** вместо скана `/workspaces`. Валидация Zod'ом и loud-warn по невалидному/отсутствующему — сохранить как есть (`generate.mjs:48–57`, Р2/§2). Last-published-wins: лёгший продукт остаётся в реестре по последнему опубликованному манифесту — маршрут не моргает.

**Выход (дверь):** генератор пишет `nginx.conf` + лендинг в volume, который nginx монтирует (общий `omnifield-gateway-conf`, либо подкаталог `gateway/` того же `omnifield-registry` — на выбор owner'а). `запись через Канал` (docker cp в nginx) — тот же хрупкий exec-путь, **отклонено**.

**liveStatus (рантайм):** Канал (Portainer/docker-API) — индикатор running/stopped на карточке лендинга (дизайн §4). НЕ влияет на таблицу маршрутов. Опционально в этом инкременте — ядро тонкое, статус можно добавить вторым заходом.

## Дрейф-гейт под изоляцией (честно про §4 входящего)
CI-шага `generate --check` сейчас **нет** (проверено: пусто в `.github/`). Под volume-моделью его в devopser-CI и не сделать честно — входы (манифесты) живут в рантайм-volume, не в репо. Поэтому:
- **Committed `stacks/gateway/nginx.conf` + `hub/index.html` — ретайрятся** как артефакт (как `products.md` по Р2). Источник правды = генерация в volume при старте хаба. «Ноль рукописных строк» держится тем, что volume руками не правят.
- **Дрейф-гейт переезжает в рантайм:** `generate --check` в хаб-контейнере = идемпотентность (регенери → сравни с тем, что в door-volume; расхождение = кто-то правил руками/устаревший образ). Не CI-шаг репо, а assertion в хабе. Owner формулирует точную форму.

## DoD — расщеплён по адресатам

### owner-hub-core (эта зона, основной)
- `generate.mjs`: `buildRegistry` читает `*.yaml` из `omnifield-registry` (glob), не `readdirSync(WORKSPACE)`. Валидация/loud-warn/сортировка — без изменений.
- Генератор пишет `nginx.conf` + лендинг в door-volume; gateway-compose монтирует его же (замена bind-путей `./nginx.conf`/`./hub`).
- hub-core исполним в `omnifield-hub` (образ/entrypoint — на выбор): bundle `@omnifield/contract-manifest` `dist/` в образ (развязка `file:`-dep). Репо продуктов НЕ монтирует.
- `--check` = рантайм-идемпотентность в хабе. Committed nginx.conf/index.html удалить из `stacks/gateway/` (ретайр).
- **DoD-проверка:** из `omnifield-hub` одна команда регенерит маршруты+лендинг для всех продуктов с валидным манифестом в volume (brainer, weber); лёгший продукт остаётся по last-published; `curl -sI localhost:8080/brainer/` и `/weber` → живой маршрут; наружу торчит только `omnifield-gateway :8080`.

### §A — prereq skeleton (owner-skeleton, отдельная сессия)
- devcontainer-template (`packages/skeleton/files/devcontainer-template.json`) + devbox: смонтировать `omnifield-registry` (rw) и на старте (`postStartCommand`/entrypoint) копировать `omnifield.yaml` продукта в `omnifield-registry/<name>.yaml`. Это делает publish-volume реальным. **Без §A hub-core читает пустой volume.**

### §C — handoff knowledger (если выбрана публикация, опц.)
- Публикация `@omnifield/contract-manifest@0.1.0` в реестр = зона knowledger. Для DoD hub-core НЕ обязательна (bundle `dist/` в образ закрывает). Отдельный хендофф, если owner-hub-core выберет публикацию вместо бандла.

## Границы / не-цели (наследует входящий бриф)
- Провижининг флота, Portainer как Канал (Р1) — не сюда.
- Продукты без манифеста (chater/knowledger/writer/devopser) — просто не в реестре; их `omnifield.yaml` = действие каждого owner'а.
- Порты/маршруты = контракт `registry/ports.md` — не менять, только регенерить корректно.

## Апстрим
- Отправить хаб-архитектору (`omnifield-hub`) как reconciliation входящего брифа: §1 exec-Канал → publish-volume, обоснование = resolver-дизайн + разделение манифест/liveStatus его же дизайна §2/§4. Peer-разворот в моей зоне, не эскалация вверх.

## Связь
- `briefs/hub-core-design.md` — Р2/§2 (реестр на манифестах, loud-warn), §3 (дверь генерится, resolver/single-origin), §4 (Канал = liveStatus).
- `briefs/hub-core-as-hub-under-isolation.md` — входящий (этот бриф заменяет его §1/§3).
- `briefs/gateway-network-single-origin.md` — механизм single-origin (референс генератора).
- Память: `[[architect-catch-base-defects]]`, `[[single-origin-only-8080]]`, `[[container-model-and-hub]]`, `[[briefs-single-zone-dod]]`.

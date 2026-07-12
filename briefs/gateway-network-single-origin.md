# Brief — single-origin ДО КОНЦА: убрать per-service host-publish, апстримы по docker-сети

| | |
|---|---|
| **Адресат** | owner-skeleton (devbox-networking) + gateway-стек (nginx/compose) — запускает user |
| **От** | devopser-архитектор, 2026-07-12 |
| **Основание** | ловля user (вживую): порты продуктов сидят в манифесте/реестре как **хост-порты** → занят порт у юзера = сервис не встал. База single-origin нарушена: наружу торчит не только `:8080`. Я обязан был пресечь это в `devbox-first-run-dx-design.md` — не пресёк, исправляю |
| **Класс** | архитектурный контракт (gateway topology + devbox networking). Трогает ВСЕ продукт-devbox'ы — скелет-механизм |
| **Приоритет** | база. Снимает целый класс дефектов, не патч |
| **Статус** | gw-step1–3 (`stacks/gateway/compose.yml` + `nginx.conf` + README) + step4-doc (`devbox/README`) — ✅ ИСПОЛНЕНО architect'ом 2026-07-12, конфиг вычитан; **живой смоук pending docker** (в devbox docker нет — рецепт ниже §Проверка). step5 (`registry/*`) — handoff owner-registry |

## Дефект (корень)

`stacks/gateway/nginx.conf`: апстримы = `proxy_pass http://host.docker.internal:3500/5173/8010`.
`host.docker.internal` = **выход на хост и обратно** → сервис в devbox ОБЯЗАН быть хост-опубликован
(`-p 3500:3500`). Отсюда три беды разом:

1. **Нарушение single-origin.** Канон: наружу машины — ТОЛЬКО `:8080` (gateway). А по факту наружу
   висят 3500/5173/8010 — каждый продукт пробивает свою дыру в хост.
2. **Класс «занятый хост-порт».** У юзера что-то на 3500 → `-p 3500:3500` не встаёт → продукт мёртв.
   Порт продукта стал глобальным хост-ресурсом, которым он быть не должен.
3. **Топологический корень G1/502.** Вся A2-обвязка (`--host 0.0.0.0` + probe) существует, потому что
   published-порт не пробрасывается на loopback-bind. Убери `-p` — уйдёт и хрупкость публикации.

⚠️ **Манифест knowledger'а был прав всегда:** `reach.routes[].port` у него = «порт КОНТЕЙНЕРА».
Дефект НЕ в манифесте и НЕ в реестре — он в **моей gateway-разводке** (`host.docker.internal`).

## Целевая топология (single-origin до конца)

Gateway и продукт-devbox'ы — на **одной docker-сети**; gateway ходит к апстриму по **имени
контейнера + внутренний порт**, наружу публикуется ТОЛЬКО `:8080`.

```
docker network create omnifield-gateway         # внешняя, один раз на машину

# gateway/compose.yml
services:
  gateway:
    ports: ["8080:80"]                            # ← единственная хост-публикация во всей системе
    networks: [omnifield-gateway]
networks:
  omnifield-gateway:
    external: true

# продукт-devbox при запуске (devbox-session.sh / devcontainer runArgs):
docker run … --network omnifield-gateway --network-alias brainer …
#   БЕЗ -p 3500:3500 / -p 8010:8010 — порты остаются ВНУТРИ контейнера
```

```nginx
# nginx.conf — апстрим по имени, НЕ host.docker.internal
resolver 127.0.0.11 valid=10s;                    # ⚠ docker-DNS; без него см. gotcha ниже
set $up_brainer_web brainer:3500;
location /brainer/ { proxy_pass http://$up_brainer_web; … }
```

### ⚠️ nginx-resolver gotcha (обязательно, иначе регресс)
nginx резолвит имя апстрима **на старте** и кэширует. Если продукт-devbox не поднят в момент старта
gateway → nginx либо не стартует, либо кэширует NXDOMAIN и держит 502 даже после подъёма продукта.
Это **регресс** против `host.docker.internal` (тот резолвился всегда). Лечение — `resolver 127.0.0.11
valid=10s` + **имя через переменную** (`set $up …; proxy_pass http://$up;`): переменная заставляет
runtime-резолв на каждый запрос → gateway стартует при лежащем продукте и подхватывает его, когда тот
появится. Без этого связка «gateway поднимается первым» (canon `gateway-hub-single-origin.md`) ломается.

## Что уходит / что остаётся

| | До | После |
|---|---|---|
| хост-публикация продуктов | `-p 3500 / 5173 / 8010` | **нет** (только `:8080`) |
| upstream reach | `host.docker.internal:port` | `<alias>:port` (docker-DNS) |
| класс «занятый хост-порт» | реален для каждого продукта | **исчез** (кроме одного `:8080`) |
| bind `0.0.0.0` (G1) | нужен | **всё ещё нужен** — peer-контейнер не достучится до loopback; A2-probe остаётся, меняется формулировка причины (не «-p не пробрасывает», а «сосед по сети не видит 127.0.0.1») |
| глобальная уникальность портов (`registry/ports.md`) | обязательна (хост-ресурс) | **релаксируется** — порт уникален в рамках контейнера; 8080 — единственный хост-порт |

## Миграция (шаги)

1. `omnifield-gateway` — внешняя сеть (создание в gateway-README / bootstrap).
2. `gateway/compose.yml`: `networks: [omnifield-gateway] (external)`; убрать `extra_hosts` host.docker.internal (для апстримов больше не нужен).
3. `nginx.conf`: `host.docker.internal:*` → `<alias>:*` через `resolver` + переменную (gotcha выше).
   Алиасы = имена продуктов (`brainer`/`weber`/… = `manifest.name` / `reach.routes[].service` —
   тот же join-key, что в `liaison-inc1-manifest-boundary.md`).
4. Devbox-сеть — по путям создания контейнера (⚠️ правка owner-skeleton: launcher `docker run` на
   хосте невозможен — хост = только Docker+файлы, нечем парсить `devcontainer.json`):
   - **VS Code / raw-run** (создание): `--network omnifield-gateway --network-alias <product>` в
     `devcontainer.json runArgs` (owner-skeleton) + документированный raw-run; **снять все `-p`**;
     внешняя сеть до `--network` — `initializeCommand: docker network create … || true`.
   - **`devbox-session.sh`** (вход, НЕ создание): гарантирует сеть idempotent через
     `docker network connect --alias <repo> omnifield-gateway <ctr>` (без node) — exec-only.
   - **`devbox/README` backend-наружу-нюанс** (appPort/`-p`) переписать «наружу ничего, всё через
     gateway» — это **devopser-root / architect** (корень репо, НЕ owner-skeleton).
5. `registry/ports.md` (owner-registry, контракт): пометить, что порты продуктов — **внутренние**
   (не хост), глобальная уникальность больше не требуется; `:8080` — единственный хост-контракт.

## Границы
- Наружу машины — ТОЛЬКО `:8080`. Любой новый `-p` на продукт = нарушение, ловить ревью.
- Топология сети — скелет-механизм (devbox join + gateway compose); содержимое сервисов — продукт.
- Полноценная генерация compose продуктов из манифеста (devopser читает `reach`+`deps`) — **инкремент 2
  блюпринта**, не здесь. Здесь — минимальный корректный фикс reach БЕЗ ожидания генератора.
- Транзишен-связь: dev-сервера сейчас живут ВНУТРИ devbox (alias = devbox). Когда inc-2 вынесет их в
  свои compose-сервисы — alias переедет на сервис, nginx-строки не меняются (имя то же). Заложено.

## DoD
Юзер с занятым хостовым 3500/5173/8010 поднимает систему — **всё встаёт** (порты внутри контейнеров,
не на хосте); `docker ps` показывает единственную хост-публикацию `:8080`; gateway стартует, когда
продукт-devbox ЕЩЁ не поднят, и подхватывает его после подъёма (resolver-gotcha закрыта);
`/brainer/`·`/sandbox/`·`/api/brainer/` ходят через docker-сеть, не через хост. `registry/ports.md` +
`devbox/README` (backend-наружу-нюанс) + `gateway/README` в актуале.

## Проверка (там, где есть docker — в devbox сокет не проброшен)
Главное — доказать resolver-gotcha: gateway стартует БЕЗ поднятых продуктов.
```sh
docker network create omnifield-gateway            # пререквизит (idempotent)
cd stacks/gateway && docker compose up -d          # ДОЛЖЕН стартовать (продукты не подняты!)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/          # 200 — хаб
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/brainer/  # 502 — продукт не поднят, но gateway ЖИВ (не упал)
docker ps --format '{{.Names}}\t{{.Ports}}'        # единственная хост-публикация — omnifield-gateway …:8080
# затем поднять brainer-devbox (--network-alias=brainer, devbox-services up) →
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/brainer/  # 200 (подхватился без рестарта gateway)
```
Провал `docker compose up` = resolver-фикс не сработал (имя резолвится на старте — проверь `set`+переменную в `proxy_pass`).

## Связь
- `gateway-hub-single-origin.md` — предыдущий single-origin (хаб/8080); этот бриф доводит его ДО КОНЦА
  (тот оставил host.docker.internal-апстримы — незакрытая дыра).
- `devbox-first-run-dx-design.md` — A2/A4/A5 приведены в соответствие (G1-причина переформулирована,
  `-p` ретайрится); `port` = внутренний апстрим (зеркалит манифест).
- `liaison-inc1-manifest-boundary.md` — join-key `name`/`service` = docker-network-alias; согласовано.
- knowledger `inc1-product-manifest-design.md` — `reach.routes[].port` (контейнерный) подтверждён верным.

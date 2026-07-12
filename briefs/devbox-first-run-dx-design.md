# Brief — devbox first-run DX: дизайн (ответ на заказ `devbox-first-run-dx.md`)

| | |
|---|---|
| **Адресат** | owner-skeleton (механизм A + B6–B8), owner-registry (C10) — запускает user |
| **От** | devopser-архитектор, 2026-07-12 |
| **Основание** | заказ `briefs/devbox-first-run-dx.md` (инцидент 30 минут, 5 грабель). Решение user: запуск заскриптован+задокументирован, dev-сервера стартуют с контейнером + ручной toggle, вход агентом — одной командой |
| **Класс** | механизм + доки в **скелете** (devopser); продукты только **декларируют**. Наследуют все devbox'ы (brainer/weber/chater/…) |
| **Статус** | ✅ АППРУВ ревью (`feedback-devbox-first-run-dx.md`, 2026-07-12). Вшиты 2 правки: **B9 РАЗБЛОКИРОВАН** (корень — host↔volume расхождение, не гонка; claude только в Docker → OAuth-volume остаётся), **A4 — autostart на ОБА пути входа** (raw-run тоже). Весь дизайн едет |

---

## 0. Раскладка ответственности (что чинит какой слой)

| Грабля инцидента | Корень | Слой фикса |
|---|---|---|
| G1 — bind 127.0.0.1 → 502 | сервис публикует порт, но слушает loopback | **обёртка** (loud-fail probe, A2) |
| G2 — `pnpm run dev -- --host` | литеральный `--` глотает флаг | **декларация + линт команды** (A2) |
| Шаг 1 — сервера не встали | `Cmd=[sleep infinity]`, старт ad-hoc | **autostart** postStart (A2/A3) |
| Шаг 3 — нет launcher'а у devopser | только legacy `claude-scope.ps1` (хост-pwsh) | **skeleton-template `devbox-session.sh`** (B6) |
| weber потерял exec-бит | правка через `\\wsl.localhost` | **init chmod + pre-commit guard** (B7) |
| Шаг 5 — онбординг-экран | нет `.claude.json` с `hasCompletedOnboarding` | **postCreate idempotent seed** (B8) |
| Шаг 4 — access-токен обнулён гонкой | shared `.credentials.json` при парал. сессиях | **B9 — user-развилка, отложено** |
| Шаг 2 — пульт не спавнит | `BRAINER_REPOS` захардкожен в env | **`registry/products.md`** (C10) + platform (не здесь) |

---

## A. Dev-сервисы — жизненный цикл (owner-skeleton)

### A1. Форма декларации — `devbox.services.json` (корень репо)
Промежуточная форма с прицелом слиться в product-manifest North Star (рекомендация заказа —
**не блокироваться на манифесте**). Массив сервисов, минимум:

```jsonc
// devbox.services.json — декларирует ПРОДУКТ; скелет оркестрирует, не знает про vite/uvicorn.
[
  { "name": "backend",  "cwd": "packages/backend",  "command": "uv run uvicorn app.main:app --host 0.0.0.0 --port 8010", "port": 8010, "healthUrl": "http://localhost:8010/health" },
  { "name": "frontend", "cwd": "packages/frontend", "command": "pnpm run dev --host 0.0.0.0",                              "port": 3500 }
]
```

- Поля: `name` · `cwd` · `command` · `port` (обяз.); `healthUrl` (опц.).
- **`name` = JOIN-KEY с манифестом** (liaison knowledger, `liaison-inc1-manifest-boundary.md`):
  `devbox.services.json[].name` === `omnifield.yaml reach.routes[].service` (или `manifest.name`,
  когда route опускает `service`). Единственный ключ связи lifecycle-декларации с манифестом. ⚠️
  Продукт с несколькими шлюзо-видимыми сервисами (brainer: `brainer-web`/`brainer-svc`) обязан
  назвать сервисы `devbox.services.json` теми же именами.
- **`port` — единственное поле, разделённое с манифестом** (`reach.routes[].port`): для
  шлюзо-видимого сервиса — то же число. Разделено легитимно (обёртка не читает манифест; манифест
  самодостаточен для gateway). Дрейф ловит **port-consistency gate** на devopser-ingest (инк 2):
  `reach.port` ≠ `devbox.services.json.port` того же `name` → loud-fail (философия G1). `healthUrl`
  — только тут, в манифест НЕ идёт.
- **Раздаётся init'ом как TEMPLATE (init-only, НЕ drift-managed)** — набор сервисов = зона
  продукт-owner'а (brainer=frontend+backend, weber=sandbox, chater=backend). Скелет ставит
  пустой/пример-шаблон, содержимое пишет продукт. По аналогии с `devcontainer.json` в `TEMPLATES`.
- Валидатор при старте: `command` НЕ содержит литерального ` -- ` перед `--host`/`--port` →
  loud fail с диагностикой **G2** («убери `--`, pnpm прокинет флаги в vite напрямую»).

### A2. Обёртка-оркестратор — `devbox-services.mjs` (skeleton, zero-deps `node:*`)
Как `init.mjs` — один node-скрипт, без supervisord в образе (образ = тонкая оболочка, канон).
Скрипт сам менеджит дочерние процессы: pidfile + лог на сервис.

- `devbox-services up` — стартует все задекларированные, **детач** (`setsid`/`nohup`), сразу
  возвращает управление → интерактивный вход контейнера СОХРАНЁН.
- **G1 вшит системно**: после старта — probe `ss -ltn` по `port`. Слушает `127.0.0.1:port`
  (а не `0.0.0.0`/`*`) → **kill + loud fail**: «G1: сервис X слушает loopback, сосед по
  docker-сети (gateway) не достучится → 502. command обязан bind 0.0.0.0». Обёртка НЕ инжектит
  флаг в чужую команду (нельзя обобщить vite≠uvicorn), но превращает молчаливый 502 в громкий
  fail-at-startup — это и есть системное устранение G1. ⚠️ Причина переформулирована после
  `gateway-network-single-origin.md`: reach — по docker-сети (`<alias>:port`), НЕ host-publish;
  bind 0.0.0.0 всё равно обязателен (peer-контейнер не видит loopback), но `-p` уходит вместе с
  классом «занятый хост-порт».
- **strictPort сохранён**: занят порт → команда продукта падает громко, обёртка отражает это
  в `status` + логе (не глотаем).

### A3. Ручной toggle + foreground
`devbox-services <cmd> [service]`:

| Команда | Что |
|---|---|
| `up` / `start [svc]` | старт всех / одного (детач) |
| `stop [svc]` | стоп всех / одного (по pidfile) |
| `restart [svc]` | стоп+старт |
| `status [svc]` | таблица: сервис · pid · порт · bind · health |
| `run <svc>` | **foreground** один сервис (HMR-eyeball / живые логи), Ctrl-C = стоп |
| `logs [svc]` | tail лога |

### A4. Autostart без потери интерактива — НА ОБА ПУТИ ВХОДА
⚠️ Правка ревью: `postStartCommand` — lifecycle-хук **только devcontainer'а** (VS Code / `devcontainer
up`). Текущие devbox'ы поднимаются **сырым `docker run … sleep infinity`** — для них postStart НЕ
срабатывает, и ровно инцидент (рестарт Docker → сервисы легли) на raw-run-пути НЕ чинится. Autostart
обязан покрыть ОБА входа, каждый вызывает один и тот же idempotent `devbox-services up`:

| Путь входа | Механизм autostart |
|---|---|
| **devcontainer-managed** (VS Code) | `postStartCommand: devbox-services up` (каждый старт, не create) + `initializeCommand: docker network create omnifield-gateway \|\| true` (внешняя сеть должна существовать ДО `--network` на create; правка owner-skeleton, ✅ подтверждаю) |
| **raw `docker run` / рестарт Docker** | стартовая команда контейнера = `sh -c 'devbox-services up; exec sleep infinity'` + `--restart unless-stopped` → Docker-рестарт ре-запускает её, сервисы встают сами |
| **safety-net** (любой путь) | `devbox-session.sh` при входе дёргает `devbox-services up` (idempotent — no-op если уже подняты); страхует контейнеры, созданные старой командой |

- **Выбор механизма (feedback «на твой выбор»):** НЕ трогаем ENTRYPOINT образа — образ = тонкая
  оболочка (канон); autostart вшит в **стартовую команду контейнера** (её задаёт создатель:
  postStart / raw-run-команда), плюс idempotent-страховка в `devbox-session.sh`. Менеджер процессов =
  сам node-скрипт; supervisord/overmind не вводим.
- postStart/старт-команда детачат и возвращают → shell/агент-вход не блокируется.
- **DoD усилён:** «рестарт Docker → сервисы встают сами» держится для **raw-run** контейнеров,
  не только VS Code-открытых.

### A5. Логи — предсказуемое место
`~/.devbox/logs/<svc>.log` + `~/.devbox/run/<svc>.pid` (home = cattle, не workspace → не
gitignore'ится, не пачкает диф). `devbox-services logs <svc>` = tail. Конец «`/tmp/*.log` руками».

---

## B. Container-session first-run — вход агентом (owner-skeleton), КРОМЕ B9

### B6. Штатный launcher `scripts/devbox-session.sh` (skeleton **MANAGED**)
Единая короткая форма входа. **Разрешение конфликта с `container-sessions-brainer.md`**
(там решили: launcher = агент-харнесс → brainer, не скелет): расщепляем на два слоя —

- **тонкий session-entry, EXEC-ONLY (СКЕЛЕТ, чистая инфра):** ⚠️ launcher бежит на **хосте**, а
  хост по канону containers-only = только Docker и файлы (node/git может не быть) → **`docker run`
  из launcher'а невозможен** (нечем парсить `devcontainer.json`: image/env/mounts). Поэтому launcher
  НЕ создаёт контейнер, а только: резолвит уже поднятый devbox-контейнер репо → гарантирует
  gateway-сеть idempotent через `docker network connect --alias <repo> omnifield-gateway <ctr>`
  (без node) → `docker exec -it -e OMNIFIELD_SCOPE=<scope> -w /workspaces/<repo> <ctr> claude "$@"`.
  Identity-механику (`scope-identity`/`marker`/`git-gate`) заводит `OMNIFIELD_SCOPE`.
- **Создание контейнера — НЕ launcher:** VS Code (`.devcontainer/`) либо workstation-`oa`
  (мой follow-up). Create-time сеть — в `devcontainer.json runArgs` + документированный raw-run.
- **роль/модель-политика (репо-side):** выбор модели per-scope (owner→opus) — необязательный
  `.local`-override / агент-харнесс brainer, в скелет НЕ тащим.
- **MANAGED, не TEMPLATE** (правка owner-skeleton, ✅ подтверждаю): `devbox-session.sh` +
  `devbox-services.mjs` — чистый механизм → обязан пропагироваться во все продукт-devbox'ы
  drift-check'ом (как husky-хуки). Только `devbox.services.json` = TEMPLATE (содержимое = зона
  продукта, A1). Мой исходный «TEMPLATE на каждый репо» был неточен — owner-skeleton прав.

Форма (референс UX — стопгап `~/oa <repo> [scope]`, канонизируем):
```sh
scripts/devbox-session.sh [scope]     # из папки репо; scope по умолчанию — main
```
- **Ретайрим `claude-scope.ps1`**: хост-PowerShell против canon containers-only (Д9). devopser
  получает `scripts/devbox-session.sh` из своего же скелета (dogfood), `.ps1` → легаси-строка в
  README. Машинный мульти-репо диспетчер (`oa`, который exec'ит в devbox монтирующий все репо) —
  **workstation-зона, отдельный follow-up**, не этот бриф.

### B7. Exec-бит launcher'ов — системный фикс
Git хранит бит в index-mode (`100755`); правка через `\\wsl.localhost` его сбивает. Двойной гейт:
1. **`init.mjs` ставит `mode 0755`** при материализации `scripts/*.sh` (расширить `writeLf` для
   исполняемых шаблонов — новый под-набор `EXECUTABLE`).
2. **pre-commit guard** (в MANAGED `husky-pre-commit`): `git ls-files -s -- 'scripts/*.sh' '**/*.sh'`
   → любой tracked `.sh` с mode ≠ `100755` = **fail commit** с подсказкой `git update-index --chmod=+x`.
   Ловит регрессию до пуша, а не в permission-denied у следующего юзера.

### B8. Онбординг-seeding — `.claude.json` до первого интерактива
Корень Шага 5: `-p`/SDK онбординг не гонят, интерактивный `claude` — гонит (экран регистрации),
если в `CLAUDE_CONFIG_DIR` нет `.claude.json` с `hasCompletedOnboarding`.

- **`postCreateCommand` дописывает idempotent-seed** `$CLAUDE_CONFIG_DIR/.claude.json` ЕСЛИ
  ОТСУТСТВУЕТ: `{ "hasCompletedOnboarding": true, "hasTrustDialogAccepted": true, "theme": "dark" }`.
  Никаких секретов (это НЕ `.credentials.json`) → безопасно печь в postCreate. Существующий файл
  НЕ трогаем (merge-safe: только при отсутствии).
- **Правка `devbox/README` пост-шаги**: сейчас там seed `.claude.json` только с
  `hasTrustDialogAccepted` — добавить `hasCompletedOnboarding: true` в образец (это и был
  недостающий флаг инцидента).

### B9. Креды — ✅ РАЗБЛОКИРОВАН (правка ревью: диагноз уточнён)
Корень Шага 4 — **НЕ гонка параллельных сессий** (шаринг одного файла между сессиями работает,
юзер так живёт на хосте). Корень — **host↔volume расхождение**: `~/.claude` на хосте и копия в
volume = ДВЕ копии одного аккаунта; OAuth-refresh ротирует токен → копия, которая не рефрешится в
этом файле, протухает (`expiresAt=0`).

**Решение user: claude используется ТОЛЬКО в Docker, на хосте — нет** → стор один (volume),
расхождения нет, корень исчезает. Значит:
- **OAuth-в-volume остаётся как есть.** Никакого API-key-решения сейчас, billing-развилка снята.
- **Задокументировать штатную операцию** «первый занос + re-seed если протух» (`devbox/README`
  §Пост-шаги уже почти это — довести): единичный `docker cp` валидного `.credentials.json` в
  volume + `.claude.json` с `hasCompletedOnboarding` (это закрывает **B8**).
- **`ANTHROPIC_API_KEY` = опция на ПОТОМ** (если автономный флот упрётся в rate-limit подписки /
  нужна per-token видимость) — не сейчас.
- **Чистая будущая версия** — DevPod credential-forwarding (форвардит из одного клиент-источника,
  без копии в volume) — блюпринт платформы, инкремент 5. Не этот бриф.

**B9 больше не блокер** — весь дизайн едет на OAuth-volume + документированный seed.

---

## C. Registry / пульт (owner-registry + architect-контракт)

### C10. `BRAINER_REPOS` → `registry/products.md`
Создан **сид `registry/products.md`** (архитектором, как `ports.md`) — runtime-каталог продуктов:
репо · скоупы · gateway-маршруты · указатель на `devbox.services.json` · spawn-eligibility.
Снимает хардкод `config.py` (`TODO(architect): moving this map into devopser registry`).

- **Здесь — только вынести реестр в манифест** (devopser-часть контракта).
- **Кросс-продуктовый спавн из пульта = brainer + platform-слой** (North Star), отдельный
  трек/блюпринт — НЕ этот бриф. Пульт brainer'а позже читает `products.md` как источник.
- owner-registry: доработка/сопровождение каталога; изменение маршрутов/портов = контракт
  через architect (canon).

---

## Границы
- Механизм + доки — **скелет** (devopser). Продукты только **декларируют** сервисы
  (`devbox.services.json`) — содержимое (vite/uvicorn конфиги) = зона продукт-owner'ов.
- Single-origin: сервисы = gateway-internal upstreams **по docker-сети** (`<alias>:<port>`,
  `gateway-network-single-origin.md`), наружу ТОЛЬКО `:8080`. Обёртка ничего не хост-публикует —
  per-service `-p` ретайрен (был корнем «занятый хост-порт» + G1).
- Docker-socket в devbox НЕ пробрасываем (канон прошлого брифа) — launcher работает хост-side
  либо из devbox, монтирующего репо; не через socket.
- Образ остаётся тонким: supervisord/overmind НЕ добавляем — менеджер процессов = node-скрипт.

## Координация с платформой (правка ревью)
Дизайн ложится в **блюпринт платформы-воркспейса** (`knowledger/blueprints/workspace-platform-draft.md`,
принят user): dev-services / launcher / onboarding = **инкременты 2–3**. Параллельно knowledger
проектирует **тонкий product-manifest** (инкремент 1, `knowledger/briefs/inc1-product-manifest.md`).

⚠️ **Граница `devbox.services.json` ↔ манифест — согласовать с knowledger, НЕ дублировать:**
- **манифест = ТОНКАЯ визитка** (что хабу надо: identity + reach) — уровень платформы/knowledger;
- **dev-services (полная команда/health) = ВНУТРИ продукта** — мой `devbox.services.json` (A1),
  detail-слой, хаб в него не смотрит;
- **`registry/products.md` (C10) = тонкий индекс**, интерим — **поглощается манифест-контрактом**,
  когда инкремент 1 материализуется (не строю поверх него постоянных зависимостей).

✅ **Граница согласована** (liaison `liaison-inc1-manifest-boundary.md`, 2026-07-12): `omnifield.yaml`
= визитка (identity+reach), `devbox.services.json` = lifecycle-detail. Единственный разделённый
value — `port` (под join-key `name` + consistency-gate). knowledger §7 снят из draft. Форма A1
зафиксирована зеркально — owner-skeleton может стартовать.

## Открытые вопросы
- Форма декларации: `devbox.services.json` сейчас как detail-слой; слияние верхних полей в
  product-manifest — по инкременту 1 knowledger (см. координацию выше). Принято «не блокироваться
  на манифесте» — detail-слой в продукте останется в любом случае.
- Раздача `devbox-services.mjs`/`devbox-session.sh`: вендорить в репо (как `init.mjs`, есть
  локально) vs гонять `pnpm dlx @omnifield/skeleton` под-командой. *Рекомендация:* вендорить —
  автономность от сети, единый паттерн с init.

## DoD — ПО-ЗОННО (правка owner-skeleton: не мешать зоны в одном чеклисте)

Один адресат = свой блок, в блоке — только файлы его зоны. Чужой файл = **handoff**, не пункт
чужого DoD.

### DoD owner-skeleton (`packages/skeleton/**` — ✅ ИСПОЛНЕНО 2026-07-12)
`devbox-services.mjs` (up/start/stop/restart/status/run/logs, детач, `~/.devbox`-state) зелёный на
живых процессах; G1 loopback-bind → kill+loud-fail; G2 литеральный `--` → fail; `devbox.services.json`
TEMPLATE; `devbox-session.sh` exec-only (`0755`); `devcontainer.json` postStart+initializeCommand+
postCreate-seed (B8); B7 init-`0755` + husky-guard; `init.mjs` раздача + `packages/skeleton/README`.

### DoD owner-registry (`registry/**` — handoff)
`registry/ports.md`: порты продуктов = внутренние, `:8080` единственный хост-контракт
(`gateway-network-single-origin.md` gw-step5); `registry/products.md` сопровождение.

### DoD gateway-стек / architect (`stacks/gateway/**` — handoff)
gw-step1–3 (`gateway-network-single-origin.md`): внешняя сеть в `compose.yml`, `nginx.conf`
host.docker.internal → `<alias>` через resolver+переменную, снять `extra_hosts`.

### DoD devopser-root / architect (корень репо, вне зон — handoff)
`devbox/README` §Пост-шаги: B8 seed + B9 занос/re-seed кредов (OAuth-volume) + backend-наружу-нюанс
переписать (наружу ничего, всё через gateway); прогнать `init.mjs` по корню devopser (материализ.
`.devcontainer/` + `scripts/` — dogfood). **Это НЕ owner-skeleton** (авторинг скелета ≠ материализация
корня): делает architect/main.

### Сквозной приёмочный тест (после всех блоков)
Юзер с занятым хостовым 3500 → система встаёт (порты внутри контейнеров); `docker ps` = единственная
хост-публикация `:8080`; рестарт Docker → сервисы сами; свежий volume → `claude` без онбординга.

## Связь
- `devbox-first-run-dx.md` — заказ (входящий).
- `feedback-devbox-first-run-dx.md` — ревью-аппрув + 2 правки (B9 разблок, A4 оба пути) — вшиты.
- `container-sessions-brainer.md` — граница launcher'а (модель-политика ≠ скелет); B6 расщепляет.
- `devbox-vscode-devcontainer.md` — тот же DX-слой, второй путь входа (VS Code); оба тянут
  `customizations`/сервис-декларацию из скелета (manifest-driven, один принцип).
- `registry/products.md` — созданный C10-каталог (тонкий индекс, поглощается манифестом инк-1).
- `knowledger/blueprints/workspace-platform-draft.md` — dev-services/launcher/onboarding = инк 2–3;
  `knowledger/briefs/inc1-product-manifest.md` — тонкий манифест (граница согласовать).
- North Star / platform-блюпринт — кросс-продуктовый спавн (downstream, не здесь).

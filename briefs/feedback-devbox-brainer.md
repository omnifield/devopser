# Feedback — обкатка devbox на brainer (ПРОМЕЖУТОЧНЫЙ, прогон идёт)

| | |
|---|---|
| **Кому** | devopser-архитектор |
| **От** | brainer-архитектор, 2026-07-10 |
| **По брифу** | `devbox-test-brainer.md` (образ `ghcr.io/omnifield/devbox:v2026.07.10`, шаблон skeleton 0.2.0) |
| **Статус** | прогон в процессе; Д1–Д5 подтверждены, чек-лист ниже обновляется |

Контекст прогона: **не VS Code** — user на WebStorm, тест ведётся через
`@devcontainers/cli` (`devcontainer up` + `docker exec`), путь 2а
(bind-mount существующего клона). Windows 11, Docker Desktop 28.3.2.
Путь 2б (clone-in-volume) — после 2а.

## Находки (по убыванию боли)

### Д1. Тег образа из брифа/шаблона не опубликован ⛔

Пин `v2026.07.10` (бриф + `devcontainer-template.json` 0.2.0) — на ghcr
такого тега нет: опубликованы только `v2026.07.09` и `latest`. И аноним, и
залогиненный pull получают `not found` — devcontainer up падает на старте.
Обход в тесте: локальный `docker tag v2026.07.09 → v2026.07.10`.
Чинить у себя не стали (граница брифа): либо докладываете тег, либо правите
пин. Сам образ public — с этим ок.

### Д3. postCreate `pnpm install` без PAT не падает, а ВИСНЕТ ⛔

Ожидание брифа «упадёт на чистом контейнере — ожидаемо» не сходится:
по факту install молча висит (>11 мин, убит руками) — похоже, ретраи на 401
от npm.pkg.github.com поверх медленного bind-mount. Это хуже fail-fast:
пользователь чистой машины видит вечный postCreate без намёка на причину.
Смягчение `|| echo hint` не спасёт — до `||` дело не доходит. Нужен
fail-fast в шаблоне: таймаут, или предварительная проба реестра
(`npm ping`/`pnpm whoami --registry …`) с внятным hint'ом про PAT.

### Д4. pnpm-store уезжает в workspace, named volume пустует

На bind-mount пути store материализуется в `/workspaces/brainer/.pnpm-store`
(v11), а volume из шаблона (`~/.local/share/pnpm/store`) остаётся пустым (4К).
Гипотеза: home и workspace — разные devices, pnpm кладёт store на один device
с проектом. Эффекты: (а) ускорение повторного install волюмом не работает
на пути 2а; (б) мусорный `.pnpm-store/` в рабочем дереве — кандидат в
managed-блок `.gitignore` скелета. На пути 2б device один — перепроверим.

### Д2. Тулинг ≠ только VS Code

Потребитель №1 — WebStorm. Оба входа брифа сформулированы как VS Code-кнопки.
`devcontainer` CLI путь работает (им и тестим) — в доку шаблона стоит добавить
абзац про JetBrains / CLI (`pnpm dlx @devcontainers/cli up --workspace-folder .`).

### Д5. Инструкция про ~/.npmrc должна быть точной

В реальном `~/.npmrc` господина потребителя — 7 `authToken`-строк разных
реестров (verdaccio, nexus, npmjs…). «Скопируйте npmrc с PAT» из workstation
§3 недостаточно: нужна точная пара строк
(`@omnifield:registry=…` + `//npm.pkg.github.com/:_authToken=…`).
Бонус-грабля: токен, выуженный «первым grep'ом», оказался дохлым — стоит
подсказать проверку `curl -H "Authorization: token …" api.github.com/user`.

## Замеры (пополняются)

| Что | Значение |
|---|---|
| docker pull образа (2.43 GB) | **35 s** |
| devcontainer up (без учёта postCreate-зависания) | до терминала — секунды |
| pnpm самопереключение 11.x → пин 10.11.0 | **работает** ✅ |
| pnpm install холодный (bind-mount, 2а) | идёт >7 мин — bind-mount тормозит ощутимо |
| pnpm install тёплый | TBD |

## Чек-лист брифа (статус на момент фидбека)

- [x] `~/.npmrc` с PAT внутри контейнера
- [x] pnpm = 10.11.0 (пин, не 11 из образа)
- [ ] `pnpm install` зелёный — идёт
- [ ] `nx affected lint,typecheck,test,build`
- [ ] python-линия: `uv sync --dev`, ruff+pytest (backend, kernel)
- [ ] гейты: коммит/пуш из контейнера
- [ ] ⭐ агент-сессии (constraint 4) — впереди
- [ ] порты в обе стороны (forwardPorts / host.docker.internal:4317, П-докер-1)

Финальная версия придёт после полного прогона (вкл. вердикт по агент-сессиям
и путь 2б).

---

## ✅ Резолюция devopser-architect по Д1–Д5 (2026-07-10, промежуточная — не ждём финала)

| Д | Решение |
|---|---|
| Д1 | Корень: воркфлоу тегует UTC-датой раннера, релиз ушёл вечером 07-09 UTC → `v2026.07.09`; пин я вписал локальной датой руками — рассинхрон двух источников правды. Фикс: `release-devbox.yml` принимает явный `-f tag=…`; тег **v2026.07.10 доиздан** (пины не трогаем, ваш локальный tag-обход можно снести); процесс в README devbox: пин — только с фактически изданного тега, проверка `docker manifest inspect`. |
| Д2 | README devbox: секция JetBrains / devcontainers-CLI (`dlx @devcontainers/cli up`). |
| Д3 | Согласен, «висит» хуже «падает». Шаблон postCreate теперь fail-fast: `timeout 20 npm whoami --registry=npm.pkg.github.com` до install, при провале — понятный hint про PAT и exit 1. |
| Д4 | Диагноз верный: pnpm держит store на одном device с проектом → на bind-mount volume пустует by-design. `.pnpm-store/` добавлен в managed-блок `.gitignore`; поведение задокументировано в README devbox («store-volume работает на clone-in-volume»). Ждём вашу перепроверку на 2б. |
| Д5 | `workstation/README` §3: подчёркнута точная пара строк + проверка живости токена `curl api.github.com/user` (200/401). |

Плюс П-докер-1 из ревью оракула — в шаблон добавлен
`--add-host=host.docker.internal:host-gateway` (linux-parity; Docker Desktop и так
даёт), в README — «localhost внутри контейнера = контейнер, хост-сервисы через
host.docker.internal». Заметка оракула про node-не-самоуправляемый — в README
«Известное поведение». Всё выше — **skeleton 0.2.1** (синк подтянет шаблон и
gitignore-блок). Ждём финал прогона: агент-сессии + 2б + тёплый install.

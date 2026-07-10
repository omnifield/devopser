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

### Д6. Bind-mount (путь 2а) не годится для node-репо на Windows-хосте ⛔ → обход найден

Хостовый `node_modules` приезжает в контейнер через bind-mount, а он собран
под Windows: платформенные бинари + junction-симлинки. Эффекты каскадом:
(а) Linux-у он неисполним (`Cannot find module`, виндовые `.CMD`-шимы);
(б) pnpm честно предлагает reinstall from scratch — и **ломает node_modules
хосту** (после теста хосту нужен свой `pnpm install`);
(в) даже `rm -rf node_modules` из контейнера — 193 s и не дочищает
junction'ы («Directory not empty»/«Is a directory» пачкой).

**Обход, предлагаем в шаблон** (у себя уже применили, работает): named volume
поверх `node_modules` —
`source=<repo>-node-modules,target=/workspaces/<repo>/node_modules,type=volume`
(+ `chown` в postCreate, volume создаётся root'ом). Каждая сторона получает
свою копию, конфликт платформ исчезает классом. С ним путь 2а стал юзабельным:
холодный install 33 s. Альтернатива — объявить в README: node-репо на
Windows-хосте → только 2б.

### Д7. ☠ ОПАСНО: удаление node_modules из контейнера на bind-mount ест исходники

Инцидент во время теста: `rm -rf node_modules` изнутри контейнера (путь 2а,
Windows-хост) **удалил исходники `packages/frontend/**`** — 52 файла. Механизм:
grpcfuse (мост Docker Desktop) отдаёт виндовые junction'ы pnpm как обычные
каталоги, `rm` рекурсивно проходит «сквозь» линк на workspace-пакет и выедает
цель. Восстановили из git без потерь (дерево было чистым), но на грязном
дереве это потеря работы. Тот же риск у «reinstall from scratch», который pnpm
сам предлагает при platform-mismatch (Д6) — т.е. наступить на это можно, ничего
руками не удаляя. В README devbox — жирное предупреждение: на 2а НЕ трогать
node_modules из контейнера; с volume-overlay из Д6 риск снимается классом
(node_modules перестаёт быть частью bind-mount).

Нюанс к Д6: volume-overlay нужен на node_modules **каждого workspace-пакета**
(у нас: корень + `packages/frontend`), не только корня — для многопакетных
workspace паттерн становится громоздким, что лишний аргумент за канон 2б.

### Д8. Легенда «системного python нет, uv качает CPython» не сходится

В образе есть `/usr/bin/python3.12` (3.12.3, база Ubuntu). Пин `3.12` в
`.python-version` удовлетворяется системным → uv ничего не качает и венвы
строятся на 3.12.3 (`home = /usr/bin`). Либо вычищать python из образа /
ставить `python-preference = only-managed`, либо поправить легенду в
README — сейчас поведение расходится с заявленным «оболочка тулчейна».

### Д9. pwsh в образе нет → claude-scope.ps1 из контейнера не работает

Лаунчеры scope-сессий у потребителей — PowerShell (`claude-scope.ps1`, канон
агентского флоу). В образе pwsh отсутствует → интерактивный scope-флоу изнутри
контейнера недоступен как есть. Варианты: pwsh в образ (+~70 МБ) или sh-порт
лаунчера на стороне репо (мы бы взяли sh-порт, но это правка канона — решать
вместе). Headless-спавн оркестратором не задет (SDK-адаптер, без ps1).

### Мелочи

- `nc` в образе нет (для смок-проб сети пригодился бы; обошлись bash /dev/tcp).
- uv-workspace синкает в **корневой** `.venv` — на bind-mount (2а) он делится
  с хостом и молча пересобирается под Linux (хосту после теста нужен свой
  `uv sync`). Тот же класс, что Д6, но без ☠: junction'ов в venv нет.

## ✔ Проверка резолюций devopser (2026-07-10, вторая итерация)

- **Д1**: тег `v2026.07.10` тянется ✅ (digest другой — образ пересобран,
  контейнер пересоздали на нём).
- **Д3**: fail-fast работает ✅ — свежий контейнер без PAT падает за ~9 s
  с внятным hint'ом. После записи PAT `npm whoami` отвечает.
- **Д4**: `.pnpm-store/` приехал в managed-блок `.gitignore` синком 0.2.1 ✅.
- Синк 0.2.1 + порт нового postCreate в наш расширенный devcontainer —
  закоммичены в main brainer.

## Замеры (пополняются)

| Что | Значение |
|---|---|
| docker pull образа (2.43 GB) | **35 s** |
| devcontainer up (без учёта postCreate) | до терминала — секунды |
| pnpm самопереключение 11.x → пин 10.11.0 | **работает** ✅ |
| pnpm install холодный, node_modules НА bind-mount | не завершился (>11 мин, висяк) — см. Д6 |
| pnpm install холодный, node_modules в volume | **30–33 s** ✅ |
| pnpm install тёплый (volume) | **1 s** ✅ |
| nx run-many lint+typecheck+test+build (frontend) | **5 s** ✅ |
| rm -rf node_modules через bind-mount | 193 s, не дочищает + ☠ Д7 |

## Чек-лист брифа (статус на момент фидбека)

- [x] `~/.npmrc` с PAT внутри контейнера
- [x] pnpm = 10.11.0 (пин, не 11 из образа)
- [x] `pnpm install` зелёный (с volume-overlay из Д6; на голом 2а — Д6/Д7)
- [x] nx-гейты lint,typecheck,test,build зелёные (run-many: affected на чистом дереве — no-op)
- [x] python-линия зелёная: uv sync 29s/8s, ruff чисто, pytest 38+37 passed
      (нюанс Д8: python взят системный, не uv-managed)
- [x] коммит из контейнера: pre-commit (sherif+affected+local) живой ✅
- [x] push из контейнера: голым — нет кредов; `gh auth login --with-token` +
      `gh auth setup-git` → работает ✅ (зафиксировать в README как путь)
- [x] хост-сервисы из контейнера (П-докер-1): host.docker.internal резолвится,
      OTEL :4317 ✅, Prometheus :9090 ✅ (Loki :3100 не запущен на хосте — n/a)
- [x] ⭐ агент-сессии, вердикт: claude 2.1.205 в образе ✅; headless-сессия
      РАБОТАЕТ — креды заносятся файлом (`docker cp ~/.claude/.credentials.json`,
      ровно то, что произвёл бы /login) + нюанс: нужен trust
      (`hasTrustDialogAccepted` в ~/.claude.json контейнера); claude-scope.ps1 —
      блокер Д9 (нет pwsh)
- [~] интерактивный /login и персистентность между рестартами — НЕ дотестировано:
      приоритет-флип user'а (local-agents-first), терминальный /login признан
      не-продуктовым флоу; рекомендация шаблону остаётся — volume под ~/.claude
- [~] порты контейнер→хост: у devcontainer-CLI-пути forwardPorts не публикует
      порты (фича VS Code) — для 2а+CLI нужен `appPort`/`-p`; отложено
- [~] путь 2б (clone-in-volume) + чистые замеры — отложено тем же флипом;
      2б станет песочницей агент-прогонов chater (см. брифы local-agents-first)

**Статус фидбека: ФИНАЛ для этой итерации.** Открытые для devopser: Д8 (системный
python вопреки легенде), Д9 (pwsh), рекомендации Д6 (node_modules-volume в шаблон
/ README-правило) и Д7 (☠ предупреждение в README). Отложенное вернётся вместе с
песочницей chater.

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

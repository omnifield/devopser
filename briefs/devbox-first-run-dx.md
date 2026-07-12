# Brief-заказ — devbox first-run DX: «новый юзер сел и полчаса не может начать работать»

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | architect-координатор миграции (решение user, 2026-07-12) |
| **Основание** | ловлено ВЖИВУЮ: после рестарта Docker architect **~30 минут** не мог поднять окружение и запустить агента в контейнере. Пять отдельных грабель подряд. Если architect с инструментами потратил полчаса — новый юзер утонет. |
| **Класс** | DX скелета devbox — наследуют ВСЕ продукт-devbox'ы (brainer / weber / chater / …). Не per-repo патч. |

## Решение user (дословно по смыслу)

1. **Всё для запуска — заскриптовано И задокументировано.** Новый юзер садится за devbox и работает за **минуты**, не реверс-инжинирит команды из конфигов и не воюет с авторизацией.
2. **Dev-сервера по дефолту стартуют ВМЕСТЕ с контейнером** + **ручной вкл/выкл**.
3. **Вход в агент-сессию — одной короткой командой** на любой репо, из коробки, с рабочей авторизацией.

---

## Инцидент-нарратив (эти 30 минут, по шагам — каждый шаг = грабля)

### Шаг 1 — dev-сервера не встали с контейнером
Рестарт Docker вернул контейнеры (gateway `restart=unless-stopped` сам; devbox'ы поднялись), но **dev-сервера НЕ поднялись**: у devbox `Cmd=[sleep infinity]`, сервера стартуют ad-hoc через `docker exec` в сессии. Итог: gateway `/brainer/` → **502**, `/sandbox/` → closed, `/api/brainer/sessions` → мёртв. Пришлось вручную выковыривать команды:

| сервис | команда | cwd | порт / base |
|---|---|---|---|
| brainer backend | `uv run uvicorn app.main:app --host 0.0.0.0 --port 8010` | `packages/backend` | :8010, префикс `/brainer/` |
| brainer frontend | `pnpm run dev --host 0.0.0.0` | `packages/frontend` | :3500 strictPort, base `/brainer/` |
| weber sandbox | `pnpm run dev --host 0.0.0.0` | `apps/sandbox` | :5173, base `/sandbox/` |

- **G1 — bind-адрес.** Голый `vite`/`pnpm dev` слушает `127.0.0.1` → published-порт контейнера (`-p 3500:3500`) НЕ пробрасывается → gateway-upstream (`host.docker.internal:3500`) молча отдаёт **502**. ОБЯЗАН `--host 0.0.0.0`. Backend это уже делает, фронты — нет. Класс: любой сервис, чей порт публикуется контейнером, обязан bind `0.0.0.0`.
- **G2 — arg-passing.** `pnpm run dev -- --host 0.0.0.0` передаёт литеральный `--` в vite → `--host` игнорируется («use --host to expose»). Правильно **без** `--`. Стоило лишнего рестарт-цикла.

### Шаг 2 — пульт не даёт запустить агента
Пульт brainer'а показывает **только существующие brainer-сессии**. Спавнить не может:
- **Реестр `BRAINER_REPOS` = `brainer;weber;chater`** — devopser/knowledger/writer НЕ зарегистрированы.
- Launch-UI в дашборде нет (спавн `hub.launch` в бэкенде есть, кнопки — нет).
- `config.py` прямым текстом: `TODO(architect): moving this map into devopser registry/products.md` — реестр захардкожен в env.

### Шаг 3 — прямого launcher'а тоже нет
- **devopser НЕ имеет container-session launcher** — только legacy `claude-scope.ps1` (хост-PowerShell, против канона containers-only). brainer/weber имеют `scripts/devbox-session.sh`, devopser — нет.
- **weber `devbox-session.sh` потерял exec-бит** (`-rw-r--r--`, грабля `\\wsl.localhost`-правки) → `./devbox-session.sh` = permission denied.
- Пришлось сделать **стопгап** `~/oa <repo> [scope]` (docker exec в brainer-devbox, который монтирует все репо) — костыль, не канон.

### Шаг 4 — авторизация: shared OAuth-токен обнулён
`claude` в контейнере: **«Not logged in · Please run /login»** — хотя `.credentials.json` в volume ЕСТЬ. Причина: `expiresAt=0` — access-токен **затёрт гонкой refresh** на общем файле (несколько claude-сессий делят один `.credentials.json`, refresh-токены ротируются при использовании → затирают друг друга). Пере-засеял валидным хостовым токеном → `claude -p` заработал.
**Корень НЕ устранён:** shared OAuth-creds не выживают при параллельных сессиях.

### Шаг 5 — онбординг: интерактивный claude всё равно просит логин
`claude -p` работал, а интерактивный `claude` показывал экран регистрации. Причина: **в volume не было `.claude.json`** → claude гонит онбординг первого запуска (экран логина), хотя креды валидны. SDK/`-p`-сессии онбординг не гоняют — поэтому пульт работал, а первый живой claude ломался. Засеял `.claude.json` (`hasCompletedOnboarding:true` + account) → пустило.

---

## Заказ (что должен спроектировать devopser-архитектор)

### A. Dev-сервисы — жизненный цикл
1. **Декларация НА ПРОДУКТ** (не хардкод per-repo): поле сервиса минимум `name`, `cwd`, `command`, `port`, опц. `healthUrl`. Наборы разные (brainer=frontend+backend, weber=sandbox, chater=…). Ложится на North Star manifest-driven.
2. **Autostart** — контейнер по дефолту поднимает задекларированные сервисы, СОХРАНЯЯ интерактивный вход. Bind `0.0.0.0` для published-портов **вшит в обёртку** (устраняет G1 системно). Форма запуска без литерального `--` (G2).
3. **Ручной toggle** — `start|stop|restart|status [service]` + foreground-режим одного сервиса (HMR-eyeball / логи).
4. **Логи** — предсказуемое место + tail-команда (не `/tmp/*.log` руками).
5. **strictPort-канон сохранить** (loud fail на занятый порт).

### B. Container-session first-run (вход в агента)
6. **Штатный launcher на КАЖДЫЙ продукт** (не только brainer). devopser своего не имеет — добавить. Единая короткая форма («войти агентом в репо X со скоупом Y»). Стопгап `~/oa` — референс UX, не канон.
7. **Exec-бит launcher'ов** — канон: править из контейнера/WSL либо `chmod +x` при коммите (weber потерял бит через `\\wsl.localhost`). Зафиксировать правилом/pre-commit.
8. **Онбординг seeding** — `.claude.json` с `hasCompletedOnboarding:true` (+ theme) должен быть в образе/volume ДО первого интерактивного входа, чтобы claude не гнал экран регистрации.
9. **Креды без гонки** — shared `.credentials.json` корраптится при параллельных сессиях (обнуление access-токена). Варианты на выбор архитектора:
   - `ANTHROPIC_API_KEY` для spawn-сессий (не ротируется, не гонится) — но это API-billing, не Max-подписка; обсудить с user;
   - per-session изоляция кред-файла (свой `CLAUDE_CONFIG_DIR` на сессию, общий только read-only seed);
   - «кабинет ключей» поверх volume `omnifield-secrets` (идея из чекпойнта — управление ключами как продукт).
   Плюс документированный «первый занос/обновление кредов» (сейчас = ручной re-seed хостовым токеном).

### C. Registry / пульт (граница)
10. **`BRAINER_REPOS` → `devopser registry/products.md`** как runtime-источник (config.py TODO). Это devopser-часть; **кросс-продуктовый спавн из пульта** = brainer + platform-слой (North Star, отдельный трек/блюпринт). Здесь — только вынести реестр в манифест.

## Границы
- Механизм + доки — **в скелете** (devopser). Продукты только **декларируют** сервисы.
- Содержимое dev-серверов (vite/uvicorn конфиги) — зона продукт-owner'ов; скелет **оркестрирует**.
- Single-origin gateway: сервисы = gateway-internal upstreams, наружу только `:8080`.

## Открытые вопросы (обсудить: user + devopser-архитектор)
- Форма декларации сервисов: сразу product-manifest (North Star) или промежуточный `devbox.services` с прицелом слиться? *Рекомендация:* не блокироваться на манифесте.
- Autostart: entrypoint-обёртка vs supervisor (`supervisord`/`overmind`).
- Креды: OAuth-per-session vs `ANTHROPIC_API_KEY` для автономных spawn-сессий — **решение user** (billing vs подписка).

## Связь
- `devbox-vscode-devcontainer.md` (VS Code в скелет) — тот же DX-слой «новый юзер садится и сразу работает».
- Registry/пульт-спавн → блюпринт платформы-воркспейса.

# Бриф: devbox-провижинер `devbox up|down|recreate` (headless, из манифеста)

> **Трек:** Foundation — Шаг 2 (Провижининг контейнера/devbox)
> **Адресат:** архитектор / owner **devopser** (зона: `scripts/` + `devbox/` + skeleton `files/`)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ (ветка → PR → CI → ревью → мерж)

## North star
**Универсальный скриптованный lifecycle devbox'а: любой продукт поднимается/пересоздаётся ОДНОЙ
командой из своего манифеста, по канону.** Ноль ручных `docker run`, ноль per-продукт-развилок в
скрипте. Канон-инвариант: **только свой репо** (без god-mount `/workspaces`), сеть `omnifield-gateway`
alias=имя, **без host-портов** (`-p`), volumes secrets+pnpm-store, restart `unless-stopped`. Любое
отклонение = дефект (наследуется всеми devbox'ами).

## Зачем (факты сняты через Канал)
- Живые devbox'ы **уже канон-чистые** (chater: mount только `/workspaces/chater` + secrets/pnpm-volume,
  сеть gateway alias=chater, ports `map[]`, restart unless-stopped). Но создаются они **VS Code
  `.devcontainer/devcontainer.json`** ЛИБО ручным `docker run` — **скриптованного headless-провижинера нет**.
- `scripts/devbox-session.sh` — **session-entry** (резолв контейнера → gateway-connect → `devbox-services up`
  → `docker exec claude`), контейнер НЕ создаёт; god-mount/`-p`-регрессии в нём нет (эта часть plan-DoD уже
  закрыта — НЕ регрессировать).
- Образ есть: `devbox/Dockerfile` → `ghcr.io/omnifield/devbox`. Манифест-де-факто (канон per-repo) —
  `.devcontainer/devcontainer.json` (image, `runArgs` network+alias, mounts, containerEnv, postCreate/postStart).

## Скоуп (только репо devopser)
1. **Headless-провижинер `devbox up|down|recreate <repo>`** (скрипт в `scripts/`, containers-only — на ХОСТЕ
   только `docker`, как `devbox-session.sh`):
   - `up` — создать (если нет) + запустить devbox по канону; **идемпотентно** (есть и запущен → no-op).
   - `down` — остановить + удалить контейнер (**volumes/данные НЕ трогать** — переживают recreate).
   - `recreate` — `down` + `up`; данные (secrets/pnpm-store + рантайм-volume продукта) переживают.
   - Канон-конфиг **из манифеста, не хардкодом**: image, bind **только своего репо** (host-путь резолвится;
     ноль god-mount), `--network omnifield-gateway --network-alias <repo>`, volumes secrets+pnpm-store,
     containerEnv (пути кредов), **ноль `-p`/host-портов**, `--restart unless-stopped`, postCreate/postStart.
2. **Манифест = единый источник (рекомендация):** переиспользовать `.devcontainer/devcontainer.json`
   (продукт его уже несёт) — чтобы headless-провижн и VS Code-путь не разъехались. Если парсинг
   devcontainer-формата под containers-only тяжёл — минимальный `devbox`-манифест, но **без дублирования**
   канон-полей (drift между ними = дефект; обосновать выбор в PR).
3. **`devbox-session.sh` остаётся session-only**; заменить в нём хинт «raw docker run …» на «`devbox up <repo>`».
4. **Доставка через skeleton:** провижинер — в MANAGED-набор (как `devbox-session.sh`/`devbox-services.mjs`),
   drift-managed → пропагируется во все продукт-репо. (Помни каскад дрейфа: после мержа — sync консюмерам.)

## Вне скоупа (явно)
- **Клон репо на хост / bootstrap dev-машины** — зона `workstation` (репо-карта, base-toolchain); провижинер
  ПРЕДПОЛАГАЕТ репо на хосте, не клонирует. Референс, не скоуп.
- Автостарт dev-сервисов ВНУТРИ контейнера — Шаг 4 (`devbox-services`, уже есть). Дверь/gateway-маршруты — Шаг 5.
- Session-launch (`session <scope>`) — Шаг 3.

## DoD (зона devopser)
- [ ] `devbox up|down|recreate <repo>` — одна команда; конфиг из манифеста; **ноль ручных `docker run`**.
- [ ] Канон-инвариант соблюдён: только свой репо (без god-mount), gateway alias, **ноль host-портов**,
      restart unless-stopped, secrets/pnpm-volume.
- [ ] Идемпотентно; **`recreate` сохраняет данные** (volumes переживают); `down` чист (контейнер удалён).
- [ ] `devbox-session.sh` session-only, хинт → `devbox up`.
- [ ] **Живой прог:** `recreate <какой-то devbox>` → поднялся канон-чистый (docker inspect: 1 repo-mount,
      alias, ports `map[]`, restart), `devbox-session.sh` входит, `devbox-services up` отрабатывает.
- [ ] PR зелёный → ревью → мерж.

## Handoff (после мержа)
- **→ все продукты (через skeleton sync):** новый провижинер-скрипт в managed-наборе — пересинк консюмеров
  (иначе drift-check красный, см. [[skeleton-etalon-drift-cascade]]).

## Проверка north star (перед мержем)
Если провижинер ветвится по имени продукта, тянет god-mount, публикует host-порты, дублирует канон-поля
манифеста, или требует VS Code/не-docker на хосте — **дефект, не мержим.** Любой devbox — одной командой.

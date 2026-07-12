# Handoff — brainer + weber owner'ам: пересоздать devbox (снять хост-порты, single-origin)

| | |
|---|---|
| **Адресат** | brainer-owner · weber-owner (запускает user) |
| **От** | devopser-архитектор, 2026-07-12 |
| **Основание** | single-origin доведён (`gateway-network-single-origin.md`, проверен вживую): gateway достаёт продукты по docker-сети `omnifield-gateway`, наружу — только `:8080` |
| **Класс** | продукт-owner action; механизм devopser готов |

## Зачем
Твой **работающий** devbox всё ещё публикует хост-порты (замер `docker ps` 2026-07-12):
- `brainer-devbox` → `0.0.0.0:3500`, `0.0.0.0:8010`
- `weber-devbox` → `0.0.0.0:5173`

Причина — контейнер создан СТАРЫМ способом (с `-p`), до single-origin. Это нарушает
«наружу только `:8080`» и держит класс «занятый хост-порт у юзера». Новый skeleton-шаблон
`devcontainer.json` **`-p` не ставит** — контейнер заходит в сеть `omnifield-gateway` по
alias'у (= имя репо) и отдаётся gateway'ю по сети, без хост-публикации.

## Что сделать
1. **Синк скелета** (`pnpm dlx @omnifield/skeleton@<версия>` или `init.mjs`) — приедут новый
   `devcontainer.json` (`--network=omnifield-gateway --network-alias=<repo>`, `initializeCommand`
   создаёт сеть, `postStartCommand: devbox-services up`) + `scripts/devbox-session.sh` +
   `scripts/devbox-services.mjs`.
2. **Задекларировать dev-сервисы** в `devbox.services.json` (корень репо): массив
   `{name, cwd, command, port, healthUrl?}`. ⚠️ `command` **bind 0.0.0.0** (G1: сосед по сети
   не видит loopback), **без литерального `--`** перед `--host/--port` (G2). Пример-форма —
   `packages/skeleton/README` (devopser). brainer: frontend :3500 + backend :8010; weber: sandbox :5173.
3. **Пересоздать контейнер** через новый шаблон:
   - VS Code: «Dev Containers: Rebuild Container»;
   - raw: `docker rm -f <repo>-devbox` → подъём заново (VS Code/`devbox-session.sh`/raw-run
     `--network omnifield-gateway --network-alias <repo> --name <repo>-devbox`, **без `-p`**).

## Проверка (DoD)
- `docker ps --format '{{.Names}}\t{{.Ports}}'` → у твоего devbox **портов НЕТ** (пусто);
  единственная хост-публикация во всей системе — `omnifield-gateway :8080`.
- `curl -sI localhost:8080/<твой-маршрут>/` → `200` (dev-сервер поднят автозапуском
  `devbox-services up`, отдан gateway'ю по сети).

## Границы
- Механизм (шаблон/сеть/launcher/оркестратор) — devopser, готов и в git. Твоё — синк + декларация
  сервисов + пересоздание своего контейнера. Порты/маршруты = контракт (`registry/ports.md`) —
  не меняем, только перестаём их хост-публиковать.
- Legacy-контейнер до пересоздания продолжит торчать портами — это не поломка, gateway уже
  ходит по сети (мы вручную `docker network connect`-нули для проверки); чистое состояние — после rebuild.

## Связь
- `gateway-network-single-origin.md` — механизм single-origin (проверен end-to-end).
- `devbox-first-run-dx-design.md` — dev-services декларация (A1) + launcher (B6).
- `registry/ports.md` — порты продуктов = внутренние, `:8080` единственный хост-контракт.

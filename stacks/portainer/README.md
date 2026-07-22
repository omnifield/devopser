# stacks/portainer — web-пульт docker-хостов (Portainer CE)

Desktop-независимое управление докером (containers-only бриф, D2.2): контейнеры,
логи, стеки, образы, volumes — локального демона и удалённых серверов, из браузера.
Дополняет `docker context` (CLI-путь, `workstation/docker.md`), не заменяет.

- **Up**: `docker compose up -d` → https://localhost:9443
- **Первый вход**: контейнер идёт с `--no-setup-token` (пульт localhost-only;
  токен-в-логах CE 2.39 давал гонки с 5-мин таймаутом настройки) — создать админа
  сразу после up: либо форма в UI (логин+пароль, ⚠️ в течение ~5 минут, проспал —
  `docker compose restart portainer`), либо мгновенно через API:
  ```sh
  curl -sk -X POST https://localhost:9443/api/users/admin/init \
    -H "Content-Type: application/json" \
    -d '{"Username":"admin","Password":"<пароль 12+ символов>"}'
  ```
- **Удалённые серверы**: Environments → Add → Docker Agent (одна команда на сервере,
  из UI) — появится по мере реальных серверов.
- **Границы**: пульт ИНФРЫ (докер-хосты); наблюдаемость агент-сессий — продукт
  brainer, не сюда. Socket-mount = root на хост-докере → порт наружу не публикуем,
  доступ только с машины.
- **Обновление**: бамп тега образа в compose (пин; свой хост-порт devopser в `registry/ports.md` не трогается).

Потребитель/заказ: user (боль «управлять без Desktop-UI»), needs-driven — стек
появился под заказ, канон соблюдён.

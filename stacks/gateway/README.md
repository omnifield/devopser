# stacks/gateway — single-origin вход dev-машины + хаб

Одна дверь на всё (`briefs/gateway-hub-single-origin.md`, заказчик — brainer,
решение user): в проде всё за nginx — в dev работаем в том же флоу, parity-грабли
(«на портах работало, за прокси нет») ловятся сразу. Прямые порты продуктов —
внутренняя деталь (nginx targets); source of truth — `registry/ports.md`, из UX
и доков они уходят.

- **Пререквизит — внешняя сеть** (`gateway-network-single-origin.md`): `docker network
  create omnifield-gateway` (один раз; devbox'ы создают её сами через `initializeCommand`).
  Апстримы ходят ПО ЭТОЙ СЕТИ по alias'у продукт-devbox'а (= имя репо), НЕ через
  `host.docker.internal` и НЕ через per-service `-p`. **Наружу — только `:8080`.**
- **Up**: `docker compose up -d` → http://localhost:8080/ — хаб.
- **Маршруты** (`nginx.conf`): `/brainer/` → `brainer:3500` (фронт, HMR websocket);
  `/sandbox/` → `weber:5173`; `/api/brainer/` → `brainer:8010` (rewrite `/api/brainer/`
  → `/brainer/`, SSE без буферизации). Апстрим-имена резолвятся docker-DNS в runtime
  (`resolver 127.0.0.11` + переменная в `proxy_pass`) → gateway **стартует, даже когда
  продукт-devbox ещё не поднят**, и отвечает 502 до его подъёма (ожидаемо, gateway первым).
- **Хаб** (`hub/index.html`) — MVP-статика руками: продукты за origin,
  инфра (Grafana/Prometheus/Portainer) пока прямыми портами. Registry-driven
  генерация и observability за тем же origin (`/grafana/`, `/prometheus/` —
  нужны `GF_SERVER_ROOT_URL` / `--web.external-url` у стека-владельца) — фаза 2.
- **Новый маршрут продукта** = контракт: через architect + запись в
  `registry/ports.md`, затем location здесь. Продукт в стек не хардкодим больше,
  чем парой location-строк — расширение registry-записью (stack-as-capability).
- **Границы**: обычный compose на машине — docker-socket не монтируется, в devbox
  не входит; секретов нет. Капсульный gateway оракула (`capsule/docker/gateway`,
  тоже :8080) — предыдущая эпоха: одновременно не поднимать.
- **Обновление**: бамп пина nginx в compose.

DoD совместной проверки (после parity-фиксов brainer): хаб → дашборд живой
(включая HMR), `/api/brainer/sessions` отвечает, SSE-стрим не буферизуется.

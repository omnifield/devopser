# stacks/gateway — single-origin вход dev-машины + хаб

Одна дверь на всё (`briefs/gateway-hub-single-origin.md`, заказчик — brainer,
решение user): в проде всё за nginx — в dev работаем в том же флоу, parity-грабли
(«на портах работало, за прокси нет») ловятся сразу. Прямые порты продуктов —
внутренняя деталь (nginx targets); source of truth — манифест продукта (`omnifield.yaml`),
из UX и доков они уходят.

- **Дверь генерится, не пишется руками** (Шаг 5.3, `briefs/hubcore-door-from-registry.md`):
  `hub-core` глобит `omnifield-registry/*.yaml` (publish-volume продуктов) → пишет `nginx.conf`
  + лендинг в door-volume `omnifield-gateway-conf`, который монтирует nginx. Committed
  `nginx.conf`/`hub/` **ретайрены** — источник правды = генерация в volume. Правила маршрутов
  (фронт pass-through vs `/api/<name>` rewrite) — `hub-core/README.md`.
- **Пререквизиты — сеть + publish-volume** (один раз на машину; devbox'ы создают через
  `initializeCommand`, для standalone — явно):
  `docker network create omnifield-gateway` и `docker volume create omnifield-registry`.
  Апстримы ходят ПО СЕТИ по alias'у продукт-devbox'а (= имя репо), НЕ через
  `host.docker.internal` и НЕ через per-service `-p`. **Наружу — только `:8080`.**
- **Up**: `docker compose up -d --build` → hub-core генерит дверь из registry → gateway
  стартует → http://localhost:8080/ — хаб. Регенерация после нового publish:
  `docker compose run --rm hub-core && docker compose restart gateway`.
- **Drift-gate (runtime `--check`)**: сервис `hub-core-check` (профиль `check`) сверяет дверь
  в door-volume с реестром — `docker compose --profile check run --rm hub-core-check` → exit 1
  при ручном дрейфе / устаревшем образе (регенери). На обычном `up` не поднимается. Почему не
  Docker HEALTHCHECK — hub-core одноразовый, а long-running gateway это чистый nginx (node нет);
  почему не CI — входы (манифесты) в registry-volume, не в git. Ассерт живёт только в рантайме хаба.
- **Маршруты** резолвятся docker-DNS в runtime (`resolver 127.0.0.11` + переменная в
  `proxy_pass`) → gateway **стартует, даже когда продукт-devbox ещё не поднят** (и когда
  реестр пуст — дверь валидна-пустая), отвечает 502 до подъёма продукта (ожидаемо, gateway первым).
- **Новый маршрут продукта** = запись в его `omnifield.yaml` (product-owned) + publish в volume;
  дверь подхватит регенерацией. Порты/маршруты продукта = его манифест (истина там);
  `registry/ports.md` держит лишь свои хост-порты devopser (:8080/:9443), не данные продуктов.
  Продукт в стек не хардкодим (stack-as-capability).
- **Границы**: обычный compose на машине — docker-socket не монтируется, в devbox
  не входит; секретов нет. Капсульный gateway оракула (`capsule/docker/gateway`,
  тоже :8080) — предыдущая эпоха: одновременно не поднимать.
- **Обновление**: бамп пина nginx в compose.

DoD совместной проверки (после parity-фиксов brainer): хаб → дашборд живой
(включая HMR), `/api/brainer/sessions` отвечает, SSE-стрим не буферизуется.

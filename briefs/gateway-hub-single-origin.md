# Brief-заказ — dev-gateway + хаб: single-origin как ЕДИНСТВЕННЫЙ флоу

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | brainer-архитектор (решение user, 2026-07-11) |
| **Основание** | ADR 068 (single-origin, оракул) + канон containers-only + грабля «в dev на портах ок, в прод через nginx — не ок» (ловлена вживую) |
| **Класс** | новый stack экосистемы (`stacks/`), первый потребитель — brainer |

## Решение user (фиксирую дословно по смыслу)

1. Прямые порты УБИРАЕМ из рабочего флоу: в проде всё проксится через nginx —
   в dev работаем В ТОМ ЖЕ флоу, иначе parity-грабли повторяются.
2. Нужен **хаб** — одна точка входа, из которой открывается всё
   (прыгать по портам неудобно).

Порты не исчезают физически — они становятся ВНУТРЕННЕЙ деталью (nginx targets),
`registry/ports.md` остаётся source of truth, но из UX и доков они уходят.
Наружу — один порт gateway.

## Заказ

**Stack `gateway`** (compose, `stacks/`): nginx на **:8080** — единственная
дверь dev-машины.

1. **Хаб** — статическая индекс-страница на `/`: ссылки на всё живое
   (brainer-дашборд `/brainer/`, Grafana, Prometheus, …). MVP — статика руками;
   registry-driven генерация — потом.
2. **Маршруты brainer** (порт-контракт из `registry/ports.md`, brainer-owner'ы
   переводят код на контракт параллельными брифами):
   ```nginx
   # фронт (vite dev за префиксом; vite base='/brainer/' делает owner-frontend)
   location /brainer/     { proxy_pass http://host.docker.internal:3500;
                            # HMR websocket — Upgrade/Connection headers обязательны
                            proxy_http_version 1.1;
                            proxy_set_header Upgrade $http_upgrade;
                            proxy_set_header Connection "upgrade"; }
   # бэк (нативный префикс /brainer/ у backend — owner-backend)
   location /api/brainer/ { proxy_pass http://host.docker.internal:8010/brainer/;
                            proxy_buffering off; }   # SSE /stream живёт только так
   ```
3. **Observability под тем же origin** — желательно фазой 2: Grafana за
   `/grafana/` (`GF_SERVER_ROOT_URL`), Prometheus за `/prometheus/`
   (`--web.external-url`). В MVP хаб может ссылаться и на их порты напрямую —
   решайте по трудоёмкости, но целевое состояние: один origin на всё.
4. **registry/ports.md**: `:8080 gateway` закрепить; отметить, что 5173/8000 —
   временные фактические порты brainer, освобождаются после исполнения
   порт-контракта (3500/8010) owner'ами.

## Границы / зависимости

- Конфиг маршрутов — ваш (stack); правки кода brainer (vite base, префикс бэка,
  порты 3500/8010) — наши owner-брифы, идут параллельно
  (`brainer/briefs/gateway-parity-{frontend,backend}.md`).
- Последовательность: gateway можно поднимать ПЕРВЫМ (маршруты будут 502 до
  наших фиксов — ок); финальная проверка parity — совместно.
- Gateway-стек НЕ трогает docker-socket и не входит в devbox — обычный compose
  на машине.
- Капсульный gateway (оракул, `capsule/docker/gateway`) — предыдущая эпоха;
  новый стек канонизируется в devopser. Согласование с оракулом (ADR 068 —
  его) — за вами или скажите, я подниму.

## DoD

`http://localhost:8080/` — хаб; `/brainer/` — дашборд живой (включая HMR);
`/api/brainer/sessions` — API; SSE-стрим сессии работает через gateway без
буферизации. Прямые порты в доках экосистемы не фигурируют.

---

## ✅ Исполнение devopser-architect (2026-07-11)

- **Стек поставлен**: `stacks/gateway` — nginx 1.29-alpine на :8080, хаб
  (MVP-статика: продукты за origin, инфра пока портами) + маршруты brainer
  (`/brainer/` с HMR-websocket, `/api/brainer/` с SSE без буферизации,
  оба таймауты 1h). Смоук: up + хаб 200 (charset utf-8), маршруты 502 —
  ожидаемо до ваших parity-фиксов.
- **registry/ports.md**: :8080 переехал из капсулы в `stacks/gateway`
  (капсульный gateway — предыдущая эпоха, одновременно не поднимать);
  3500/8010 помечены как nginx-targets за gateway; 5173/8000 — временные,
  освобождаются вашими owner-брифами.
- **Фаза 2** (Grafana/Prometheus за origin) — отложена: требует env-правок
  в стеке-владельце observability (капсула, интерим) — станет заказом при
  переезде observability в devopser.
- **Согласование с оракулом** (ADR 068 + вывод капсульного gateway) — подниму
  я через user на ближайшем показе.
- Ждём parity-фиксы owner'ов brainer → совместная финальная проверка DoD
  (HMR + SSE через gateway).

---

## ✅ Ревью оракула (2026-07-11) — ПРИНЯТО; ADR 068 согласован

**Согласование ADR 068 (владелец — я): ЗАКРЫТО.** Канонизация single-origin
gateway в devopser одобрена — заказ пришёл ровно правильным флоу (needs-driven,
потребитель brainer, ноль wholesale-миграции). Капсульный gateway = предыдущая
эпоха: одновременно не поднимать (:8080 конфликт), выводится вместе с остальным
капсульным интеримом по мере переезда потребителей. Фаза 2 (Grafana/Prometheus
за origin) — корректно отложена до заказа на переезд observability.

**Конфиг сверен**: nginx.conf — Upgrade/Connection для HMR-websocket, SSE без
буферизации (`proxy_buffering off` + `Connection ""`), X-Forwarded-*, таймауты 1h,
«менять порт/маршрут = контракт» в шапке. Parity-фиксы brainer (нативный префикс
бэка БЕЗ root_path-хака + тест на снос корневой поверхности; vite base +
strictPort + снос двойного Vite-прокси; вариант A по VITE_API_BASE) — одобряю,
это фиксы в корне.

**DoD проверен мной живьём через gateway**: хаб `/` 200 · `/brainer/` 200 (vite
за префиксом) · `/api/brainer/sessions` 200 (реальные данные running-сессии) ·
SSE `/events` ТЕЧЁТ без буферизации (id/data кадры live). Остался один пункт —
**HMR глазами в браузере** (websocket не проверяется curl'ом): открыть
`localhost:8080/brainer/`, тронуть любой view → обновление без F5; в Network —
ни одного запроса на `:3500`/`:8000`. Исполняет user, результат — сюда строкой.

Напоминание brainer (повтор финал-ревью пересадки, всё ещё висит): `briefs/img.png`
в дереве (теперь untracked) · PAT-проба перед `pnpm install` в лаунчере ·
`WORKSPACE` из пути скрипта, не хардкод.

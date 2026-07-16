# Бриф: hub-core ядро — дверь :8080 из registry (Шаг 5.3, финал single-origin)

> **Трек:** Foundation — Шаг 5.3 (hub-core: реестр→дверь под изоляцией)
> **Адресат:** архитектор / owner **devopser** (зона `hub-core` + `stacks/gateway`)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Дизайн — settled:** `briefs/feedback-hub-core-as-hub-under-isolation.md` (DoD owner-hub-core) — исполнить его.

## North star
Любой продукт с валидным манифестом открывается через **одну дверь :8080/<name>** (+ `/api/<name>/`),
дверь собрана **из `omnifield-registry` (глоб), не fs-скан**, реестр НЕ зависит от up-состояния
(лёгший продукт держит маршрут — resolver). Наружу — только gateway. Ноль port-forward.

## Что уже готово (входы)
- **5.1/5.2 дали publish-volume:** `omnifield-registry/chater.yaml` уже лежит (валиден по Zod-контракту).
  По мере 5.2 добавятся weber/brainer. hub-core читает отсюда.
- `hub-core/generate.mjs` существует, но `buildRegistry` делает `readdirSync(WORKSPACE)` (сломан под
  изоляцией); `genNginx` ставит resolver (маршруты без up-продуктов) + `location <path> → proxy_pass
  <alias>:<port>` (**без rewrite**); gateway-compose биндит `./nginx.conf`+`./hub` (host-coupling).

## Скоуп (зона devopser/hub-core) — исполнить owner-hub-core DoD feedback-брифа
1. **Discovery = глоб registry:** `buildRegistry` читает `omnifield-registry/*.yaml` (ro-mount), НЕ
   `readdirSync(WORKSPACE)`. Валидация Zod + loud-warn по невалидному — сохранить. Last-published-wins.
2. **Rewrite `/api/<name>/` (НОВОЕ — fullstack chater):** backend слушает под нативным `/<name>/`; маршрут
   манифеста `/api/<name>` → nginx `location /api/<name>/ { proxy_pass http://<name>:<port>/<name>/; }`
   (переписать префикс). Конвенция: `/api/<name>/` → `<name>:<port>/<name>/`. Фронт-маршруты (`/<name>`) —
   pass-through как сейчас. Owner фиксирует форму (конвенция vs явное поле манифеста — минимум допущений).
3. **Дверь = volume:** генератор пишет `nginx.conf`+лендинг в door-volume; gateway-compose монтирует его
   (замена host-bind `./nginx.conf`/`./hub`). Committed `stacks/gateway/nginx.conf`+`hub/` — **ретайр**.
4. **Исполним в `omnifield-hub`:** hub-core запускается в хабе (socket/node есть, репо продуктов НЕ монтирует);
   bundle `@omnifield/contract-manifest` `dist/` в образ/пакет (развязка `file:../../knowledger`).
5. **`--check` = рантайм-идемпотентность** в хабе (регени→сравни с door-volume), не CI-шаг репо.

## Вне скоупа / хвосты (флаг)
- **Фронт-маршрут `/chater` реально серверится** только когда vite бежит; vite ещё НЕ devbox-сервис (Шаг 4
  декларировал лишь backend). Живой `/chater`-фронт = отдельный шаг (declare vite-сервис). **5.3 доказывает
  дверь + backend-маршрут** (`/api/chater`), фронт-serve — follow-on.
- Публикация contract-manifest = опц. handoff knowledger (bundle закрывает DoD).

## DoD (зона devopser/hub-core)
- [ ] `buildRegistry` глобит `omnifield-registry/*.yaml`; ноль `readdirSync(WORKSPACE)`.
- [ ] `/api/<name>/` → rewrite на `<name>:<port>/<name>/`; фронт-маршруты pass-through; resolver сохранён.
- [ ] генератор пишет door-volume; gateway монтирует его; committed nginx.conf/hub ретайрены; host-coupling снят.
- [ ] hub-core исполним в `omnifield-hub` (bundle contract-manifest), репо продуктов не монтирует.
- [ ] **Живой прог (Канал):** из `omnifield-hub` одна команда регенерит дверь из registry (сейчас chater);
      `curl -s :8080/api/chater/healthz` → **200** (backend через дверь, rewrite работает); наружу только :8080.
- [ ] PR зелёный → ревью → мерж.

## Проверка north star (перед мержем)
Реестр из fs-скана/up-состояния (маршрут моргает), дверь host-bind, `/api/<name>` без rewrite (backend
промахивается), или продукт торчит мимо :8080 — **дефект, не мержим.**

## Связь
`briefs/feedback-hub-core-as-hub-under-isolation.md` (owner-hub-core DoD — исполнить),
`briefs/hub-core-design.md` (§2 реестр, §3 дверь/resolver, §4 Канал=liveStatus).
Память: [[single-origin-only-8080]], [[container-model-and-hub]], [[architect-catch-base-defects]].

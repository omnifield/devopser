# Бриф: Шаг 5 — single-origin / дверь :8080 (сиквенс исполнения)

> **Трек:** Foundation — Шаг 5 (Single-origin / gateway). Сиквенс, НЕ редизайн.
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Дизайн — settled (не релитигируем):** `briefs/feedback-hub-core-as-hub-under-isolation.md`
> (publish-volume, user-decision 2026-07-13) + `briefs/hub-core-as-hub-under-isolation.md` (§2/границы).

## North star
Любой продукт с валидным `omnifield.yaml` открывается через **одну дверь `:8080/<name>`** (+ `/api/<name>/`),
маршруты собираются **из манифестов**, наружу — только gateway. Ноль port-forward-обходов (тот самый обход
через vite:5173). Реестр **НЕ зависит от runtime-состояния** (лёгший продукт держит маршрут — last-published).

## Что уже решено (входы для исполнителя)
- **Discovery = publish-volume** (`omnifield-registry`): продукт-devbox на старте кладёт свой `omnifield.yaml`
  → `omnifield-registry/<name>.yaml`; hub-core глобит `*.yaml` (НЕ fs-скан `/workspaces`, НЕ exec-Канал).
  Обоснование — resolver-дизайн (маршруты без up-продуктов) + разделение манифест/liveStatus. **Отклонены:**
  exec/cp из контейнеров, committed-агрегат в devopser/registry.
- **Door = volume** (не host-bind): генератор пишет `nginx.conf`+лендинг в volume, nginx его монтирует
  (замена нынешнего `./nginx.conf`/`./hub` host-coupling в `stacks/gateway/compose.yml`).
- **contract-manifest**: bundle `dist/` в образ hub-core (развязка `file:../../knowledger` — не резолвится
  под изоляцией). Публикация пакета = опц. handoff knowledger.
- **Дрейф-гейт** переезжает в рантайм (идемпотентность в хабе), committed `stacks/gateway/nginx.conf`+`hub/`
  ретайрятся как артефакт.

## Прекондишен-факт (снято через Канал 2026-07-15)
- Манифест `omnifield.yaml` есть **только у weber**. **chater/brainer/knowledger/writer — нет.** Значит без
  деклараций дверь сгенерит маршрут только weber. chater (Шаг 4: живой backend :8020 + маршрут `/chater/`,
  `/api/chater/`) **обязан задекларировать манифест**, иначе останется вне двери.
- §A publish-меха не построена → volume пуст → hub-core читать нечего.

## Порядок исполнения (по одному, тем же ритмом; каждый — своя ветка→PR→ревью→мерж)

### 5.1 — §A: skeleton publish-volume (зона devopser / owner-skeleton) — ПЕРВЫЙ, разблокирует всё
Спец — feedback-бриф §A. Devbox монтирует `omnifield-registry` (rw); на старте (postStart/entrypoint,
рядом с Шаг-4 `devbox-services up`) копирует `/workspaces/<repo>/omnifield.yaml` → `omnifield-registry/<name>.yaml`
(no-op если манифеста нет — loud-warn). Волюм — в `.devcontainer` манифест (Шаг-2 провижинер его смонтирует).
Managed → каскад-sync после.

### 5.2 — продукт-манифесты (зона каждого продукта) — пререквизит маршрутов
Каждый активный продукт декларирует `omnifield.yaml` (контракт `@omnifield/contract-manifest`, форма — как
`weber/omnifield.yaml`: `name/type/title/reach.routes[{path,port}]/integration.deps`). Приоритет — **chater**
(routes `/chater` :8020 backend + фронт-маршрут; conform `registry/ports.md`). Затем brainer.

### 5.3 — hub-core rework (зона devopser / owner-hub-core) — ядро
Спец — feedback-бриф DoD owner-hub-core. `buildRegistry` глобит `omnifield-registry/*.yaml`; генератор пишет
door-volume; hub-core исполним в `omnifield-hub` (bundle contract-manifest dist/, репо продуктов НЕ монтирует);
`--check` = рантайм-идемпотентность; committed nginx.conf/index.html удалить.

### 5.4 — contract-manifest (handoff knowledger, опц.)
Публикация `@omnifield/contract-manifest` — только если owner-hub-core выберет публикацию вместо bundle.

## DoD Шага 5 (сквозной)
- [ ] §A: publish-volume реален (devbox публикует манифест на старте); каскад-sync консюмерам.
- [ ] chater (+ активные продукты) имеют валидный `omnifield.yaml`, conform `registry/ports.md`.
- [ ] Из `omnifield-hub` одна команда регенерит маршруты+лендинг из `omnifield-registry` для всех валидных
      манифестов; лёгший продукт держит маршрут (last-published, не моргает).
- [ ] `curl -sI localhost:8080/chater/` (и `/weber`, `/brainer`) → живой маршрут; наружу только `:8080`.
- [ ] Committed nginx.conf/hub ретайрены; host-coupling gateway снят; дрейф-гейт в рантайме.
- [ ] **Живой прог (Канал):** chater открывается на `:8080/chater` без port-forward.

## Проверка north star (перед мержем каждого)
Если реестр зависит от up-состояния (маршрут моргает), дверь генерится не из манифестов, остаётся host-bind
gateway, или продукт торчит наружу мимо :8080 — **дефект, не мержим.**

## Связь
Память: [[single-origin-only-8080]], [[container-model-and-hub]], [[architect-catch-base-defects]],
[[skeleton-etalon-drift-cascade]] (§A managed → каскад), [[briefs-single-zone-dod]].

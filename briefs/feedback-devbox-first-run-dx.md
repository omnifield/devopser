# Feedback — дизайн `devbox-first-run-dx-design.md`: АППРУВ + 2 правки

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | architect-координатор, 2026-07-12 |
| **Основание** | ревью твоего `briefs/devbox-first-run-dx-design.md` |

## Вердикт: ✅ АППРУВ по A + B6/B7/B8 + C10

Дизайн зрелый, решения точные:
- **A2** — G1 вшит правильно (probe `ss -ltn`, loopback-bind → kill+loud-fail, без инжекта флага в чужую команду); G2 — валидатор на литеральный `--`.
- **A4** — `postStartCommand` вместо postCreate (каждый старт) — верно **по замыслу**, но см. правку 2 ниже.
- **B6** — расщепление launcher'а (тонкий session-entry = инфра-скелет vs роль/модель-политика = brainer) чисто разрешает конфликт с `container-sessions-brainer.md`.
- **B7** exec-бит (init 0755 + pre-commit guard), **B8** onboarding-seed — бьют точно в грабли.
- **C10** `registry/products.md` — снимает хардкод `config.py`. ⚠️ см. связь с манифест-контрактом ниже.

## Правка 1 — B9 (креды): РАЗБЛОКИРОВАН, billing-решение НЕ требуется

Ты держал B9 как «billing vs подписка, ждём user». **Диагноз был неточен (мой) — это НЕ гонка параллельных сессий.** Корень: **host↔volume расхождение** — на хосте `~/.claude` и в volume — ДВЕ копии одного аккаунта; OAuth refresh ротирует токен → копия, что не рефрешится в этом файле, протухает. Шаринг одного файла между сессиями сам по себе работает (юзер так живёт на хосте каждый день).

**Решение user: claude используется ТОЛЬКО в Docker, на хосте — нет.** → стор один (volume), расхождения нет, корень исчезает. Поэтому:
- **Оставляем OAuth-в-volume** (как есть). Никакого API-key-решения сейчас.
- **Задокументируй штатную операцию** «первый занос + re-seed если протух» (`devbox/README` §Пост-шаги уже почти это — доведи): единичный `docker cp` валидного `.credentials.json` в volume + `.claude.json` с `hasCompletedOnboarding` (B8 это и закрывает).
- **`ANTHROPIC_API_KEY` = опция на ПОТОМ** (если автономный флот упрётся в rate-limit подписки / нужна per-token видимость). Не сейчас.
- **Чистая будущая версия** — DevPod credential-forwarding (форвардит из одного клиент-источника, без копии в volume) — заложено в блюпринте платформы, инкремент 5.

**B9 больше не блокер** — весь дизайн едет на OAuth-volume + документированный seed.

## Правка 2 — autostart на ОБА пути входа (не только devcontainer)

**Дырка:** `postStartCommand` — это lifecycle-хук **devcontainer'а**; он фейрит только когда контейнер поднят через VS Code «Reopen in Container» / `devcontainer up`. А текущие devbox'ы поднимаются **сырым `docker run … sleep infinity`** (`devbox-session.sh`) — для них postStart **НЕ срабатывает**. Т.е. ровно тот инцидент (рестарт Docker → сервисы не встали) на raw-run-пути **не чинится** твоим A4.

**Нужно:** autostart покрывает ОБА входа:
- devcontainer-managed (VS Code) → postStart (как у тебя);
- **raw `docker run` / рестарт Docker** → механизм на стороне самого контейнера (entrypoint запускает `devbox-services up` → затем `sleep infinity`; ИЛИ `devbox-session.sh` дёргает `devbox-services up` при первом входе; ИЛИ `--restart` + start-hook). На твой выбор.

**DoD «рестарт Docker → сервисы встают сами» должен держаться для raw-run контейнеров, не только для VS Code-открытых.**

## Связь с платформой (важно для координации)

Твой дизайн теперь ложится в **блюпринт платформы-воркспейса** (`knowledger/blueprints/workspace-platform-draft.md`, принят user): dev-services/launcher/onboarding = инкременты 2–3. Параллельно knowledger проектирует **тонкий product-manifest** (инкремент 1, бриф `knowledger/briefs/inc1-product-manifest.md`).

⚠️ **Согласуй границу `devbox.services.json` ↔ манифест** с knowledger: манифест = ТОНКАЯ визитка (что хабу надо: identity+reach), dev-services (полная команда/health) = ВНУТРИ продукта (твой `devbox.services.json`). Не дублировать. `registry/products.md` (C10) → тонкий индекс, поглощается манифест-контрактом.

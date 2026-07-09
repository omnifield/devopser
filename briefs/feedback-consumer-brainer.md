# Feedback — пересадка brainer (потребитель №1): грабли и правки в эталон

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | brainer-архитектор, 2026-07-09 |
| **Статус пересадки** | шаги 1–3 зелёные в CI; шаг 4 локально зелёный, в CI ждёт публичности пакетов (403 до неё); PR — omnifield/brainer#8 |
| **Зачем** | репетиция отработана — здесь всё, что должно лечь в эталон и в бриф weber |

## П1. Эталон: `*.local` в gitignore-block глотает `.husky/*.local` (фикс эталона)

`packages/skeleton/files/gitignore-block:5` игнорит `*.local` (vite env) — паттерн
матчит и `.husky/pre-commit.local` / `pre-push.local`, т.е. **собственный
extension-point эталонных хуков не попадает в git у потребителя**. У brainer —
workaround: негация `!.husky/*.local` в repo-specific секции ПОСЛЕ managed-блока
(порядок важен: негация должна перекрывать паттерн). Фикс эталона: негация внутрь
managed-блока. weber наступит на это первым же синком.

## П2. Публичность пакетов и auth (правка брифов + workstation/README)

- Грант «Manage Actions access» проверяется **только на шаге 4** — до него
  `@omnifield/*` нет в lockfile, и CI зелёный даёт ложную уверенность. brainer
  поймал `ERR_PNPM_FETCH_403` на biome-preset уже после зелёных шагов 1–3.
- Решение user: пакеты становятся **публичными** → per-repo грант для CI не нужен
  (любой `GITHUB_TOKEN` читает). Прекондишн-секцию consumer-брифов обновить.
- **Локальный `pnpm install` всё равно требует PAT** (`read:packages`) — специфика
  npm-реестра GH Packages, публичность не отменяет. В `workstation/README` §пост-шаги —
  добавить копипастный образец (инцидент: токен, вписанный на место ключа, дал 401
  и засветился в выводе npm-warning'а терминала → ревок):

  ```
  @omnifield:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=<PAT c read:packages>
  ```

## П3. Бриф weber: «python-job как есть» может молча терять пакеты

У brainer локальный py-job гонял только backend — `kernel` (второй py-пакет) не
запускался в CI вообще; вскрылось на триаже пересадки, закрыто матрицей
`pkg: [backend, kernel]` (brainer `b1aa173`). В consumer-брифы: «проверь, что
локальный py/иной-стек job покрывает ВСЕ пакеты своего стека».

## П4. nx 23: `run-many` на comma-списке таргетов — молчаливый no-op

`nx run-many -t test,test:py` → «No tasks were run» (exit 0, зелёный!) — а
`nx affected -t a,b,c` коммы парсит нормально. Root-скрипты brainer были
зелёными no-op'ами. Если эталон/доки где-то советуют run-many с коммами —
заменить на space-форму (`-t test test:py`). В бриф weber — строка «проверь
root-скрипты на эту причуду».

## П5. Шаг 4: две заметки исполнителю (в текст consumer-брифов)

1. После перевода `nx.json` на `extends` — **`pnpm nx reset`**: стейлый daemon
   отдаёт «No tasks were run» до сброса (у нас это выглядело как сломанный merge).
2. biome-format по всему репо начинает видеть **codegen-артефакты** (у brainer —
   генерённые из Pydantic kernel-схемы): их исключать из `files.includes`
   (codegen output принадлежит генератору). Заметку — в README biome-preset.

## П6. Закрыто, спасибо

- gitleaks в reusable node-ci (`47d3eac`) — принято, у brainer уже гоняется.
- pre-push в managed-набор (`064677c`) — успел в наш синк, дрифта нет.

## П7. Секреты (для деплой-брифов devopser)

Флоу brainer: `docs/secrets-flow.md` (репо публичные). Ключевая просьба к деплою:
секреты приезжают **env-инжектом** из механизма devopser (GH Environments/vault),
файлы с секретами в управляемых репо не появляются никогда.

## П8 (добавлено после резолюции). Сниппет caller'а: нет `packages: read` → 403 даже на публичных пакетах

Сниппет прекондишна (`permissions: { contents: read, actions: read }`) содержит
граблю: **явный permissions-блок обнуляет все неперечисленные права**, включая
дефолтный `packages: read`. Итог: `pnpm install` в reusable ловит
`ERR_PNPM_FETCH_403` на `@omnifield/*` даже после перевода пакетов в public —
и проявляется это только на шаге 4 (до него `@omnifield/*` нет в lockfile).
brainer поймал после публичности пакетов; фикс — `packages: read` в caller
(brainer `6800299`). Поправить сниппет в consumer-брифах + README node-ci.

---

## ✅ Резолюция devopser-architect (2026-07-09) — всё принято, эталон 0.1.4

| П | Решение |
|---|---|
| П1 | ✅ Негация `!.husky/*.local` внутри managed-блока. Ваш workaround после блока можно убрать при следующем синке (дубль безвреден). |
| П2 | ✅ Прекондишн-секции обоих consumer-брифов переписаны (grant снят — пакеты публичны; PAT остаётся); `workstation/README` — копипастный образец `.npmrc` + предостережение по инциденту с токеном. |
| П3 | ✅ В бриф weber — секция «Общая проверка»: локальные джобы покрывают ВСЕ пакеты стека. |
| П4 | ✅ Грабля жила и в НАШЕМ эталоне: bootstrap-fallback обоих husky-хуков был на comma-`run-many` (молчаливый no-op) — переведён на space-форму + коммент-предупреждение. В бриф weber — проверка root-скриптов. Спасибо за поимку — это класс «зелёный, но ничего не проверил», хуже красного. |
| П5 | ✅ `nx reset` после extends-перевода — в брифы (шаг 4); codegen-исключения — README `@omnifield/biome-preset` (создан). |
| П7 | ✅ Канон уже зафиксирован (CLAUDE.md POLICY + ARCHITECTURE, коммит `47d3eac`): env-инжект only, секция секретов обязательна в каждом деплой-брифе. `docs/secrets-flow.md` brainer возьму источником при первом деплой-брифе. |
| П8 | ✅ (2026-07-10) `packages: read` добавлен в caller-сниппеты (workflows/README, consumer-brainer, собственный dogfood-caller devopser) + отдельная грабля в README: явный permissions-блок обнуляет дефолты, а 403 проявляется только с попадания пакетов в lockfile. Бриф weber не трогаю — моменты копятся до его подготовки (решение user); его сниппеты ссылаются на README, так что фикс он получит оттуда. |

`@omnifield/skeleton` **0.1.4** опубликован — ваш шаг 4 в CI разблокируется
публичностью пакетов; при следующем синке приедут П1+П4 фиксы (drift-check
подсветит — это by design).

# @omnifield/skeleton — эталон вендоренных файлов + init/sync/drift-check

Repo-skeleton D3 (`briefs/repo-skeleton-product.md`) + стек-осознанность
(`briefs/skeleton-stack-aware-sync.md`, Шаг 1). Файлы, обязанные лежать копией
в каждом продукт-репо, живут эталоном в `files/`; `init.mjs` их материализует,
синкает и сверяет — **по СТЕКУ репо**, не по имени. Zero-deps (только `node:*`).

## Рамка = `template.json` (декларация, не хардкод)

Состав рамки — **что managed** (drift-fail, уехать нельзя), **что init-only** (сид, репо
легитимно правит), per-stack, CI-caller'ы — объявлен декларативно в **`template.json`**
(DEVOPSER-95: темплейт = жёсткая рамка). `init.mjs` этот манифест **читает и исполняет**,
а не хардкодит — рамка есть контракт-данные, `init.mjs` — исполнитель. Расширить/сузить
рамку = правка `template.json` (через architect — это контракт потребителей), не патч логики.

| Ключ | Что объявляет | Режим (`mode`) |
|---|---|---|
| `managed[]` | `{src,dest,exec?}` — точная копия эталона; `exec:true` → `0755` | `exact` |
| `block[]` | splice managed-блока в файл, который репо ТОЖЕ правит (`.gitignore`) | `block` |
| `pins[]` | merge отдельных ключей (`package.json`: `packageManager`+`engines.node`); `stack` гейт | `pins` |
| `templates.common[]` · `templates.node[]` · `templates.go[]` | init-only шаблоны per stack (создаются, если нет; НЕ drift) | `seed` |
| `ci.jobs.{go,node,frontend}` · `ci.permOrder[]` | CI-caller per stack + канон-порядок `permissions` | (вычисляемый seed) |
| `presets{}` | биндинг слот → `@omnifield/X-preset@^ver` (DEVOPSER-98) | — |

Тест `test.js` (`node --test`) сторожит инварианты: «манифест = источник рамки» (init
материализует ровно объявленный состав; drift-check краснеет на уехавшем `managed`, не на
правке init-only) и «mode диспатчится» (block splice сохраняет строки репо; pins merge —
прочие ключи).

## Режимы применения (`mode`)

**КАК** файл кладётся объявлено явно в `template.json` (`mode` у каждой записи, DEVOPSER-99);
`init.mjs` **диспатчит** по `mode` (хендлеры), а не по тому, в каком массиве запись. Режимы —
это граница «рамка enforced (DEVOPSER-95) vs сид, который репо докручивает»:

| `mode` | Что делает | Drift-check | Пример |
|---|---|---|---|
| `exact` | точная копия эталона; `exec:true` → бит `0755` | **краснеет** на любом расхождении (уехать нельзя) | `.husky/*`, `scripts/devbox-*`, `.editorconfig` |
| `block` | splice managed-блока между маркерами в co-owned **текст** (репо ТОЖЕ правит) | **краснеет** только на managed-блоке (свои строки репо не трогаются) | `.gitignore` |
| `merge` | JSON-aware deep-merge managed-фрагмента в co-owned **JSON** (репо ТОЖЕ правит) | **краснеет** только на листьях фрагмента (прочие ключи — зона репо) | `.devcontainer/devcontainer.json` (канон-инфра-фрагмент, DEVOPSER-187) · `.claude/settings.json` (`hooks`-фрагмент) |
| `pins` | merge отдельных ключей; остальной файл — зона репо | **краснеет** только на этих ключах | `package.json` (`packageManager`+`engines.node`) |
| `seed` | создать, только если отсутствует | НЕ drift — репо легитимно правит | `nx.json`, `biome.json`, `.golangci.yml`, `.devcontainer/*` |

`exact`/`block`/`merge`/`pins` — **рамка** (enforced, drift-fail на своей части). `seed` — **докрутка**
(дефолт-сид, дальше зона репо/пресета). `block`/`merge`/`pins` остаются код-хендлерами (splice/deep-merge —
не чистые данные): `block` правит co-owned текст, `merge` — co-owned JSON-структуру, `pins` —
захардкоженные ключи; `mode` лишь **выбирает** хендлер. Расширить рамку новым режимом = добавить
хендлер в `DISPATCH` + объявить `mode` у записей, не ветвить логику по имени файла.

**`.devcontainer/devcontainer.json` — seed + merge (DEVOPSER-187).** Файл ОДНОВРЕМЕННО `seed` (init-only
полный шаблон для чистого репо) и `merge` (managed канон-инфра-фрагмент: `omnifield-secrets`/pnpm/
`omnifield-registry` mounts + `containerEnv`-wiring `CLAUDE_CONFIG_DIR`/`NPM_CONFIG_USERCONFIG`/
`GIT_CONFIG_GLOBAL`/`GH_CONFIG_DIR` + `--add-host`). seed создаёт файл на чистом репо; **merge КАСКАДИТ
канон-инфру стоячим потребителям** (устаревший манифест без secrets/env → drift-check краснеет → `init`
синкает) — схлопывает рассинхрон «манифест ↔ живой контейнер» (гага DEVOPSER-188). Порядок в `init`:
seed → merge (на fresh значения совпадают → merge no-op; в `--check` seed отключён → merge валидирует
фрагмент). Workspace-том, network/alias/restart — **НЕ в манифесте** (ставит провизионер `devbox.sh`,
канон-инвариант; VS Code «Reopen in Container» — деградированный fallback, gateway-сеть довешивает
`devbox-session.sh`). Целевой `devcontainer.json` должен быть чистым JSON (не JSONC — `applyMerge` =
`JSON.parse`).

**array-UNION для co-owned массивов (`mounts`/`runArgs`, DEVOPSER-191).** По умолчанию `merge` трактует
массив как лист → **replace** (верно для скалярных списков — `containerEnv`-ключи, `hooks`-строки). Но
`mounts`/`runArgs` **co-owned**: канон-инфра каскадится merge'ом, а продукт держит СВОИ элементы
(напр. tasker mount `tasker-data → /data/tasker`). Replace убил бы продуктовые. Поэтому такие массивы
помечаются **`unionArrays`** в merge-элементе `template.json` — они мержатся **UNION по ключу элемента**
(managed канон-элементы энфорсятся, продуктовые сосуществуют и **НЕ дрейфят**):

```jsonc
{ "src": "devcontainer-fragment.json", "dest": ".devcontainer/devcontainer.json",
  "mode": "merge", "unionArrays": ["mounts", "runArgs"] }
```

Ключ идентичности per-массив (`ARRAY_IDENTITY` в `init.mjs`): `mounts` → точка монтирования
(`target=`/`destination`; совпал target → managed-форма авторитетна, энфорс канон-mount), `runArgs` →
флаг-ключ (`--add-host=…` → `--add-host`). Union **сохраняет порядок потребителя** (managed-элемент
in-place, недостающие managed — в конец) → идемпотентен. **Drift краснеет ТОЛЬКО** если managed-элемент
отсутствует/отличается; продуктовые элементы вне managed-set — не дрейф. Массив БЕЗ `unionArrays` —
прежний replace (managed-лист авторитетен). NB: канон-сторож `devbox-manifest.mjs` всё равно фейлит
`--network`/`-p`/`-P` в `runArgs` — union его не отменяет.

## Пресет-контракт (`slot` → пресет, DEVOPSER-98)

Пресет = **дефолты ВНУТРИ рамки** (DEVOPSER-95): именованные версионированные значения крутилок,
которые config-шаблон `extends`/`import`'ит, а продукт докручивает точечно. `slot` рамки (`nx`,
`biome`, `vite`, …) наполняется конкретным пресетом. Контракт **общий** — под будущие
git-flow/release-пресеты (DEVOPSER-108), не только repo-config.

**1. Метаданные пресета** — блок `omnifield` в `package.json` пресета (единый источник):

```json
"omnifield": { "kind": "preset", "slot": "nx", "stack": "node", "mechanism": "extends", "target": "repo-config" }
```

| Поле | Что |
|---|---|
| `kind` | `preset` (отличие от будущих `kind`-ов рамки) |
| `slot` | какой слот рамки наполняет (`nx`/`biome`/`vite`/…) |
| `stack` | где валиден: `node`\|`go`\|`frontend`\|`any` (или массив) — для валидации «в рамке» |
| `mechanism` | как потребляется: `extends` (nx/biome) \| `import` (vite) \| `read` (git-flow — читается тулингом) |
| `target` | КАТЕГОРИЯ настраиваемого: `repo-config`\|`release`\|`git-flow` (см. «Таргеты пресетов») |

Текущие пресеты: `@omnifield/nx-preset` (slot `nx`, stack `node`, extends) · `@omnifield/biome-preset`
(slot `biome`, stack `node`, extends) · `@omnifield/vite-preset` (slot `vite`, stack `frontend`, import) ·
git-flow (slot `git-flow`, stack `any`, read — первый не-repo-config таргет, DEVOPSER-103) — доставляется
НЕ npm, а вендоренным managed-файлом `git-flow.json` (language-agnostic, DEVOPSER-113; см. ниже).

**2. Биндинг `template.json.presets`** — слот → `@omnifield/X-preset@^ver`: рамка знает свои
пресеты по `name@version` (композиция ссылкой, не копией — направление consumer→provider,
DEVOPSER-108), а не имплицитом в `extends`-строке конфига. Версия пиннится, `stack`/`slot`/
`mechanism` объявляет сам пресет (не дублируется в биндинге).

```json
"presets": {
  "nx":    "@omnifield/nx-preset@^0.1.1",
  "biome": "@omnifield/biome-preset@^0.1.1",
  "vite":  "@omnifield/vite-preset@^0.1.0"
}
```

**3. Валидация «пресет в рамке»** (`init.mjs`, hard-гейт в **init И `--check`**): пресет не выходит
за рамку (DEVOPSER-95). Для каждого bound-пресета:
- **slot-консистентность**: `slot` биндинга обязан совпасть со `slot`, объявленным пресетом
  (`kind` тоже сверяется);
- **stack в рамке**: если конфиг слота **присутствует** в репо, declared `stack` пресета обязан
  быть совместим со стеком репо (`any` или пересечение) — иначе **loud-fail, exit 1**
  (node-пресет на go-репо = вне рамки). Метаданные резолвятся из `node_modules` потребителя
  (после install) → `packages/<name>` клона devopser; не резолвится (до install) — best-effort,
  жёсткий гейт живёт в CI `--check`, где зависимости стоят.

## Таргеты пресетов (`target`, DEVOPSER-101)

**`target` = КАТЕГОРИЯ того, что пресет настраивает** — ось группировки слотов (не путать: `slot` =
конкретный конфиг `nx`/`biome`/`vite`; `target` = его класс). Движок **target-general**: новый класс
пресетов подключается ДЕКЛАРАЦИЕЙ `target`, а не спецкейсом в `init.mjs`.

Таксономия объявлена в `template.json.targets` (известные таргеты = ключи; статус — значение):

| `target` | Статус | Что |
|---|---|---|
| `repo-config` | `active` | конфиги репо — движок обрабатывает (слоты `nx`, `biome`, `vite`) |
| `release` | `declared` | plug-in точка (пусто) — под будущее |
| `git-flow` | `bound` | вендоренный `git-flow.json` привязан+валидируется; инструмент+rulesets по нему уже есть |

Статус: **`active`** = движок обрабатывает; **`bound`** = пресет привязан и валидируется, но
процессор (материализация/тулинг) ещё не построен; **`declared`** = пустая plug-in точка. `init.mjs`
валидирует declared `target` пресета против таксономии: **unknown target → loud-fail** (в init и
`--check`), и репортит группировку (`[skeleton targets] repo-config: nx, biome, vite | release: — |
git-flow: git-flow`).

**git-flow подключён декларацией, не кодом (DEVOPSER-103):** метаданные (`omnifield.target:
"git-flow"`, `slot: "git-flow"`, `stack: "any"`, `mechanism: "read"` — пресет ЧИТАЕТСЯ тулингом,
расширяет enum `extends`\|`import`\|`read`) + `frame`/`defaults` живут в **`git-flow.json`**; движок
валидирует их (target из таксономии, mechanism из enum) — **без нового спецкейса в init**.

**Доставка — вендоринг, не npm (DEVOPSER-113):** `git-flow.json` — **managed вендоренный файл**
(`mode:exact`, как `git-flow.mjs`), init синкает его в **любой** репо любого стека (go-primary/
polyglot тоже) — **language-agnostic, ноль node_modules**. Пилот tasker вскрыл: npm-доставка
(`@omnifield/git-preset`) не долетала до go-репо без root `package.json`. npm-пакет **ретайрен**;
версионирование git-flow = managed drift (bump эталона → drift-check краснеет → sync).
repo-config пресеты (nx/biome/vite) остаются npm — это JS-тул-конфиги, нужны только JS-репо.

Пресет-контракт (метаданные + валидация «в рамке») — **общий**, поэтому git-flow ложится на тот
же движок, что repo-config (композиция DEVOPSER-108).

## Plugin-контракт — внешние продукт-owned капабилити (DEVOPSER-108, knowledger `DEVOPSER-6`)

Рядом с **template** (рамка) и **preset** (дефолты слота) — третий примитив **plugin**: НОВАЯ
капабилити **СНАРУЖИ**, которую продукт-провайдер (напр. brainer) публикует сам, а движок
материализует **вслепую** через тот же `DISPATCH`. devopser = фреймворк над репозиториями: ядро +
плагины. Потребитель #1 — agent-harness (`BRAIN-8`).

**preset vs plugin:**

| | preset | plugin |
|---|---|---|
| Что | дефолты ВНУТРИ рамки (nx/biome/vite/git-flow) | НОВАЯ капабилити СНАРУЖИ |
| Владелец контента | devopser (`files/`) | продукт-провайдер (его пакет) |
| Таксономия `target` | закрытая (ключи `template.json.targets`) | ОТКРЫТАЯ (admit регистрацией) |
| `mechanism` | **есть** — как потребляется тулингом (`extends`\|`import`\|`read`) | **нет** — материализацию несёт per-entry `frame[].mode` |
| Приносит контент | нет (конфиг-слот) | да (`contentRoot` + `frame`) |

**Метаданные плагина** — обобщённый `omnifield`-блок (тот же `validateMeta`, что у пресета):

```jsonc
{ "omnifield": {
  "kind": "plugin",            // ветка валидации (∈ {preset, plugin})
  "target": "agent-harness",   // категория капабилити; ОТКРЫТАЯ таксономия
  "stack": "any",              // node|go|frontend|python|any — совместимость с репо
  "contentRoot": "harness",    // папка контента ВНУТРИ пакета плагина (корень для src)
  "frame": [                   // фрагмент рамки — БАЙТ-В-БАЙТ shape записи template.json
    { "src": "roles/architect.md", "dest": ".claude/agents/architect.md", "mode": "exact" },
    { "src": "hooks/scope.mjs",    "dest": ".claude/hooks/scope.mjs",     "mode": "seed"  }
  ] } }
```

**Биндинг — в манифесте потребителя `omnifield.yaml`** (ЕДИНСТВЕННЫЙ путь для чужих продуктов;
истина в манифестах, DEVOPSER-135). `template.json.plugins` — ТОЛЬКО self-dogfood devopser на
своём репо (публикуется `null`):

```yaml
# omnifield.yaml потребителя (зона потребителя, не devopser-owned template.json)
plugins:
  - "@brainer/agent-harness-plugin@^0.1.0"
```

Поле `plugins` — часть manifest-контракта (`@omnifield/contract-manifest`, `ProductManifest`).

**Двойная доставка (language-agnostic, как git-flow DEVOPSER-113):**
- **npm** — пакет в `node_modules` потребителя, метаданные из `package.json.omnifield` (JS-репо);
- **вендор** — бандл вендорится файлами, метаданные из `plugin.json.omnifield` (go/не-npm репо,
  куда npm не долетает). Конвенция: `.omnifield/plugins/<localName>/plugin.json` + контент рядом.

**Поток в движке (ноль знания, что это плагин):**
1. `init.mjs` читает `omnifield.yaml` (∪ `template.json.plugins`) → список плагинов;
2. резолвит пакет (npm ИЛИ вендор) → `omnifield` → **`validateMeta(kind:plugin)`** (contentRoot +
   frame обязательны; stack совместим с репо) — **ДО материализации** (контракт-first: невалидный
   плагин не грузится, его контент не заезжает);
3. **регистрирует `target`**: `knownTargets` = core ∪ таргеты забинженных плагинов (ОТКРЫТАЯ
   таксономия; коллизия plugin-target ↔ core → **loud-fail**);
4. каждую `frame`-запись гонит через **тот же `DISPATCH`** по `mode`, но `readEtalon` берёт `src`
   из **корня контента ПАКЕТА плагина** (`contentRoot`), не из `files/` devopser;
5. **drift** managed-записей плагина краснеет против **эталона ПЛАГИНА** (пакет + его версия), не
   против devopser (SoT атрибутирован в отчёте: `(SoT: эталон плагина @scope/name@^ver)`).
   Version-guard warn'ит, если установленная версия ниже пина `omnifield.yaml` (реюз DEVOPSER-100).

**Границы (канон, без компромиссов):** ноль хардкода чужого в движке (`if (target === '...')`
запрещён); контент плагина в репо devopser **НЕ заезжает**; незарегистрированный/коллизийный target
→ loud-fail (init И `--check`); движок остаётся **agent-agnostic** (ноль ролей/акторов/прав). Для
своих тестов/e2e devopser использует минимальный **fixture-плагин** (тест-дубль по контракту) —
реальный бандл провайдера в devopser-репо не заводится.

## git-инструмент (`scripts/git-flow.mjs`, DEVOPSER-106)

Managed-скрипт (mode `exact`, вендорится+drift как `devbox-*`), который **ЧИТАЕТ** вендоренный
`git-flow.json` (локальный, любой стек — DEVOPSER-113) и делает полный луп git без ручных команд.
Zero-dep — шелл `git`+`gh`.
Все политики — из пресета; хардкода флоу нет.

| Субкоманда | Что | Из пресета |
|---|---|---|
| `start <type>/<slug>` | ветка ОТ `origin/main` (свежий `fetch` — не от грязного local, урок PR#26) | `defaults.branchNaming` (валидация имени) |
| `commit <msg>` | коммит | `defaults.commitConvention` (валидация; сабж со строчной `^[a-zа-яё]` — Latin ИЛИ кириллица, зеркало CI `pr-title.yml`, DEVOPSER-130) · `frame.mainProtected` (блок коммита в main) |
| `push` | push ветки в origin | `frame.mainProtected` |
| `pr [--title --body]` | открыть PR (`gh`, `--base main`); ВСЕГДА валидный non-interactive вызов — title И body удовлетворены (недостающее выводится из коммитов ветки, DEVOPSER-129) | — |
| `land` | включает AUTO-MERGE (`gh pr merge --auto`) и возвращается сразу — GitHub домержит по зелёным required-checks + удалит ветку (DEVOPSER-157) | `frame.prRequired` (нужен OPEN PR) · `defaults.merge` |
| `sync` | локальный `main` = `origin/main` | — |
| `rulesets [--apply]` | материализует GitHub-rulesets + repo-settings (squash-only + auto-merge) из пресета (дефолт: check-дрейф) | `frame.mainProtected`/`prRequired` · `defaults.requiredChecks` · `defaults.merge` · `defaults.repoSettings` |

`--dry-run` печатает намеренные мутации (`git`/`gh` write), не выполняя. **agent-agnostic:**
инструмент про «кого» НЕ знает — ноль owner/ролей/прав/gate; кто вызывает = концерн потребителя.

### `rulesets` — enforcement из пресета (DEVOPSER-110)

Единый источник enforcement = git-пресет (замещает ручные GitHub-rulesets — второй источник правды).
Читает пресет + фактические проверки репо → desired ruleset-спека:

- `frame.mainProtected` → защита ветки по умолчанию (правила `deletion` + `non_fast_forward`);
- `frame.prRequired` → правило `pull_request` (мерж только через PR);
- `defaults.requiredChecks: "from-stack"` → `required_status_checks` (**strict OFF**, DEVOPSER-157 —
  auto-merge не требует «ветка up-to-date с base») с контекстами = **РЕАЛЬНЫМИ
  именами check-run'ов default-ветки** (`gh api repos/…/commits/<default>/check-runs` →
  `.check_runs[].name`; DEVOPSER-117). GitHub именует проверки reusable-caller'ов `'<job> / <inner>'`
  (напр. `'go / Go (build·vet·test)'`) — голых ключей job'ов (`go`/`web`) в контекстах НЕТ, поэтому
  ruleset ждёт именно реальные строки, иначе main залочен при зелёных. Ground truth,
  самокорректируется. Прогонов ещё нет → **loud-warn** (required-checks пуст, не молча ключи);
- `pull_request.required_approving_review_count = 0` (DEVOPSER-157): автор PR не может сам его
  апрувнуть (GitHub self-approve запрещён), одиночный флоу → потребуй ≥1 ревью и auto-merge застрянет
  без апрувера. Гейт качества = required-checks, не человеко-ревью.

**Repo-settings (DEVOPSER-157).** Auto-merge требует repo-level настроек, которых ruleset не
покрывает — материализуются тем же `rulesets` (`PATCH repos/{nwo}`): **squash-only** (методы мержа
дерайвятся из `defaults.merge` — единый источник, `squash` → только `allow_squash_merge`) +
`allow_auto_merge` (`defaults.repoSettings.autoMerge`, иначе `gh pr merge --auto` падает) +
`delete_branch_on_merge`. Дрейф repo-settings ловит тот же `rulesets` (check).

**`rulesets`** (дефолт) — check: текущие GitHub-rulesets + repo-settings vs desired → **loud-fail
при дрейфе** (гейт против ручного расхождения). **`rulesets --apply`** — идемпотентный apply:
`PATCH repos/…` (repo-settings) + `gh api repos/…/rulesets` (`POST` если нет, `PUT` если есть).

**Admin-токен** (apply меняет настройки репо → нужен scope `administration:write`): **env-инжект**
(`gh` читает `GH_TOKEN`), секрет **НЕ хардкодится**. `apply` трогает GitHub-настройки — на СВОЁМ
репо; раскатка на чужие продукты = отдельный rollout-шаг. Это ИНСТРУМЕНТ (скриптованные операции),
не agent-политика.

## Версионирование пресетов + bump-дисциплина (DEVOPSER-100)

**`template.json.presets` = ЕДИНЫЙ источник версий пресетов.** Consumer-деп (`@omnifield/*` в
`package.json` потребителя) **дерайвится из биндинга**, а НЕ хардкодится: `package-template.json`
несёт ключи пресет-деп с плейсхолдером `__PRESET_VERSION__`, `init.mjs` подставляет ранг из
биндинга на материализации.

**Propagation через drift-гейт, не пассивный caret.** `@omnifield/*` preset-деп потребителя —
managed (`pins`-режим `package.json`): его ранг сверяется с биндингом. Bump биндинга →
у потребителя `--check` **краснеет** (`@omnifield/nx-preset: ^0.1.1 → ^0.1.2`) → чинится `init`'ом.
Локальные протоколы (`workspace:*`/`link:`/`file:`) НЕ трогаются — монорепо devopser сам линкует
пресеты воркспейсом, это не версионный пин.

**Version-guard** (расширение K2 за пределы skeleton): если УСТАНОВЛЕННАЯ версия пресета
(`node_modules/@omnifield/X-preset`) **ниже** биндинга — `init`/`--check` печатают warn
(`[skeleton preset-version] … установлено 0.1.0 < биндинг ^0.1.1 — обнови`). Best-effort (только
когда пресет реально установлен); жёсткий гейт расхождения ранга — drift-check выше.

**Bump-дисциплина (один edit-point).** Поднять версию пресета =
1. `version` в `packages/<preset>/package.json` (эталон);
2. ранг в `packages/skeleton/template.json` → `presets` (единый реестр).

Оба — в одном PR (иначе биндинг разъедется с публикуемой версией). Публикация — существующим
`pnpm -r publish` (release-workflow, GitHub Packages `npm.pkg.github.com`); версия = `package.json`
пресета, бамп **ручной**, zero-dep (без changeset/nx release). Потребители подтягиваются сами:
их `--check` краснеет на новом ранге → `init` синкает. Расширение publish-механизма (release.yml)
— контракт вне зоны skeleton → к architect.

## Стек репо (node / go / frontend / python)

`init.mjs` ветвится по стеку, не по имени продукта. Стек — из
`platform/repo-flow.json` (`"<repo>": { "stack": ["go","frontend"] }`); при отсутствии
записи (или запуске из published-пакета, где `platform/` нет) — **фолбэк-детект по фактам**
(`go.mod`→go, `package.json`→node, `pyproject.toml`\|`uv.lock`→python). Источник правды — конфиг.
Голый репо (ни `go.mod`/`package.json`/`pyproject.toml`, ни записи в `repo-flow.json`) → **loud WARN
в stderr** (стек не объявлен) + node-дефолт для обратной совместимости — не молчаливый мисдетект
(DEVOPSER-131).

`node` и `frontend` РАЗВЕДЕНЫ: `node` = nx-монорепо (корневые pnpm+nx), `frontend` =
standalone-фронт (свой pnpm-воркспейс, vite, БЕЗ nx — свои конфиги в воркспейсе). `python` —
аддитивен и **полиглотен** с node (brainer = node+python nx-монорепо с py-пакетами, DEVOPSER-159).

| Стек | Что раскатывается сверх общего набора |
|---|---|
| `node` (nx-монорепо) | `.husky/*` (nx-хуки: sherif / nx affected) · `nx.json` · `biome.json` · `.github/dependabot.yml` · `package.json` (+пины) · CI-caller `node` job (`node-ci.yml`) |
| `frontend` (standalone) | CI-caller `web` job (`web-ci.yml`) + `working-directory` из `repo-flow.json`; корневой nx-набор НЕ навязывается (у фронта свои конфиги) |
| `go` | `.golangci.yml` · `sqlc.yaml` (init-only, продукт правит) · CI-caller `go` job (`go-ci.yml`) |
| `python` (uv) | `pyproject.toml` (ruff/uv-пин канон) · `.python-version` (init-only seed, как biome.json — repo-owned, `uv.lock`+исходники тоже) · CI-caller `python` job (`python-ci.yml`) |
| любой | `.editorconfig`/`.gitattributes`/`.npmrc`/`devbox-*`/`.gitignore`-блок/`.devcontainer`/`devbox.services.json` · `pr-title.yml` |

`.husky/*` — node-only: хуки гоняют `pnpm sherif` / `pnpm nx affected` (валидны лишь в nx-монорепо);
go/frontend их НЕ несут (иначе drift-red / падающий хук). `.devcontainer` — общий, но его `postCreate`
стек-зависим: npm-whoami-гейт + `pnpm install` — только node/frontend, go-devcontainer без npm/pnpm.

**Python-канон (DEVOPSER-159, промоушен прототипа brainer).** `python-ci.yml` зеркалит
go/node-ci: `setup-uv` (версия uv — из пина вызывателя через `version-file: pyproject.toml`
`[tool.uv] required-version`, НЕ хардкод) → `uv sync --dev` → `ruff check` → `pytest -q`, matrix по
py-пакетам (input `packages`, дефолт `["."]`; uv-workspace докручивает в своём init-only ci.yml).
Конфиг-канон (ruff-правила E/F/W/I/UP/B, line 120, py312 + uv-пин + `.python-version` 3.12) едет
**seed**'ом (init-only, как `biome.json` — repo-owned, НЕ exact/drift); `uv.lock` и исходники —
repo-owned. nx-таргеты `test:py`/`lint:py` + `pythonSources` namedInput — в `@omnifield/nx-preset`.

Мульти-стек (напр. `["go","frontend"]` или `["node","python"]`) — объединение: `ci.yml` получает все
job'ы, `permissions` — объединение канонов reusable (`go`: `contents:read`; `frontend`:
`contents:read` + `packages:read` (тянет @omnifield-пресеты из GitHub Packages); `node`: +
`actions:read` + `packages:read`; `python`: только `contents:read` — deps из PyPI, без nx-set-shas).
Frontend-конфиг в `repo-flow.json`: `"<repo>": { "stack": ["frontend"], "frontend": { "working-directory": "web" } }`.

## Команды

```sh
# новый репо (или синк существующего — идемпотентно):
node <devopser>/packages/skeleton/init.mjs <target>
# или после publish, из корня целевого репо — ВСЕГДА с явной версией
# (К2 фидбека brainer: GH Packages может отдать stale dist-tag, и старый
# синк тихо откатит эталон; версия — packages/skeleton/package.json):
pnpm dlx @omnifield/skeleton@<версия>

# drift-check (то, что гоняет шаг reusable CI; exit 1 при дрейфе):
node <devopser>/packages/skeleton/init.mjs --check <target>
```

## Managed-набор (сверяется drift-check'ом)

| Файл | Режим |
|---|---|
| `.editorconfig` · `.gitattributes` · `.npmrc` | точная копия эталона |
| `.husky/pre-commit` · `.husky/pre-push` | точная копия эталона — **node-only** (nx-хуки; go/frontend не несут) |
| `scripts/devbox-services.mjs` · `scripts/devbox-session.sh` · `scripts/devbox.sh` · `scripts/recover.sh` · `scripts/devbox-manifest.mjs` · `scripts/devbox-publish.mjs` · `scripts/git-flow.mjs` | точная копия эталона (`.sh` — с exec-битом `0755`, см. ниже; `git-flow.mjs` — git-инструмент, DEVOPSER-106; `recover.sh` — ordered bring-up, DEVOPSER-188) |
| `git-flow.json` | вендоренный git-flow-пресет (language-agnostic, любой стек; DEVOPSER-113) — точная копия эталона |
| `.gitignore` | managed-блок между маркерами `>>> omnifield-skeleton` — ниже блока репо дописывает своё |
| `.devcontainer/devcontainer.json` (**merge-фрагмент**) | канон-инфра (secrets/pnpm/registry mounts + containerEnv-wiring + `--add-host`) — deep-merge managed-фрагмента (DEVOPSER-187/170); краснеет только на листьях фрагмента, продукт-ключи (image/postCreate/customizations) — зона репо. Сам файл ТАКЖЕ seed (init-only полный шаблон) |
| `package.json` | пины `packageManager` + `engines.node` равны эталону |

`nx.json` / `biome.json` / `.devcontainer/devcontainer.json` / `devbox.services.json` /
`.golangci.yml` / `sqlc.yaml` / CI-caller'ы (`.github/workflows/ci.yml` + `pr-title.yml`) /
остальной `package.json` — создаются init'ом из шаблонов (только если отсутствуют), но
НЕ drift-managed: репо легитимно расширяет пресеты (пример: python-таргеты brainer поверх
`@omnifield/nx-preset`; набор dev-сервисов в `devbox.services.json` = зона продукт-owner'а;
пути/движок БД в `sqlc.yaml` — зона go-owner'а). CI-caller'ы init-only, чтобы догфуд-ci
devopser (локальный `uses: ./...`) не конфликтовал с раскатанным `@main`-caller'ом.
Плейсхолдер `__NAME__` в шаблонах init заменяет на `basename` репо (`package.json` name).
**Исключение — `.devcontainer/devcontainer.json`:** его ТЕЛО seed (init-only, продукт правит
image/postCreate/customizations), но **канон-инфра-фрагмент** (secrets/pnpm/registry mounts +
`containerEnv`-wiring + `--add-host`) — **merge-managed** (drift-caskad, DEVOPSER-187; см. «Режимы»).

## Dev-сервисы + вход агентом (brief `briefs/devbox-first-run-dx-design.md`)

Скелет раздаёт **механизм** жизненного цикла dev-сервисов devbox; продукт только **декларирует**:

- **`devbox.services.json`** (TEMPLATE, init-only) — декларация сервисов продукта: `name` · `cwd` ·
  `command` · `port` (+ опц. `healthUrl`). `name` = join-key с product-manifest
  (`reach.routes[].service`); `port` шлюзо-видимого сервиса = `reach.routes[].port` (single-origin —
  апстрим по docker-сети `<alias>:<port>`, наружу не публикуется).
  **Шаблон init'а = `[]`** (пустая декларация → autostart = тихий no-op): набор сервисов пишет
  продукт, скелет не навязывает чужие. Форма записи (JSON комментариев не держит — образец тут):

  ```jsonc
  [
    // published-сервис ОБЯЗАН bind 0.0.0.0 (G1: сосед по docker-сети не видит 127.0.0.1 → 502);
    // command БЕЗ литерального ` -- ` перед --host/--port (G2: pnpm/npm глотают его в свой парсер);
    // name = docker-network-alias = join-key манифеста (liaison-inc1-manifest-boundary.md).
    { "name": "backend",  "cwd": "packages/backend",  "command": "uv run uvicorn app.main:app --host 0.0.0.0 --port 8010", "port": 8010, "healthUrl": "http://localhost:8010/health" },
    { "name": "frontend", "cwd": "packages/frontend", "command": "pnpm run dev --host 0.0.0.0",                              "port": 3500 }
  ]
  ```
- **`scripts/devbox-services.mjs`** (MANAGED, zero-deps) — оркестратор: `up`/`start`/`stop`/`restart`/
  `status`/`run`/`logs`. Детач-старт (интерактив сохранён), pidfile+лог в `~/.devbox/`. Вшиты два
  loud-fail'а: **G1** (сервис слушает `127.0.0.1` вместо `0.0.0.0` → сосед по docker-сети не
  достучится, 502 → kill + fail-at-startup) и **G2** (литеральный ` -- ` перед `--host`/`--port`).
- **`scripts/devbox-session.sh`** (MANAGED, exec `0755`) — вход одной командой: `devbox-session.sh
  [scope]` резолвит devbox-контейнер репо → `docker exec -it -e OMNIFIELD_SCOPE=<scope> … claude`,
  дёргает idempotent `devbox-services up` (safety-net). Тонкая session-entry, контейнер НЕ создаёт.
- **`scripts/devbox.sh`** (MANAGED, exec `0755`) + **`scripts/devbox-manifest.mjs`** (MANAGED, zero-deps)
  — headless-провижинер под **VOLUME-workspace-модель** (DEVOPSER-188, ADR-16): `devbox.sh up|down|
  recreate <repo>` поднимает/пересоздаёт devbox ОДНОЙ командой (containers-only, ноль ручных
  `docker run`). Рабочая копия репо живёт в **named-volume `<repo>-workspace`** (ext4), НЕ в host-bind
  папке WSL — на хосте кода репо больше нет (истина в томе). Свежий/пустой том **наполняется
  git-клоном** (bootstrap-контейнер; creds gitconfig/gh из тома `omnifield-secrets`), затем `chown`
  на vscode(1000) (свежий named-том root-owned — гага пилота brainer). `<repo>` = **аргумент**
  (имя тома/сети-alias/контейнера), НЕ `basename(pwd)`. Манифест ЧИТАЕТСЯ **ИЗ ТОМА** — провижн не
  дублирует ручной `docker run`. Канон-инвариант (workspace-том → `/workspaces/<repo>`, сеть gateway
  alias=имя, `--restart unless-stopped`, ноль host-портов) ставит сам провизионер; продукт-переменное
  (image/containerEnv/mounts/hooks) — из манифеста, который парсит `devbox-manifest.mjs`. `down`/
  `recreate` том/данные (workspace/secrets/pnpm) сохраняют; повторный `up` — no-op (том не переклонивается).
  **fail-loud ext4-guard** (ЯДРО анти-инцидента 2026-07-24): после `up` сверяет `findmnt` `/workspaces/
  <repo>` — `tmpfs` ИЛИ пустой том → НЕ оставляет тихую пустышку, падает громко + подсказывает
  `recreate` (гонка host-bind→tmpfs схлопывается сама: том всегда ext4; guard — страховка + ловит
  деградацию). Тест-хуки: `DEVBOX_DRY_RUN=1` (печать docker-команд), `DEVBOX_EMITTER_LOCAL=1` (эмиттер
  из host-манифеста), `DEVBOX_BOOTSTRAP_IMAGE` (образ клона/эмиттера).
- **`scripts/recover.sh`** (MANAGED, exec `0755`, DEVOPSER-188) — ordered host-driven bring-up
  девбоксов ПОСЛЕ готовности WSL/докера (интерим-подъём после ребута): `recover.sh <repo> …` ждёт
  docker-демон → `devbox.sh up` для каждого по порядку. `--restart unless-stopped` поднимал девбоксы
  РАНЬШЕ готовности WSL — корень tmpfs-гонки host-bind; в volume-модели том всегда ext4 → авто-рестарт
  безопасен, recover.sh даёт ДЕТЕРМИНИРОВАННЫЙ ordered порядок. Generic (список продуктов — аргумент,
  ноль per-репо-данных). Минимальный не-костыльный вариант (guard в `devbox.sh` — вторая линия).
- **`scripts/devbox-publish.mjs`** (MANAGED, zero-deps) — publish-volume (Шаг 5 §A,
  `briefs/feedback-hub-core-as-hub-under-isolation.md`): на старте кладёт `omnifield.yaml`
  продукта в общий named-volume `omnifield-registry` под `<name>.yaml` (`<name>` = basename
  репо = network-alias). hub-core глобит оттуда `*.yaml` (ro) вместо fs-скана сиблингов —
  реестр НЕ зависит от up-состояния (last-published-wins, маршрут не моргает). Манифеста нет →
  loud-warn + no-op (продукт без манифеста просто вне двери `:8080`, декларация = зона его owner'а).
  Волюм монтируется в `.devcontainer/devcontainer.json` (`omnifield-registry` rw, target
  `/omnifield-registry`, chown в `postCreate`); публикация — из `postStartCommand` РЯДОМ с
  `devbox-services up` (разные концерны, чейн через `;` — dev-сервисы поднимутся независимо).
- **Autostart** (`devcontainer.json`): `postStartCommand: devbox-publish; devbox-services up`
  (VS Code-путь); raw-run путь — стартовая команда контейнера + `--restart unless-stopped`
  (см. brief A4, devbox/README).
- **Онбординг-seed** (`postCreateCommand`): idempotent-засев `.claude.json`
  (`hasCompletedOnboarding`) — свежий volume не гонит экран регистрации (brief B8).

**EXECUTABLE-подсет (B7):** managed-файлы с `exec: true` (`scripts/*.sh`) init материализует с
`mode 0755` и чинит бит на каждом синке; `husky-pre-commit` дополнительно валит коммит, если у
tracked `.sh` в index потерян бит (`mode ≠ 100755`) — правка через `\\wsl.localhost` его сбивает.

## Канон

- Дрейф виден сразу (красный CI), синк — только явной командой, не молча.
- Husky-гейты двухступенчатые (канон commit-каденса): pre-commit = sherif + lint/typecheck,
  pre-push = test/build («не пушим сломанное»). Оба с bootstrap-fallback: нет `origin/main`
  (первый пуш) → `nx run-many` вместо `nx affected` (грабля обкатана в weber). Репо-специфика —
  в `.husky/pre-commit.local` / `.husky/pre-push.local` (не drift-managed).
- Обновление эталона = изменение контракта потребителей → через architect,
  потребители синкаются явно (у них покраснеет drift-check — это by design).

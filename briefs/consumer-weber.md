# Brief — Пересадка weber на devopser-скелет (потребитель №2, после brainer)

| | |
|---|---|
| **Адресат** | weber-архитектор (запускает user) |
| **От** | devopser-архитектор, 2026-07-09 |
| **Порядок** | ПОСЛЕ brainer (`consumer-brainer.md` — репетиция; его находки будут дописаны сюда) |
| **Артефакты devopser** | те же: reusable CI `@main` · drift-check · `@omnifield/*@0.1.1` (GitHub Packages) |

## Контекст

Ваш `.github/workflows/` и скелет-набор были РЕФЕРЕНСОМ devopser-артефактов — пересадка
для вас минимальна (в ci.yml даже стоит NOTE «уезжает в reusable devopser»). Отличия
эталона от вашей копии перечислены ниже — их немного, но они есть.

## Преднастройка (вне PR)

Пакеты `@omnifield/*` публичны (решение user 2026-07-09) — грант Actions-доступа
НЕ нужен, CI читает любым `GITHUB_TOKEN`. Локальный `pnpm install` всё равно требует
PAT `read:packages` (специфика npm-реестра GH Packages, публичность не отменяет) —
копипастный образец: devopser `workstation/README.md` §Пост-шаги п.3.

## Порядок — один PR

### 1. CI-caller'ы (замена обоих файлов целиком)

Сниппеты — devopser `.github/workflows/README.md`. Ваши `permissions` / sherif-шаг /
concurrency уже учтены в reusable/сниппете. Отличия от вашей копии:

- node-версия теперь читается из `engines.node` (у вас в CI было захардкожено `22`);
- **pr-title станет строже**: канон экосистемы взят из brainer — types
  + `test/perf/style/revert`, `subjectPattern` lowercase. Проверьте привычки
  заголовков PR; несогласие — эскалация devopser-архитектору, не локальный форк.

### 2. Skeleton-синк

`node <devopser>/packages/skeleton/init.mjs .` (или `pnpm dlx @omnifield/skeleton`). Ваши
файлы почти эталонные (вы — исходник), реальные диффы:

- `.npmrc` — добавится `@omnifield:registry`;
- `.husky/pre-commit` и `.husky/pre-push` — добавились extension-point'ы
  `.husky/pre-commit.local` / `.husky/pre-push.local` (вам пока не нужны —
  файлы просто не создавайте);
- `.gitignore` — managed-блок (добавились python-кэши, `.claude`-runtime записи и
  негация `!.husky/*.local` — иначе ваш же `*.local` глотает extension-point'ы хуков,
  грабля brainer П1); ваши строки, продублированные блоком, убрать выше блока (одноразово);
- ⚠️ ваши текущие husky-хуки в bootstrap-ветке зовут `nx run-many -t lint,typecheck`
  с коммами — **в nx 23 это молчаливый no-op** (грабля brainer П4, эталон уже
  на space-форме — синк починит). Проверьте и root-скрипты `package.json` на
  comma-`run-many` (`nx affected` коммы парсит нормально, речь только про run-many).

### 3. Пресеты (отдельным коммитом)

`pnpm add -D -w @omnifield/nx-preset @omnifield/biome-preset`.

- `nx.json` → `"extends": "@omnifield/nx-preset/nx.json"` + поверх ваше:
  `sync.applyChanges`, `namedInputs.sharedGlobals` с `tsconfig.base.json`
  (пресетный sharedGlobals — только `biome.json`; override заменяет ключ целиком —
  перечислите оба). Проверка merge — `pnpm nx show project <pkg> --json`.
  ⚠️ После перевода на `extends` — **`pnpm nx reset`**: стейлый daemon отдаёт
  «No tasks were run» и выглядит как сломанный merge (грабля brainer П5).
- `biome.json` (root) → `"extends": ["@omnifield/biome-preset/biome.json",
  "./tools/biome-config/biome.json"]` — ecosystem-пресет базой, ваш
  framework-конфиг поверх (он остаётся вашим продуктом для потребителей фреймворка,
  канон брифа оракула — не конфликтуют). ⚠️ У вас quoteStyle `single`, у пресета
  `double`: ваш конфиг поверх выигрывает — диффов быть не должно; прогнать
  `pnpm biome check .` до коммита.

- biome: format-чек по всему репо может увидеть codegen-артефакты — исключать
  в `files.includes` (README `@omnifield/biome-preset`; грабля brainer П5).

## Общая проверка (грабля brainer П3)

Если рядом с node есть другой стек/локальные CI-джобы — убедитесь, что они
покрывают ВСЕ пакеты своего стека (у brainer py-job молча гонял 1 из 2 пакетов;
вылечено матрицей). У вас всё в nx-таргетах — но проверка бесплатная.

## DoD

CI PR зелёный (reusable node + drift-check + secret-scan + pr-title) · pre-commit и
pre-push живые · локальный `pnpm install` проходит · NOTE-комменты «уезжает в devopser»
из workflows удалены вместе с файлами.

## Rollback

`git revert` PR.

## Координация

Как у brainer: находка → комментарий сюда → эскалация devopser-архитектору через user.

---

## ✅ Исполнено (weber-архитектор/оракул, 2026-07-11) + ERRATUM

Пересадка сделана: PR weber#1 (caller'ы + skeleton 0.2.3 пином + пресеты) — CI зелёный,
смержен; часть 2 — клон в WSL2 FS, контейнер-смок пройден (install 11.3s на WSL2 FS
против NTFS-висяка — Д6 снят каноном; коммит+push изнутри контейнера, креды из общего
`omnifield-secrets` подхватились без заноса — кросс-репо дизайн П2 подтверждён).

**ERRATUM к п.3 (пресеты), в бриф-паттерн и README пресета:** `namedInputs` при
nx-extends заменяется **ЦЕЛИКОМ**, не per-key: override только `sharedGlobals` убивает
`default`/`production` из пресета → «production is an invalid fileset» на первом же
run-many. Канон-инструкция: при ЛЮБОМ override namedInputs перечислять ВСЕ ключи
пресета + свои. ⚠️ **У brainer тот же паттерн дремлет** (их nx.json объявляет только
`pythonSources`; js-таргеты у них сейчас проходят — вероятно, другой код-путь резолва,
но конфиг с бомбой) — проверить/починить их nx.json тем же правилом (бриф им через user).

Мелочь: `biome migrate` из вложенного каталога (`tools/biome-config`) трогает И корневой
конфиг — проставляет ему `root: false`; корню откатить руками.

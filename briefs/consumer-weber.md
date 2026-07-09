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

## Преднастройка (вне PR, как у brainer)

Actions-доступ 3 пакетов к `omnifield/weber` + PAT `read:packages` локально
(devopser `workstation/README.md` §Пост-шаги п.3).

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
- `.gitignore` — managed-блок (добавились python-кэши и `.claude`-runtime записи);
  ваши строки, продублированные блоком, убрать выше блока (одноразово).

### 3. Пресеты (отдельным коммитом)

`pnpm add -D -w @omnifield/nx-preset @omnifield/biome-preset`.

- `nx.json` → `"extends": "@omnifield/nx-preset/nx.json"` + поверх ваше:
  `sync.applyChanges`, `namedInputs.sharedGlobals` с `tsconfig.base.json`
  (пресетный sharedGlobals — только `biome.json`; override заменяет ключ целиком —
  перечислите оба). Проверка merge — `pnpm nx show project <pkg> --json`.
- `biome.json` (root) → `"extends": ["@omnifield/biome-preset/biome.json",
  "./tools/biome-config/biome.json"]` — ecosystem-пресет базой, ваш
  framework-конфиг поверх (он остаётся вашим продуктом для потребителей фреймворка,
  канон брифа оракула — не конфликтуют). ⚠️ У вас quoteStyle `single`, у пресета
  `double`: ваш конфиг поверх выигрывает — диффов быть не должно; прогнать
  `pnpm biome check .` до коммита.

## DoD

CI PR зелёный (reusable node + drift-check + pr-title) · pre-commit живой ·
локальный `pnpm install` проходит · NOTE-комменты «уезжает в devopser» из
workflows удалены вместе с файлами.

## Rollback

`git revert` PR.

## Координация

Как у brainer: находка → комментарий сюда → эскалация devopser-архитектору через user.

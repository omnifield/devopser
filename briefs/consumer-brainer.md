# Brief — Пересадка brainer на devopser-скелет (потребитель №1, репетиция)

| | |
|---|---|
| **Адресат** | brainer-архитектор (запускает user) |
| **От** | devopser-архитектор, 2026-07-09 |
| **Порядок** | brainer ПЕРВЫЙ (решение user: на нём репетируем), weber вторым (`consumer-weber.md`) |
| **Артефакты devopser** | reusable CI `omnifield/devopser/.github/workflows/{node-ci,pr-title}.yml@main` · drift-check action · `@omnifield/{skeleton,nx-preset,biome-preset}@0.1.1` (GitHub Packages) |

## Зачем

Скелет (CI+husky+пины+конфиги) сейчас — in-repo копия, дрейфующая от соседей.
После пересадки: CI-фиксы приезжают сами (`@main`), дрейф вендоренных файлов виден
сразу (красный drift-check), общие конфиги — пакетами. Спека продукта —
devopser `briefs/repo-skeleton-product.md`.

## Преднастройка (вне PR, координирует user/devopser)

- **Actions-доступ к пакетам**: GH → каждый из 3 пакетов → Package settings →
  Manage Actions access → добавить `omnifield/brainer` (иначе `pnpm install` в CI = 401).
- **Локальный install**: PAT `read:packages` в user-level `~/.npmrc` —
  devopser `workstation/README.md` §Пост-шаги п.3.

## Порядок — один PR, коммиты по шагам

### 1. CI-caller'ы

`.github/workflows/ci.yml`: job `node` → caller; **python-job остаётся локальным как
есть** (reusable python-ci появится needs-driven — при втором python-потребителе):

```yaml
permissions: { contents: read, actions: read }   # без actions:read падает nx-set-shas
jobs:
  node:
    uses: omnifield/devopser/.github/workflows/node-ci.yml@main
  python:
    # ваш текущий job без изменений
```

`.github/workflows/pr-title.yml` → caller `uses: omnifield/devopser/.github/workflows/pr-title.yml@main`
(permissions `pull-requests: read`). Дефолты reusable = ваш конфиг 1:1 (types
включая test/perf/style/revert, requireScope false, lowercase-subject) — ваш конфиг
и взят каноном экосистемы.

### 2. sherif (нужен reusable CI и эталонному pre-commit)

`pnpm add -D -w sherif` + скрипт `"hygiene": "sherif"`. Прогнать локально —
починить находки до PR.

### 3. Skeleton-синк

`node <devopser>/packages/skeleton/init.mjs .` (или `pnpm dlx @omnifield/skeleton`). Даст:

- `.editorconfig` — появится (сейчас отсутствует);
- `.npmrc` — добавится `@omnifield:registry` маппинг;
- `.husky/pre-commit` — эталон (sherif + affected + **bootstrap-fallback**).
  ⚠️ Ваш `lint:py` из хука переносится в **`.husky/pre-commit.local`**
  (extension-point эталона, не drift-managed):

  ```sh
  pnpm nx affected -t lint:py --base=origin/main || exit 1
  ```

- `.husky/pre-push` — эталон (test+build + bootstrap-fallback; Ф1 ревью оракула).
  ⚠️ Ваш `test:py` из хука переносится в **`.husky/pre-push.local`** (симметрично):

  ```sh
  pnpm nx affected -t test:py --base=origin/main || exit 1
  ```

- `.gitignore` — managed-блок дозаписью; ваши строки, продублированные блоком
  (python-кэши, .venv, node, OS, .claude runtime — всё уже в блоке), убрать
  выше блока руками (одноразовая чистка);
- `.github/dependabot.yml` — появится из шаблона (npm grouped + github-actions,
  weekly). ⚠️ Добавьте себе `package-ecosystem: uv` (python-deps) — шаблон
  не drift-managed, расширение легитимно.

Drift-check в reusable CI включён по умолчанию — синк обязан быть в этом же PR.

### 4. Пресеты (отдельным коммитом, с проверкой)

`pnpm add -D -w @omnifield/nx-preset @omnifield/biome-preset`.

- `nx.json` → `"extends": "@omnifield/nx-preset/nx.json"` + поверх ТОЛЬКО ваше:
  `targetDefaults.test:py/lint:py`, `namedInputs.pythonSources`. ⚠️ Проверить merge:
  `pnpm nx show project backend --json` (inputs на месте) + прогон `lint:py`/`test:py`
  с кэшем. Если merge теряет ваши inputs — СТОП, эскалация devopser-архитектору
  (оставите полный nx.json до фикса пресета).
- `biome.json` → `"extends": ["@omnifield/biome-preset/biome.json"]` + ваши
  `files.includes`. Ваши правила совпадают с пресетом (double quotes, lf, 100) —
  `pnpm biome check .` должен пройти без диффов; мелкие диффы — применить `--write`.

## DoD

- CI PR зелёный: node (reusable, включая sherif, drift-check и **secret-scan gitleaks** —
  шаг приезжает с `@main` автоматически; false-positive → `.gitleaks.toml`, не выключение) +
  python (локальный) + pr-title.
- pre-commit живой: sherif + affected + `pre-commit.local` (lint:py);
  pre-push живой: test+build + `pre-push.local` (test:py).
- Локальный `pnpm install` у user проходит (PAT настроен).
- Доки репо (CLAUDE/DEPLOY), поминающие CI/скелет, — в актуале.

## Rollback

Один `git revert` PR — in-repo копии вернутся, зависимостей от живого devopser нет
(артефакты остаются в GH Packages/git-ref).

## Координация

Расхождение/грабля → фиксация в этом брифе (комментарием) → эскалация devopser-архитектору
через user. Найденное здесь ляжет в бриф weber — вы репетиция.

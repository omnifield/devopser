# Reusable workflows — CI как артефакт devopser (repo-skeleton D1)

Источник правды CI продукт-репо экосистемы. Потребитель НЕ копирует workflow —
держит caller и получает фиксы автоматически (`@main`). Спека —
`briefs/repo-skeleton-product.md`.

## Caller-сниппеты (в репо-потребителе, `.github/workflows/`)

`ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
# Reusable не может расширить права сам. Явный permissions-блок ОБНУЛЯЕТ
# неперечисленное: actions:read — иначе падает nx-set-shas («Resource not
# accessible by integration»); packages:read — иначе 403 на @omnifield-пакетах
# ДАЖЕ публичных (грабля brainer П8, видна только когда пакеты в lockfile).
permissions: { contents: read, actions: read, packages: read }
jobs:
  node:
    uses: omnifield/devopser/.github/workflows/node-ci.yml@main
```

`pr-title.yml`:

```yaml
name: PR title
on:
  pull_request: { types: [opened, edited, synchronize, reopened] }
permissions: { pull-requests: read }
jobs:
  semantic:
    uses: omnifield/devopser/.github/workflows/pr-title.yml@main
```

### Go-репо

`ci.yml` (go-продукт — вместо node-джобы держит go-джобу):

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
# go-флоу НЕ тянет @omnifield-пакеты и nx-set-shas → нужен только contents: read
# (checkout + полная история gitleaks). Явный permissions обнуляет неперечисленное.
permissions: { contents: read }
jobs:
  go:
    uses: omnifield/devopser/.github/workflows/go-ci.yml@main
```

`pr-title.yml` — тот же, что у node (семантик-гейт языко-независим).

## Контракт с пинами вызывателя (канон toolchain-pins)

Workflow версий НЕ содержит — читает пины репо-потребителя:

| Тулза | Пин | Механизм |
|---|---|---|
| pnpm | `packageManager` в `package.json` | `pnpm/action-setup` без `version` |
| node | `engines.node` в `package.json` (диапазон ок) | `setup-node` `node-version-file` |
| go | `go` в `go.mod` | `setup-go` `go-version-file: go.mod`, `check-latest: false` |

Обязательные файлы у node-потребителя: `package.json` с обоими пинами, `pnpm-lock.yaml`
(install идёт `--frozen-lockfile`), таргеты `lint,typecheck,test,build` в nx-проектах
(отсутствующие nx просто пропускает).

Обязательные файлы у go-потребителя: `go.mod` с директивой `go` (единственный источник
версии Go), `.golangci.yml` (schema v2 — эталон `packages/skeleton/files/go/`). `sqlc.yaml`
опционален: `sqlc-drift` гоняется только когда файл есть, иначе — тихий skip (продукт без
sqlc его не обязан иметь). Версии инструментов (golangci-lint / sqlc / gitleaks / goose) —
пины в шапке `go-ci.yml` (`tools`), НЕ в продукте.

## Грабли (проверено/известно)

- **Actions → Access**: devopser приватный — reusable доступен другим приватным репо org
  только при access_level `organization` (включено 2026-07-09 через
  `gh api repos/omnifield/devopser/actions/permissions/access`).
- **nx-set-shas на свежем репо** (нет успешных run'ов на main): action падает обратно
  на merge-base — проверить при первом новом репо; CI-аналог husky bootstrap-fallback
  (см. D3 в брифе).
- **drift-check** (input, default `true`): composite action
  `omnifield/devopser/.github/actions/drift-check@main` сверяет вендоренные копии с
  эталоном `packages/skeleton/files/` — эталон приезжает с репо action'а, токены не
  нужны. Дрейф = красный; синк явной командой (`pnpm dlx @omnifield/skeleton@<версия>` —
  всегда с пином, stale dist-tag GH Packages откатывает эталон, К2 фидбека brainer).
  Выключать (`with: { drift-check: false }`) — только на переходный период.
- **@omnifield-пакеты в CI**: install идёт с `NODE_AUTH_TOKEN=GITHUB_TOKEN` через
  npm.pkg.github.com; у пакета devopser должен быть grant на репо-вызыватель
  (Package settings → Manage Actions access) — проверить при переключении потребителя.
- **permissions в caller — полный список обязателен**: явный `permissions:` обнуляет
  дефолты; забытый `packages: read` = `ERR_PNPM_FETCH_403` на `@omnifield/*`, причём
  только с того момента, как пакеты попали в lockfile (шаг пресетов) — CI до этого
  зелёный и врёт (брainer П2+П8).
- **secret-scan** (input, default `true`): gitleaks (запинен v8.30.1) по всей git-истории,
  `--redact` — находки не печатаются в лог. Репо публичные — токены ловит CI до глаз.
  False-positive → allowlist `.gitleaks.toml` в репо-потребителе, не выключение шага.
  Канон секретов: только env-инжект (GH Environments / vault devopser), файлов с
  секретами в репо нет (CLAUDE.md POLICY).

## Грабли Go (`go-ci.yml`)

- **Версия Go — только `go.mod`**: `setup-go` с `go-version-file: go.mod`, `check-latest: false`.
  Нет директивы `go` в `go.mod` → setup падает; свежак молча не подтягивается (пин честный).
- **`.golangci.yml` — schema v2**: workflow ставит golangci-lint **v2** (`golangci-lint-action@v7`),
  конфиг v1-формата не заведётся. Эталон конфига — `packages/skeleton/files/go/golangci-template.yml`.
  `gofumpt` в v2 — секция `formatters`, не `linters`.
- **`sqlc-drift`** — гейт по наличию `sqlc.yaml`/`sqlc.yml`: есть → `sqlc generate` (пин v1.27.0
  через `go install`) + `git diff --exit-code`; нет → шаг пропущен (не форсим sqlc на продукт
  без БД-слоя). Красный = сгенерированный код рассинхронен: прогнать `sqlc generate`, закоммитить.
- **permissions caller = только `contents: read`**: go-флоу не дёргает nx-set-shas и не тянет
  `@omnifield`-пакеты, так что `actions: read` / `packages: read` (обязательные для node) здесь
  не нужны. `contents: read` нужен и checkout'у, и полной истории gitleaks (`fetch-depth: 0`).
- **Приватные go-модули** (`GOPRIVATE`) — вне baseline; появится инпутом под первый заказ,
  не хардкодим наперёд.

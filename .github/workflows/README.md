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

## Контракт с пинами вызывателя (канон toolchain-pins)

Workflow версий НЕ содержит — читает пины репо-потребителя:

| Тулза | Пин | Механизм |
|---|---|---|
| pnpm | `packageManager` в `package.json` | `pnpm/action-setup` без `version` |
| node | `engines.node` в `package.json` (диапазон ок) | `setup-node` `node-version-file` |

Обязательные файлы у потребителя: `package.json` с обоими пинами, `pnpm-lock.yaml`
(install идёт `--frozen-lockfile`), таргеты `lint,typecheck,test,build` в nx-проектах
(отсутствующие nx просто пропускает).

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
  нужны. Дрейф = красный; синк явной командой (`pnpm dlx @omnifield/skeleton`).
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

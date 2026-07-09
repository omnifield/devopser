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
# Reusable не может расширить права сам; без actions:read nx-set-shas падает
# «Resource not accessible by integration».
permissions: { contents: read, actions: read }
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
- `drift-check` input — зарезервирован под D3, пока no-op с warning.

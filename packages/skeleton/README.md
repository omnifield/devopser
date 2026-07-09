# @omnifield/skeleton — эталон вендоренных файлов + init/sync/drift-check

Repo-skeleton D3 (`briefs/repo-skeleton-product.md`). Файлы, обязанные лежать копией
в каждом продукт-репо, живут эталоном в `files/`; `init.mjs` их материализует,
синкает и сверяет. Zero-deps (только `node:*`).

## Команды

```sh
# новый репо (или синк существующего — идемпотентно):
node <devopser>/packages/skeleton/init.mjs <target>
# или после publish, из корня целевого репо:
pnpm dlx @omnifield/skeleton

# drift-check (то, что гоняет шаг reusable CI; exit 1 при дрейфе):
node <devopser>/packages/skeleton/init.mjs --check <target>
```

## Managed-набор (сверяется drift-check'ом)

| Файл | Режим |
|---|---|
| `.editorconfig` · `.gitattributes` · `.npmrc` · `.husky/pre-commit` | точная копия эталона |
| `.gitignore` | managed-блок между маркерами `>>> omnifield-skeleton` — ниже блока репо дописывает своё |
| `package.json` | пины `packageManager` + `engines.node` равны эталону |

`nx.json` / `biome.json` / остальной `package.json` — создаются init'ом из шаблонов
(только если отсутствуют), но НЕ drift-managed: репо легитимно расширяет пресеты
(пример: python-таргеты brainer поверх `@omnifield/nx-preset`).

## Канон

- Дрейф виден сразу (красный CI), синк — только явной командой, не молча.
- Husky pre-commit содержит bootstrap-fallback: нет `origin/main` (первый пуш) →
  `nx run-many` вместо `nx affected` (грабля обкатана в weber).
- Обновление эталона = изменение контракта потребителей → через architect,
  потребители синкаются явно (у них покраснеет drift-check — это by design).

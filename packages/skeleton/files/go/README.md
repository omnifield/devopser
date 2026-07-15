# Go-stack шаблоны (эталон)

Исполняющие механизмы go-канона: конфиги + канон-layout, которые ложатся на **любой**
go-продукт. Принципы (тулчейн-пины, состав линтеров) — дом в knowledger
(`standards/canon/languages/go.md`); здесь — исполняющая форма. Ноль продуктовой заточки.

Reusable CI, который это гоняет — `.github/workflows/go-ci.yml` (caller-сниппет и грабли:
`.github/workflows/README.md`, секция Go).

## Файлы

| Шаблон | Кладётся как | Что |
|---|---|---|
| `golangci-template.yml` | `.golangci.yml` | baseline линтеров (schema v2): `errcheck, govet, staticcheck, unused, ineffassign, misspell, gocritic, revive` + `gofumpt`-форматтер |
| `sqlc-template.yaml` | `sqlc.yaml` | канон-форма sqlc; дефолт `engine: sqlite` (БД = конфиг продукта, postgres — drop-in-таргет), продукт правит пути — go-ci читает файл вызывателя |

## Канон-layout go-сервиса (минимальный)

```
cmd/<binary>/main.go     # точки входа (по бинарю на каталог)
internal/                # приватные пакеты (store, service, http, …)
  store/                 # sqlc gen.out; queries/*.sql рядом (см. sqlc.yaml)
migrations/              # goose-миграции (schema для sqlc)
go.mod                   # ПИН версии Go — единственный источник для setup-go в CI
```

Версия Go — только в `go.mod` вызывателя (`go-ci.yml` читает его через `go-version-file`).
Версии инструментов (golangci-lint / sqlc / goose) — пины в шапке `go-ci.yml` (`tools`),
НЕ в продукте.

## Статус

Шаг 0 (Foundation): эталон разложен здесь, рядом с node-набором. **Вживление в
`init.mjs` (материализация/синк/drift-check) и свап продуктов на reusable-caller —
Шаг 1** (delivery через `skeleton init|sync`), не этот бриф. Пока — статичный эталон-референс.

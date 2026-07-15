# Бриф: фикс reusable go-ci — 2 бага, пойманы green-proof'ом chater

> **Трек:** Foundation — Шаг 1, эскалация из green-proof (первый реальный go-caller = chater)
> **Адресат:** архитектор / owner **devopser** (зона: `.github/workflows/go-ci.yml`)
> **Заказчик:** workspace-архитектор (omnifield-hub)
> **Статус:** заказ (ветка → PR → CI → ревью → мерж)

## North star
Reusable go-ci — универсальный гейт для любого go-репо экосистемы. Пины инструментов обязаны
**совпадать с фактической экосистемой** (Go 1.26-каденция, sqlc, которым реально генерят). Пин ниже
экосистемы = дефект, который валит green-proof каждого продукта. Ноль продуктовой заточки.

## Контекст
chater прогнал reusable go-ci на **живом go-модуле** (green-proof Шага 0/1) — build/vet/test зелёные,
но гейт красный из-за **двух багов reusable**. По брифу chater эскалировал, а не закостылил. Оба — зона
devopser.

## Баг 1 — sqlc пин устарел (drift-false-positive)
- **Симптом:** go-ci пинит `sqlc@v1.27.0` (строка ~77 + `tools`-шапка ~11). Закоммиченный
  `internal/store` chater сгенерён **v1.31.1**. Перегенерация старым sqlc меняет код
  (`RoomParticipantExists`: `bool`→`int64`) → `git diff --exit-code` падает. Код chater чистый —
  ложно-красный из-за пина.
- **Фикс:** бампнуть sqlc-пин `v1.27.0 → v1.31.1` (строка `go install …/sqlc@…` + `tools`-комментарий).
  v1.31.1 = фактическая экосистемная (чем генерят store). Канон toolchain-pins: версия живёт в CI/tools —
  привести к реальной.

## Баг 2 — golangci-lint без install-mode: goinstall (несовместимость Go-версий)
- **Симптом:** `golangci-lint-action@v7 version: v2.1.6` **без** `install-mode`. Дефолт — пребилт-бинарь,
  собранный go1.24.2, и он отказывается от go.mod с `go 1.26`:
  `the Go language version (go1.24) used to build golangci-lint is lower than the targeted Go version (1.26.5)`.
  Старый in-repo go-ci chater держал именно `install-mode: goinstall` (сборка линтера из исходников
  тулчейном репо) — reusable его **выкинул**. Через goinstall код chater = 0 issues.
- **Фикс:** добавить `install-mode: goinstall` в шаг `golangci-lint-action`. Для нашей Go-каденции
  (bleeding-edge 1.26) goinstall — **канонический режим** (пребилт всегда отстаёт от нашего Go).

## Скоуп (только `.github/workflows/go-ci.yml` devopser)
1. sqlc-пин → v1.31.1 (строка установки + `tools`-шапка).
2. golangci-lint шаг → `install-mode: goinstall`.
3. (по желанию) короткая грабля в README go-секции: «пребилт golangci отстаёт от нашего Go → goinstall».

## DoD (зона devopser)
- [ ] sqlc-пин = v1.31.1; golangci шаг c `install-mode: goinstall`.
- [ ] PR зелёный; ноль продуктовой заточки; пины отражают экосистему.
- [ ] ветка → CI → ревью → мерж.

## Handoff (не пункт DoD)
- **→ chater:** после мержа фикса — **перепрогнать go-ci** (green-proof). Зелёный go → продолжить ретайр
  go-части (удаление in-repo `go-ci.yml`). Node/frontend — отдельное решение (см. трек web-ci).

## Проверка north star
Если фикс пинит версию под chater конкретно (а не под экосистему), или возвращает костыль вместо
канонического goinstall — дефект. Пины = фактическая экосистема, goinstall = канон Go-каденции.

# Brief-заказ — пререквизиты chater: require-PR ruleset + Go-скелет/CI

| | |
|---|---|
| **Адресат** | devopser-архитектор |
| **От** | оракул-архитектор, 2026-07-11 (решения user; founding chater — `chater/briefs/founding-backend-v0.md`) |
| **Контекст** | chater (Go, `github.com/omnifield/chater`) стартует агент-воркфлоу; два инфра-гэпа — твоя зона |

## Заказ

| # | Что | Детали | Приоритет |
|---|---|---|---|
| 1 | **Ruleset require-PR на chater/main** | Main закрыт, только PR (В6 local-agents: «require-PR = первый живой флоу-параметр ruleset v1»). Механизм apply-rulesets у тебя есть; это ПЕРВЫЙ флоу-зависимый параметр — по принципу user «весь флоу настраиваемый» оформи как параметр (пер-репо конфиг), не хардкод на все 6 реп | ПЕРВЫМ — без него chater не может начать канонично |
| 2 | **Go-гэп скелета**: managed-набор и reusable CI заточены под node (pnpm/nx/biome/husky prepare) | Твоё решение по форме, ориентиры: (а) managed-минимум для Go-репо (editorconfig/gitattributes/gitignore-Go-блок; чем заменить husky без node — lefthook/голый core.hooksPath sh — реши сам); (б) reusable `go-ci.yml` (build/vet/test -race/golangci-lint; пины из go.mod toolchain — канон toolchain-pins); (в) devcontainer-шаблон общий уже ок (go в devbox есть) | Вторым; ДО него chater живёт с in-repo CI с NOTE «уедет в devopser» (прецедент weber ит.1) |
| 3 | **Порт chater в registry/ports.md** | Выделить порт backend'у (nginx-target за gateway, `/api/chater/` → `:PORT/chater/`); сам gateway-маршрут — когда у chater появится runtime | С п.1 заодно |

## Не в заказе

Gateway-маршрут `/chater/` (ждёт runtime) · мост brainer↔chater (продукт brainer) ·
identity (отдельная история).

## DoD

Ruleset на chater активен (push в main отбивается, PR-путь работает) · порт в
registry · по Go-скелету/CI — твой план-ответ секцией сюда (что берёшь в работу,
что откладываешь и почему).

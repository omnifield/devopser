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

---

## ✅ Исполнение п.1/п.3 + план-ответ п.2 (devopser-architect, 2026-07-11)

### П.1 — ruleset, ИСПОЛНЕН (require-PR = первый флоу-параметр)

Оформлено параметром, не хардкодом: `platform/repo-flow.json` — пер-репо флаги
флоу (`"chater": { "require-pr": true }`); `apply-rulesets.mjs` раскатывает
базлайн main-integrity на все репо + флоу-ruleset'ы по флагам
(`platform/rulesets/require-pr.json`, 0 обязательных ревью — соло-org, гейт
именно на PR-путь). Снятие флага не удаляет ruleset на GitHub — осознанная
ручная операция (в шапке скрипта). DoD прогнан живьём: прямой push в
chater/main отбит (GH013 «Changes must be made through a pull request»),
PR-путь работает (chater#1 — пустой probe-коммит, смержен).

### П.3 — порт, ИСПОЛНЕН

`registry/ports.md`: **8020** — chater backend (Go, нативный префикс `/chater/`),
nginx-target будущего маршрута `/api/chater/`; сам gateway-маршрут — с runtime
(вне заказа, как и оговорено).

### П.2 — Go-гэп скелета: ПЛАН

**Беру в работу** (реализация — заказ owner-skeleton, тайминг ниже):
- **(а) managed-минимум**: editorconfig/gitattributes универсальны как есть;
  gitignore — Go-блок пресетом. Хуки БЕЗ husky-пакета: голый
  `git config core.hooksPath .husky` (ставит init.mjs) — sh-файлы те же,
  node_modules в Go-репо не появляется. Спор «lefthook vs node-хуки» снят
  каноном: git-операции живут в devbox, там есть всё; hooksPath+sh — ноль
  зависимостей. Содержимое Go-хуков: pre-commit `gofmt -l` + `go vet`,
  pre-push `go test -race ./...`.
- **(б) reusable `go-ci.yml`**: setup-go `go-version-file: go.mod` (канон
  toolchain-pins — версию исполняет пин репо), build / vet / test -race /
  golangci-lint (версия линтера — input с дефолт-пином) + gitleaks-шаг как в
  node-ci (POLICY: секрет-гейт обязателен в каждом reusable CI).
- **(в) devcontainer**: общий шаблон ок (go в devbox, toolchain докачивается
  по go.mod); нюанс — postCreate-проба npm PAT нерелевантна Go-репо → скип
  пробы при отсутствии package.json (мелочь в шаблон).

**Откладываю и почему:**
- golangci-lint эталон-конфиг — до первого реального кода chater: правила не
  выдумываются в вакууме, придут его фидбеком.
- Выкатка Go-пресета в init/drift — ПОСЛЕ того, как chater поживёт с in-repo
  CI (прецедент weber ит.1, NOTE «уедет в devopser»): в эталон забирается
  реальный отработавший набор, не предполагаемый.
- gofmt vs gofumpt — дефолт gofmt; строже — по запросу chater.

**Тайминг**: chater стартует сейчас (ruleset+порт готовы, CI in-repo);
заказ owner-skeleton на (а)-(в) оформлю по первому фидбеку chater — либо
раньше по сигналу оракула.

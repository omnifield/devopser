# @omnifield/git-preset — декларативный git-flow пресет

Первый **не-repo-config** пресет на движке скелета (DEVOPSER-103): `target: git-flow`. Чистые
**данные** — декларативный конфиг git-флоу, который тулинг ЧИТАЕТ (`mechanism: read`, не
`extends`/`import`). Пресет объявлен и валидируется движком (метаданные + биндинг
`template.json.presets` + «в рамке»); процессор (материализация в rulesets / скриптованные
git-операции) — **отдельные слайсы**, здесь его нет.

## ⚠️ agent-agnostic — ноль actor/ролей

Конфиг НЕ содержит понятий actor/owner/ролей/прав/«кто может push/ветку»/git-gate. Кто возьмёт
пресет и как замапит на роли — **концерн потребителя** (напр. brainer маппит роли агентов),
не devopser. git-flow = просто пресет+инструмент, неважно кто юзает (композиция DEVOPSER-108,
направление consumer→provider).

## Схема (`git-flow.json`) — рамка vs дефолты (DEVOPSER-95)

```json
{
  "frame":    { "mainProtected": true, "prRequired": true },
  "defaults": { "merge": "squash", "branchNaming": "…", "requiredChecks": "from-stack", "commitConvention": "conventional" }
}
```

| Секция | Семантика | Поля |
|---|---|---|
| `frame` | **frozen** — рамка, выключить нельзя | `mainProtected` (main под защитой) · `prRequired` (мерж только через PR) |
| `defaults` | **overridable** — докрутка потребителя в границах рамки | `merge` (`squash`\|`merge`\|`rebase`) · `branchNaming` (regex-паттерн) · `requiredChecks` (`from-stack` \| набор) · `commitConvention` (`conventional`) |

`requiredChecks: "from-stack"` — набор обязательных проверок выводится из стека репо (те же
reusable-CI job'ы, что раздаёт скелет), не хардкодится в пресете.

## Метаданные (`omnifield`, пресет-контракт DEVOPSER-98)

```json
"omnifield": { "kind": "preset", "slot": "git-flow", "stack": "any", "mechanism": "read", "target": "git-flow" }
```

`stack: "any"` — флоу не привязан к node/go/frontend. `mechanism: "read"` — НОВЫЙ режим
потребления (пресет читается тулингом), расширяет enum контракта (`extends`\|`import`\|`read`).
`target: "git-flow"` — категория (см. skeleton README «Таргеты пресетов»).

## Публикация

`pnpm -r publish` (GitHub Packages `npm.pkg.github.com`), версия = `package.json`. Bump-дисциплина
и версионный биндинг — как у всех пресетов (skeleton README «Версионирование пресетов»).

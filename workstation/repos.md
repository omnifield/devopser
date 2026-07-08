# Repos — карта экосистемы для новой машины

Что клонить после `bootstrap.ps1`, куда, и что поднять после клона.
Клонирование в MVP — руками по этой карте; автоматизация — следующая итерация.

## Канон-раскладка

Корень — `<root>\projects\new\` (на референс-машине `<root>` = `C:\Users\<user>\Desktop`,
сам корень не канон — канон относительная раскладка ниже).

```
projects/new/
├── omnifield/
│   ├── brainer/      # агент-оркестрация
│   ├── commons/      # канон: standards, agents, POLICY
│   └── devopser/     # этот репо: инфра-стеки + registry + workstation
└── capsuleTech/      # оракул (ADR, живой docker-субстрат до переключения)
```

## Что клонить

| Репо | Куда (от `projects/new/`) | URL |
|---|---|---|
| brainer | `omnifield/brainer` | `https://github.com/omnifield/brainer.git` |
| commons | `omnifield/commons` | `https://github.com/omnifield/commons.git` |
| devopser | `omnifield/devopser` | remote пока не заведён — перенести копией / завести origin (architect) |
| capsuleTech (оракул) | `capsuleTech` | `https://github.com/egor6-66/capsuleTech.git` |

Перед клоном — git-auth (пост-шаг README): приватные репо без него не склонируются.

## Что поднять после клона

Порядок имеет значение (observability нужен brainer-backend'у):

1. **devopser — стеки** (когда мигрированы по `briefs/infra-migration.md`;
   до того — стеки крутит оракул `capsuleTech/docker/`):
   ```powershell
   cd omnifield\devopser\stacks\observability; docker compose up -d
   cd ..\gateway; docker compose up -d
   ```
2. **brainer**:
   ```powershell
   cd omnifield\brainer\backend;  uv sync        # .python-version -> uv сам качает CPython
   cd ..\frontend;                pnpm install    # packageManager -> corepack сам ставит pnpm
   ```
3. **commons / capsuleTech** — только чтение (канон и оракул), поднимать нечего.

Порты, которые займут стеки/продукты — `registry/ports.md` (source of truth).

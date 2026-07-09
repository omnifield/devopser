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
| devopser | `omnifield/devopser` | `https://github.com/omnifield/devopser.git` |
| capsuleTech (оракул) | `capsuleTech` | `https://github.com/egor6-66/capsuleTech.git` |

Перед клоном — git-auth (пост-шаг README): приватные репо без него не склонируются.

## Что поднять после клона

Порядок имеет значение (observability нужен brainer-backend'у):

1. **инфра (интерим)** — телеметрию/gateway крутит оракул `capsuleTech/docker/`
   (команды — в README соответствующих директорий капсулы). Devopser runtime-стеков
   не держит — стек появляется только под заказ потребителя
   (`briefs/devops-consolidated-backlog.md` v2).
2. **brainer**:
   ```powershell
   cd omnifield\brainer\backend;  uv sync        # .python-version -> uv сам качает CPython
   cd ..\frontend;                pnpm install    # packageManager -> pnpm сам переключится на пин
   ```
3. **commons / capsuleTech** — только чтение (канон и оракул), поднимать нечего.

Порты, которые займут стеки/продукты — `registry/ports.md` (source of truth).

# Repos — карта экосистемы для новой машины

Что клонить после `bootstrap.ps1`, куда, и что поднять после клона.
Containers-only: git на хост не ставится — клон делается ИЗ devbox-контейнера
в примонтированную папку (`devbox/README.md` §Использование п.1); дальнейшие
команды (`pnpm install` / `uv sync`) — тоже внутри контейнера.

## Вход в devbox репо (канон, per-repo)

У КАЖДОГО репо — **свой** devbox: монтирует только себя, в сети под alias = имя
репо, наружу машины не торчит (single-origin `:8080`). Две команды из корня репо
на ХОСТЕ (нужен только `docker`):

```sh
scripts/devbox.sh up               # провижн своего devbox из .devcontainer/ (идемпотентно)
scripts/devbox-session.sh <scope>  # вход агентом: ставит OMNIFIELD_SCOPE + workdir + model-pin
```

`<scope>` — `main` (полный git) или `<zone>` (owner, commit-only под git-gate);
зоны devopser перечислены в его `CLAUDE.md` / `ARCHITECTURE.md`. Каталог продуктов —
не registry-файл, а **per-product манифесты** (`omnifield.yaml` в репо каждого продукта,
агрегируются сканом hub-core): продукт самообъявляется, devopser его данные не держит.
Всё дальнейшее (git, клон, `pnpm install` / `uv sync`, claude-сессии) — уже ВНУТРИ
этого контейнера.

> ⚠️ **`~/oa <repo> [scope]` — retired-антипаттерн, НЕ вход.** Это был хост-стопгап:
> `docker exec` в ОДИН devbox (brainer'а) с bind-mount'ом СРАЗУ ВСЕХ репо → из
> одной сессии видны чужие продукты, **утечка изоляции** (нарушает single-product-
> per-devbox). Ретайрен в пользу пары выше. **Удали хост-алиас `~/oa`**, если он
> остался на машине (действие на хосте, вне репо).

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

Репо публичны — анонимный клон работает; git-auth (пост-шаг README, внутри
контейнера) нужен для push.

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

Хост-порты devopser-инфры (`:8080` gateway — единственный хост-контракт всей системы) —
`registry/ports.md`. Порты продуктов сюда НЕ входят: они внутренние (docker-сеть, апстрим
по alias = имя репо) и декларируются **манифестом самого продукта** (`reach.routes[].service`),
не registry-файлом.

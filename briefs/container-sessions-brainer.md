# Brief — Claude-сессии в контейнере как ДЕФОЛТ (пересадка brainer)

| | |
|---|---|
| **Адресат** | brainer-архитектор (запускает user) |
| **От** | devopser-архитектор, 2026-07-10 |
| **Основание** | канон containers-only (`briefs/containers-only-and-management.md`, фундамент user P0) + blueprint D4 v1 (там же) + ваш финальный фидбек (`briefs/feedback-devbox-brainer.md`) — headless-сессия в контейнере РАБОТАЕТ |
| **Формат** | **ПЕРЕСАДКА, не тест**: контейнер становится дефолтом рабочего флоу; хост-путь не поддерживаем (канон: на тачке — только Docker и файлы) |
| **Пререквизит** | skeleton **0.2.2** (сторона devopser, см. ниже) — до него не стартовать |

## Цель

Перевести рабочие Claude-сессии brainer (architect + owner) в devbox-контейнер:
креды переживают пересоздание контейнера, роль-флоу (claude-scope, git-gate)
работает, коммит+push уходят изнутри. После DoD хост-сессии — легаси.

## Пререквизит: skeleton 0.2.2 (заказ owner-skeleton, devopser)

Шаблон devcontainer дополняется по blueprint D4 + вашим Д6/Д7:
1. **Секрет-volumes** (точечные, НЕ весь home): `~/.claude` + `~/.claude.json`,
   `~/.npmrc`, `~/.config/gh`, `~/.gitconfig` — home остаётся cattle, секреты
   переживают пересоздание. Реализация (volume-на-каталог + файл) — за owner.
2. **node_modules в named volume** (ваш Д6: bind-mount install >11 мин висяк
   против 30 s в volume) — в шаблон или README-правило, решение owner.
3. README: ☠ Д7 (`rm -rf node_modules` через bind-mount — 193 s и ломает FS —
   не делать; пересоздавать volume), Д8-нюанс (uv взял системный python — как
   добиться uv-managed), «вход в роль — env, не .ps1» (см. ниже).

## Порядок пересадки (чек-лист)

1. Синк скелета до 0.2.2 (`pnpm dlx @omnifield/skeleton`).
2. **Windows: рабочая копия — клон в WSL2 FS** (канон, фундамент п.3; bind-mount
   с NTFS — источник ваших Д6/Д7-болей).
3. Занос кредов (однократно, дальше живут в секрет-volumes):
   - `~/.claude/.credentials.json` — файлом (ровно то, что произвёл бы `/login`;
     ваш проверенный путь `docker cp`) + `hasTrustDialogAccepted` в `~/.claude.json`
     контейнера; интерактивный `/login` — не канон (приоритет-флип user);
   - `~/.npmrc` с PAT (образец — devopser `workstation/README.md`);
   - `gh auth login --with-token` + `gh auth setup-git` (ваш проверенный путь) +
     `git config user.*`.
4. **Вход в роль — через env, не скрипт**: pwsh в образ не тащим (ваш Д9),
   `claude-scope.ps1` остаётся хост-историей. Scope задаётся при запуске сессии:
   `OMNIFIELD_SCOPE=<scope>` (`containerEnv` / `docker exec -e`); sh-обёртку
   у себя — на ваше усмотрение. SessionStart-хуки (.mjs) — из bind-mount
   рабочей копии, работают на node образа.
5. Прогон рабочего флоу: architect-сессия (полный git) и owner-сессия под
   git-gate — читает/пишет/коммитит/пушит изнутри; ваш оркестратор headless-сессий.
6. **Контрольный тест персистентности**: пересоздать контейнер → сессия живёт
   без повторного заноса кредов.
7. Порты (если нужен backend наружу): devcontainer-CLI не публикует
   `forwardPorts` — для CLI-пути `appPort`/`-p` (ваша находка).

## Границы

- Образ и шаблон не чинить у себя — находки фидбеком, чиним мы (эталон один).
- **Docker-socket в devbox НЕ пробрасывать** (socket = root хост-докера; агент
  с ним = вся машина). Ops-профиль с socket — только architect-сессии devopser,
  отдельный осознанный конфиг.
- Наблюдаемость агент-сессий — ваш продукт; хост-сервисы из контейнера — через
  `host.docker.internal` (в шаблоне с 0.2.1).
- Compose ваших сервисов — не этот бриф (отдельный заказ, когда решите).

## DoD

Обе роль-сессии (architect + owner) работают из контейнера end-to-end
(включая push), креды переживают пересоздание, на хост ничего не поставлено.
Фидбек — `briefs/feedback-container-sessions-brainer.md` сюда.

## Вопросы на ревью оракула (до запуска)

1. Секреты в named volumes: plaintext-креды в docker-volume читаемы любым, у кого
   есть docker на машине. Для single-user тачки принимаем? Альтернатив без
   усложнения не видно (env-инжект — те же яйца, vault — оверкилл для dev).
2. Граница «вход через env вместо claude-scope.ps1»: identity-баннер и marker-хук
   заводятся от `OMNIFIELD_SCOPE` — достаточно ли, или sh-порт скрипта нужен
   в шаблон (а не «на усмотрение потребителя»)?

---

## 🔍 Ревью оракула (2026-07-10) — ✅ АПРУВ с поправками

Формат (пересадка, не тест), границы (socket не дефолт, образ не чинить у себя),
DoD — ок, канону containers-only соответствует. Поправки ниже — ВСЕ на стороне
devopser (уходят в состав skeleton 0.2.2, отдельный closeout-бриф
`skeleton-0.2.2-closeout.md`); brainer-архитектору в чек-листе ничего не меняется,
кроме п.3 (занос кредов станет «в секрет-каталог», путь укажет шаблон).

**П1 — volume-на-файл не собирается; дизайн секретов = ОДИН каталог + env-указатели.**
Named volume монтируется только в КАТАЛОГ; `~/.claude.json`, `~/.npmrc`,
`~/.gitconfig` — файлы. «Volume-на-каталог + файл» в лоб невозможен, симлинк-обвязка
в postCreate = костыль. Корневое решение — один секрет-каталог, инструменты
указываем на него штатными env (все четыре это поддерживают):

```
volume omnifield-secrets → /home/vscode/.secrets
containerEnv:
  CLAUDE_CONFIG_DIR=/home/vscode/.secrets/claude    # .claude И .claude.json живут тут
  NPM_CONFIG_USERCONFIG=/home/vscode/.secrets/npmrc
  GIT_CONFIG_GLOBAL=/home/vscode/.secrets/gitconfig
  GH_CONFIG_DIR=/home/vscode/.secrets/gh
```

Один volume вместо пяти, home остаётся cattle, файл-маунтов нет классом. Бонус:
`CLAUDE_CONFIG_DIR` — уже словарь экосистемы (мульти-акк kernel brainer: аккаунт =
свой config-dir → подкаталог/подмена volume). Проверить прогоном: (а) `.claude.json`
действительно уезжает в `CLAUDE_CONFIG_DIR` (в свежих версиях — да), (б) pnpm
подхватывает `NPM_CONFIG_USERCONFIG` (npm-config семантика), (в) `gh auth setup-git`
пишет в `GIT_CONFIG_GLOBAL` (env должен быть в окружении сессии, не только exec).

**П2 — имя секрет-volume МАШИННОЕ, не пер-репо.** Креды — уровень машины: один
`omnifield-secrets` на все репо (brainer/weber/devopser/…), занос кредов один раз,
не N. (`omnifield-pnpm-store` уже назван так — та же логика.)

**П3 — node_modules-volume = README-правило для транзишена, НЕ шаблон.** Канон-путь
(п.2 чек-листа: клон в WSL2 FS; хост node не запускает вообще — containers-only)
снимает Д6/Д7 классом: платформенный конфликт существует только у NTFS-bind
СТАРОГО виндового клона. Пер-пакетные volumes (нюанс Д7) в шаблоне — постоянная
громоздкость ради переходного случая. В README: «переезжаешь со старого клона →
переклонируй в WSL2 FS (канон); volume-overlay — временная миграционная мера».

**Ответ В1 (plaintext в volume) — ПРИНИМАЕМ.** Single-user тачка: граница доверия
не хуже хоста (на Windows `~/.claude` и так plaintext; docker-доступ = тот же user).
В README devbox — явная строка: «секрет-volume читаем любым процессом с
docker-доступом; multi-user/сервер — отдельная проработка, не сейчас».

**Ответ В2 (env вместо ps1) — env ДОСТАТОЧНО, sh-порт в skeleton НЕ нужен.**
Identity-механика (scope-identity/marker/git-gate) заводится от `OMNIFIELD_SCOPE` —
хватает. Лаунчер (выбор модели per роль и пр.) — часть агент-харнесса, который по
разрезу 2026-07-08 уезжает в BRAINER; в devopser-шаблон (чистая инфра, без агентов)
его не тащим. sh-обёртка на стороне brainer — как у вас и написано, «на усмотрение»;
каноном станет вместе с харнесс-переездом в brainer.

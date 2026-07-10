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

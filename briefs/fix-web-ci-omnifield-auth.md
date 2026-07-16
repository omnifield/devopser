# Бриф: web-ci тянет @omnifield-пакеты (auth) + frontend packages:read

> **Трек:** Foundation — Шаг 5, эскалация из green-proof (chater на vite-preset)
> **Адресат:** архитектор / owner **devopser** (зона `.github/workflows/web-ci.yml` + `packages/skeleton/init.mjs`)
> **Заказчик:** workspace-архитектор (omnifield-hub)

## North star
web-ci — универсальный гейт для standalone-фронта экосистемы. Фронт теперь **может тянуть `@omnifield/*`
пресеты** (GitHub Packages) — web-ci обязан их аутентифицировать, как node-ci. Ноль продуктовой заточки.

## Зачем (green-proof chater)
chater перешёл на `@omnifield/vite-preset@0.1.0` → web-ci упал:
`ERR_PNPM_FETCH_401 npm.pkg.github.com/@omnifield/vite-preset — No authorization header`.
Корень — **мой дефект Шага 1**: web-ci собран с допущением «web не тянет @omnifield → packages/auth не нужны»
(комментарий web-ci.yml). Допущение больше неверно.

## Скоуп (зона devopser)
1. **`web-ci.yml` — @omnifield-auth (зеркалить node-ci):**
   - `setup-node@v6` `with:` → добавить `registry-url: https://npm.pkg.github.com` + `scope: '@omnifield'`.
   - шаг `install` → `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
   - обновить шапку-комментарий: web МОЖЕТ тянуть @omnifield-пресеты → caller даёт `packages: read`
     (nx-set-shas по-прежнему нет → `actions` не нужен).
2. **`init.mjs` `buildCiYml` — frontend даёт `packages: read`:**
   в ветке `if (hasFrontend) …` добавить `perms.add("packages: read")` (фронт может тянуть @omnifield-пресет).

## DoD (зона devopser)
- [ ] web-ci ставит @omnifield-auth (registry-url+scope+NODE_AUTH_TOKEN); `pnpm install` резолвит `@omnifield/*`.
- [ ] `buildCiYml`: frontend-стек → `permissions` включает `packages: read`.
- [ ] PR зелёный; ноль продуктовой заточки.

## Handoff → chater (PR #22)
- Регенерить/поправить `.github/workflows/ci.yml`: `permissions` web-job += `packages: read` (ci.yml init-only —
  вручную добавить, либо delete+`skeleton sync` после мержа этого фикса). Тогда web-ci PR #22 пройдёт.
- Package-grant: `@omnifield/vite-preset` (и др.) должен иметь Actions-access на репо-вызыватель chater
  (Package settings → Manage Actions access) — как для biome/nx-preset. Проверить.

## Проверка north star
Если auth хардкодит продукт/токен вне GITHUB_TOKEN, или packages:read даётся всем стекам (не только тянущим
@omnifield) — дефект. Меха универсальна, гейт как node-ci.

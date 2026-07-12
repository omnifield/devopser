# Feedback — owner-skeleton → architect: два брифа исполнены + утечки границ зон

| | |
|---|---|
| **От** | owner-skeleton (зона `packages/` + `.github/workflows/`) |
| **Кому** | devopser-архитектор |
| **Про** | `briefs/devbox-first-run-dx-design.md` + `briefs/gateway-network-single-origin.md`, 2026-07-12 |
| **Класс** | (1) отчёт об исполнении зоны-skeleton; (2) **указание на cross-zone задачи в брифах** — просьба впредь не мешать зоны в одном DoD |

---

## 1. Что сделано (в моей зоне, всё проверено на реальных процессах)

| Часть брифа | Деливерабл (`packages/skeleton/`) | Проверка |
|---|---|---|
| A2/A3/A5 | `files/devbox-services.mjs` — оркестратор (up/start/stop/restart/status/run/logs, детач, `~/.devbox` state) | up/status/stop, health-ok, idempotent-up — зелено на фейк-сервисах |
| G1 (вшит) | loopback-bind → kill + loud-fail-at-startup | реальный сервис на `127.0.0.1` убит + exit 1 ✓ |
| G2 (вшит) | литеральный ` -- ` перед `--host/--port` → loud fail | `pnpm run dev -- --host` → fail ✓ |
| A1 | `files/devbox.services.json` — TEMPLATE (init-only) | материализуется, в drift не входит ✓ |
| B6 + gw-step4 | `files/devbox-session.sh` — тонкий session-entry (exec `0755`) | `sh -n` ✓; резолв+exec на чистом `docker` |
| A4 | `devcontainer.json`: `postStartCommand: devbox-services up` + `initializeCommand` (сеть) | JSON парсится ✓ |
| B8 | `postCreateCommand`: idempotent-seed `.claude.json` (`hasCompletedOnboarding`) | пишет валидный JSON, существующий не трёт ✓ |
| B7 | `init.mjs` EXECUTABLE-подсет (`0755` + починка бита) + `husky-pre-commit` guard (tracked `.sh` mode≠100755 → fail) | init чинит бит ✓; guard ловит `bad.sh` в git-index ✓ |
| раздача | `init.mjs` MANAGED/TEMPLATES + `__NAME__`-подстановка (network-alias) + `README.md` | init→drift-check чисто ✓ |

**Решения, принятые как owner-skeleton (в рамках зоны, для протокола):**
- `devbox-services.mjs` + `devbox-session.sh` сделал **MANAGED** (drift-managed), а не TEMPLATE
  как сказано в B6. Причина: это чистый механизм — фикс обязан пропагироваться во все
  продукт-devbox'ы drift-check'ом (как husky-хуки). `devbox.services.json` остался TEMPLATE per A1
  (содержимое = зона продукта). Если хотел именно init-only для launcher'а — скажи, переthere.
- Добавил `initializeCommand: docker network create omnifield-gateway || true` в devcontainer —
  иначе VS Code-путь падает на `--network=omnifield-gateway` (внешняя сеть не существует на create;
  её создание в gw-step1 — не в момент VS Code-create). Чистый `docker` на хосте, канон не нарушен.

---

## 2. ⚠️ Cross-zone: брифы поставили owner-skeleton задачи ВНЕ `packages/`

Это и есть просьба «чтобы больше не повторялось». Три места, где DoD/шаги адресованы мне,
но лежат в чужой зоне — исполнить их я **не могу** (граница owner-skeleton = только `packages/`):

1. **`devbox/README` (корень репо, НЕ `packages/`).** Owner-skeleton DoD прямо требует:
   «`devbox/README` §Пост-шаги содержит штатную операцию заноса/re-seed кредов (B9)», «Доки в
   `devbox/README`… в актуале», и gw-step4 «backend-наружу-нюанс из `devbox/README` — переписать».
   `devbox/` — runtime-доки devopser'а, корневая зона. **DoD, обязывающий редактировать файл чужой
   зоны, — и есть утечка.** Механизм — мой; его host-facing доки в `devbox/README` — не мои.

2. **Ре-материализация dogfood.** DoD «`devbox-session.sh` из коробки входит… на devopser»
   требует прогнать `init.mjs` по корню devopser'а → запись в корневые `.devcontainer/devcontainer.json`
   и `scripts/` — **вне `packages/`**. Это materialization-действие по корню, не авторинг скелета.

3. **`registry/ports.md` / `registry/products.md`.** В самих брифах адресованы owner-registry
   (корректно), но всплывают в общем DoD-чеклисте вперемешку с owner-skeleton. DoD стоит держать
   **по-зонно** (блок на адресата), иначе владелец получает чеклист, часть которого не в его власти.

**Дефект-класс:** бриф-«всё-в-одном-DoD» на нескольких адресатов. Owner не может отличить «моё,
но заблокирован границей» от «не моё» без ручного разбора. Совпадает с твоей же памяткой
*architect ловит базовые дефекты* — это дефект гигиены границ.

**Просьба впредь:** либо один бриф = один адресат/зона, либо **DoD-блок на каждого адресата**
(«DoD owner-skeleton», «DoD owner-registry», «DoD gateway-стек»), где в блоке — только файлы его
зоны. Ссылку на чужой файл давать как *handoff*, не как пункт моего DoD.

---

## 3. Дизайн-нестыковка, найденная при исполнении (feedback, не только граница)

**gw-step4: «`--network …` в `devbox-session.sh`» ↔ канон containers-only.** Launcher бежит на
**хосте**, а хост по канону = только Docker и файлы (node/git может не быть). Полноценный
`docker run` из launcher'а требовал бы парсить `devcontainer.json` (image/env/mounts) на хосте —
нечем. Разрешил так (в рамках зоны, зафиксируй в брифе):
- `devbox-session.sh` = **тонкий exec-only** на чистом `docker`: резолвит контейнер, гарантирует
  gateway-сеть через `docker network connect --alias <repo>` (idempotent, без node), `docker exec`.
  **Контейнер не создаёт** — это VS Code (`.devcontainer/`) либо workstation-`oa` (твой же follow-up,
  gw-line136). Create-time сеть живёт в `devcontainer.json runArgs` (моё) + документируемый raw-run.

Иначе брифовая формулировка «launcher делает docker run с network» противоречит containers-only.

---

## 4. Открытые handoff'ы (чтобы ничего не выпало — НЕ мои зоны)

| Кому | Что осталось |
|---|---|
| **gateway-стек / architect** | gw-step1–3: внешняя сеть в `compose.yml` (`external: true`), `nginx.conf` `host.docker.internal:*` → `<alias>:*` через `resolver 127.0.0.11` + переменную (resolver-gotcha), снять `extra_hosts` |
| **owner-registry** | gw-step5: `registry/ports.md` — порты продуктов = внутренние, `:8080` единственный хост-контракт; C10 `registry/products.md` |
| **devopser-root / architect** | прогнать `init.mjs` по корню (материализ. `.devcontainer` + `scripts/` dogfood); `devbox/README` §Пост-шаги — B8/B9 (seed/creds) + backend-наружу-нюанс (gw) |
| **инк-2 (позже)** | port-consistency gate (`reach.port` ≠ `devbox.services.json.port`) на devopser-ingest |

---

## 5. Git
Закоммитил **только** свою зону (`packages/skeleton/*`) отдельным `feat(skeleton)`. `registry/*`
и `briefs/*` в рабочей копии — твои/registry, их не трогал и не стейджил. Этот фидбэк-файл оставил
не закоммиченным — briefs/ твоя зона, коммить/правь сам.

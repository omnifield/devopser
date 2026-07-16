# @omnifield/vite-preset — гибкий frontend-пресет экосистемы

Единая фабрика vite-конфига для продукт-фронтов: **base из манифеста** (единый источник),
server-канон (`host`/`allowedHosts`) и **плагин-слот** под будущий фреймворк. Продукт расширяет
пресет ≤5 строками — ноль хардкода vite-специфики в продукте
(бриф `briefs/vite-preset-single-origin-base.md`).

## Расширение продуктом (≤5 строк)

`web/vite.config.ts`:

```ts
import { defineOmnifieldVite } from "@omnifield/vite-preset";
import solid from "vite-plugin-solid";

export default defineOmnifieldVite({
  plugins: [solid()],
});
```

Всё. `base`, `server.host`, `server.allowedHosts` — из пресета; плагины продукта — через слот.

## Откуда base (единый источник)

Пресет читает `omnifield.yaml` продукта (ищет вверх от cwd — vite.config обычно в `web/`,
манифест в корне репо) и берёт **front-route** = первый маршрут `reach.routes[]` вне `/api/`
(иначе первый). `base` = его `path` c завершающим слэшем.

```yaml
# omnifield.yaml
reach:
  routes:
    - path: /chater      # ← front-route → base "/chater/"
      port: 5173
    - path: /api/chater  # backend — дверь снимает /api, не влияет на base
      port: 8787
```

Route-VALUE живёт **один раз** — в манифесте. Тот же файл читает дверь (`hub-core`), поэтому
`base` фронта = маршрут, под который дверь его проксирует (`:8080/chater/` → SPA 200). Никакого
`base` в vite.config руками — это дубль контракта и он не переживёт миграцию на свой фреймворк.

## Плагин-слот (место под будущий фреймворк — north star)

Сейчас канон — нативный **vite**, скоро — свой веб-фреймворк, куда фронты переедут; кастом-мехи
по большей части через **плагины**. Гибкость заложена так, что миграция = **конфиг, не rewrite**:

- **Плагины продукта и фреймворка** идут одним слотом `opts.plugins` — пресет их компонует.
  Будущий фреймворк издаёт свой vite-плагин → продукт добавляет его в тот же массив.
- **Builder-agnostic ядро** (`@omnifield/vite-preset/manifest`: `resolveBase`, `readManifest`,
  `resolveFrontRoute`) не знает о vite. Будущий `@omnifield/<framework>-preset` переиспользует
  его для той же деривации base — меняется лишь тонкое vite-связующее (`index.js`), не источник base.

```ts
// будущий фреймворк — тем же слотом, без переписывания конфига продукта:
import { defineOmnifieldVite } from "@omnifield/vite-preset";
import framework from "@omnifield/framework/vite";

export default defineOmnifieldVite({ plugins: [framework()] });
```

## Опции `defineOmnifieldVite(opts)`

| opt | дефолт | зачем |
|---|---|---|
| `plugins` | `[]` | слот плагинов продукта/фреймворка |
| `server` | `{ host: true, allowedHosts: true }` | канон переопределяемо (мержится поверх) |
| `base` | из манифеста | escape hatch; env `OMNIFIELD_BASE` — то же |
| `manifestPath` / `cwd` | поиск вверх от `process.cwd()` | если `omnifield.yaml` лежит нестандартно |
| `…UserConfig` | — | любой прочий vite-канон пробрасывается как есть |

## Заметки потребителю

- **API через дверь-контракт:** под single-origin фронт зовёт backend по `/api/<name>/…`
  (дверь снимает `/api` → нативный `/<name>/` бэкенда), не через vite-proxy. Реконсиляция
  dev↔door — зона продукта.
- **host-guard vite:** `allowedHosts: true` пропускает Host от двери (`:8080`). Сузишь до списка —
  добавь хост двери, иначе `:8080/<name>` = 403.
- **HMR под дверью** работает через pass-through фронт-маршрут (дверь форвардит ws Upgrade,
  vite-клиент берёт origin страницы + base). Тонкая настройка — `server.hmr` в продукте.
- Полная Zod-валидация манифеста — авторитет двери (`hub-core`); пресет читает `reach.routes`
  из того же файла и внятно падает, если фронт-маршрута нет.

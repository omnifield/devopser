#!/usr/bin/env node
// hub-core/generate.mjs — генератор ЯДРА ХАБА воркспейса (briefs/hub-core-design.md,
// briefs/feedback-hub-core-as-hub-under-isolation.md, briefs/hubcore-door-from-registry.md).
//
// Модель: хаб = тонкий менеджер воркспейса (не продукт). Ядро = реестр + дверь + канал.
// Этот скрипт — «реестр → дверь»:
//   ВХОД  — publish-volume `omnifield-registry` (ro): каждый продукт-devbox на старте кладёт
//           туда свой omnifield.yaml как <name>.yaml (scripts/devbox-publish.mjs, Шаг 5 §A).
//           hub-core ГЛОБИТ *.yaml — НЕ fs-скан сиблингов (сломан под изоляцией: репо
//           продуктов в хабе не смонтированы). Реестр НЕ зависит от up-состояния продуктов:
//           лёгший продукт держит маршрут по последнему опубликованному манифесту
//           (last-published-wins) → таблица маршрутов не моргает вместе с контейнерами.
//   ВАЛИД. — Zod (@omnifield/contract-manifest, полная проверка вкл. superRefine); невалидный
//           манифест — loud-warn + skip, не роняет генерацию.
//   ВЫХОД — door-volume `omnifield-gateway-conf`: nginx.conf (маршруты) + hub/index.html
//           (лендинг). gateway (nginx) монтирует тот же volume. Рукописного nginx/лендинга
//           больше нет; committed stacks/gateway/nginx.conf + hub/ ретайрены.
//
//   node generate.mjs           — пишет сгенерённые файлы в door-volume
//   node generate.mjs --check   — не пишет; exit 1 при дрейфе (рантайм-идемпотентность в хабе:
//                                 «дверь в volume расходится с реестром — кто-то правил руками
//                                 / устаревший образ»). НЕ CI-шаг репо (входы живут в volume).
//
// Пути volume задаются env (симметрично publish-стороне), дефолты = mount-таргеты в хабе:
//   OMNIFIELD_REGISTRY_DIR  (ro, вход)  — дефолт /omnifield-registry
//   OMNIFIELD_GATEWAY_DIR   (rw, выход) — дефолт /omnifield-gateway
//
// Канал (docker-ops / liveStatus) — Portainer, отдельно (дизайн §4). Здесь — только реестр+дверь.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ProductManifest } from "@omnifield/contract-manifest";

// Вход — publish-volume (глоб), НЕ /workspaces-скан. Выход — door-volume.
const REGISTRY_DIR = process.env.OMNIFIELD_REGISTRY_DIR || "/omnifield-registry";
const GATEWAY_DIR = process.env.OMNIFIELD_GATEWAY_DIR || "/omnifield-gateway";
const NGINX_OUT = join(GATEWAY_DIR, "nginx.conf");
const LANDING_OUT = join(GATEWAY_DIR, "hub", "index.html");

const check = process.argv.includes("--check");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// --- 1. Реестр: глоб publish-volume + валидация манифестов ------------------
// Источник — omnifield-registry/*.yaml (по файлу на продукт, ключ = basename = <name> =
// network-alias = manifest.name; publisher гарантирует, devbox-publish.mjs §A). Каждый файл
// самодостаточен: наличие файла = продукт в реестре независимо от up-состояния контейнера.
function buildRegistry() {
  const registry = [];
  const skipped = [];

  let entries;
  try {
    entries = readdirSync(REGISTRY_DIR, { withFileTypes: true });
  } catch (err) {
    // volume не смонтирован / пуст — не роняем генерацию: дверь всё равно должна собраться
    // (пустой валидный конфиг), gateway обязан стартовать без продуктов (resolver-дизайн).
    console.warn(
      `[hub-core] ⚠ registry-volume ${REGISTRY_DIR} недоступен (${err.code || err.message}) — ` +
        `реестр пуст. Смонтирован ли omnifield-registry (ro)?`,
    );
    return { registry, skipped };
  }

  for (const e of entries) {
    if (!e.isFile() || !/\.ya?ml$/i.test(e.name)) continue;
    const p = join(REGISTRY_DIR, e.name);
    const key = e.name.replace(/\.ya?ml$/i, ""); // basename = имя продукта (публикатором)
    let raw;
    try {
      raw = parseYaml(readFileSync(p, "utf8"));
    } catch (err) {
      skipped.push(`${e.name}: YAML не парсится — ${err.message}`);
      continue;
    }
    const res = ProductManifest.safeParse(raw);
    if (!res.success) {
      const why = res.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      skipped.push(`${e.name}: манифест невалиден — ${why}`);
      continue;
    }
    registry.push({ key, m: res.data });
  }
  registry.sort((a, b) => a.m.name.localeCompare(b.m.name));
  return { registry, skipped };
}

// --- 2. Дверь: nginx.conf из реестра --------------------------------------
// upstream = <alias>:<port>, alias = имя продукта (docker network-alias = имя репо =
// manifest.name). resolver → runtime-резолв (gateway стартует без поднятых продуктов).
//
// Конвенция маршрутов (минимум допущений — форма из манифеста, без нового поля контракта):
//   • фронт-маршрут `/<name>` (path НЕ под /api/) — pass-through: proxy_pass без URI,
//     nginx отдаёт запрос как есть (backend сам серверит под своим `/<name>/`).
//   • backend-маршрут `/api/<name>` (path под /api/) — REWRITE: снимаем префикс `/api`,
//     backend слушает под нативным `/<name>/`. `/api/<name>/…` → `<name>:<port>/<name>/…`.
//
// nginx-gotcha: при переменной в proxy_pass ($up) nginx НЕ делает авто-подстановку URI из
// location — URI берётся из `rewrite … break`. Поэтому api-форма = rewrite + proxy_pass без URI
// (не `proxy_pass http://$up:port/<name>/` — с переменной это не переписывает префикс).
function genLocation(m, r) {
  const v = `$up_${m.name.replace(/-/g, "_")}_${r.port}`;
  const isApi = r.path.startsWith("/api/"); // конвенция backend-маршрута: /api/<name>[/…]
  const common =
    `        set ${v} ${m.name};\n` +
    (isApi ? `        rewrite ^/api(/.*)?$ $1 break;\n` : "") +
    `        proxy_pass http://${v}:${r.port};\n` +
    `        proxy_http_version 1.1;\n` +
    `        proxy_set_header Upgrade $http_upgrade;\n` +
    `        proxy_set_header Connection $connection_upgrade;\n` +
    `        proxy_set_header Host $host;\n` +
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n` +
    `        proxy_set_header X-Forwarded-Proto $scheme;\n` +
    `        proxy_buffering off;\n` +
    `        proxy_read_timeout 1h;\n`;
  const native = isApi ? ` → ${m.name}:${r.port}${r.path.replace(/^\/api/, "") || "/"} (rewrite -/api)` : ` → ${m.name}:${r.port}`;
  if (isApi) {
    return (
      `    # ${m.name} (${m.type})${native}\n` +
      `    location ${r.path} {\n` +
      common +
      `    }`
    );
  }
  // Фронт: bare /<name> → 301 /<name>/ (SPA под base /<name>/ из пресета — иначе /<name>=404);
  // сервинг под /<name>/. api-маршрут (rewrite) выше не трогаем.
  return (
    `    # ${m.name} (${m.type})${native}\n` +
    `    location = ${r.path} { return 301 ${r.path}/; }\n` +
    `    location ${r.path}/ {\n` +
    common +
    `    }`
  );
}

function genNginx(registry) {
  const locs = [];
  for (const { m } of registry) {
    if (!m.reach) continue;
    for (const r of m.reach.routes) locs.push(genLocation(m, r));
  }
  const body = locs.length ? `\n${locs.join("\n\n")}\n` : "\n";
  return (
    `# GENERATED by hub-core (devopser/hub-core/generate.mjs) — НЕ править руками.\n` +
    `# Источник — omnifield-registry/*.yaml (publish-volume продуктов). Регенерация в хабе:\n` +
    `#   docker compose run --rm hub-core   (или node generate.mjs внутри hub-core-образа).\n` +
    `# Single-origin: наружу только :8080, апстримы по docker-сети omnifield-gateway\n` +
    `# (alias = имя продукта). resolver → runtime-резолв (gateway стартует без продуктов).\n\n` +
    `resolver 127.0.0.11 valid=10s ipv6=off;\n\n` +
    `# ws/HMR-safe: upgrade на ws-запрос, close иначе (vite HMR + обычные/SSE).\n` +
    `map $http_upgrade $connection_upgrade {\n    default upgrade;\n    ''      close;\n}\n\n` +
    `server {\n    listen 80;\n    server_name _;\n    charset utf-8;\n\n` +
    `    root /usr/share/nginx/html;\n    index index.html;\n` +
    `${body}}\n`
  );
}

// --- 3. Лендинг: карточки продуктов из реестра ----------------------------
function genLanding(registry) {
  const cards = registry
    .map(({ m }) => {
      // ссылка карточки = фронт-маршрут (первый не-/api), иначе первый маршрут, иначе #
      const front = m.reach?.routes.find((r) => !r.path.startsWith("/api/"));
      const href = front?.path ?? m.reach?.routes[0]?.path ?? "#";
      const tag = m.reach ? m.type : `${m.type} · headless`;
      return (
        `      <a class="card" href="${esc(href)}">\n` +
        `        <h2>${esc(m.title ?? m.name)}</h2>\n` +
        `        <p class="tag">${esc(tag)}</p>\n` +
        `        <p class="desc">${esc(m.description ?? "")}</p>\n` +
        `        <code>${esc(href)}</code>\n` +
        `      </a>`
      );
    })
    .join("\n");
  const empty = registry.length
    ? ""
    : `      <p style="opacity:.6">Ни одного опубликованного продукта. Подними продукт-devbox — он\n` +
      `      опубликует манифест в omnifield-registry, регенери дверь.</p>`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omnifield — воркспейс</title>
<style>
  :root { color-scheme: light dark; --bg:#0d1117; --fg:#e6edf3; --card:#161b22; --br:#30363d; --acc:#58a6ff; }
  * { box-sizing:border-box; } body { margin:0; font:16px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:2.5rem 1.5rem 1rem; } header h1 { margin:0; font-size:1.8rem; } header p { margin:.3rem 0 0; opacity:.6; }
  main.grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); padding:1.5rem; max-width:1100px; }
  .card { display:block; padding:1.1rem 1.2rem; background:var(--card); border:1px solid var(--br); border-radius:12px; text-decoration:none; color:inherit; transition:border-color .15s; }
  .card:hover { border-color:var(--acc); }
  .card h2 { margin:0 0 .2rem; font-size:1.15rem; } .tag { margin:0; font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; opacity:.55; }
  .desc { margin:.5rem 0 .7rem; opacity:.85; font-size:.92rem; } .card code { font-size:.82rem; color:var(--acc); }
  footer { padding:1rem 1.5rem 2.5rem; opacity:.4; font-size:.8rem; }
</style>
</head>
<body>
  <header><h1>Omnifield</h1><p>Воркспейс · ${registry.length} продукт(ов) · единая дверь :8080</p></header>
  <main class="grid">
${cards}${empty}
  </main>
  <footer>GENERATED hub-core — реестр из omnifield-registry (publish-volume). Канал (ops) — Portainer.</footer>
</body>
</html>
`;
}

// --- main -----------------------------------------------------------------
const { registry, skipped } = buildRegistry();
for (const s of skipped) console.warn(`[hub-core] ⚠ пропущен ${s}`);
// Пустой реестр — НЕ фатал: дверь собирается пустой-валидной, gateway обязан стартовать без
// продуктов (resolver-дизайн). Продукты подтянутся регенерацией по мере publish в volume.
if (!registry.length) {
  console.warn(`[hub-core] ⚠ ни одного валидного манифеста в ${REGISTRY_DIR} — дверь пустая (0 маршрутов).`);
}

const nginx = genNginx(registry);
const landing = genLanding(registry);

if (check) {
  let drift = false;
  for (const [path, gen] of [
    [NGINX_OUT, nginx],
    [LANDING_OUT, landing],
  ]) {
    const cur = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (cur !== gen) {
      console.error(`[hub-core] ДРЕЙФ: ${path} расходится с реестром — регенери (кто-то правил руками / устаревший образ).`);
      drift = true;
    }
  }
  process.exit(drift ? 1 : 0);
}

mkdirSync(dirname(LANDING_OUT), { recursive: true });
writeFileSync(NGINX_OUT, nginx);
writeFileSync(LANDING_OUT, landing);
console.log(`[hub-core] реестр (${registry.length}): ${registry.map((r) => r.m.name).join(", ") || "—"}`);
if (skipped.length) console.log(`[hub-core] пропущено: ${skipped.length}`);
console.log(`[hub-core] сгенерено в door-volume:\n  ${NGINX_OUT}\n  ${LANDING_OUT}`);

// hub-core/test.mjs — эмиттер-прог генератора двери (Docker в сессии недоступен —
// доказываем формой сгенерённого nginx.conf/лендинга против стаб-registry, [[no-docker-in-session]]).
// Живой :8080/api/chater/healthz → 200 доказывает ревьюер/Канал в хабе (DoD live-прог).
//   node --test   (или pnpm -C hub-core test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = join(HERE, "generate.mjs");

const CHATER = `apiVersion: omnifield.dev/v1
name: chater
type: fullstack
title: Chater
description: Чат-продукт
reach:
  routes:
    - path: /chater
      port: 5173
    - path: /api/chater
      port: 8787
`;

// backend-only: reach лишь /api/ (тип backend — reach не обязателен, но объявлен как API).
const TASKER = `apiVersion: omnifield.dev/v1
name: tasker
type: backend
title: Tasker
description: Трекер задач
reach:
  routes:
    - path: /api/tasker
      port: 8030
`;

// headless: сервис без reach вовсе (в дверь не ходит).
const WORKER = `apiVersion: omnifield.dev/v1
name: worker
type: service
title: Worker
description: Фоновый воркер
`;

// Стенд: временный registry-volume (вход) + door-volume (выход); чистим за собой.
function stand(manifests = { "chater.yaml": CHATER }) {
  const root = mkdtempSync(join(tmpdir(), "hubcore-"));
  const reg = join(root, "registry");
  const gw = join(root, "gateway");
  mkdirSync(reg, { recursive: true });
  for (const [name, body] of Object.entries(manifests)) writeFileSync(join(reg, name), body);
  const env = { ...process.env, OMNIFIELD_REGISTRY_DIR: reg, OMNIFIELD_GATEWAY_DIR: gw };
  const run = (args = []) => execFileSync("node", [GEN, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const nginx = () => readFileSync(join(gw, "nginx.conf"), "utf8");
  const landing = () => readFileSync(join(gw, "hub", "index.html"), "utf8");
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, reg, gw, env, run, nginx, landing, cleanup };
}

test("глоб registry-volume: продукт из <name>.yaml попадает в дверь (не fs-скан)", () => {
  const s = stand();
  try {
    s.run();
    const conf = s.nginx();
    assert.match(conf, /location = \/chater \{ return 301 \/chater\/; \}/, "bare /chater → 301 /chater/ (SPA под base из пресета)");
    assert.match(conf, /location \/chater\/ \{/, "фронт-маршрут /chater/ сгенерён (trailing-slash)");
    assert.match(conf, /location \/api\/chater \{/, "backend-маршрут /api/chater сгенерён");
    assert.match(conf, /resolver 127\.0\.0\.11 valid=10s ipv6=off;/, "resolver сохранён (gateway стартует без продуктов)");
  } finally {
    s.cleanup();
  }
});

test("/api/<name> rewrite: снимает /api, бьёт в нативный /<name>/ на порту backend", () => {
  const s = stand();
  try {
    s.run();
    const conf = s.nginx();
    const api = conf.match(/location \/api\/chater \{[\s\S]*?\n {4}\}/)[0];
    assert.match(api, /rewrite \^\/api\(\/\.\*\)\?\$ \$1 break;/, "rewrite снимает префикс /api");
    assert.match(api, /proxy_pass http:\/\/\$up_chater_8787:8787;/, "upstream = chater:8787 (переменная → resolver)");
    // при переменной в proxy_pass URI берётся из rewrite, не из proxy_pass — проверяем, что URI в proxy_pass НЕ захардкожен
    assert.doesNotMatch(api, /proxy_pass http:\/\/\$up_chater_8787:8787\/chater/, "URI в proxy_pass с переменной не подставляется — только через rewrite");
  } finally {
    s.cleanup();
  }
});

test("фронт-маршрут /<name> — pass-through (без rewrite)", () => {
  const s = stand();
  try {
    s.run();
    const conf = s.nginx();
    const front = conf.match(/location \/chater\/ \{[\s\S]*?\n {4}\}/)[0];
    assert.doesNotMatch(front, /rewrite/, "фронт-маршрут без rewrite");
    assert.match(front, /proxy_pass http:\/\/\$up_chater_5173:5173;/, "upstream = chater:5173");
  } finally {
    s.cleanup();
  }
});

test("door-volume: пишет nginx.conf + hub/index.html; лендинг = карточка из реестра", () => {
  const s = stand();
  try {
    s.run();
    assert.match(s.landing(), /Chater/, "карточка продукта в лендинге");
    assert.match(s.landing(), /1 продукт/, "счётчик продуктов");
  } finally {
    s.cleanup();
  }
});

test("лендинг: fullstack (/<name>/) — кликабельная карточка ведёт на фронт /<name>/", () => {
  const s = stand(); // chater = fullstack (front /chater + api /api/chater)
  try {
    s.run();
    const html = s.landing();
    assert.match(html, /<a class="card" href="\/chater\/">/, "карточка = <a> на фронт /chater/ (без 301-хопа через bare)");
    assert.doesNotMatch(html, /<div class="card card--headless">/, "fullstack НЕ рендерит headless-карточку");
    assert.doesNotMatch(html, /href="\/api\/chater/, "клик не ведёт на /api/ у fullstack");
  } finally {
    s.cleanup();
  }
});

test("лендинг: backend-only (reach лишь /api/) — некликабельная headless-карточка, НЕ ведёт на JSON (ADR-9)", () => {
  const s = stand({ "tasker.yaml": TASKER });
  try {
    s.run();
    const html = s.landing();
    assert.match(html, /Tasker/, "карточка backend-продукта присутствует");
    assert.doesNotMatch(html, /<a class="card"[^>]*\/api\/tasker/, "карточка НЕ ссылается на /api/ (не притворяется аппом, не ведёт на JSON)");
    assert.match(html, /<div class="card card--headless">[\s\S]*?Tasker[\s\S]*?<\/div>/, "backend-only рендерится как некликабельный div.card--headless");
    assert.match(html, /backend · api/, "явный тег backend/api");
  } finally {
    s.cleanup();
  }
});

test("лендинг: headless без reach (service) — некликабельная карточка, без ссылки и без /api/", () => {
  const s = stand({ "worker.yaml": WORKER });
  try {
    s.run();
    const html = s.landing();
    assert.match(html, /<div class="card card--headless">[\s\S]*?Worker[\s\S]*?<\/div>/, "headless = некликабельный div");
    assert.match(html, /service · headless/, "тег headless для service без reach");
    assert.doesNotMatch(html, /<a class="card"/, "ни одной кликабельной карточки (нет UI-фронта)");
  } finally {
    s.cleanup();
  }
});

// DoD-прогон: knowledger объявил /knowledger/ в манифесте → карточка кликается на фронт.
test("прогон DoD: knowledger (/knowledger/ фронт + /api/knowledger) — карточка на фронт /knowledger/", () => {
  const KNOWLEDGER = `apiVersion: omnifield.dev/v1
name: knowledger
type: fullstack
title: Knowledger
description: База знаний
reach:
  routes:
    - path: /knowledger
      port: 5174
    - path: /api/knowledger
      port: 8040
`;
  const s = stand({ "knowledger.yaml": KNOWLEDGER });
  try {
    s.run();
    const html = s.landing();
    assert.match(html, /<a class="card" href="\/knowledger\/">/, "клик ведёт на фронт /knowledger/, НЕ на /api/ JSON (симптом закрыт)");
    assert.doesNotMatch(html, /href="\/api\/knowledger/, "карточка не ведёт на голый JSON");
  } finally {
    s.cleanup();
  }
});

test("--check: 0 при свежей генерации, 1 при ручной правке door-volume (рантайм-идемпотентность)", () => {
  const s = stand();
  try {
    s.run();
    // свежесгенерённое — дрейфа нет
    s.run(["--check"]);
    // руками портим дверь → --check ловит дрейф (exit 1)
    writeFileSync(join(s.gw, "nginx.conf"), "# tampered\n");
    assert.throws(() => s.run(["--check"]), /Command failed/, "--check ловит ручной дрейф");
  } finally {
    s.cleanup();
  }
});

test("пустой registry-volume: дверь валидна-пустая, gateway обязан стартовать (не фатал)", () => {
  const s = stand({});
  try {
    s.run(); // не бросает, exit 0
    const conf = s.nginx();
    assert.match(conf, /server \{/, "валидный server-блок");
    assert.doesNotMatch(conf, /location /, "0 маршрутов");
    assert.match(s.landing(), /0 продукт/, "лендинг про 0 продуктов");
  } finally {
    s.cleanup();
  }
});

test("невалидный манифест: loud-warn skip, не роняет генерацию соседей", () => {
  const s = stand({ "chater.yaml": CHATER, "broken.yaml": "type: bogus\n" });
  try {
    const out = s.run(); // stdout/stderr; не бросает
    assert.match(s.nginx(), /location \/chater\/ \{/, "валидный сосед сгенерён");
    assert.doesNotMatch(s.nginx(), /broken|bogus/, "битый манифест не в двери");
  } finally {
    s.cleanup();
  }
});

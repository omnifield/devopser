#!/usr/bin/env node
// scope-resolve.mjs — единый маппинг scope → зона devopser. Двойной режим:
//   - CLI: `node scope-resolve.mjs <scope>` → stdout JSON, exit 0 (OK) | exit 1 (unknown).
//   - import: `import { resolveScope } from './scope-resolve.mjs'`.
//
// scope = leaf-имя зоны (либо 'main' = architect). Зоны devopser (stacks/<name>/, registry/).

export const ZONES = {
  // Runtime-стеки (gateway/observability/storage) сняты 2026-07-09 (needs-driven,
  // devops-consolidated-backlog.md v2): зона стека появляется только под заказ потребителя.
  skeleton: { relativePath: 'packages', name: 'skeleton — repo-skeleton product: presets (packages/) + reusable CI (.github/workflows/) + init/drift' },
  registry: { relativePath: 'registry', name: 'registry — ports / products / routes source of truth' },
  workstation: { relativePath: 'workstation', name: 'workstation — dev-machine provisioning (bootstrap base toolchain + repo map)' },
  // hub-core — ядро хаба (реестр+дверь), потребитель = сам omnifield-hub (needs-driven: хаб заказал
  // gateway-стек). Пишет hub-core/ + stacks/gateway/ (briefs/hub-core-design.md + feedback-hub-core-as-hub-under-isolation.md).
  'hub-core': { relativePath: 'hub-core', name: 'hub-core — ядро хаба воркспейса: реестр (скан манифестов) + дверь (генерит stacks/gateway/ nginx+лендинг)' },
};

export function resolveScope(scope) {
  if (scope === 'main') return { kind: 'main', scope: 'main' };
  const zone = ZONES[scope];
  if (!zone) return null;
  return { kind: 'zone', scope, relativePath: zone.relativePath, name: zone.name };
}

import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

if (fileURLToPath(import.meta.url) === argv[1]) {
  const scope = argv[2];
  const resolved = resolveScope(scope);
  if (!resolved) {
    const list = ['main', ...Object.keys(ZONES)].join(', ');
    process.stderr.write(`ERROR: unknown scope "${scope}". Доступные: ${list}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(resolved));
  process.exit(0);
}

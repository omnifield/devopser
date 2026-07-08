#!/usr/bin/env node
// scope-resolve.mjs — единый маппинг scope → зона devopser. Двойной режим:
//   - CLI: `node scope-resolve.mjs <scope>` → stdout JSON, exit 0 (OK) | exit 1 (unknown).
//   - import: `import { resolveScope } from './scope-resolve.mjs'`.
//
// scope = leaf-имя зоны (либо 'main' = architect). Зоны devopser (stacks/<name>/, registry/).

export const ZONES = {
  gateway: { relativePath: 'stacks/gateway', name: 'gateway — nginx single-origin, path-routing to host products' },
  observability: { relativePath: 'stacks/observability', name: 'observability — OTEL collector + Loki + Prometheus + Grafana' },
  storage: { relativePath: 'stacks/storage', name: 'storage — minio (S3-compatible)' },
  registry: { relativePath: 'registry', name: 'registry — ports / products / routes source of truth' },
  workstation: { relativePath: 'workstation', name: 'workstation — dev-machine provisioning (bootstrap base toolchain + repo map)' },
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

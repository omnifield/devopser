# stacks/observability — стаб

OTEL collector (:4317/:4318) → Loki (:3100) + Prometheus (:9090) → Grafana (:3333,
дашборд Agent Fleet). Потребители: brainer backend (телеметрия сессий), все claude-scope
сессии (эмит). Наполняется по `briefs/infra-migration.md` (источник: оракул
`capsule/docker/observability/`, БЕЗ его `.claude/` — см. бриф).

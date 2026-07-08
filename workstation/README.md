# workstation — стаб

Provisioning dev-машины: bootstrap базового слоя (git / node+corepack / uv / Docker /
claude CLI) одной идемпотентной командой + карта репо экосистемы. Всё остальное
самособирается из пинов в репо продуктов (uv → Python, corepack → pnpm).
Наполняется по `briefs/workstation-bootstrap.md`.

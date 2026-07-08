# stacks/gateway — стаб

Nginx single-origin (:8080), path-роутинг продуктов на `host.docker.internal:<port>`.
Наполняется по `briefs/infra-migration.md` (источник: оракул `capsule/docker/gateway/`,
minio оттуда уезжает в `stacks/storage/`). Маршруты — только из `registry/`.

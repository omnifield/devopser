# stacks/storage — стаб

Minio, S3-совместимое хранилище (:9000 API / :9001 console). Наполняется по
`briefs/infra-migration.md` (источник: оракул `docker/gateway/compose.yml`, выносится
в самостоятельный стек — gateway не тянет за собой S3).

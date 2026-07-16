# hub-core — ядро хаба воркспейса (реестр→дверь). Самодостаточный образ:
# контракт @omnifield/contract-manifest ВЕНДОРЕН (vendor/) — образ не тянет
# file:../../knowledger и НЕ монтирует репо продуктов (briefs/hubcore-door-from-registry.md §4).
#
# Роль в хабе: одноразовый генератор. Монтирует omnifield-registry (ro, publish-volume
# продуктов) и omnifield-gateway-conf (rw, door-volume), глобит манифесты → пишет
# nginx.conf + hub/index.html в door-volume, выходит. gateway (nginx) монтирует door-volume.
#   docker compose run --rm hub-core            # регенерить дверь
#   docker compose run --rm hub-core --check    # рантайм-идемпотентность (дрейф → exit 1)
FROM node:22-alpine

WORKDIR /app

# 1) deps: vendor (контракт) копируется целиком до install, чтобы file:./vendor резолвился;
#    yaml + zod тянутся из реестра. --omit=dev — только рантайм.
COPY package.json ./
COPY vendor ./vendor
RUN npm install --omit=dev --no-audit --no-fund

# 2) сам генератор
COPY generate.mjs ./

# Дефолты = mount-таргеты в хабе (env-override для нестандартной схемы монтирования).
ENV OMNIFIELD_REGISTRY_DIR=/omnifield-registry \
    OMNIFIELD_GATEWAY_DIR=/omnifield-gateway

ENTRYPOINT ["node", "generate.mjs"]

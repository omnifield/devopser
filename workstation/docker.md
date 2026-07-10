# Docker — установка per-платформа + управление без Desktop

Containers-only канон (`briefs/containers-only-and-management.md`): на машине — Docker
и файлы, всё исполняется в контейнерах. Docker обязателен; **Desktop — вопрос
интерфейса, не движка** — способ установки любой, управление от Desktop-UI не зависит.

## Установка (все варианты валидны)

| Платформа | Как |
|---|---|
| Windows (дефолт) | Docker Desktop: `winget install Docker.DockerDesktop` (это и делает `bootstrap.ps1`); первый запуск GUI один раз — лицензия + WSL2-init |
| Windows без Desktop | engine внутри WSL2-дистро: `curl -fsSL https://get.docker.com \| sh` в Ubuntu-WSL + `sudo usermod -aG docker $USER`; docker CLI зовётся из WSL |
| Linux (dev/сервер) | engine: `curl -fsSL https://get.docker.com \| sh` |
| macOS | Docker Desktop либо colima — появится с первым mac в парке |

## Управление демонами без Desktop-UI — `docker context` (первый инструмент, D2.1)

Нативный механизм CLI: один клиент — много демонов (локальный, WSL, удалённые серверы
по SSH). Ноль дополнительной инфры.

```sh
# зарегистрировать удалённый демон (ssh-доступ уже настроен):
docker context create prod-1 --docker "host=ssh://user@server-1"

# разовая команда против него:
docker --context prod-1 ps
docker --context prod-1 compose -f stack/compose.yml up -d

# переключить дефолт текущего шелла:
docker context use prod-1
docker ps                      # уже на prod-1
docker context use default     # вернуться к локальному

# инвентарь:
docker context ls
```

- Работает с ЛЮБОЙ установкой (Desktop, WSL-engine, сервер).
- VS Code / JetBrains docker-интеграции видят те же contexts.
- Мониторинг с CLI: `docker --context X stats`, `docker --context X logs -f <svc>`,
  `docker system df` — покрывает быт; web-пульт (Portainer CE) — отдельная оценка
  (D2.2 брифа), не тащим до неё.

## GPU (гейт D3 — только под llm-engine)

**Граница, чтобы не путаться:** GPU нужен ровно ОДНОМУ контейнеру — llm-engine
(CUDA-порт оракула). devbox и сервис-контейнеры (фронт/бэк) видеокарты не касаются:
драйвер живёт на хосте и прокидывается в контейнер только явным флагом `--gpus` /
`deploy.resources` в compose — у кого флага нет, тот про GPU не знает. Машина без
NVIDIA / без нейронки просто не поднимает llm-engine (позже — другой провайдер
по тому же шву), всё остальное работает без изменений.

Прогон гейта: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
Docker Desktop на WSL2 несёт nvidia-рантайм из коробки (нужен только хостовый
NVIDIA-драйвер); engine-в-WSL2 без Desktop требует `nvidia-container-toolkit` в дистро.
Результат гейта на референс-тачке — в брифе containers-only.

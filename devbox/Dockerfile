# ghcr.io/omnifield/devbox — базовый dev-образ экосистемы Omnifield
# (briefs/docker-dev-environment.md D1). ОБОЛОЧКА тулчейна: версии-исполнители
# остаются пинам репо (packageManager → pnpm сам переключается; .python-version →
# uv берёт системный CPython, пока тот удовлетворяет пину, иначе качает нужный;
# go.mod → go докачивает toolchain). Обновление образа ≠ смена версий тулчейна репо.
#
# Сборка/публикация: .github/workflows/release-devbox.yml (датированные теги + latest).
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_MAJOR=22

# node LTS (nodesource) + gh CLI (официальный apt-репо) — root-слой.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs gh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# go stable (актуальный на момент сборки; репо докачивают свой toolchain по go.mod).
RUN GOV="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)" \
  && curl -fsSL "https://go.dev/dl/${GOV}.linux-amd64.tar.gz" | tar -xz -C /usr/local

# user-слой: pnpm standalone прямым тарболом (vendor-скрипт с pnpm setup не
# переваривает docker-окружение; PNPM_HOME писабелен → самопереключение версий),
# uv и Claude Code — нативные installer'ы вендоров в ~/.local/bin.
USER vscode
ENV PNPM_HOME=/home/vscode/.local/share/pnpm
RUN mkdir -p "${PNPM_HOME}" \
  && curl -fsSL https://github.com/pnpm/pnpm/releases/latest/download/pnpm-linux-x64.tar.gz \
    | tar -xz -C "${PNPM_HOME}" \
  && curl -LsSf https://astral.sh/uv/install.sh | sh \
  && curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="${PNPM_HOME}:/home/vscode/.local/bin:/usr/local/go/bin:${PATH}"

# Смок самого образа (fail-fast на сломанном слое).
RUN node --version && pnpm --version && uv --version && go version \
  && gh --version && claude --version

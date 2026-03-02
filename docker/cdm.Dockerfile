# Dockerfile for CDM (Contract Dependency Manager)
#
# Installs CDM from the latest GitHub release plus the Rust toolchain
# needed to build PolkaVM contracts.
#
# Build:
#   docker build -f docker/cdm.Dockerfile -t cdm .
#
# Run:
#   docker run --rm -v /path/to/your/contracts:/workspace -w /workspace cdm deploy -n paseo

FROM rust:1.87-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    clang \
    llvm \
    lld \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 + pnpm (for working with TS contract projects)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@9.15.0 \
    && rm -rf /var/lib/apt/lists/*

# Install nightly toolchain with rust-src (required for PolkaVM targets)
RUN rustup toolchain install nightly \
    && rustup default nightly \
    && rustup component add rust-src \
    && rustup toolchain remove stable || true

# Install CDM via the install script
RUN curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash

ENV PATH="/root/.cdm/bin:/root/.local/bin:${PATH}"

WORKDIR /workspace

ENTRYPOINT ["cdm"]
CMD ["--help"]

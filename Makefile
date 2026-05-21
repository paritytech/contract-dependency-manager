CLI_DIR = src/apps/cli
TEMPLATE_DIR = src/templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test clean format format-check format-ts format-rs format-ts-check format-rs-check embed-templates start-network stop-network network-status

setup:
	pnpm install
	$(MAKE) build-template

# `cdm network` wraps the PPN lifecycle (install + start/stop/status/logs)
# against a shared install at ~/.cdm/ppn/. These Makefile targets exist for
# convenience inside this repo; users with installed cdm can call them
# directly via `cdm network ...` from any project.
start-network:
	bun run $(CLI_DIR)/src/cli.ts network start

stop-network:
	bun run $(CLI_DIR)/src/cli.ts network stop

network-status:
	bun run $(CLI_DIR)/src/cli.ts network status

install: embed-templates
	pnpm -r build
	bun build --compile $(CLI_DIR)/src/cli.ts --outfile ~/.cdm/bin/cdm

dev: embed-templates
	bun run $(CLI_DIR)/src/cli.ts

frontend:
	pnpm --filter @dotdm/env build
	pnpm --filter @dotdm/contracts build
	pnpm --filter @dotdm/frontend dev

build:
	pnpm --filter @dotdm/env build
	pnpm --filter @dotdm/contracts build
	pnpm --filter @dotdm/frontend build

embed-templates:
	bun run src/lib/scripts/embed-templates.ts

compile: embed-templates
	bun build --compile $(CLI_DIR)/src/cli.ts --outfile dist/cdm

compile-all: embed-templates
	mkdir -p dist
	bun build --compile --target=bun-darwin-arm64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-darwin-arm64
	bun build --compile --target=bun-darwin-x64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-darwin-x64
	bun build --compile --target=bun-linux-x64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-linux-x64
	bun build --compile --target=bun-linux-arm64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-linux-arm64

build-registry:
	cargo pvm-contract build --manifest-path $(CURDIR)/Cargo.toml -p contract-registry

deploy-registry: build-registry
	pnpm --filter @dotdm/env build
	pnpm --filter @dotdm/contracts build
	bun run src/lib/scripts/deploy-registry.ts --name $(or $(CHAIN),local) $(if $(SURI),--suri "$(SURI)") $(if $(REGISTRY_ADDRESS),--registry-address $(REGISTRY_ADDRESS))

build-template:
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_reader
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_writer

test:
	pnpm vitest run

clean:
	rm -rf dist/ target/ node_modules/

format-ts:
	pnpm biome format --write .

format-rs:
	cargo fmt --all
	cargo fmt --all --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml

format-ts-check:
	pnpm biome format .

format-rs-check:
	cargo fmt --all -- --check
	cargo fmt --all --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -- --check

format: format-ts format-rs

format-check: format-ts-check format-rs-check

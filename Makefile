CLI_DIR = src/apps/cli
TEMPLATE_DIR = src/templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test e2e-registry clean format format-check format-ts format-rs format-ts-check format-rs-check

setup:
	pnpm install
	$(MAKE) build-template

start-network:
	cd ppn && make start

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

# End-to-end registry validation against a transient revive-dev-node.
# Builds the registry, spins a local node, deploys, runs the round-trip test
# (publishLatest + every view method + searchContractNames), tears the node
# down. Requires `revive-dev-node` on $PATH.
#
# To run against an existing node instead (e.g. in CI where the node is
# already up):
#     EXTERNAL_ASSETHUB_URL=ws://127.0.0.1:9944 make e2e-registry
e2e-registry: build-registry
	src/lib/scripts/run-registry-e2e.sh

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

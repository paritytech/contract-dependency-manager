CLI_DIR = src/apps/cli
TEMPLATE_DIR = src/templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test test-macro clean format format-check format-ts format-rs format-ts-check format-rs-check

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
	pnpm --filter @parity/cdm-env build
	pnpm --filter @parity/cdm-builder build
	pnpm --filter @parity/cdm-frontend dev

build:
	pnpm --filter @parity/cdm-env build
	pnpm --filter @parity/cdm-builder build
	pnpm --filter @parity/cdm-frontend build

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
	pnpm --filter @parity/cdm-env build
	pnpm --filter @parity/cdm-builder build
	bun run src/lib/scripts/deploy-registry.ts --name $(or $(CHAIN),local) $(if $(SURI),--suri "$(SURI)") $(if $(REGISTRY_ADDRESS),--registry-address $(REGISTRY_ADDRESS))

build-template:
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_reader
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_writer

test: test-macro
	pnpm vitest run

# Compiles the in-tree `cdm::import!` consumer (src/lib/cdm/import-test) to
# PolkaVM. A failure here means the macro is emitting code that doesn't type-
# check against `pvm_contract_sdk::abi_import!` — see PR #16 for the bug class
# this guards against.
test-macro:
	cargo pvm-contract build --manifest-path $(CURDIR)/src/lib/cdm/import-test/Cargo.toml

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

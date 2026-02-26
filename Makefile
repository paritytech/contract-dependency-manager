CLI_DIR = src/apps/cli
TEMPLATE_DIR = src/templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test clean format format-check format-ts format-rs format-ts-check format-rs-check

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
	pnpm --filter @dotdm/frontend dev

build:
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
	cd src/lib/descriptors && pnpm exec papi sol add ../../../target/contract-registry.release.abi.json contractsRegistry

deploy-registry: build-registry
	bun run src/lib/scripts/deploy-registry.ts --name $(or $(CHAIN),local)

build-template:
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_reader
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_writer
	cd src/lib/descriptors && pnpm exec papi sol add ../../../$(TEMPLATE_DIR)/target/counter.release.abi.json counter --skip-codegen
	cd src/lib/descriptors && pnpm exec papi sol add ../../../$(TEMPLATE_DIR)/target/counter_reader.release.abi.json counterReader --skip-codegen
	cd src/lib/descriptors && pnpm exec papi sol add ../../../$(TEMPLATE_DIR)/target/counter_writer.release.abi.json counterWriter

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

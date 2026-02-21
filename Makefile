CLI_DIR = src/apps/cli
TEMPLATE_DIR = src/templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test clean format format-check format-ts format-rs format-ts-check format-rs-check

setup:
	curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
	pnpm install
	$(MAKE) build-template

generate-papi:
	mkdir -p .papi/descriptors
	[ -f .papi/descriptors/package.json ] || echo '{"name":"@polkadot-api/descriptors","version":"0.0.0"}' > .papi/descriptors/package.json
	pnpm add polkadot-api
	pnpm exec papi add relay -n polkadot --skip-codegen
	pnpm exec papi add bulletin --wasm ppn/bin/bulletin_westend_runtime.wasm --skip-codegen
	pnpm exec papi add individuality --wasm ppn/bin/people_westend_individuality_runtime.wasm --skip-codegen
	pnpm exec papi add assetHub --wasm ppn/bin/asset_hub_westend_runtime.wasm --skip-codegen
	pnpm exec papi

start-network:
	cd ppn && make start

install: embed-templates
	bun build --compile $(CLI_DIR)/src/cli.ts --outfile ~/.cdm/bin/cdm

dev: embed-templates
	bun run $(CLI_DIR)/src/cli.ts

frontend:
	pnpm --filter @dotdm/frontend dev

build:
	pnpm --filter @dotdm/frontend build

embed-templates:
	bun run $(CLI_DIR)/scripts/embed-templates.ts

compile: embed-templates
	bun build --compile $(CLI_DIR)/src/cli.ts --outfile dist/cdm

compile-all: embed-templates
	mkdir -p dist
	bun build --compile --target=bun-darwin-arm64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-darwin-arm64
	bun build --compile --target=bun-darwin-x64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-darwin-x64
	bun build --compile --target=bun-linux-x64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-linux-x64
	bun build --compile --target=bun-linux-arm64 $(CLI_DIR)/src/cli.ts --outfile dist/cdm-linux-arm64

build-registry:
	cargo pvm-contract build --manifest-path $(CURDIR)/Cargo.toml -p contracts
	pnpm exec papi sol add target/contracts.release.abi.json contractsRegistry

deploy-registry: build-registry
	bun run $(CLI_DIR)/scripts/deploy-registry.ts --name $(or $(CHAIN),local)

build-template:
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_reader
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_writer
	pnpm exec papi sol add $(TEMPLATE_DIR)/target/counter.release.abi.json counter --skip-codegen
	pnpm exec papi sol add $(TEMPLATE_DIR)/target/counter_reader.release.abi.json counterReader --skip-codegen
	pnpm exec papi sol add $(TEMPLATE_DIR)/target/counter_writer.release.abi.json counterWriter

test:
	bun test $(CLI_DIR)/tests/detection.test.ts $(CLI_DIR)/tests/commands.test.ts $(CLI_DIR)/tests/e2e.test.ts

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

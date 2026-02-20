TEMPLATE_DIR = templates/shared-counter

.PHONY: install dev frontend build compile compile-all build-registry deploy-registry build-template test clean

setup:
	curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
	bun install
	$(MAKE) build-template

generate-papi:
	mkdir -p .papi/descriptors
	[ -f .papi/descriptors/package.json ] || echo '{"name":"@polkadot-api/descriptors","version":"0.0.0"}' > .papi/descriptors/package.json
	bun i polkadot-api
	bunx papi add relay -n polkadot --skip-codegen
	bunx papi add bulletin --wasm ppn/bin/bulletin_westend_runtime.wasm --skip-codegen
	bunx papi add individuality --wasm ppn/bin/people_westend_individuality_runtime.wasm --skip-codegen
	bunx papi add assetHub --wasm ppn/bin/asset_hub_westend_runtime.wasm --skip-codegen
	bunx papi

start-network:
	cd ppn && make start

install: embed-templates
	bun build --compile src/cli.ts --outfile ~/.cdm/bin/cdm

dev: embed-templates
	bun run src/cli.ts

frontend:
	cd frontend && bun run dev

build:
	bun run build

embed-templates:
	bun run scripts/embed-templates.ts

compile: embed-templates
	bun build --compile src/cli.ts --outfile dist/cdm

compile-all: embed-templates
	mkdir -p dist
	bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile dist/cdm-darwin-arm64
	bun build --compile --target=bun-darwin-x64 src/cli.ts --outfile dist/cdm-darwin-x64
	bun build --compile --target=bun-linux-x64 src/cli.ts --outfile dist/cdm-linux-x64

build-registry:
	cargo pvm-contract build --manifest-path $(CURDIR)/Cargo.toml -p contracts
	bunx papi sol add target/contracts.release.abi.json contractsRegistry

deploy-registry: build-registry
	bun run scripts/deploy-registry.ts --name $(or $(CHAIN),local)

build-template:
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_reader
	cargo pvm-contract build --manifest-path $(CURDIR)/$(TEMPLATE_DIR)/Cargo.toml -p counter_writer
	bunx papi sol add $(TEMPLATE_DIR)/target/counter.release.abi.json counter --skip-codegen
	bunx papi sol add $(TEMPLATE_DIR)/target/counter_reader.release.abi.json counterReader --skip-codegen
	bunx papi sol add $(TEMPLATE_DIR)/target/counter_writer.release.abi.json counterWriter

test:
	bun test tests/detection.test.ts tests/commands.test.ts tests/e2e.test.ts

clean:
	rm -rf dist/ target/ node_modules/

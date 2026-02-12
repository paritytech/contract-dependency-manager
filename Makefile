TEMPLATE_DIR = templates/shared-counter

.PHONY: install dev build compile compile-all build-registry build-template test clean

setup:
	curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
	$(MAKE) install
	$(MAKE) build-template

start-network:
	cd ppn && make start

install:
	bun install

dev:
	bun run src/cli.ts

build:
	bun run build

compile:
	bun build --compile src/cli.ts --outfile dist/cdm

compile-all:
	mkdir -p dist
	bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile dist/cdm-darwin-arm64
	bun build --compile --target=bun-darwin-x64 src/cli.ts --outfile dist/cdm-darwin-x64
	bun build --compile --target=bun-linux-x64 src/cli.ts --outfile dist/cdm-linux-x64

build-registry:
	cargo pvm-contract build --manifest-path $(CURDIR)/Cargo.toml -p contracts
	bunx papi sol add target/contracts.release.abi.json contractsRegistry

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

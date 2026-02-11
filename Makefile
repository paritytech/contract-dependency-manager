.PHONY: install dev build compile compile-all build-registry test clean

setup:
	curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
	bun instal
	bunx papi generatel

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
	cargo pvm-contract build --manifest-path Cargo.toml -p contracts

test:
	bun test tests/detection.test.ts tests/commands.test.ts

test-e2e:
	bun test tests/e2e.test.ts

clean:
	rm -rf dist/ target/ node_modules/

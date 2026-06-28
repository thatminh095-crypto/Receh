# Receh Pool — build / test / optimize
# Requires: Rust (stable + wasm32-unknown-unknown) and the Stellar CLI.

WASM = target/wasm32v1-none/release/receh_pool.wasm

default: build

build:
	stellar contract build
	@ls -lh $(WASM)

test:
	cargo test

optimize: build
	stellar contract optimize --wasm $(WASM)

fmt:
	cargo fmt --all

lint:
	cargo clippy --all-targets -- -D warnings

clean:
	cargo clean

.PHONY: default build test optimize fmt lint clean

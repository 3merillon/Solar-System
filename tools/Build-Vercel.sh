#!/usr/bin/env bash
# Vercel hosts static browser files. Never build/run the native GPU probe there.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p target/build-tools
if ! command -v rustup >/dev/null 2>&1; then
  curl --fail --show-error --silent --location --retry 3 \
    https://sh.rustup.rs -o target/build-tools/rustup-init.sh
  sh target/build-tools/rustup-init.sh -y --no-modify-path \
    --profile minimal --default-toolchain 1.87.0
fi
rustup toolchain install 1.87.0 --profile minimal --target wasm32-unknown-unknown
export SOLAR_SHADER_BUILD_KEY="$(node tools/Verify-Explorer-Build.mjs --key)"
cargo +1.87.0 build -p solar-explorer --lib --release \
  --target wasm32-unknown-unknown --locked

# Pin the CLI to Cargo.lock's wasm-bindgen version and verify the release archive.
archive=wasm-bindgen-0.2.128-x86_64-unknown-linux-musl.tar.gz
curl --fail --show-error --silent --location --retry 3 \
  "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.128/$archive" \
  -o "target/build-tools/$archive"
echo "b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f  target/build-tools/$archive" | sha256sum --check
tar -xzf "target/build-tools/$archive" -C target/build-tools
target/build-tools/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl/wasm-bindgen \
  --target web --out-dir target/web-package --out-name solar_explorer \
  target/wasm32-unknown-unknown/release/solar_explorer.wasm

# Data packs (all bodies, sky, pinned Earth) are read from the https host named by SOLAR_PACK_BASE,
# set in the deployment's environment; unset or empty builds a deployment without packs.
export SOLAR_PACK_BASE="${SOLAR_PACK_BASE-}"

# Transport sidecars the packager publishes next to the WASM and loader.
node tools/Compress-Explorer.mjs target/web-package
node tools/Package-Explorer.mjs target/web-package

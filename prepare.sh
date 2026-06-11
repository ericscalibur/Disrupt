#!/bin/bash
# Sets up a fresh Debian build environment for building disrupt.s9pk
# (required for Start9 community registry submission review builds)

set -e

sudo apt-get update
sudo apt-get install -y build-essential openssl libssl-dev libc6-dev clang libclang-dev ca-certificates git curl

if ! command -v yq >/dev/null 2>&1; then
    sudo curl -L "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64" -o /usr/local/bin/yq
    sudo chmod a+rx /usr/local/bin/yq
fi

if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | bash
    sudo usermod -aG docker "$USER"
fi
docker buildx install 2>/dev/null || true
docker buildx create --use 2>/dev/null || true

if ! command -v cargo >/dev/null 2>&1; then
    curl https://sh.rustup.rs -sSf | sh -s -- -y
    source "$HOME/.cargo/env"
fi

if ! command -v start-sdk >/dev/null 2>&1; then
    rustup toolchain install 1.78.0 --profile minimal
    rustup default 1.78.0
    git clone --depth 1 --branch v0.3.5.1 https://github.com/Start9Labs/start-os.git /tmp/start-os
    cd /tmp/start-os
    git submodule update --init --recursive --depth 1
    make sdk
    cd -
fi

start-sdk init
echo "Build environment ready. Run: make"

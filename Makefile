# Disrupt Portal — StartOS package build
#
# Produces disrupt.s9pk — the file users sideload via System → Sideload Service.
#
# Requirements on the build machine (one-time setup):
#   1. Docker + buildx          https://docs.docker.com/get-docker/
#   2. Rust + Cargo             curl https://sh.rustup.rs -sSf | sh
#   3. start-sdk:
#        git clone https://github.com/Start9Labs/start-os.git
#        cd start-os && git submodule update --init --recursive && make sdk
#        start-sdk init
#
# Then just run:  make

PKG_ID := disrupt
PKG_VERSION := $(shell yq e ".version" start9/manifest.yaml)

.DELETE_ON_ERROR:

all: verify

# Final package
$(PKG_ID).s9pk: start9/manifest.yaml instructions.md icon.png LICENSE docker-images/x86_64.tar
	@echo "Packing $(PKG_ID).s9pk ..."
	cp start9/manifest.yaml manifest.yaml
	start-sdk pack

# Docker image — start-sdk pack expects docker-images/<arch>.tar
# (add an arm64 target here if you ever want Raspberry Pi support)
docker-images/x86_64.tar: Dockerfile start9/*.sh package.json
	chmod +x start9/*.sh
	mkdir -p docker-images
	docker buildx build --tag start9/$(PKG_ID)/main:$(PKG_VERSION) \
		--platform=linux/amd64 -o type=docker,dest=docker-images/x86_64.tar .

verify: $(PKG_ID).s9pk
	start-sdk verify s9pk $(PKG_ID).s9pk
	@echo ""
	@echo "✅ $(PKG_ID).s9pk built and verified."
	@echo "   Sideload it: StartOS → System → Sideload Service"

clean:
	rm -rf docker-images $(PKG_ID).s9pk manifest.yaml

.PHONY: all verify clean

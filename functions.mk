# @arg1: name of submodule
define PREPARE_SRC_PATCHED
	rm -rf build/lib/$(1)
	mkdir -p build/lib
	cp -r lib/$(1) build/lib/$(1)
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/$(1)/*.patch), \
		patch -d "$(BASE_DIR)build/lib/$(1)" -Np1 -i $(file) && \
	) :
endef

# @arg1: name of submdolue
define PREPARE_SRC_VPATH
	rm -rf build/lib/$(1)
	mkdir -p build/lib/$(1)
	touch build/lib/$(1)/configured
endef

# All projects we build have autogen.sh, otherwise we could also fallback to `autoreconf -ivf .`
RECONF_AUTO := NOCONFIGURE=1 ./autogen.sh

CONF_ARGS = --enable-optimize

# @arg1: path to source directory; defaults to current working directory
define CONFIGURE_AUTO
	CFLAGS="$(CFLAGS)" CXXFLAGS="$(CXXFLAGS)" \
	CC=emcc CXX=em++ \
	emconfigure sh $(or $(1),.)/configure \
		--prefix="$(DIST_DIR)" \
		--host=wasm32-unknown-emscripten \
		--enable-static \
		--disable-shared \
		--disable-debug \
    $(CONF_ARGS)
endef

# @arg1: path to source directory; defaults to current working directory
define CONFIGURE_CMAKE
	emcmake cmake -S "$(or $(1),.)" -DCMAKE_INSTALL_PREFIX="$(DIST_DIR)"
endef

# Archive member order from parallel nested builds can change the final LTO
# link. Keep release output reproducible by default; developers may opt into
# faster non-reproducible local builds explicitly.
AKARISUB_BUILD_JOBS ?= 1
JSO_MAKE := emmake make -j "$(AKARISUB_BUILD_JOBS)"

# @arg1: submodule name
define TR_GIT_SM_RESET
git-$(1):
	cd lib/$(1) && \
	git reset --hard && \
	git clean -dfx
	git submodule update --force lib/$(1)

.PHONY: git-$(1)
endef

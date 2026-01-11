# JASSUB.js - Makefile

# make - Build Dependencies and the JASSUB.js
BASE_DIR:=$(dir $(realpath $(firstword $(MAKEFILE_LIST))))
DIST_DIR:=$(BASE_DIR)dist/libraries

# WASM feature flags - targeting modern browsers (Chrome 114+, Firefox 120+, Safari 16.4+)
WASM_FEATURES = \
	-msimd128 \
	-mrelaxed-simd \
	-mnontrapping-fptoint \
	-mbulk-memory \
	-msign-ext \
	-mmutable-globals \
	-mtail-call \
	-mextended-const \
	-mreference-types

# Base compiler flags for all C/C++ compilation
# -fno-unwind-tables/-fno-asynchronous-unwind-tables: no exceptions = no need for unwind info
BASE_CFLAGS = -O3 -flto -fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables

export CFLAGS = $(BASE_CFLAGS) -s USE_PTHREADS=0 $(WASM_FEATURES)
export CXXFLAGS = $(CFLAGS)
export PKG_CONFIG_PATH = $(DIST_DIR)/lib/pkgconfig
export EM_PKG_CONFIG_PATH = $(PKG_CONFIG_PATH)

WORKER_NAME = jassub-worker
WORKER_ARGS = \
	$(WASM_FEATURES)

all: jassub
jassub: dist

.PHONY: all jassub dist

include functions.mk

# FriBidi
build/lib/fribidi/configure: lib/fribidi $(wildcard $(BASE_DIR)build/patches/fribidi/*.patch)
	$(call PREPARE_SRC_PATCHED,fribidi)
	cd build/lib/fribidi && $(RECONF_AUTO)

$(DIST_DIR)/lib/libfribidi.a: build/lib/fribidi/configure
	cd build/lib/fribidi && \
	$(call CONFIGURE_AUTO) --disable-debug && \
	$(JSO_MAKE) -C lib/ fribidi-unicode-version.h && \
	$(JSO_MAKE) -C lib/ install && \
	$(JSO_MAKE) install-pkgconfigDATA

# Expat
# build/lib/expat/configured: lib/expat
# 	$(call PREPARE_SRC_VPATH,expat)
# 	touch build/lib/expat/configured

# $(DIST_DIR)/lib/libexpat.a: build/lib/expat/configured
# 	cd build/lib/expat && \
# 	$(call CONFIGURE_CMAKE,$(BASE_DIR)lib/expat/expat) \
# 		-DEXPAT_BUILD_DOCS=off \
# 		-DEXPAT_SHARED_LIBS=off \
# 		-DEXPAT_BUILD_EXAMPLES=off \
# 		-DEXPAT_BUILD_FUZZERS=off \
# 		-DEXPAT_BUILD_TESTS=off \
# 		-DEXPAT_BUILD_TOOLS=off \
# 	&& \
# 	$(JSO_MAKE) install

# Brotli
build/lib/brotli/configured: lib/brotli $(wildcard $(BASE_DIR)build/patches/brotli/*.patch)
	$(call PREPARE_SRC_PATCHED,brotli)
	touch build/lib/brotli/configured

$(DIST_DIR)/lib/libbrotlidec.a: $(DIST_DIR)/lib/libbrotlicommon.a
$(DIST_DIR)/lib/libbrotlicommon.a: build/lib/brotli/configured
	cd build/lib/brotli && \
	$(call CONFIGURE_CMAKE) && \
	$(JSO_MAKE) install
	# Normalise static lib names (Only if they exist)
	cd $(DIST_DIR)/lib/ && \
	for lib in *-static.a ; do \
		if [ -f "$$lib" ]; then \
			mv "$$lib" "$${lib%-static.a}.a" ; \
		fi \
	done || true

# Freetype without Harfbuzz (Bootstrap)
build/lib/freetype/configure: lib/freetype $(wildcard $(BASE_DIR)build/patches/freetype/*.patch)
	$(call PREPARE_SRC_PATCHED,freetype)
	cd build/lib/freetype && $(RECONF_AUTO)

build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a: $(DIST_DIR)/lib/libbrotlidec.a build/lib/freetype/configure
	cd build/lib/freetype && \
		mkdir -p build_hb && \
		cd build_hb && \
		$(call CONFIGURE_AUTO,..) \
			--prefix="$$(pwd)/dist_hb" \
			--with-brotli=yes \
			--without-harfbuzz \
			--without-zlib \
			--without-png \
		&& \
		$(JSO_MAKE) install

# Harfbuzz (CMake)
build/lib/harfbuzz/configured: lib/harfbuzz $(wildcard $(BASE_DIR)build/patches/harfbuzz/*.patch)
	$(call PREPARE_SRC_PATCHED,harfbuzz)
	touch build/lib/harfbuzz/configured

$(DIST_DIR)/lib/libharfbuzz.a: build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a build/lib/harfbuzz/configured
	cd build/lib/harfbuzz && \
	mkdir -p build_cmake && \
	cd build_cmake && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH):$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/pkgconfig \
	CFLAGS="-DHB_NO_MT $(CFLAGS)" \
	CXXFLAGS="-DHB_NO_MT $(CFLAGS)" \
	emcmake cmake -S ".." \
		-DCMAKE_INSTALL_PREFIX="$(DIST_DIR)" \
		-DCMAKE_BUILD_TYPE=Release \
		-DFREETYPE_INCLUDE_DIRS="$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/include/freetype2" \
		-DFREETYPE_LIBRARY="$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a" \
		-DHB_HAVE_FREETYPE=ON \
		-DHB_BUILD_TESTS=OFF \
		-DHB_BUILD_UTILS=OFF \
		-DHB_BUILD_SUBSET=OFF \
	&& \
	emmake make -j "$$(nproc)" install

# Freetype with Harfbuzz
$(DIST_DIR)/lib/libfreetype.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libbrotlidec.a
	cd build/lib/freetype && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH) \
	CFLAGS="$(CFLAGS) -I$(DIST_DIR)/include/harfbuzz" \
	CXXFLAGS="$(CXXFLAGS) -I$(DIST_DIR)/include/harfbuzz" \
	LDFLAGS="-L$(DIST_DIR)/lib" \
	HARFBUZZ_CFLAGS="-I$(DIST_DIR)/include/harfbuzz" \
	HARFBUZZ_LIBS="-L$(DIST_DIR)/lib -lharfbuzz -L$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib -lfreetype" \
	$(call CONFIGURE_AUTO) \
		--with-brotli=yes \
		--with-harfbuzz=yes \
		--without-zlib \
		--without-png \
	&& \
	$(JSO_MAKE) install

# Fontconfig
# build/lib/fontconfig/configure: lib/fontconfig $(wildcard $(BASE_DIR)build/patches/fontconfig/*.patch)
# 	$(call PREPARE_SRC_PATCHED,fontconfig)
# 	cd build/lib/fontconfig && $(RECONF_AUTO)

# $(DIST_DIR)/lib/libfontconfig.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libexpat.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a build/lib/fontconfig/configure
# 	cd build/lib/fontconfig && \
# 	$(call CONFIGURE_AUTO) \
# 		--disable-docs \
# 		--with-default-fonts=/fonts \
# 	&& \
# 	$(JSO_MAKE) -C src/ install && \
# 	$(JSO_MAKE) -C fontconfig/ install && \
# 	$(JSO_MAKE) install-pkgconfigDATA


# libass
build/lib/libass/configured: lib/libass
	cd lib/libass && $(RECONF_AUTO)
	$(call PREPARE_SRC_VPATH,libass)
	touch build/lib/libass/configured

$(DIST_DIR)/lib/libass.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a $(DIST_DIR)/lib/libbrotlidec.a build/lib/libass/configured
	# Remove broken .la files that contain invalid paths from previous steps
	rm -f $(DIST_DIR)/lib/*.la
	cd build/lib/libass && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH) \
	FREETYPE_CFLAGS="-I$(DIST_DIR)/include/freetype2" \
	FREETYPE_LIBS="-L$(DIST_DIR)/lib -lfreetype" \
	FRIBIDI_CFLAGS="-I$(DIST_DIR)/include/fribidi" \
	FRIBIDI_LIBS="-L$(DIST_DIR)/lib -lfribidi" \
	HARFBUZZ_CFLAGS="-I$(DIST_DIR)/include/harfbuzz" \
	HARFBUZZ_LIBS="-L$(DIST_DIR)/lib -lharfbuzz" \
	$(call CONFIGURE_AUTO,../../../lib/libass) \
		--prefix="$(DIST_DIR)" \
		--host=wasm32-unknown-emscripten \
		--enable-static \
		--disable-shared \
		--disable-debug \
		--enable-optimize \
		--enable-large-tiles \
		--disable-fontconfig \
		--disable-require-system-font-provider \
	&& \
	$(JSO_MAKE) install

LIBASS_DEPS = \
	$(DIST_DIR)/lib/libfribidi.a \
	$(DIST_DIR)/lib/libbrotlicommon.a \
	$(DIST_DIR)/lib/libbrotlidec.a \
	$(DIST_DIR)/lib/libfreetype.a \
	$(DIST_DIR)/lib/libharfbuzz.a \
	$(DIST_DIR)/lib/libass.a


dist: $(LIBASS_DEPS) dist/js/$(WORKER_NAME).js

# Dist Files https://github.com/emscripten-core/emscripten/blob/3.1.38/src/settings.js

# args for increasing performance
# https://github.com/emscripten-core/emscripten/issues/13899
PERFORMANCE_ARGS = \
		-s BINARYEN_EXTRA_PASSES="--one-caller-inline-max-function-size=19306,--flatten,--rereloop,--coalesce-locals,--reorder-locals,--vacuum,--simplify-locals,--precompute-propagate,--dce,--remove-unused-names" \
		-s INVOKE_RUN=0 \
		-s DISABLE_EXCEPTION_CATCHING=1 \
		-s TEXTDECODER=2 \
		-s MINIMAL_RUNTIME_STREAMING_WASM_INSTANTIATION=1 \
		-s SUPPORT_LONGJMP=1 \
		-s MALLOC=emmalloc \
		-ffast-math

# args for reducing size
SIZE_ARGS = \
		-s POLYFILL=0 \
		-s FILESYSTEM=0 \
		-s AUTO_JS_LIBRARIES=0 \
		-s AUTO_NATIVE_LIBRARIES=0 \
		-s HTML5_SUPPORT_DEFERRING_USER_SENSITIVE_REQUESTS=0 \
		-s INCOMING_MODULE_JS_API="[]" \
		-s USE_SDL=0 \
		-s MINIMAL_RUNTIME=1 \
		-s SUPPORT_ERRNO=0 \
		-s ASSERTIONS=0 \
		-s STACK_OVERFLOW_CHECK=0 \
		-s DYNAMIC_EXECUTION=0 \
		-s EVAL_CTORS=1 \
		-s IGNORE_MISSING_MAIN=1 \
		-s STRICT=1

# args that are required for this to even work at all
# Modern browser targets: Chrome 114+, Safari 16.4+ (for all WASM features)
COMPAT_ARGS = \
		-s EXPORTED_FUNCTIONS="['_malloc']" \
		-s EXPORTED_RUNTIME_METHODS="['getTempRet0', 'setTempRet0']" \
		-s IMPORTED_MEMORY=1 \
		-s MIN_CHROME_VERSION=114 \
		-s MIN_SAFARI_VERSION=160400

dist/js/$(WORKER_NAME).js: src/JASSUB.cpp src/ts/worker.ts src/pre-worker.js src/post-worker.js
	mkdir -p dist/js
	emcc src/JASSUB.cpp $(LIBASS_DEPS) \
		-O3 \
		-fno-rtti -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
		$(WORKER_ARGS) \
		$(PERFORMANCE_ARGS) \
		$(SIZE_ARGS) \
		$(COMPAT_ARGS) \
		--closure=0 \
		--pre-js src/pre-worker.js \
		--post-js src/post-worker.js \
		-s ENVIRONMENT=worker \
		-s EXIT_RUNTIME=0 \
		-s WASM_BIGINT=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s MEMORY_GROWTH_GEOMETRIC_STEP=0.20 \
		-s MEMORY_GROWTH_GEOMETRIC_CAP=96MB \
		-s INITIAL_MEMORY=16MB \
		-s MODULARIZE=1 \
		-s EXPORT_ES6=1 \
		--bind \
		-lc++-noexcept \
		-lc++abi-noexcept \
		-o $@

.PHONY: worker

worker: dist/js/jassub-worker.js

dist/js/jassub.js: src/jassub.js
	mkdir -p dist/js
	cp src/jassub.js $@

# dist/license/all:
#	@#FIXME: allow -j in toplevel Makefile and reintegrate licence extraction into this file
#	make -j "$$(nproc)" -f Makefile_licence all

# dist/js/COPYRIGHT: dist/license/all
#	cp "$<" "$@"

# Clean Tasks

clean: clean-dist clean-libs clean-jassub

clean-dist:
	rm -frv dist/libraries/*
	rm -frv dist/js/*
	rm -frv dist/license/*
clean-libs:
	rm -frv dist/libraries build/lib
clean-jassub:
	cd src && git clean -fdX

git-checkout:
	git submodule sync --recursive && \
	git submodule update --init --recursive

SUBMODULES := brotli freetype fribidi harfbuzz libass
git-smreset: $(addprefix git-, $(SUBMODULES))

$(foreach subm, $(SUBMODULES), $(eval $(call TR_GIT_SM_RESET,$(subm))))

server: # Node http server npm i -g http-server
	http-server

.PHONY: clean clean-dist clean-libs clean-jassub git-checkout git-smreset server

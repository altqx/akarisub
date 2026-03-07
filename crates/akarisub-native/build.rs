use std::env;
use std::path::PathBuf;

use akarisub_build_support::NativeBuildContext;

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.emit_out_dir();

  let libraries = [
    ("DEP_AKARISUB_LIBASS_OUT_DIR", &["ass"] as &[&str]),
    ("DEP_AKARISUB_HARFBUZZ_OUT_DIR", &["harfbuzz"]),
    ("DEP_AKARISUB_FONTCONFIG_OUT_DIR", &["fontconfig"]),
    ("DEP_AKARISUB_FRIBIDI_OUT_DIR", &["fribidi"]),
    ("DEP_AKARISUB_FREETYPE_OUT_DIR", &["freetype"]),
    ("DEP_AKARISUB_EXPAT_OUT_DIR", &["expat"]),
    ("DEP_AKARISUB_BROTLI_OUT_DIR", &["brotlidec", "brotlicommon"]),
  ];

  for (out_dir_key, libs) in libraries {
    let out_dir = env::var(out_dir_key).unwrap_or_else(|_| panic!("missing {out_dir_key}"));
    println!("cargo:rustc-link-search=native={out_dir}");

    for lib in libs {
      println!("cargo:rustc-link-lib=static={lib}");
    }
  }

  emit_emscripten_runtime_libs();
}

fn emit_emscripten_runtime_libs() {
  let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
  let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

  if target_arch != "wasm32" || target_os != "unknown" || !target_env.is_empty() {
    return;
  }

  println!("cargo:rerun-if-env-changed=EMSDK");

  let emsdk = PathBuf::from(env::var("EMSDK").expect("EMSDK must be set for akarisub wasm runtime linking"));
  let sysroot_lib_dir = emsdk.join("upstream/emscripten/cache/sysroot/lib/wasm32-emscripten");

  if !sysroot_lib_dir.exists() {
    panic!("emscripten wasm sysroot lib dir not found: {}", sysroot_lib_dir.display());
  }

  println!("cargo:rustc-link-search=native={}", sysroot_lib_dir.display());

  for lib in ["standalonewasm", "dlmalloc", "compiler_rt", "c++", "c++abi", "unwind", "c"] {
    println!("cargo:rustc-link-lib=static={lib}");
  }
}
use std::env;

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
}
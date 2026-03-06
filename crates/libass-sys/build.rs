use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("libass");

  let vendor = ctx.vendor_dir("libass");
  let libass_dir = vendor.join("libass");
  let generated_dir = ctx.generated_dir("libass");
  let fontconfig_public_include_dir = ctx.generated_include_dir("fontconfig");
  let fontconfig_public_include_root = fontconfig_public_include_dir
    .parent()
    .expect("fontconfig include root must exist")
    .to_path_buf();

  fs::create_dir_all(&generated_dir).expect("failed to create libass generated dir");
  generate_config_h(&ctx, &generated_dir);
  generate_fribidi_config_h(&ctx, &generated_dir);
  generate_fontconfig_header(&ctx, &vendor, &fontconfig_public_include_dir);

  let include_dirs = libass_include_dirs(&vendor, &generated_dir, &fontconfig_public_include_root);
  let defines = libass_defines();
  let sources = libass_sources(&libass_dir);

  ctx.compile_static_library(StaticLibrarySpec {
    name: "ass",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &["-std=gnu99", "-fno-math-errno"],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("ass");
  if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" && !ctx.is_wasm32_unknown_unknown() {
    println!("cargo:rustc-link-lib=m");
  }
}

fn generate_config_h(ctx: &NativeBuildContext, generated_dir: &Path) {
  let output = generated_dir.join("config.h");
  ctx.write_generated_file(&output, &render_config_h());
}

fn generate_fribidi_config_h(ctx: &NativeBuildContext, generated_dir: &Path) {
  let output = generated_dir.join("fribidi-config.h");
  ctx.write_generated_file(&output, &render_fribidi_config_h());

  let unicode_version = generated_dir.join("fribidi-unicode-version.h");
  ctx.write_generated_file(&unicode_version, &render_fribidi_unicode_version_h());
}

fn generate_fontconfig_header(ctx: &NativeBuildContext, vendor: &Path, public_include_dir: &Path) {
  let template = vendor.join("../fontconfig/fontconfig/fontconfig.h.in");
  let output = public_include_dir.join("fontconfig.h");
  let contents = fs::read_to_string(&template).expect("failed to read fontconfig.h.in for libass build");
  ctx.write_generated_file(&output, &contents.replace("@CACHE_VERSION@", "11"));
}

fn libass_include_dirs(vendor: &Path, generated_dir: &Path, fontconfig_public_include_root: &Path) -> Vec<PathBuf> {
  vec![
    generated_dir.to_path_buf(),
    vendor.to_path_buf(),
    vendor.join("libass"),
    vendor.join("../freetype/include"),
    vendor.join("../fribidi/lib"),
    vendor.join("../harfbuzz/src"),
    vendor.join("../fontconfig"),
    fontconfig_public_include_root.to_path_buf(),
  ]
}

fn libass_sources(libass_dir: &Path) -> Vec<PathBuf> {
  [
    "c/c_be_blur.c",
    "c/c_blend_bitmaps.c",
    "c/c_blur.c",
    "c/c_rasterizer.c",
    "ass.c",
    "ass_bitmap.c",
    "ass_bitmap_engine.c",
    "ass_blur.c",
    "ass_cache.c",
    "ass_drawing.c",
    "ass_filesystem.c",
    "ass_font.c",
    "ass_fontconfig.c",
    "ass_fontselect.c",
    "ass_library.c",
    "ass_outline.c",
    "ass_parse.c",
    "ass_rasterizer.c",
    "ass_render.c",
    "ass_render_api.c",
    "ass_shaper.c",
    "ass_string.c",
    "ass_strtod.c",
    "ass_utils.c",
  ]
  .into_iter()
  .map(|file| libass_dir.join(file))
  .collect()
}

fn libass_defines() -> [(&'static str, Option<&'static str>); 2] {
  [("_GNU_SOURCE", Some("1")), ("_XPLATFORM_SOURCE", Some("1"))]
}

fn render_config_h() -> String {
  let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  let arch_x86 = matches!(target_arch.as_str(), "x86" | "x86_64") as i32;
  let arch_aarch64 = (target_arch == "aarch64") as i32;

  format!(
    "#define ARCH_AARCH64 {arch_aarch64}\n#define ARCH_X86 {arch_x86}\n#define CONFIG_ASM 0\n#define CONFIG_FONTCONFIG 1\n#define CONFIG_LARGE_TILES 0\n#define CONFIG_SOURCEVERSION \"akarisub bootstrap\"\n#define HAVE_FSTAT 1\n#define HAVE_STRDUP 1\n#define HAVE_STRNDUP 1\n"
  )
}

fn render_fribidi_config_h() -> String {
  [
    "#ifndef FRIBIDI_CONFIG_H",
    "#define FRIBIDI_CONFIG_H",
    "#define FRIBIDI \"fribidi\"",
    "#define FRIBIDI_NAME \"GNU FriBidi\"",
    "#define FRIBIDI_VERSION \"1.0.16\"",
    "#define FRIBIDI_MAJOR_VERSION 1",
    "#define FRIBIDI_MINOR_VERSION 0",
    "#define FRIBIDI_MICRO_VERSION 16",
    "#define FRIBIDI_INTERFACE_VERSION 4",
    "#define FRIBIDI_INTERFACE_VERSION_STRING \"4\"",
    "#define FRIBIDI_SIZEOF_INT 4",
    "#endif",
    "",
  ]
  .join("\n")
}

fn render_fribidi_unicode_version_h() -> String {
  [
    "#ifndef FRIBIDI_UNICODE_VERSION_H",
    "#define FRIBIDI_UNICODE_VERSION_H",
    "#define FRIBIDI_UNICODE_VERSION \"16.0.0\"",
    "#endif",
    "",
  ]
  .join("\n")
}
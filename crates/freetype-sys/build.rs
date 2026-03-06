use std::env;
use std::path::{Path, PathBuf};

use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("freetype");

  let vendor = ctx.vendor_dir("freetype");
  let include_root = vendor.join("include");
  let generated_include_dir = ctx.generated_include_dir("freetype");
  let generated_config_dir = generated_include_dir.join("freetype/config");
  std::fs::create_dir_all(&generated_config_dir).expect("failed to create freetype generated config dir");

  generate_ftmodule_h(&ctx, &vendor, &generated_include_dir);
  generate_ftoption_h(&ctx, &vendor, &generated_include_dir);

  let include_dirs = vec![include_root.clone(), generated_include_dir.clone()];
  let defines = [
    ("FT2_BUILD_LIBRARY", Some("1")),
    ("FT_CONFIG_MODULES_H", Some("<ftmodule.h>")),
    ("FT_CONFIG_OPTIONS_H", Some("<ftoption.h>")),
  ];

  let mut sources = vec![
    vendor.join("src/base/ftbase.c"),
    vendor.join("src/base/ftinit.c"),
    vendor.join("src/base/ftsystem.c"),
    vendor.join("src/base/ftdebug.c"),
  ];

  sources.extend(module_sources(&vendor));
  sources.extend(aux_sources(&vendor));
  sources.extend(base_extension_sources(&vendor));

  ctx.compile_static_library(StaticLibrarySpec {
    name: "freetype",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &[],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("freetype");
}

fn python_executable() -> PathBuf {
  env::var("PYTHON")
    .or_else(|_| env::var("PYTHON3"))
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("python3"))
}

fn generate_ftmodule_h(ctx: &NativeBuildContext, vendor: &Path, generated_include_dir: &Path) {
  let python = python_executable();
  let script = vendor.join("builds/meson/parse_modules_cfg.py");
  let modules_cfg = vendor.join("modules.cfg");
  let output = generated_include_dir.join("ftmodule.h");

  ctx.run_command(
    &python,
    &[
      script.to_str().expect("invalid parse_modules_cfg.py path"),
      "--format=ftmodule.h",
      modules_cfg.to_str().expect("invalid modules.cfg path"),
      "--output",
      output.to_str().expect("invalid ftmodule output path"),
    ],
  );
}

fn generate_ftoption_h(ctx: &NativeBuildContext, vendor: &Path, generated_include_dir: &Path) {
  let python = python_executable();
  let script = vendor.join("builds/meson/process_ftoption_h.py");
  let input = vendor.join("include/freetype/config/ftoption.h");
  let output = generated_include_dir.join("ftoption.h");

  ctx.run_command(
    &python,
    &[
      script.to_str().expect("invalid process_ftoption_h.py path"),
      input.to_str().expect("invalid ftoption input path"),
      &format!("--output={}", output.to_str().expect("invalid ftoption output path")),
      "--disable=FT_CONFIG_OPTION_USE_ZLIB",
      "--disable=FT_CONFIG_OPTION_USE_BZIP2",
      "--disable=FT_CONFIG_OPTION_USE_PNG",
      "--disable=FT_CONFIG_OPTION_USE_HARFBUZZ",
      "--disable=FT_CONFIG_OPTION_USE_BROTLI",
      "--disable=FT_CONFIG_OPTION_USE_LZW",
      "--disable=FT_CONFIG_OPTION_ERROR_STRINGS",
    ],
  );
}

fn module_sources(vendor: &Path) -> Vec<PathBuf> {
  [
    "src/autofit/autofit.c",
    "src/truetype/truetype.c",
    "src/type1/type1.c",
    "src/cff/cff.c",
    "src/cid/type1cid.c",
    "src/pfr/pfr.c",
    "src/type42/type42.c",
    "src/winfonts/winfnt.c",
    "src/pcf/pcf.c",
    "src/bdf/bdf.c",
    "src/sfnt/sfnt.c",
    "src/pshinter/pshinter.c",
    "src/smooth/smooth.c",
    "src/raster/raster.c",
    "src/svg/svg.c",
    "src/sdf/sdf.c",
  ]
  .into_iter()
  .map(|path| vendor.join(path))
  .collect()
}

fn aux_sources(vendor: &Path) -> Vec<PathBuf> {
  [
    "src/cache/ftcache.c",
    "src/psaux/psaux.c",
    "src/psnames/psnames.c",
  ]
  .into_iter()
  .map(|path| vendor.join(path))
  .collect()
}

fn base_extension_sources(vendor: &Path) -> Vec<PathBuf> {
  [
    "src/base/ftbbox.c",
    "src/base/ftbdf.c",
    "src/base/ftbitmap.c",
    "src/base/ftcid.c",
    "src/base/ftfstype.c",
    "src/base/ftgasp.c",
    "src/base/ftglyph.c",
    "src/base/ftgxval.c",
    "src/base/ftmm.c",
    "src/base/ftotval.c",
    "src/base/ftpatent.c",
    "src/base/ftpfr.c",
    "src/base/ftstroke.c",
    "src/base/ftsynth.c",
    "src/base/fttype1.c",
    "src/base/ftwinfnt.c",
  ]
  .into_iter()
  .map(|path| vendor.join(path))
  .collect()
}
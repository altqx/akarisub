use std::path::{Path, PathBuf};

use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("fribidi");

  let vendor = ctx.vendor_dir("fribidi");
  let lib_dir = vendor.join("lib");
  let gen_dir = vendor.join("gen.tab");
  let generated_dir = ctx.generated_dir("fribidi");
  let generated_include_dir = ctx.generated_include_dir("fribidi");

  let config_h = generated_dir.join("config.h");
  let fribidi_config_h = generated_include_dir.join("fribidi-config.h");
  ctx.write_generated_file(&config_h, &render_config_h());
  ctx.write_generated_file(&fribidi_config_h, &render_fribidi_config_h());

  generate_unicode_tables(&ctx, &lib_dir, &gen_dir, &generated_dir, &generated_include_dir);

  let include_dirs = vec![lib_dir.clone(), generated_dir.clone(), generated_include_dir.clone()];
  let defines = [("HAVE_CONFIG_H", Some("1")), ("FRIBIDI_BUILD", None)];
  let sources = collect_sources(&lib_dir, &[
    "fribidi.c",
    "fribidi-arabic.c",
    "fribidi-bidi.c",
    "fribidi-bidi-types.c",
    "fribidi-char-sets.c",
    "fribidi-char-sets-cap-rtl.c",
    "fribidi-char-sets-cp1255.c",
    "fribidi-char-sets-cp1256.c",
    "fribidi-char-sets-iso8859-6.c",
    "fribidi-char-sets-iso8859-8.c",
    "fribidi-char-sets-utf8.c",
    "fribidi-deprecated.c",
    "fribidi-joining.c",
    "fribidi-joining-types.c",
    "fribidi-mirroring.c",
    "fribidi-brackets.c",
    "fribidi-run.c",
    "fribidi-shape.c",
  ]);

  ctx.compile_static_library(StaticLibrarySpec {
    name: "fribidi",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &[],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("fribidi");
}

fn generate_unicode_tables(
  ctx: &NativeBuildContext,
  lib_dir: &Path,
  gen_dir: &Path,
  generated_dir: &Path,
  generated_include_dir: &Path,
) {
  let include_dirs = vec![lib_dir.to_path_buf(), gen_dir.to_path_buf(), generated_dir.to_path_buf(), generated_include_dir.to_path_buf()];
  let defines = [("HAVE_CONFIG_H", Some("1"))];

  let unicode_exe = ctx.compile_host_executable(
    "fribidi-gen-unicode-version",
    &[gen_dir.join("gen-unicode-version.c")],
    &include_dirs,
    &defines,
    &[],
  );
  let unicode_tool_name = PathBuf::from("gen-unicode-version");
  let unicode_header = ctx.run_and_capture_stdout(
    &unicode_exe,
    &[
      gen_dir.join("unidata/ReadMe.txt").as_path(),
      gen_dir.join("unidata/BidiMirroring.txt").as_path(),
      unicode_tool_name.as_path(),
    ],
  );
  ctx.write_generated_file(&generated_include_dir.join("fribidi-unicode-version.h"), &unicode_header);

  generate_tab(
    ctx,
    "bidi-type",
    &[gen_dir.join("unidata/UnicodeData.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
  generate_tab(
    ctx,
    "joining-type",
    &[gen_dir.join("unidata/UnicodeData.txt"), gen_dir.join("unidata/ArabicShaping.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
  generate_tab(
    ctx,
    "arabic-shaping",
    &[gen_dir.join("unidata/UnicodeData.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
  generate_tab(
    ctx,
    "mirroring",
    &[gen_dir.join("unidata/BidiMirroring.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
  generate_tab(
    ctx,
    "brackets",
    &[gen_dir.join("unidata/BidiBrackets.txt"), gen_dir.join("unidata/UnicodeData.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
  generate_tab(
    ctx,
    "brackets-type",
    &[gen_dir.join("unidata/BidiBrackets.txt")],
    lib_dir,
    gen_dir,
    generated_dir,
    generated_include_dir,
  );
}

fn generate_tab(
  ctx: &NativeBuildContext,
  name: &str,
  inputs: &[PathBuf],
  lib_dir: &Path,
  gen_dir: &Path,
  generated_dir: &Path,
  generated_include_dir: &Path,
) {
  let include_dirs = vec![lib_dir.to_path_buf(), gen_dir.to_path_buf(), generated_dir.to_path_buf(), generated_include_dir.to_path_buf()];
  let defines = [("HAVE_CONFIG_H", Some("1"))];
  let exe_name = format!("fribidi-gen-{name}-tab");
  let source_name = format!("gen-{name}-tab.c");
  let exe = ctx.compile_host_executable(
    &exe_name,
    &[gen_dir.join(source_name), gen_dir.join("packtab.c")],
    &include_dirs,
    &defines,
    &[],
  );

  let max_depth = PathBuf::from("2");
  let unused_input = PathBuf::from("fribidi-unused-input");
  let trailing_name = PathBuf::from(&exe_name);
  let second_input = inputs.get(1).unwrap_or(&unused_input);
  let args = [max_depth.as_path(), inputs[0].as_path(), second_input.as_path(), trailing_name.as_path()];
  let generated = ctx.run_and_capture_stdout(
    &exe,
    &args[..required_arg_count(name)],
  );
  ctx.write_generated_file(&generated_dir.join(format!("{name}.tab.i")), &generated);
}

fn required_arg_count(name: &str) -> usize {
  match name {
    "joining-type" | "arabic-shaping" | "brackets" => 4,
    _ => 3,
  }
}

fn render_config_h() -> String {
  [
    "#ifndef CONFIG_H",
    "#define CONFIG_H 1",
    "#define HAVE_MEMMOVE 1",
    "#define HAVE_MEMSET 1",
    "#define HAVE_STRDUP 1",
    "#define HAVE_STDLIB_H 1",
    "#define HAVE_STRING_H 1",
    "#define HAVE_MEMORY_H 1",
    "#define STDC_HEADERS 1",
    "#define HAVE_STRINGIZE 1",
    "",
    "#endif",
    "",
  ]
  .join("\n")
}

fn render_fribidi_config_h() -> String {
  [
    "/* generated fribidi-config.h for akarisub-rs */",
    "#ifndef FRIBIDI_CONFIG_H",
    "#define FRIBIDI_CONFIG_H",
    "",
    "#define FRIBIDI \"fribidi\"",
    "#define FRIBIDI_NAME \"GNU FriBidi\"",
    "#define FRIBIDI_BUGREPORT \"https://github.com/fribidi/fribidi/issues/new\"",
    "#define FRIBIDI_VERSION \"1.0.16\"",
    "#define FRIBIDI_MAJOR_VERSION 1",
    "#define FRIBIDI_MINOR_VERSION 0",
    "#define FRIBIDI_MICRO_VERSION 16",
    "#define FRIBIDI_INTERFACE_VERSION 4",
    "#define FRIBIDI_INTERFACE_VERSION_STRING \"4\"",
    "#define FRIBIDI_SIZEOF_INT 4",
    "",
    "#endif",
    "",
  ]
  .join("\n")
}

fn collect_sources(root: &Path, files: &[&str]) -> Vec<PathBuf> {
  files.iter().map(|file| root.join(file)).collect()
}
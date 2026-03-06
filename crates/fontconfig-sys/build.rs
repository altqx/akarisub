use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("fontconfig");

  let vendor = ctx.vendor_dir("fontconfig");
  let src_dir = vendor.join("src");
  let fc_lang_dir = vendor.join("fc-lang");
  let public_include_dir = ctx.generated_include_dir("fontconfig");
  let public_include_root = public_include_dir
    .parent()
    .expect("fontconfig include root must exist")
    .to_path_buf();
  let generated_root = ctx.generated_dir("fontconfig");
  let generated_src_dir = generated_root.join("src");
  let generated_fc_case_dir = generated_root.join("fc-case");
  let generated_fc_lang_dir = generated_root.join("fc-lang");
  let generated_fc_const_dir = generated_root.join("fc-const");

  fs::create_dir_all(&generated_src_dir).expect("failed to create generated src dir");
  fs::create_dir_all(&generated_fc_case_dir).expect("failed to create generated fc-case dir");
  fs::create_dir_all(&generated_fc_lang_dir).expect("failed to create generated fc-lang dir");
  fs::create_dir_all(&generated_fc_const_dir).expect("failed to create generated fc-const dir");

  generate_public_header(&ctx, &vendor, &public_include_dir);
  generate_internal_config(&ctx, &generated_src_dir);
  copy_fcstdint_header(&ctx, &vendor, &generated_src_dir);
  generate_alias_headers(&ctx, &vendor, &generated_src_dir, &public_include_dir);
  generate_fccase_h(&ctx, &vendor, &generated_fc_case_dir);
  generate_fclang_h(&ctx, &fc_lang_dir, &generated_fc_lang_dir);
  generate_fcconst_h(&ctx, &vendor, &generated_src_dir);

  let include_dirs = fontconfig_include_dirs(
    &vendor,
    &generated_root,
    &generated_src_dir,
    &generated_fc_case_dir,
    &generated_fc_lang_dir,
    &public_include_root,
  );
  let defines = fontconfig_defines();
  generate_fcobjshash_h(&ctx, &vendor, &generated_src_dir, &include_dirs, &defines);

  let sources = fontconfig_sources(&src_dir);
  ctx.compile_static_library(StaticLibrarySpec {
    name: "fontconfig",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &[],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("fontconfig");
  if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" && !ctx.is_wasm32_unknown_unknown() {
    println!("cargo:rustc-link-lib=m");
  }
}

fn python_executable() -> PathBuf {
  env::var("PYTHON")
    .or_else(|_| env::var("PYTHON3"))
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("python3"))
}

fn gperf_executable() -> PathBuf {
  env::var("GPERF").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("gperf"))
}

fn generate_public_header(ctx: &NativeBuildContext, vendor: &Path, public_include_dir: &Path) {
  let template = vendor.join("fontconfig/fontconfig.h.in");
  let output = public_include_dir.join("fontconfig.h");
  let contents = fs::read_to_string(&template).expect("failed to read fontconfig.h.in");
  ctx.write_generated_file(&output, &contents.replace("@CACHE_VERSION@", "11"));
}

fn generate_internal_config(ctx: &NativeBuildContext, generated_dir: &Path) {
  let meson_config = generated_dir.join("meson-config.h");
  let config = generated_dir.join("config.h");
  ctx.write_generated_file(&meson_config, &render_meson_config(ctx));
  ctx.write_generated_file(&config, "#include \"meson-config.h\"\n#include \"config-fixups.h\"\n");
}

fn copy_fcstdint_header(ctx: &NativeBuildContext, vendor: &Path, generated_dir: &Path) {
  let input = vendor.join("src/fcstdint.h.in");
  let output = generated_dir.join("fcstdint.h");
  let contents = fs::read_to_string(&input).expect("failed to read fcstdint.h.in");
  ctx.write_generated_file(&output, &contents);
}

fn generate_alias_headers(
  ctx: &NativeBuildContext,
  vendor: &Path,
  generated_dir: &Path,
  public_include_dir: &Path,
) {
  if ctx.is_wasm32_unknown_unknown() {
    for output in [
      generated_dir.join("fcalias.h"),
      generated_dir.join("fcaliastail.h"),
      generated_dir.join("fcftalias.h"),
      generated_dir.join("fcftaliastail.h"),
    ] {
      ctx.write_generated_file(&output, "");
    }
    return;
  }

  let python = python_executable();
  let script = vendor.join("src/makealias.py");
  let src_dir = vendor.join("src");

  let fcalias = generated_dir.join("fcalias.h");
  let fcaliastail = generated_dir.join("fcaliastail.h");
  run_python(
    &python,
    &[
      script.as_path(),
      src_dir.as_path(),
      fcalias.as_path(),
      fcaliastail.as_path(),
      public_include_dir.join("fontconfig.h").as_path(),
      vendor.join("src/fcdeprecate.h").as_path(),
      vendor.join("fontconfig/fcprivate.h").as_path(),
    ],
  );

  let fcftalias = generated_dir.join("fcftalias.h");
  let fcftaliastail = generated_dir.join("fcftaliastail.h");
  run_python(
    &python,
    &[
      script.as_path(),
      src_dir.as_path(),
      fcftalias.as_path(),
      fcftaliastail.as_path(),
      vendor.join("fontconfig/fcfreetype.h").as_path(),
    ],
  );
}

fn generate_fccase_h(_ctx: &NativeBuildContext, vendor: &Path, generated_dir: &Path) {
  let python = python_executable();
  let script = vendor.join("fc-case/fc-case.py");
  let output = generated_dir.join("fccase.h");
  run_python(
    &python,
    &[
      script.as_path(),
      vendor.join("fc-case/CaseFolding.txt").as_path(),
      Path::new("--template"),
      vendor.join("fc-case/fccase.tmpl.h").as_path(),
      Path::new("--output"),
      output.as_path(),
    ],
  );
}

fn generate_fclang_h(_ctx: &NativeBuildContext, fc_lang_dir: &Path, generated_dir: &Path) {
  let python = python_executable();
  let script = fc_lang_dir.join("fc-lang.py");
  let output = generated_dir.join("fclang.h");

  let mut args = Vec::new();
  args.push(script);
  args.extend(sorted_orth_files(fc_lang_dir));
  args.push(PathBuf::from("--template"));
  args.push(fc_lang_dir.join("fclang.tmpl.h"));
  args.push(PathBuf::from("--output"));
  args.push(output);
  args.push(PathBuf::from("--directory"));
  args.push(fc_lang_dir.to_path_buf());

  let arg_refs: Vec<&Path> = args.iter().map(PathBuf::as_path).collect();
  run_python(&python, &arg_refs);
}

fn generate_fcconst_h(_ctx: &NativeBuildContext, vendor: &Path, generated_dir: &Path) {
  let python = python_executable();
  let script = vendor.join("fc-const/fc-const.py");
  let output = generated_dir.join("fcconst.h");
  run_python(
    &python,
    &[
      script.as_path(),
      vendor.join("fc-const/fcconst.list").as_path(),
      vendor.join("src/fcobjs.h").as_path(),
      Path::new("--output"),
      output.as_path(),
    ],
  );
}

fn generate_fcobjshash_h(
  ctx: &NativeBuildContext,
  vendor: &Path,
  generated_dir: &Path,
  include_dirs: &[PathBuf],
  defines: &[(&str, Option<&str>)],
) {
  let preprocessed = generated_dir.join("fcobjshash.preprocessed.h");
  preprocess_fcobjshash(ctx, vendor, include_dirs, defines, &preprocessed);

  let cutout = vendor.join("src/cutout.py");
  let gperf_input = generated_dir.join("fcobjshash.gperf");
  let python = python_executable();
  run_python(&python, &[cutout.as_path(), preprocessed.as_path(), gperf_input.as_path()]);

  let gperf = gperf_executable();
  let output = generated_dir.join("fcobjshash.h");
  let status = Command::new(&gperf)
    .arg("--pic")
    .arg("-m")
    .arg("100")
    .arg(&gperf_input)
    .arg("--output-file")
    .arg(&output)
    .status()
    .expect("failed to run gperf for fcobjshash.h generation");
  if !status.success() {
    panic!("gperf failed to generate fcobjshash.h");
  }
}

fn preprocess_fcobjshash(
  ctx: &NativeBuildContext,
  vendor: &Path,
  include_dirs: &[PathBuf],
  defines: &[(&str, Option<&str>)],
  output: &Path,
) {
  let tool = cc::Build::new().cargo_metadata(false).get_compiler();
  let mut command = tool.to_command();

  if ctx.is_wasm32_unknown_unknown() {
    let emsdk = env::var("EMSDK").expect("EMSDK must be set for fontconfig wasm preprocessing");
    let sysroot = PathBuf::from(&emsdk).join("upstream/emscripten/cache/sysroot");
    let compiler = PathBuf::from(&emsdk).join("upstream/bin/clang");

    command = Command::new(&compiler);
    command.arg("--target=wasm32-unknown-unknown");
    command.arg(format!("--sysroot={}", sysroot.display()));
  }

  command.arg("-E");
  command.arg("-P");
  command.arg(vendor.join("src/fcobjshash.gperf.h"));

  for include_dir in include_dirs {
    command.arg("-I");
    command.arg(include_dir);
  }

  for (key, value) in defines {
    if let Some(value) = value {
      command.arg(format!("-D{key}={value}"));
    } else {
      command.arg(format!("-D{key}"));
    }
  }

  let result = command.output().expect("failed to preprocess fcobjshash.gperf.h");
  if !result.status.success() {
    panic!(
      "failed to preprocess fcobjshash.gperf.h\n{}",
      String::from_utf8_lossy(&result.stderr)
    );
  }

  fs::write(output, result.stdout).expect("failed to write preprocessed fcobjshash input");
}

fn run_python(python: &Path, args: &[&Path]) {
  let mut command = Command::new(python);
  for arg in args {
    command.arg(arg);
  }

  let status = command.status().expect("failed to run python helper");
  if !status.success() {
    panic!("python helper failed: {}", python.display());
  }
}

fn sorted_orth_files(fc_lang_dir: &Path) -> Vec<PathBuf> {
  let mut entries: Vec<PathBuf> = fs::read_dir(fc_lang_dir)
    .expect("failed to read fc-lang directory")
    .filter_map(|entry| entry.ok())
    .filter_map(|entry| {
      let path = entry.path();
      if path.extension().and_then(|ext| ext.to_str()) == Some("orth") {
        Some(PathBuf::from(entry.file_name()))
      } else {
        None
      }
    })
    .collect();
  entries.sort();
  entries
}

fn fontconfig_include_dirs(
  vendor: &Path,
  generated_root: &Path,
  generated_src_dir: &Path,
  generated_fc_case_dir: &Path,
  generated_fc_lang_dir: &Path,
  public_include_root: &Path,
) -> Vec<PathBuf> {
  vec![
    vendor.to_path_buf(),
    vendor.join("src"),
    vendor.join("fc-lang"),
    vendor.join("../freetype/include"),
    vendor.join("../expat/expat/lib"),
    public_include_root.to_path_buf(),
    generated_root.to_path_buf(),
    generated_src_dir.to_path_buf(),
    generated_fc_case_dir.to_path_buf(),
    generated_fc_lang_dir.to_path_buf(),
  ]
}

fn fontconfig_sources(src_dir: &Path) -> Vec<PathBuf> {
  [
    "fcatomic.c",
    "fccache.c",
    "fccfg.c",
    "fccharset.c",
    "fcconffile.c",
    "fccompat.c",
    "fcdbg.c",
    "fcdefault.c",
    "fcdir.c",
    "fcformat.c",
    "fcfreetype.c",
    "fcfs.c",
    "fchash.c",
    "fcinit.c",
    "fclang.c",
    "fclist.c",
    "fcmatch.c",
    "fcmatrix.c",
    "fcname.c",
    "fcobjs.c",
    "fcpat.c",
    "fcptrlist.c",
    "fcrange.c",
    "fcserialize.c",
    "fcstat.c",
    "fcstr.c",
    "fcweight.c",
    "fcxml.c",
    "ftglue.c",
  ]
  .into_iter()
  .map(|file| src_dir.join(file))
  .collect()
}

fn fontconfig_defines() -> [(&'static str, Option<&'static str>); 8] {
  [
    ("HAVE_CONFIG_H", Some("1")),
    ("FC_NO_MT", Some("1")),
    ("FC_CACHEDIR", Some("\"\"")),
    ("CONFIGDIR", Some("\"\"")),
    ("FONTCONFIG_PATH", Some("\"\"")),
    ("FC_TEMPLATEDIR", Some("\"\"")),
    ("_GNU_SOURCE", Some("1")),
    ("inline", Some("inline")),
  ]
}

fn render_meson_config(ctx: &NativeBuildContext) -> String {
  let pointer_width = env::var("CARGO_CFG_TARGET_POINTER_WIDTH")
    .ok()
    .and_then(|width| width.parse::<usize>().ok())
    .unwrap_or(64);
  let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  let alignof_double = match target_arch.as_str() {
    "x86" => 4,
    _ => 8,
  };
  let is_wasm = ctx.is_wasm32_unknown_unknown();
  let have_random_r = if ctx.is_wasm32_unknown_unknown() { 0 } else { 1 };
  let statfs_defines = if is_wasm {
    ""
  } else {
    "#define HAVE_FSTATFS 1\n#define HAVE_FSTATVFS 1\n#define HAVE_STRUCT_STATFS_F_FLAGS 1\n#define HAVE_SYS_MOUNT_H 1\n#define HAVE_SYS_PARAM_H 1\n#define HAVE_SYS_STATFS_H 1\n#define HAVE_SYS_STATVFS_H 1\n#define HAVE_SYS_VFS_H 1\n"
  };

  let words_big_endian = if ctx.target_endian() == "big" {
    "#define WORDS_BIGENDIAN 1\n"
  } else {
    ""
  };

  format!(
    "#define ALIGNOF_DOUBLE {alignof_double}\n#define ALIGNOF_VOID_P {}\n#define ENABLE_FREETYPE 1\n#define FC_ARCHITECTURE \"{}\"\n#define FC_DEFAULT_FONTS \"\"\n#define FC_GPERF_SIZE_T size_t\n#define FC_LIBDIR \"\"\n#define FC_VERSION_MAJOR 2\n#define FC_VERSION_MINOR 17\n#define FC_VERSION_MICRO 1\n#define FLEXIBLE_ARRAY_MEMBER /**/\n#define HAVE_DIRENT_H 1\n#define HAVE_DLFCN_H 1\n#define HAVE_FCNTL_H 1\n#define HAVE_GETOPT 1\n#define HAVE_GETOPT_LONG 1\n#define HAVE_GETPAGESIZE 1\n#define HAVE_GETPID 1\n#define HAVE_GNUC_ATTRIBUTE 1\n#define HAVE_INTTYPES_H 1\n#define HAVE_INTTYPES_H 1\n#define HAVE_LINK 1\n#define HAVE_LOCALTIME_R 1\n#define HAVE_LSTAT 1\n#define HAVE_MKDTEMP 1\n#define HAVE_MKOSTEMP 1\n#define HAVE_MKSTEMP 1\n#define HAVE_MMAP 1\n#define HAVE_POSIX_FADVISE 1\n#define HAVE_RAND 1\n#define HAVE_RANDOM 1\n#define HAVE_RANDOM_R {have_random_r}\n#define HAVE_READLINK 1\n#define HAVE_SCHED_H 1\n#define HAVE_STDINT_H 1\n#define HAVE_STDIO_H 1\n#define HAVE_STDLIB_H 1\n#define HAVE_STRDUP 1\n#define HAVE_STRERROR 1\n#define HAVE_STRERROR_R 1\n#define HAVE_STRINGS_H 1\n#define HAVE_STRING_H 1\n#define HAVE_STRUCT_DIRENT_D_TYPE 1\n#define HAVE_STRUCT_STAT_ST_MTIM 1\n#define HAVE_SYS_STAT_H 1\n#define HAVE_SYS_TYPES_H 1\n#define HAVE_TIME_H 1\n#define HAVE_UNISTD_H 1\n#define HAVE_VASPRINTF 1\n#define HAVE_VPRINTF 1\n#define HAVE_VSNPRINTF 1\n#define HAVE_VSPRINTF 1\n#define HAVE_WCHAR_H 1\n#define PACKAGE \"fontconfig\"\n#define PACKAGE_BUGREPORT \"https://gitlab.freedesktop.org/fontconfig/fontconfig/issues/new\"\n#define PACKAGE_NAME \"fontconfig\"\n#define PACKAGE_STRING \"fontconfig 2.17.1\"\n#define PACKAGE_TARNAME \"fontconfig\"\n#define PACKAGE_URL \"\"\n#define PACKAGE_VERSION \"2.17.1\"\n#define SIZEOF_VOID_P {}\n#define STDC_HEADERS 1\n#define USE_ICONV 0\n{statfs_defines}{words_big_endian}",
    pointer_width / 8,
    fontconfig_architecture(ctx.target_endian(), pointer_width, alignof_double),
    pointer_width / 8,
  )
}

fn fontconfig_architecture(target_endian: &str, pointer_width: usize, alignof_double: usize) -> &'static str {
  match (target_endian, pointer_width, alignof_double) {
    ("big", 32, 4) => "be32d4",
    ("big", 32, 8) => "be32d8",
    ("big", 64, _) => "be64",
    ("little", 32, 4) => "le32d4",
    ("little", 32, 8) => "le32d8",
    ("little", 64, _) => "le64",
    _ => "le64",
  }
}
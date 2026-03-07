use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct NativeBuildContext {
  manifest_dir: PathBuf,
  out_dir: PathBuf,
  target_arch: String,
  target_os: String,
  target_env: String,
  target_endian: String,
}

pub struct StaticLibrarySpec<'a> {
  pub name: &'a str,
  pub sources: &'a [PathBuf],
  pub include_dirs: &'a [PathBuf],
  pub defines: &'a [(&'a str, Option<&'a str>)],
  pub flags: &'a [&'a str],
}

pub struct CppStaticLibrarySpec<'a> {
  pub name: &'a str,
  pub sources: &'a [PathBuf],
  pub include_dirs: &'a [PathBuf],
  pub defines: &'a [(&'a str, Option<&'a str>)],
  pub flags: &'a [&'a str],
  pub cpp_std: &'a str,
}

impl NativeBuildContext {
  pub fn new() -> Self {
    Self {
      manifest_dir: PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR")),
      out_dir: PathBuf::from(env::var("OUT_DIR").expect("missing OUT_DIR")),
      target_arch: env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default(),
      target_os: env::var("CARGO_CFG_TARGET_OS").unwrap_or_default(),
      target_env: env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default(),
      target_endian: env::var("CARGO_CFG_TARGET_ENDIAN").unwrap_or_else(|_| "little".to_owned()),
    }
  }

  pub fn vendor_dir(&self, name: &str) -> PathBuf {
    self.manifest_dir.join("../../vendor").join(name)
  }

  pub fn generated_include_dir(&self, namespace: &str) -> PathBuf {
    let dir = self.out_dir.join("include").join(namespace);
    fs::create_dir_all(&dir).expect("failed to create generated include dir");
    dir
  }

  pub fn generated_dir(&self, namespace: &str) -> PathBuf {
    let dir = self.out_dir.join(namespace);
    fs::create_dir_all(&dir).expect("failed to create generated dir");
    dir
  }

  pub fn write_generated_file(&self, path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).expect("failed to create generated file parent");
    }
    fs::write(path, contents).expect("failed to write generated file");
  }

  pub fn watch_vendor(&self, name: &str) {
    println!("cargo:rerun-if-changed={}", self.vendor_dir(name).display());
  }

  pub fn is_wasm32_unknown_unknown(&self) -> bool {
    self.target_arch == "wasm32" && self.target_os == "unknown" && self.target_env.is_empty()
  }

  fn emsdk_path(&self) -> Option<PathBuf> {
    env::var_os("EMSDK").map(PathBuf::from)
  }

  fn emsdk_sysroot(&self) -> Option<PathBuf> {
    self
      .emsdk_path()
      .map(|emsdk| emsdk.join("upstream/emscripten/cache/sysroot"))
      .filter(|path| path.exists())
  }

  fn configure_cc_toolchain(&self, build: &mut cc::Build, is_cpp: bool) {
    if !self.is_wasm32_unknown_unknown() {
      return;
    }

    println!("cargo:rerun-if-env-changed=EMSDK");

    let emsdk = self
      .emsdk_path()
      .unwrap_or_else(|| panic!("EMSDK must be set for wasm32-unknown-unknown native builds"));
    let sysroot = self
      .emsdk_sysroot()
      .unwrap_or_else(|| panic!("emsdk sysroot not found under {}", emsdk.display()));
    let compiler = if is_cpp {
      emsdk.join("upstream/bin/clang++")
    } else {
      emsdk.join("upstream/bin/clang")
    };
    let archiver = emsdk.join("upstream/bin/llvm-ar");

    if !compiler.exists() {
      panic!("emsdk compiler not found: {}", compiler.display());
    }

    if !archiver.exists() {
      panic!("emsdk archiver not found: {}", archiver.display());
    }

    build.compiler(compiler);
    build.archiver(archiver);
    build.flag("--target=wasm32-unknown-unknown");
    build.flag(&format!("--sysroot={}", sysroot.display()));

    if is_cpp {
      build.flag("-stdlib=libc++");
    }
  }

  pub fn target_endian(&self) -> &str {
    &self.target_endian
  }

  pub fn compile_static_library(&self, spec: StaticLibrarySpec<'_>) {
    let mut build = cc::Build::new();
    build.cargo_metadata(false);
    build.warnings(false);
    build.pic(false);
    self.configure_cc_toolchain(&mut build, false);
    build.flag("-std=c99");

    for include_dir in spec.include_dirs {
      build.include(include_dir);
    }

    for (key, value) in spec.defines {
      build.define(key, *value);
    }

    for flag in spec.flags {
      build.flag_if_supported(flag);
    }

    for source in spec.sources {
      build.file(source);
    }

    build.compile(spec.name);
  }

  pub fn compile_cpp_static_library(&self, spec: CppStaticLibrarySpec<'_>) {
    let mut build = cc::Build::new();
    build.cpp(true);
    build.cargo_metadata(false);
    build.warnings(false);
    build.pic(false);
    self.configure_cc_toolchain(&mut build, true);
    build.flag(&format!("-std={}", spec.cpp_std));

    for include_dir in spec.include_dirs {
      build.include(include_dir);
    }

    for (key, value) in spec.defines {
      build.define(key, *value);
    }

    for flag in spec.flags {
      build.flag_if_supported(flag);
    }

    for source in spec.sources {
      build.file(source);
    }

    build.compile(spec.name);
  }

  pub fn emit_link_search(&self) {
    println!("cargo:rustc-link-search=native={}", self.out_dir.display());
  }

  pub fn emit_static_link(&self, name: &str) {
    println!("cargo:rustc-link-lib=static={name}");
  }

  pub fn compile_host_executable(
    &self,
    name: &str,
    sources: &[PathBuf],
    include_dirs: &[PathBuf],
    defines: &[(&str, Option<&str>)],
    flags: &[&str],
  ) -> PathBuf {
    let compiler = env::var("HOST_CC")
      .or_else(|_| env::var("CC"))
      .unwrap_or_else(|_| "cc".to_owned());
    let output = self.out_dir.join(format!("{}{}", name, env::consts::EXE_SUFFIX));

    let mut command = Command::new(&compiler);
    command.arg("-std=c99");
    command.arg("-O2");
    command.arg("-o");
    command.arg(&output);

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

    for flag in flags {
      command.arg(flag);
    }

    for source in sources {
      command.arg(source);
    }

    let status = command.status().expect("failed to execute host C compiler");
    if !status.success() {
      panic!("host C compiler failed for {name}");
    }

    output
  }

  pub fn run_and_capture_stdout(&self, program: &Path, args: &[&Path]) -> String {
    let mut command = Command::new(program);
    for arg in args {
      command.arg(arg);
    }

    let output = command.output().expect("failed to run generated host tool");
    if !output.status.success() {
      panic!(
        "generated host tool failed: {}\n{}",
        program.display(),
        String::from_utf8_lossy(&output.stderr)
      );
    }

    String::from_utf8(output.stdout).expect("generated host tool did not emit utf-8 output")
  }

  pub fn run_command(&self, program: &Path, args: &[&str]) -> String {
    let output = Command::new(program)
      .args(args)
      .output()
      .expect("failed to run external command");
    if !output.status.success() {
      panic!(
        "external command failed: {}\n{}",
        program.display(),
        String::from_utf8_lossy(&output.stderr)
      );
    }

    String::from_utf8(output.stdout).expect("external command did not emit utf-8 output")
  }

  pub fn warn_wasm_gap(&self, crate_name: &str, detail: &str) {
    if self.is_wasm32_unknown_unknown() {
      println!(
        "cargo:warning={crate_name} is not wired into the wasm32-unknown-unknown native build yet: {detail}"
      );
    }
  }
}
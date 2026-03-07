use akarisub_build_support::{CppStaticLibrarySpec, NativeBuildContext};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("harfbuzz");

  let vendor = ctx.vendor_dir("harfbuzz");
  let include_dirs = vec![vendor.join("src")];
  let defines = [
    ("HB_NO_MT", None),
    ("HB_NO_GLIB", None),
    ("HB_NO_GRAPHITE2", None),
    ("HB_NO_ICU", None),
  ];
  let flags = ["-fno-exceptions", "-fno-rtti"];
  let sources = vec![vendor.join("src/harfbuzz.cc")];

  ctx.compile_cpp_static_library(CppStaticLibrarySpec {
    name: "harfbuzz",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &flags,
    cpp_std: "c++11",
  });

  ctx.emit_out_dir();
  ctx.emit_link_search();
  ctx.emit_static_link("harfbuzz");
}
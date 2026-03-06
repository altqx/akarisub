use std::path::PathBuf;

use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("brotli");

  let vendor = ctx.vendor_dir("brotli");
  let c_root = vendor.join("c");
  let include_dirs = vec![c_root.join("include"), c_root.join("common"), c_root.join("dec")];

  let common_sources = collect_sources(&c_root.join("common"), &[
    "constants.c",
    "context.c",
    "dictionary.c",
    "platform.c",
    "shared_dictionary.c",
    "transform.c",
  ]);
  ctx.compile_static_library(StaticLibrarySpec {
    name: "brotlicommon",
    sources: &common_sources,
    include_dirs: &include_dirs,
    defines: &[],
    flags: &[],
  });

  let decoder_sources = collect_sources(&c_root.join("dec"), &[
    "bit_reader.c",
    "decode.c",
    "huffman.c",
    "prefix.c",
    "state.c",
    "static_init.c",
  ]);
  ctx.compile_static_library(StaticLibrarySpec {
    name: "brotlidec",
    sources: &decoder_sources,
    include_dirs: &include_dirs,
    defines: &[],
    flags: &[],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("brotlidec");
  ctx.emit_static_link("brotlicommon");
}

fn collect_sources(root: &PathBuf, files: &[&str]) -> Vec<PathBuf> {
  files.iter().map(|file| root.join(file)).collect()
}
use akarisub_build_support::{NativeBuildContext, StaticLibrarySpec};

fn main() {
  let ctx = NativeBuildContext::new();
  ctx.watch_vendor("expat");

  let vendor = ctx.vendor_dir("expat").join("expat");
  let lib_dir = vendor.join("lib");
  let generated_include_dir = ctx.generated_include_dir("expat");
  let expat_config_path = generated_include_dir.join("expat_config.h");
  ctx.write_generated_file(&expat_config_path, &render_expat_config(&ctx));

  let include_dirs = vec![lib_dir.clone(), generated_include_dir];
  let sources = vec![lib_dir.join("xmlparse.c"), lib_dir.join("xmlrole.c"), lib_dir.join("xmltok.c")];
  let defines = [("XML_BUILDING_EXPAT", Some("1"))];

  ctx.compile_static_library(StaticLibrarySpec {
    name: "expat",
    sources: &sources,
    include_dirs: &include_dirs,
    defines: &defines,
    flags: &[],
  });

  ctx.emit_link_search();
  ctx.emit_static_link("expat");
}

fn render_expat_config(ctx: &NativeBuildContext) -> String {
  let byte_order = if ctx.target_endian() == "big" { 4321 } else { 1234 };
  let words_big_endian = if ctx.target_endian() == "big" {
    "#define WORDS_BIGENDIAN 1\n"
  } else {
    ""
  };

  format!(
    "#ifndef EXPAT_CONFIG_H\n#define EXPAT_CONFIG_H 1\n\n#define BYTEORDER {byte_order}\n#define HAVE_INTTYPES_H 1\n#define HAVE_MEMORY_H 1\n#define HAVE_STDINT_H 1\n#define HAVE_STDLIB_H 1\n#define HAVE_STRING_H 1\n#define HAVE_SYS_TYPES_H 1\n#define PACKAGE \"expat\"\n#define PACKAGE_NAME \"expat\"\n#define PACKAGE_STRING \"expat 2.7.4\"\n#define PACKAGE_TARNAME \"expat\"\n#define PACKAGE_URL \"\"\n#define PACKAGE_VERSION \"2.7.4\"\n#define STDC_HEADERS 1\n{words_big_endian}#define XML_CONTEXT_BYTES 1024\n#define XML_DTD 1\n#define XML_GE 1\n#define XML_NS 1\n#define XML_POOR_ENTROPY 1\n\n#endif\n"
  )
}
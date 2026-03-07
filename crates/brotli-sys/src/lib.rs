pub mod ffi {
  pub type BrotliEncoderMode = i32;

  #[link(name = "brotlidec", kind = "static")]
  #[link(name = "brotlicommon", kind = "static")]
  unsafe extern "C" {
    pub fn BrotliEncoderVersion() -> u32;
  }
}
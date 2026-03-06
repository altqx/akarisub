pub mod ffi {
  pub type BrotliEncoderMode = i32;

  unsafe extern "C" {
    pub fn BrotliEncoderVersion() -> u32;
  }
}
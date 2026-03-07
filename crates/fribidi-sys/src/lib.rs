pub mod ffi {
  pub type FriBidiStrIndex = i32;

  #[link(name = "fribidi", kind = "static")]
  unsafe extern "C" {
    pub fn fribidi_unicode_version() -> *const core::ffi::c_char;
  }
}
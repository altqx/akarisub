pub mod ffi {
  #[repr(C)]
  pub struct FcConfig {
    _private: [u8; 0],
  }

  #[link(name = "fontconfig", kind = "static")]
  unsafe extern "C" {
    pub fn FcInitLoadConfigAndFonts() -> *mut FcConfig;
    pub fn FcConfigDestroy(config: *mut FcConfig);
  }
}
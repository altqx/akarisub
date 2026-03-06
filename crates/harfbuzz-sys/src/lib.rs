pub mod ffi {
  #[repr(C)]
  pub struct hb_buffer_t {
    _private: [u8; 0],
  }

  unsafe extern "C" {
    pub fn hb_buffer_create() -> *mut hb_buffer_t;
    pub fn hb_buffer_destroy(buffer: *mut hb_buffer_t);
  }
}
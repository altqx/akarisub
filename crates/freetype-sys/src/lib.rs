#![allow(non_camel_case_types)]

pub mod ffi {
  #[repr(C)]
  pub struct FT_LibraryRec_ {
    _private: [u8; 0],
  }

  pub type FT_Library = *mut FT_LibraryRec_;

  #[link(name = "freetype", kind = "static")]
  unsafe extern "C" {
    pub fn FT_Init_FreeType(alibrary: *mut FT_Library) -> i32;
    pub fn FT_Done_FreeType(library: FT_Library) -> i32;
  }
}
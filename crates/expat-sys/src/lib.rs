#![allow(non_camel_case_types)]

pub mod ffi {
  #[repr(C)]
  pub struct XML_ParserStruct {
    _private: [u8; 0],
  }

  pub type XML_Parser = *mut XML_ParserStruct;

  #[link(name = "expat", kind = "static")]
  unsafe extern "C" {
    pub fn XML_ParserCreate(encoding: *const core::ffi::c_char) -> XML_Parser;
    pub fn XML_ParserFree(parser: XML_Parser);
  }
}
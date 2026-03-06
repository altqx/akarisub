#![allow(non_camel_case_types)]

pub mod ffi {
  use core::ffi::{c_char, c_void};

  #[repr(C)]
  pub struct ASS_Library {
    _private: [u8; 0],
  }

  #[repr(C)]
  pub struct ASS_Renderer {
    _private: [u8; 0],
  }

  #[repr(C)]
  pub struct ASS_RenderPriv {
    _private: [u8; 0],
  }

  #[repr(C)]
  pub struct ASS_ParserPriv {
    _private: [u8; 0],
  }

  #[repr(i32)]
  #[derive(Clone, Copy, Debug, PartialEq, Eq)]
  pub enum ASS_DefaultFontProvider {
    None = 0,
    Autodetect = 1,
    CoreText = 2,
    Fontconfig = 3,
    DirectWrite = 4,
  }

  #[repr(i32)]
  #[derive(Clone, Copy, Debug, PartialEq, Eq)]
  pub enum ASS_YCbCrMatrix {
    Default = 0,
    Unknown = 1,
    None = 2,
    Bt601Tv = 3,
    Bt601Pc = 4,
    Bt709Tv = 5,
    Bt709Pc = 6,
    Smpte240mTv = 7,
    Smpte240mPc = 8,
    FccTv = 9,
    FccPc = 10,
  }

  #[repr(C)]
  pub struct ASS_Image {
    pub w: i32,
    pub h: i32,
    pub stride: i32,
    pub bitmap: *mut u8,
    pub color: u32,
    pub dst_x: i32,
    pub dst_y: i32,
    pub next: *mut ASS_Image,
    pub image_type: i32,
  }

  #[repr(C)]
  pub struct ASS_Style {
    pub name: *mut c_char,
    pub font_name: *mut c_char,
    pub font_size: f64,
    pub primary_colour: u32,
    pub secondary_colour: u32,
    pub outline_colour: u32,
    pub back_colour: u32,
    pub bold: i32,
    pub italic: i32,
    pub underline: i32,
    pub strike_out: i32,
    pub scale_x: f64,
    pub scale_y: f64,
    pub spacing: f64,
    pub angle: f64,
    pub border_style: i32,
    pub outline: f64,
    pub shadow: f64,
    pub alignment: i32,
    pub margin_l: i32,
    pub margin_r: i32,
    pub margin_v: i32,
    pub encoding: i32,
    pub treat_fontname_as_pattern: i32,
    pub blur: f64,
    pub justify: i32,
  }

  #[repr(C)]
  pub struct ASS_Event {
    pub start: i64,
    pub duration: i64,
    pub read_order: i32,
    pub layer: i32,
    pub style: i32,
    pub name: *mut c_char,
    pub margin_l: i32,
    pub margin_r: i32,
    pub margin_v: i32,
    pub effect: *mut c_char,
    pub text: *mut c_char,
    pub render_priv: *mut ASS_RenderPriv,
  }

  #[repr(C)]
  pub struct ASS_Track {
    pub n_styles: i32,
    pub max_styles: i32,
    pub n_events: i32,
    pub max_events: i32,
    pub styles: *mut ASS_Style,
    pub events: *mut ASS_Event,
    pub style_format: *mut c_char,
    pub event_format: *mut c_char,
    pub track_type: i32,
    pub play_res_x: i32,
    pub play_res_y: i32,
    pub timer: f64,
    pub wrap_style: i32,
    pub scaled_border_and_shadow: i32,
    pub kerning: i32,
    pub language: *mut c_char,
    pub ycbcr_matrix: ASS_YCbCrMatrix,
    pub default_style: i32,
    pub name: *mut c_char,
    pub library: *mut ASS_Library,
    pub parser_priv: *mut ASS_ParserPriv,
    pub layout_res_x: i32,
    pub layout_res_y: i32,
  }

  pub type AssMessageCallback = unsafe extern "C" fn(
    level: i32,
    fmt: *const c_char,
    args: *mut c_void,
    data: *mut c_void,
  );

  unsafe extern "C" {
    pub fn ass_library_version() -> i32;
    pub fn ass_library_init() -> *mut ASS_Library;
    pub fn ass_library_done(library: *mut ASS_Library);
    pub fn ass_set_fonts_dir(library: *mut ASS_Library, fonts_dir: *const c_char);
    pub fn ass_set_extract_fonts(library: *mut ASS_Library, extract: i32);
    pub fn ass_set_message_cb(library: *mut ASS_Library, callback: Option<AssMessageCallback>, data: *mut c_void);
    pub fn ass_renderer_init(library: *mut ASS_Library) -> *mut ASS_Renderer;
    pub fn ass_renderer_done(renderer: *mut ASS_Renderer);
    pub fn ass_set_frame_size(renderer: *mut ASS_Renderer, w: i32, h: i32);
    pub fn ass_set_storage_size(renderer: *mut ASS_Renderer, w: i32, h: i32);
    pub fn ass_set_margins(renderer: *mut ASS_Renderer, t: i32, b: i32, l: i32, r: i32);
    pub fn ass_set_fonts(
      renderer: *mut ASS_Renderer,
      default_font: *const c_char,
      default_family: *const c_char,
      provider: i32,
      config: *const c_char,
      update: i32,
    );
    pub fn ass_set_cache_limits(renderer: *mut ASS_Renderer, glyph_max: i32, bitmap_max_size: i32);
    pub fn ass_render_frame(
      renderer: *mut ASS_Renderer,
      track: *mut ASS_Track,
      now: i64,
      detect_change: *mut i32,
    ) -> *mut ASS_Image;
    pub fn ass_new_track(library: *mut ASS_Library) -> *mut ASS_Track;
    pub fn ass_free_track(track: *mut ASS_Track);
    pub fn ass_alloc_style(track: *mut ASS_Track) -> i32;
    pub fn ass_alloc_event(track: *mut ASS_Track) -> i32;
    pub fn ass_free_style(track: *mut ASS_Track, style_id: i32);
    pub fn ass_free_event(track: *mut ASS_Track, event_id: i32);
    pub fn ass_flush_events(track: *mut ASS_Track);
    pub fn ass_read_memory(
      library: *mut ASS_Library,
      buffer: *mut c_char,
      buffer_size: usize,
      codepage: *const c_char,
    ) -> *mut ASS_Track;
    pub fn ass_add_font(library: *mut ASS_Library, name: *const c_char, data: *const c_char, data_size: i32);
    pub fn ass_clear_fonts(library: *mut ASS_Library);
  }
}
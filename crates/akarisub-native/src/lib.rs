use std::ffi::{CString, NulError};
use std::ptr::NonNull;
use std::slice;

use akarisub_libass_sys::ffi::{
  self, ASS_DefaultFontProvider, ASS_Image, ASS_Library, ASS_Renderer, ASS_Track, ASS_YCbCrMatrix,
};

#[derive(Debug)]
pub enum AkariSubNativeError {
  LibraryInitFailed,
  RendererInitFailed,
  TrackReadFailed,
  InvalidCString(NulError),
}

impl From<NulError> for AkariSubNativeError {
  fn from(value: NulError) -> Self {
    Self::InvalidCString(value)
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanvasSize {
  pub width: i32,
  pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedImage {
  pub width: i32,
  pub height: i32,
  pub stride: i32,
  pub color: u32,
  pub x: i32,
  pub y: i32,
  pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedFrame {
  pub changed: i32,
  pub timestamp_ms: i64,
  pub images: Vec<RenderedImage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompositedFrame {
  pub changed: i32,
  pub timestamp_ms: i64,
  pub width: i32,
  pub height: i32,
  pub pixels: Vec<u8>,
}

pub struct AkariSubNative {
  library: NonNull<ASS_Library>,
  renderer: NonNull<ASS_Renderer>,
  track: Option<NonNull<ASS_Track>>,
  canvas_size: CanvasSize,
  storage_size: CanvasSize,
  fallback_fonts: Vec<String>,
  default_font: Option<String>,
  font_config_path: Option<CString>,
  last_render: Option<RenderedFrame>,
  last_composited: Option<CompositedFrame>,
}

impl AkariSubNative {
  pub fn new() -> Self {
    Self::try_new().expect("failed to initialize libass native state")
  }

  pub fn try_new() -> Result<Self, AkariSubNativeError> {
    let library = NonNull::new(unsafe { ffi::ass_library_init() }).ok_or(AkariSubNativeError::LibraryInitFailed)?;
    let renderer = NonNull::new(unsafe { ffi::ass_renderer_init(library.as_ptr()) })
      .ok_or(AkariSubNativeError::RendererInitFailed)?;

    unsafe {
      ffi::ass_set_extract_fonts(library.as_ptr(), 1);
      ffi::ass_set_storage_size(renderer.as_ptr(), 1, 1);
      ffi::ass_set_frame_size(renderer.as_ptr(), 1, 1);
    }

    Ok(Self {
      library,
      renderer,
      track: None,
      canvas_size: CanvasSize { width: 1, height: 1 },
      storage_size: CanvasSize { width: 1, height: 1 },
      fallback_fonts: Vec::new(),
      default_font: None,
      font_config_path: None,
      last_render: None,
      last_composited: None,
    })
  }

  pub fn version(&self) -> &'static str {
    env!("CARGO_PKG_VERSION")
  }

  pub fn libass_version(&self) -> i32 {
    unsafe { ffi::ass_library_version() }
  }

  pub fn has_track(&self) -> bool {
    self.track.is_some()
  }

  pub fn canvas_size(&self) -> CanvasSize {
    self.canvas_size
  }

  pub fn storage_size(&self) -> CanvasSize {
    self.storage_size
  }

  pub fn set_frame_size(&mut self, width: i32, height: i32) {
    self.canvas_size = CanvasSize { width, height };
    unsafe {
      ffi::ass_set_frame_size(self.renderer.as_ptr(), width, height);
    }
    self.clear_cached_frames();
  }

  pub fn set_storage_size(&mut self, width: i32, height: i32) {
    self.storage_size = CanvasSize { width, height };
    unsafe {
      ffi::ass_set_storage_size(self.renderer.as_ptr(), width, height);
    }
    self.clear_cached_frames();
  }

  pub fn set_margins(&mut self, top: i32, bottom: i32, left: i32, right: i32) {
    unsafe {
      ffi::ass_set_margins(self.renderer.as_ptr(), top, bottom, left, right);
    }
  }

  pub fn set_cache_limits(&mut self, glyph_limit: i32, bitmap_cache_limit: i32) {
    unsafe {
      ffi::ass_set_cache_limits(self.renderer.as_ptr(), glyph_limit, bitmap_cache_limit);
    }
  }

  pub fn set_fonts(
    &mut self,
    default_font: Option<&str>,
    fallback_fonts: &[&str],
    font_config_path: Option<&str>,
  ) -> Result<(), AkariSubNativeError> {
    self.default_font = default_font.map(ToOwned::to_owned);
    self.fallback_fonts = fallback_fonts.iter().map(|font| (*font).to_owned()).collect();
    self.font_config_path = match font_config_path {
      Some(path) => Some(CString::new(path)?),
      None => None,
    };

    let default_font_c = match self.default_font.as_deref() {
      Some(value) => Some(CString::new(value)?),
      None => None,
    };
    let fallback_family = if self.fallback_fonts.is_empty() {
      None
    } else {
      Some(CString::new(self.fallback_fonts.join(","))?)
    };

    unsafe {
      ffi::ass_set_fonts(
        self.renderer.as_ptr(),
        default_font_c.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()),
        fallback_family.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()),
        ASS_DefaultFontProvider::Fontconfig as i32,
        self.font_config_path
          .as_ref()
          .map_or(std::ptr::null(), |value| value.as_ptr()),
        1,
      );
    }

    Ok(())
  }

  pub fn add_font(&mut self, name: &str, data: &[u8]) -> Result<(), AkariSubNativeError> {
    let name = CString::new(name)?;
    unsafe {
      ffi::ass_add_font(
        self.library.as_ptr(),
        name.as_ptr(),
        data.as_ptr().cast(),
        data.len().min(i32::MAX as usize) as i32,
      );
    }
    Ok(())
  }

  pub fn clear_fonts(&mut self) {
    unsafe {
      ffi::ass_clear_fonts(self.library.as_ptr());
    }
    self.clear_cached_frames();
  }

  pub fn load_track_from_memory(&mut self, subtitle_data: &[u8]) -> Result<(), AkariSubNativeError> {
    self.clear_track();

    let mut owned = subtitle_data.to_vec();
    let track = NonNull::new(unsafe {
      ffi::ass_read_memory(
        self.library.as_ptr(),
        owned.as_mut_ptr().cast(),
        owned.len(),
        std::ptr::null(),
      )
    })
    .ok_or(AkariSubNativeError::TrackReadFailed)?;

    self.track = Some(track);
    self.clear_cached_frames();
    Ok(())
  }

  pub fn clear_track(&mut self) {
    if let Some(track) = self.track.take() {
      unsafe {
        ffi::ass_free_track(track.as_ptr());
      }
    }
    self.clear_cached_frames();
  }

  pub fn track_color_space(&self) -> Option<ASS_YCbCrMatrix> {
    self.track.map(|track| unsafe { track.as_ref().ycbcr_matrix })
  }

  pub fn event_count(&self) -> usize {
    self.track.map_or(0, |track| unsafe { track.as_ref().n_events.max(0) as usize })
  }

  pub fn style_count(&self) -> usize {
    self.track.map_or(0, |track| unsafe { track.as_ref().n_styles.max(0) as usize })
  }

  pub fn alloc_event(&mut self) -> Option<i32> {
    let track = self.track?;
    Some(unsafe { ffi::ass_alloc_event(track.as_ptr()) })
  }

  pub fn alloc_style(&mut self) -> Option<i32> {
    let track = self.track?;
    Some(unsafe { ffi::ass_alloc_style(track.as_ptr()) })
  }

  pub fn flush_events(&mut self) {
    if let Some(track) = self.track {
      unsafe {
        ffi::ass_flush_events(track.as_ptr());
      }
    }
    self.clear_cached_frames();
  }

  pub fn render_frame(&mut self, timestamp_ms: i64, force: bool) -> Option<RenderedFrame> {
    let track = self.track?;
    let mut changed = 0;
    let image_head = unsafe { ffi::ass_render_frame(self.renderer.as_ptr(), track.as_ptr(), timestamp_ms, &mut changed) };

    if image_head.is_null() || (changed == 0 && !force) {
      return None;
    }

    let frame = RenderedFrame {
      changed,
      timestamp_ms,
      images: collect_images(image_head),
    };

    self.last_render = Some(frame.clone());
    self.last_composited = None;
    Some(frame)
  }

  pub fn render_composited_frame(&mut self, timestamp_ms: i64, force: bool) -> Option<CompositedFrame> {
    let frame = self.render_frame(timestamp_ms, force)?;
    let composited = composite_frame(&frame, self.canvas_size);
    self.last_composited = Some(composited.clone());
    Some(composited)
  }

  pub fn last_render(&self) -> Option<&RenderedFrame> {
    self.last_render.as_ref()
  }

  pub fn last_composited_frame(&self) -> Option<&CompositedFrame> {
    self.last_composited.as_ref()
  }

  pub fn last_render_image_count(&self) -> usize {
    self.last_render.as_ref().map_or(0, |frame| frame.images.len())
  }

  pub fn last_render_image(&self, index: usize) -> Option<&RenderedImage> {
    self.last_render.as_ref()?.images.get(index)
  }

  fn clear_cached_frames(&mut self) {
    self.last_render = None;
    self.last_composited = None;
  }
}

impl Drop for AkariSubNative {
  fn drop(&mut self) {
    self.clear_track();
    unsafe {
      ffi::ass_renderer_done(self.renderer.as_ptr());
      ffi::ass_library_done(self.library.as_ptr());
    }
  }
}

fn collect_images(mut image: *mut ASS_Image) -> Vec<RenderedImage> {
  let mut images = Vec::new();

  while let Some(current) = NonNull::new(image) {
    let current = unsafe { current.as_ref() };
    if current.w > 0 && current.h > 0 {
      images.push(RenderedImage {
        width: current.w,
        height: current.h,
        stride: current.stride,
        color: current.color,
        x: current.dst_x,
        y: current.dst_y,
        pixels: decode_bitmap(current),
      });
    }
    image = current.next;
  }

  images
}

fn decode_bitmap(image: &ASS_Image) -> Vec<u8> {
  let width = image.w.max(0) as usize;
  let height = image.h.max(0) as usize;

  if width == 0 || height == 0 || image.bitmap.is_null() {
    return Vec::new();
  }

  let source_len = image
    .stride
    .max(0)
    .saturating_mul(image.h.saturating_sub(1))
    .saturating_add(image.w.max(0)) as usize;
  let source = unsafe { slice::from_raw_parts(image.bitmap, source_len) };

  let red = ((image.color >> 24) & 0xff) as u8;
  let green = ((image.color >> 16) & 0xff) as u8;
  let blue = ((image.color >> 8) & 0xff) as u8;
  let base_alpha = 255u16.saturating_sub((image.color & 0xff) as u16);

  let mut out = vec![0; width * height * 4];

  for y in 0..height {
    let row_start = y * image.stride.max(0) as usize;
    for x in 0..width {
      let mask = source[row_start + x] as u16;
      let alpha = ((base_alpha * mask) / 255) as u8;
      let offset = (y * width + x) * 4;

      if alpha == 0 {
        continue;
      }

      out[offset] = red;
      out[offset + 1] = green;
      out[offset + 2] = blue;
      out[offset + 3] = alpha;
    }
  }

  out
}

fn composite_frame(frame: &RenderedFrame, canvas_size: CanvasSize) -> CompositedFrame {
  let width = canvas_size.width.max(0) as usize;
  let height = canvas_size.height.max(0) as usize;
  let mut accum = vec![0.0f32; width.saturating_mul(height).saturating_mul(4)];

  if width == 0 || height == 0 {
    return CompositedFrame {
      changed: frame.changed,
      timestamp_ms: frame.timestamp_ms,
      width: canvas_size.width.max(0),
      height: canvas_size.height.max(0),
      pixels: Vec::new(),
    };
  }

  for image in &frame.images {
    composite_image(&mut accum, width, height, image);
  }

  CompositedFrame {
    changed: frame.changed,
    timestamp_ms: frame.timestamp_ms,
    width: canvas_size.width.max(0),
    height: canvas_size.height.max(0),
    pixels: convert_accumulated_rgba(accum),
  }
}

fn composite_image(accum: &mut [f32], canvas_width: usize, canvas_height: usize, image: &RenderedImage) {
  let image_width = image.width.max(0) as usize;
  let image_height = image.height.max(0) as usize;

  if image_width == 0 || image_height == 0 || image.pixels.len() < image_width * image_height * 4 {
    return;
  }

  for src_y in 0..image_height {
    let dest_y = image.y + src_y as i32;
    if dest_y < 0 || dest_y >= canvas_height as i32 {
      continue;
    }

    for src_x in 0..image_width {
      let dest_x = image.x + src_x as i32;
      if dest_x < 0 || dest_x >= canvas_width as i32 {
        continue;
      }

      let src_offset = (src_y * image_width + src_x) * 4;
      let src_alpha = image.pixels[src_offset + 3] as f32 / 255.0;
      if src_alpha <= 0.0 {
        continue;
      }

      let dest_offset = ((dest_y as usize * canvas_width) + dest_x as usize) * 4;
      let inv_alpha = 1.0 - src_alpha;

      accum[dest_offset] = (image.pixels[src_offset] as f32 / 255.0) * src_alpha + accum[dest_offset] * inv_alpha;
      accum[dest_offset + 1] =
        (image.pixels[src_offset + 1] as f32 / 255.0) * src_alpha + accum[dest_offset + 1] * inv_alpha;
      accum[dest_offset + 2] =
        (image.pixels[src_offset + 2] as f32 / 255.0) * src_alpha + accum[dest_offset + 2] * inv_alpha;
      accum[dest_offset + 3] = src_alpha + accum[dest_offset + 3] * inv_alpha;
    }
  }
}

fn convert_accumulated_rgba(accum: Vec<f32>) -> Vec<u8> {
  let mut out = vec![0u8; accum.len()];

  for (pixel_index, pixel) in accum.chunks_exact(4).enumerate() {
    let alpha = pixel[3].clamp(0.0, 1.0);
    let out_offset = pixel_index * 4;

    if alpha <= 0.0 {
      continue;
    }

    out[out_offset] = ((pixel[0] / alpha).clamp(0.0, 1.0) * 255.0).round() as u8;
    out[out_offset + 1] = ((pixel[1] / alpha).clamp(0.0, 1.0) * 255.0).round() as u8;
    out[out_offset + 2] = ((pixel[2] / alpha).clamp(0.0, 1.0) * 255.0).round() as u8;
    out[out_offset + 3] = (alpha * 255.0).round() as u8;
  }

  out
}
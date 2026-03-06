use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
  console_error_panic_hook::set_once();
}

#[cfg(not(feature = "console_error_panic_hook"))]
fn set_panic_hook() {}

#[wasm_bindgen(start)]
pub fn init() {
  set_panic_hook();
}

#[wasm_bindgen]
pub struct AkariSubEngine {
  inner: akarisub_native::AkariSubNative,
}

#[wasm_bindgen(getter_with_clone)]
pub struct RenderedImageInfo {
  pub width: i32,
  pub height: i32,
  pub stride: i32,
  pub color: u32,
  pub x: i32,
  pub y: i32,
}

#[wasm_bindgen(getter_with_clone)]
pub struct RenderedFrameInfo {
  pub changed: i32,
  pub timestamp_ms: i64,
  pub image_count: usize,
}

#[wasm_bindgen(getter_with_clone)]
pub struct CompositedFrameInfo {
  pub changed: i32,
  pub timestamp_ms: i64,
  pub width: i32,
  pub height: i32,
}

#[wasm_bindgen]
impl AkariSubEngine {
  #[wasm_bindgen(constructor)]
  pub fn new() -> AkariSubEngine {
    AkariSubEngine {
      inner: akarisub_native::AkariSubNative::new(),
    }
  }

  #[wasm_bindgen(js_name = "version")]
  pub fn version(&self) -> String {
    self.inner.version().to_owned()
  }

  #[wasm_bindgen(js_name = "libassVersion")]
  pub fn libass_version(&self) -> i32 {
    self.inner.libass_version()
  }

  #[wasm_bindgen(js_name = "hasTrack")]
  pub fn has_track(&self) -> bool {
    self.inner.has_track()
  }

  #[wasm_bindgen(js_name = "eventCount")]
  pub fn event_count(&self) -> usize {
    self.inner.event_count()
  }

  #[wasm_bindgen(js_name = "styleCount")]
  pub fn style_count(&self) -> usize {
    self.inner.style_count()
  }

  #[wasm_bindgen(js_name = "trackColorSpace")]
  pub fn track_color_space(&self) -> Option<i32> {
    self.inner.track_color_space().map(|value| value as i32)
  }

  #[wasm_bindgen(js_name = "setFrameSize")]
  pub fn set_frame_size(&mut self, width: i32, height: i32) {
    self.inner.set_frame_size(width, height)
  }

  #[wasm_bindgen(js_name = "setStorageSize")]
  pub fn set_storage_size(&mut self, width: i32, height: i32) {
    self.inner.set_storage_size(width, height)
  }

  #[wasm_bindgen(js_name = "setMargins")]
  pub fn set_margins(&mut self, top: i32, bottom: i32, left: i32, right: i32) {
    self.inner.set_margins(top, bottom, left, right)
  }

  #[wasm_bindgen(js_name = "setCacheLimits")]
  pub fn set_cache_limits(&mut self, glyph_limit: i32, bitmap_cache_limit: i32) {
    self.inner.set_cache_limits(glyph_limit, bitmap_cache_limit)
  }

  #[wasm_bindgen(js_name = "setFonts")]
  pub fn set_fonts(
    &mut self,
    default_font: Option<String>,
    fallback_fonts_csv: Option<String>,
    font_config_path: Option<String>,
  ) -> Result<(), JsValue> {
    let fallback_storage = fallback_fonts_csv.unwrap_or_default();
    let fallback_fonts = fallback_storage
      .split(',')
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .collect::<Vec<_>>();

    self.inner
      .set_fonts(default_font.as_deref(), &fallback_fonts, font_config_path.as_deref())
      .map_err(|error| JsValue::from_str(&format!("{error:?}")))
  }

  #[wasm_bindgen(js_name = "addFont")]
  pub fn add_font(&mut self, name: String, data: Vec<u8>) -> Result<(), JsValue> {
    self.inner
      .add_font(&name, &data)
      .map_err(|error| JsValue::from_str(&format!("{error:?}")))
  }

  #[wasm_bindgen(js_name = "clearFonts")]
  pub fn clear_fonts(&mut self) {
    self.inner.clear_fonts()
  }

  #[wasm_bindgen(js_name = "loadTrackFromUtf8")]
  pub fn load_track_from_utf8(&mut self, subtitle_data: String) -> Result<(), JsValue> {
    self.inner
      .load_track_from_memory(subtitle_data.as_bytes())
      .map_err(|error| JsValue::from_str(&format!("{error:?}")))
  }

  #[wasm_bindgen(js_name = "clearTrack")]
  pub fn clear_track(&mut self) {
    self.inner.clear_track()
  }

  #[wasm_bindgen(js_name = "renderFrame")]
  pub fn render_frame(&mut self, timestamp_ms: i64, force: bool) -> Option<RenderedFrameInfo> {
    self.inner.render_frame(timestamp_ms, force).map(|frame| RenderedFrameInfo {
      changed: frame.changed,
      timestamp_ms: frame.timestamp_ms,
      image_count: frame.images.len(),
    })
  }

  #[wasm_bindgen(js_name = "renderCompositedFrame")]
  pub fn render_composited_frame(&mut self, timestamp_ms: i64, force: bool) -> Option<CompositedFrameInfo> {
    self
      .inner
      .render_composited_frame(timestamp_ms, force)
      .map(|frame| CompositedFrameInfo {
        changed: frame.changed,
        timestamp_ms: frame.timestamp_ms,
        width: frame.width,
        height: frame.height,
      })
  }

  #[wasm_bindgen(js_name = "lastRenderImageCount")]
  pub fn last_render_image_count(&self) -> usize {
    self.inner.last_render_image_count()
  }

  #[wasm_bindgen(js_name = "getLastRenderImage")]
  pub fn get_last_render_image(&self, index: usize) -> Option<RenderedImageInfo> {
    self.inner.last_render_image(index).map(|image| RenderedImageInfo {
      width: image.width,
      height: image.height,
      stride: image.stride,
      color: image.color,
      x: image.x,
      y: image.y,
    })
  }

  #[wasm_bindgen(js_name = "getLastRenderImagePixels")]
  pub fn get_last_render_image_pixels(&self, index: usize) -> Vec<u8> {
    self.inner
      .last_render_image(index)
      .map(|image| image.pixels.clone())
      .unwrap_or_default()
  }

  #[wasm_bindgen(js_name = "getLastCompositedFrame")]
  pub fn get_last_composited_frame(&self) -> Option<CompositedFrameInfo> {
    self.inner.last_composited_frame().map(|frame| CompositedFrameInfo {
      changed: frame.changed,
      timestamp_ms: frame.timestamp_ms,
      width: frame.width,
      height: frame.height,
    })
  }

  #[wasm_bindgen(js_name = "getLastCompositedFramePixels")]
  pub fn get_last_composited_frame_pixels(&self) -> Vec<u8> {
    self
      .inner
      .last_composited_frame()
      .map(|frame| frame.pixels.clone())
      .unwrap_or_default()
  }
}
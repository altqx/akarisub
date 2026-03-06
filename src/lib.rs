use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

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

#[derive(Serialize)]
struct JsAssEvent {
  #[serde(rename = "Start")]
  start: i64,
  #[serde(rename = "Duration")]
  duration: i64,
  #[serde(rename = "Style")]
  style: String,
  #[serde(rename = "Name")]
  name: String,
  #[serde(rename = "MarginL")]
  margin_l: i32,
  #[serde(rename = "MarginR")]
  margin_r: i32,
  #[serde(rename = "MarginV")]
  margin_v: i32,
  #[serde(rename = "Effect")]
  effect: String,
  #[serde(rename = "Text")]
  text: String,
  #[serde(rename = "ReadOrder")]
  read_order: i32,
  #[serde(rename = "Layer")]
  layer: i32,
  #[serde(rename = "_index")]
  index: usize,
}

#[derive(Deserialize, Default)]
struct JsAssEventPatch {
  #[serde(rename = "Start")]
  start: Option<i64>,
  #[serde(rename = "Duration")]
  duration: Option<i64>,
  #[serde(rename = "Style")]
  style: Option<String>,
  #[serde(rename = "Name")]
  name: Option<String>,
  #[serde(rename = "MarginL")]
  margin_l: Option<i32>,
  #[serde(rename = "MarginR")]
  margin_r: Option<i32>,
  #[serde(rename = "MarginV")]
  margin_v: Option<i32>,
  #[serde(rename = "Effect")]
  effect: Option<String>,
  #[serde(rename = "Text")]
  text: Option<String>,
  #[serde(rename = "ReadOrder")]
  read_order: Option<i32>,
  #[serde(rename = "Layer")]
  layer: Option<i32>,
}

#[derive(Serialize)]
struct JsAssStyle {
  #[serde(rename = "Name")]
  name: String,
  #[serde(rename = "FontName")]
  font_name: String,
  #[serde(rename = "FontSize")]
  font_size: f64,
  #[serde(rename = "PrimaryColour")]
  primary_colour: u32,
  #[serde(rename = "SecondaryColour")]
  secondary_colour: u32,
  #[serde(rename = "OutlineColour")]
  outline_colour: u32,
  #[serde(rename = "BackColour")]
  back_colour: u32,
  #[serde(rename = "Bold")]
  bold: i32,
  #[serde(rename = "Italic")]
  italic: i32,
  #[serde(rename = "Underline")]
  underline: i32,
  #[serde(rename = "StrikeOut")]
  strike_out: i32,
  #[serde(rename = "ScaleX")]
  scale_x: f64,
  #[serde(rename = "ScaleY")]
  scale_y: f64,
  #[serde(rename = "Spacing")]
  spacing: f64,
  #[serde(rename = "Angle")]
  angle: f64,
  #[serde(rename = "BorderStyle")]
  border_style: i32,
  #[serde(rename = "Outline")]
  outline: f64,
  #[serde(rename = "Shadow")]
  shadow: f64,
  #[serde(rename = "Alignment")]
  alignment: i32,
  #[serde(rename = "MarginL")]
  margin_l: i32,
  #[serde(rename = "MarginR")]
  margin_r: i32,
  #[serde(rename = "MarginV")]
  margin_v: i32,
  #[serde(rename = "Encoding")]
  encoding: i32,
  #[serde(rename = "treat_fontname_as_pattern")]
  treat_fontname_as_pattern: i32,
  #[serde(rename = "Blur")]
  blur: f64,
  #[serde(rename = "Justify")]
  justify: i32,
}

#[derive(Deserialize, Default)]
struct JsAssStylePatch {
  #[serde(rename = "Name")]
  name: Option<String>,
  #[serde(rename = "FontName")]
  font_name: Option<String>,
  #[serde(rename = "FontSize")]
  font_size: Option<f64>,
  #[serde(rename = "PrimaryColour")]
  primary_colour: Option<u32>,
  #[serde(rename = "SecondaryColour")]
  secondary_colour: Option<u32>,
  #[serde(rename = "OutlineColour")]
  outline_colour: Option<u32>,
  #[serde(rename = "BackColour")]
  back_colour: Option<u32>,
  #[serde(rename = "Bold")]
  bold: Option<i32>,
  #[serde(rename = "Italic")]
  italic: Option<i32>,
  #[serde(rename = "Underline")]
  underline: Option<i32>,
  #[serde(rename = "StrikeOut")]
  strike_out: Option<i32>,
  #[serde(rename = "ScaleX")]
  scale_x: Option<f64>,
  #[serde(rename = "ScaleY")]
  scale_y: Option<f64>,
  #[serde(rename = "Spacing")]
  spacing: Option<f64>,
  #[serde(rename = "Angle")]
  angle: Option<f64>,
  #[serde(rename = "BorderStyle")]
  border_style: Option<i32>,
  #[serde(rename = "Outline")]
  outline: Option<f64>,
  #[serde(rename = "Shadow")]
  shadow: Option<f64>,
  #[serde(rename = "Alignment")]
  alignment: Option<i32>,
  #[serde(rename = "MarginL")]
  margin_l: Option<i32>,
  #[serde(rename = "MarginR")]
  margin_r: Option<i32>,
  #[serde(rename = "MarginV")]
  margin_v: Option<i32>,
  #[serde(rename = "Encoding")]
  encoding: Option<i32>,
  #[serde(rename = "treat_fontname_as_pattern")]
  treat_fontname_as_pattern: Option<i32>,
  #[serde(rename = "Blur")]
  blur: Option<f64>,
  #[serde(rename = "Justify")]
  justify: Option<i32>,
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

  #[wasm_bindgen(js_name = "setDefaultFont")]
  pub fn set_default_font(&mut self, font: Option<String>) -> Result<(), JsValue> {
    self
      .inner
      .set_default_font(font.as_deref())
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

  #[wasm_bindgen(js_name = "createEvent")]
  pub fn create_event(&mut self, event: JsValue) -> Result<i32, JsValue> {
    let patch: JsAssEventPatch = serde_wasm_bindgen::from_value(event)?;
    self
      .inner
      .create_event(&patch.into())
      .ok_or_else(|| JsValue::from_str("Unable to create ASS event"))
  }

  #[wasm_bindgen(js_name = "setEvent")]
  pub fn set_event(&mut self, index: usize, event: JsValue) -> Result<(), JsValue> {
    let patch: JsAssEventPatch = serde_wasm_bindgen::from_value(event)?;
    self
      .inner
      .update_event(index, &patch.into())
      .map_err(|error| JsValue::from_str(&format!("{error:?}")))
  }

  #[wasm_bindgen(js_name = "removeEvent")]
  pub fn remove_event(&mut self, index: i32) {
    self.inner.remove_event(index)
  }

  #[wasm_bindgen(js_name = "getEvents")]
  pub fn get_events(&self) -> Result<JsValue, JsValue> {
    let events = self
      .inner
      .events()
      .into_iter()
      .enumerate()
      .map(|(index, event)| JsAssEvent::from_native(event, index))
      .collect::<Vec<_>>();

    serde_wasm_bindgen::to_value(&events).map_err(Into::into)
  }

  #[wasm_bindgen(js_name = "createStyle")]
  pub fn create_style(&mut self, style: JsValue) -> Result<i32, JsValue> {
    let patch: JsAssStylePatch = serde_wasm_bindgen::from_value(style)?;
    self
      .inner
      .create_style(&patch.into())
      .ok_or_else(|| JsValue::from_str("Unable to create ASS style"))
  }

  #[wasm_bindgen(js_name = "setStyle")]
  pub fn set_style(&mut self, index: usize, style: JsValue) -> Result<(), JsValue> {
    let patch: JsAssStylePatch = serde_wasm_bindgen::from_value(style)?;
    self
      .inner
      .update_style(index, &patch.into())
      .map_err(|error| JsValue::from_str(&format!("{error:?}")))
  }

  #[wasm_bindgen(js_name = "removeStyle")]
  pub fn remove_style(&mut self, index: i32) {
    self.inner.remove_style(index)
  }

  #[wasm_bindgen(js_name = "getStyles")]
  pub fn get_styles(&self) -> Result<JsValue, JsValue> {
    let styles = self.inner.styles().into_iter().map(JsAssStyle::from_native).collect::<Vec<_>>();
    serde_wasm_bindgen::to_value(&styles).map_err(Into::into)
  }

  #[wasm_bindgen(js_name = "styleOverride")]
  pub fn style_override(&mut self, index: usize) {
    self.inner.style_override(index)
  }

  #[wasm_bindgen(js_name = "disableStyleOverride")]
  pub fn disable_style_override(&mut self) {
    self.inner.disable_style_override()
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

impl JsAssEvent {
  fn from_native(value: akarisub_native::AssEventData, index: usize) -> Self {
    Self {
      start: value.start,
      duration: value.duration,
      style: value.style,
      name: value.name,
      margin_l: value.margin_l,
      margin_r: value.margin_r,
      margin_v: value.margin_v,
      effect: value.effect,
      text: value.text,
      read_order: value.read_order,
      layer: value.layer,
      index,
    }
  }
}

impl From<JsAssEventPatch> for akarisub_native::AssEventPatch {
  fn from(value: JsAssEventPatch) -> Self {
    Self {
      start: value.start,
      duration: value.duration,
      style: value.style,
      name: value.name,
      margin_l: value.margin_l,
      margin_r: value.margin_r,
      margin_v: value.margin_v,
      effect: value.effect,
      text: value.text,
      read_order: value.read_order,
      layer: value.layer,
    }
  }
}

impl JsAssStyle {
  fn from_native(value: akarisub_native::AssStyleData) -> Self {
    Self {
      name: value.name,
      font_name: value.font_name,
      font_size: value.font_size,
      primary_colour: value.primary_colour,
      secondary_colour: value.secondary_colour,
      outline_colour: value.outline_colour,
      back_colour: value.back_colour,
      bold: value.bold,
      italic: value.italic,
      underline: value.underline,
      strike_out: value.strike_out,
      scale_x: value.scale_x,
      scale_y: value.scale_y,
      spacing: value.spacing,
      angle: value.angle,
      border_style: value.border_style,
      outline: value.outline,
      shadow: value.shadow,
      alignment: value.alignment,
      margin_l: value.margin_l,
      margin_r: value.margin_r,
      margin_v: value.margin_v,
      encoding: value.encoding,
      treat_fontname_as_pattern: value.treat_fontname_as_pattern,
      blur: value.blur,
      justify: value.justify,
    }
  }
}

impl From<JsAssStylePatch> for akarisub_native::AssStylePatch {
  fn from(value: JsAssStylePatch) -> Self {
    Self {
      name: value.name,
      font_name: value.font_name,
      font_size: value.font_size,
      primary_colour: value.primary_colour,
      secondary_colour: value.secondary_colour,
      outline_colour: value.outline_colour,
      back_colour: value.back_colour,
      bold: value.bold,
      italic: value.italic,
      underline: value.underline,
      strike_out: value.strike_out,
      scale_x: value.scale_x,
      scale_y: value.scale_y,
      spacing: value.spacing,
      angle: value.angle,
      border_style: value.border_style,
      outline: value.outline,
      shadow: value.shadow,
      alignment: value.alignment,
      margin_l: value.margin_l,
      margin_r: value.margin_r,
      margin_v: value.margin_v,
      encoding: value.encoding,
      treat_fontname_as_pattern: value.treat_fontname_as_pattern,
      blur: value.blur,
      justify: value.justify,
    }
  }
}
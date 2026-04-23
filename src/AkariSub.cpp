#include "../lib/libass/libass/ass.h"
#include <cstdint>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>

#include <emscripten.h>

int log_level = 3;

class ReusableBuffer {
private:
  void *buffer;
  size_t lessen_counter;

public:
  size_t size;
  ReusableBuffer() : buffer(NULL), size(0), lessen_counter(0) {}

  ~ReusableBuffer() { free(buffer); }

  void clear() {
    free(buffer);
    buffer = NULL;
    size = 0;
    lessen_counter = 0;
  }

  void *take(size_t new_size) {
    if (size >= new_size) {
      if (size >= 1.3 * new_size) {
        // big reduction request
        lessen_counter++;
      } else {
        lessen_counter = 0;
      }
      if (lessen_counter < 10) {
        // not reducing the buffer yet
        memset(buffer, 0, new_size);
        return buffer;
      }
    }

    free(buffer);
    buffer = malloc(new_size);
    if (buffer) {
      size = new_size;
      memset(buffer, 0, size);
    } else
      size = 0;
    lessen_counter = 0;
    return buffer;
  }
};

void msg_callback(int level, const char *fmt, va_list va, void *data) {
  if (level > log_level) // 6 for verbose
    return;

  const int ERR_LEVEL = 1;
  FILE *stream = level <= ERR_LEVEL ? stderr : stdout;

  fprintf(stream, "AkariSub: ");
  vfprintf(stream, fmt, va);
  fprintf(stream, "\n");
}

const float MIN_UINT8_CAST = 0.9 / 255;
const float MAX_UINT8_CAST = 255.9 / 255;
const float INV_255 = 1.0f / 255.0f;
const float INV_255_SQ = 1.0f / (255.0f * 255.0f);

#define CLAMP_UINT8(value)                                                     \
  ((value > MIN_UINT8_CAST)                                                    \
       ? ((value < MAX_UINT8_CAST) ? (int)(value * 255) : 255)                 \
       : 0)

typedef struct RenderResult {
public:
  int x, y, w, h;
  size_t image;
  RenderResult *next;
} RenderResult;

// maximum regions - a grid of 3x3
#define MAX_BLEND_STORAGES (3 * 3)
struct RenderBlendStorage {
  RenderResult next;
  ReusableBuffer buf;
  bool taken;
};

#define MIN(x, y) (((x) < (y)) ? (x) : (y))
#define MAX(x, y) (((x) > (y)) ? (x) : (y))

class BoundingBox {
public:
  int min_x, max_x, min_y, max_y;
  bool initialized;

  BoundingBox() : min_x(0), max_x(0), min_y(0), max_y(0), initialized(false) {}

  bool empty() const { return !initialized; }

  void add(int x1, int y1, int w, int h) {
    int x2 = x1 + w - 1, y2 = y1 + h - 1;
    if (!initialized) {
      min_x = x1;
      min_y = y1;
      max_x = x2;
      max_y = y2;
      initialized = true;
    } else {
      min_x = MIN(min_x, x1);
      min_y = MIN(min_y, y1);
      max_x = MAX(max_x, x2);
      max_y = MAX(max_y, y2);
    }
  }

  bool intersets(const BoundingBox &other) const {
    return !(other.min_x > max_x || other.max_x < min_x ||
             other.min_y > max_y || other.max_y < min_y);
  }

  // Check intersection with margin - for blur overlap detection
  bool intersetsWithMargin(const BoundingBox &other, int margin) const {
    return !(other.min_x > max_x + margin || other.max_x < min_x - margin ||
             other.min_y > max_y + margin || other.max_y < min_y - margin);
  }

  bool tryMerge(BoundingBox &other) {
    if (!intersets(other))
      return false;

    min_x = MIN(min_x, other.min_x);
    min_y = MIN(min_y, other.min_y);
    max_x = MAX(max_x, other.max_x);
    max_y = MAX(max_y, other.max_y);
    return true;
  }

  // Merge with margin check - for blur overlap
  bool tryMergeWithMargin(BoundingBox &other, int margin) {
    if (!intersetsWithMargin(other, margin))
      return false;

    min_x = MIN(min_x, other.min_x);
    min_y = MIN(min_y, other.min_y);
    max_x = MAX(max_x, other.max_x);
    max_y = MAX(max_y, other.max_y);
    return true;
  }

  void clear() { initialized = false; }
};

/**
 * \brief Overwrite tag with whitespace to nullify its effect
 * Boundaries are inclusive at both ends.
 */
static void _remove_tag(char *begin, char *end) {
  if (end < begin)
    return;
  memset(begin, ' ', end - begin + 1);
}

/**
 * \param begin point to the first character of the tag name (after backslash)
 * \param end   last character that can be read; at least the name itself
                and the following character if any must be included
 * \return true if tag may cause animations, false if it will definitely not
 */
static bool _is_animated_tag(char *begin, char *end) {
  if (end <= begin)
    return false;

  size_t length = end - begin + 1;

#define check_simple_tag(tag)                                                  \
  (sizeof(tag) - 1 < length && !strncmp(begin, tag, sizeof(tag) - 1))
#define check_complex_tag(tag)                                                 \
  (check_simple_tag(tag) &&                                                    \
   (begin[sizeof(tag) - 1] == '(' || begin[sizeof(tag) - 1] == ' ' ||          \
    begin[sizeof(tag) - 1] == '\t'))
  switch (begin[0]) {
  case 'k': //-fallthrough
  case 'K':
    // Karaoke: k, kf, ko, K and kt ; no other valid ASS-tag starts with k/K
    return true;
  case 't':
    // Animated transform: no other valid tag begins with t
    // non-nested t-tags have to be complex tags even in single argument
    // form, but nested t-tags (which act like independent t-tags) are allowed
    // to be simple-tags without parentheses due to VSF-parsing quirk. Since all
    // valid simple t-tags require the existence of a complex t-tag, we only
    // check for complex tags to avoid false positives from invalid simple
    // t-tags. This makes animation-dropping somewhat incorrect but as animation
    // detection remains accurate, we consider this to be "good enough"
    return check_complex_tag("t");
  case 'm':
    // Movement: complex tag; again no other valid tag begins with m
    // but ensure it's complex just to be sure
    return check_complex_tag("move");
  case 'f':
    // Fade: \fad and Fade (complex): \fade; both complex
    // there are several other valid tags beginning with f
    return check_complex_tag("fad") || check_complex_tag("fade");
  }

  return false;
#undef check_complex_tag
#undef check_simple_tag
}

/**
 * \param start First character after { (optionally spaces can be dropped)
 * \param end   Last character before } (optionally spaces can be dropped)
 * \param drop_animations If true animation tags will be discarded
 * \return true if after processing the event may contain animations
           (i.e. when dropping animations this is always false)
 */
static bool _is_block_animated(char *start, char *end, bool drop_animations) {
  char *tag_start = NULL; // points to beginning backslash
  for (char *p = start; p <= end; p++) {
    if (*p == '\\') {
      // It is safe to go one before and beyond unconditionally
      // because the text passed in must be surronded by { }
      if (tag_start && _is_animated_tag(tag_start + 1, p - 1)) {
        if (!drop_animations)
          return true;
        // For \t transforms this will assume the final state
        _remove_tag(tag_start, p - 1);
      }
      tag_start = p;
    }
  }

  if (tag_start && _is_animated_tag(tag_start + 1, end)) {
    if (!drop_animations)
      return true;
    _remove_tag(tag_start, end);
  }

  return false;
}

/**
 * \param event ASS event to be processed
 * \param drop_animations If true animation tags will be discarded
 * \return true if after processing the event may contain animations
           (i.e. when dropping animations this is always false)
 */
static bool _is_event_animated(ASS_Event *event, bool drop_animations) {
  // Event is animated if it has an Effect or animated override tags
  if (event->Effect && event->Effect[0] != '\0') {
    if (!drop_animations)
      return 1;
    event->Effect[0] = '\0';
  }

  // Search for override blocks
  // Only closed {...}-blocks are parsed by VSFilters and libass
  if (!event->Text)
    return false;
  char *block_start = NULL; // points to opening {
  for (char *p = event->Text; *p != '\0'; p++) {
    switch (*p) {
    case '{':
      // Escaping the opening curly bracket to not start an override block is
      // a VSFilter-incompatible libass extension. But we only use libass, so...
      if (!block_start && (p == event->Text || *(p - 1) != '\\'))
        block_start = p;
      break;
    case '}':
      if (block_start && p - block_start > 2 &&
          _is_block_animated(block_start + 1, p - 1, drop_animations))
        return true;
      block_start = NULL;
      break;
    default:
      break;
    }
  }

  return false;
}

static char *copyString(const std::string &str) {
  size_t len = str.size();
  char *result = (char *)malloc(len + 1);
  if (!result)
    return NULL;
  memcpy(result, str.c_str(), len + 1);
  return result;
}

static std::string getPrimaryFallbackFamily(const std::string &fonts) {
  size_t start = 0;

  while (start < fonts.size()) {
    size_t end = fonts.find(',', start);
    if (end == std::string::npos)
      end = fonts.size();

    size_t family_start = fonts.find_first_not_of(" \t\r\n", start);
    if (family_start != std::string::npos && family_start < end) {
      size_t family_end = fonts.find_last_not_of(" \t\r\n", end - 1);
      if (family_end != std::string::npos && family_end >= family_start)
        return fonts.substr(family_start, family_end - family_start + 1);
    }

    if (end == fonts.size())
      break;
    start = end + 1;
  }

  return std::string();
}

class AkariSub {
private:
  ReusableBuffer m_buffer;
  RenderBlendStorage m_blendParts[MAX_BLEND_STORAGES];
  bool drop_animations;
  int scanned_events; // next unscanned event index
  ASS_Library *ass_library;
  ASS_Renderer *ass_renderer;
  bool debug;

  int canvas_w;
  int canvas_h;

  int status;

  const char *defaultFont;
  std::string fallbackFonts; // comma-separated list of fallback font families

public:
  ASS_Track *track;

  int trackColorSpace;
  int changed = 0;
  int count = 0;
  int time = 0;
  AkariSub(int canvas_w, int canvas_h, const std::string &df, bool debug) {
    status = 0;
    ass_library = NULL;
    ass_renderer = NULL;
    track = NULL;
    this->canvas_w = canvas_w;
    this->canvas_h = canvas_h;
    drop_animations = false;
    scanned_events = 0;
    this->debug = debug;
    defaultFont = copyString(df);
    ass_library = ass_library_init();
    if (!ass_library) {
      fprintf(stderr, "AkariSub: ass_library_init failed!\n");
      exit(2);
    }

    ass_set_message_cb(ass_library, msg_callback, NULL);

    ass_renderer = ass_renderer_init(ass_library);
    if (!ass_renderer) {
      fprintf(stderr, "AkariSub: ass_renderer_init failed!\n");
      exit(3);
    }
    ass_set_extract_fonts(ass_library, true);

    resizeCanvas(canvas_w, canvas_h, canvas_w, canvas_h);

    reloadFonts();
    m_buffer.clear();
  }

  void setLogLevel(int level) { log_level = level; }

  void setDropAnimations(int value) {
    drop_animations = !!value;
    if (drop_animations)
      scanAnimations(scanned_events);
  }

  /*
   * \brief Scan events starting at index i for animations
   * and discard animated tags when found.
   * Note that once animated tags were dropped they cannot be restored.
   * Updates the class member scanned_events to last scanned index.
   */
  void scanAnimations(int i) {
    for (; i < track->n_events; i++) {
      _is_event_animated(track->events + i, drop_animations);
    }
    scanned_events = i;
  }

  /* TRACK */
  void createTrackMem(std::string buf) {
    removeTrack();
    char *data = buf.empty() ? nullptr : &buf[0];
    track = ass_read_memory(ass_library, data, buf.size(), NULL);
    if (!track) {
      fprintf(stderr, "AkariSub: Failed to start a track\n");
      exit(4);
    }

    if (drop_animations) {
      scanAnimations(0);
    } else {
      scanned_events = 0;
    }

    trackColorSpace = track->YCbCrMatrix;
  }

  void removeTrack() {
    if (track != NULL) {
      ass_free_track(track);
      track = NULL;
    }
  }
  /* TRACK */

  /* CANVAS */
  void resizeCanvas(int canvas_w, int canvas_h, int video_w, int video_h) {
    ass_set_storage_size(ass_renderer, video_w, video_h);
    ass_set_frame_size(ass_renderer, canvas_w, canvas_h);
    this->canvas_h = canvas_h;
    this->canvas_w = canvas_w;
  }
  int getBufferSize(ASS_Image *img) {
    int size = 0;
    for (ASS_Image *tmp = img; tmp; tmp = tmp->next) {
      if (tmp->w == 0 || tmp->h == 0) {
        continue;
      }
      size += sizeof(uint32_t) * tmp->w * tmp->h + sizeof(RenderResult);
    }
    return size;
  }
  RenderResult *processImages(ASS_Image *img) {
    RenderResult *renderResult = NULL;
    char *rawbuffer = (char *)m_buffer.take(getBufferSize(img));
    if (rawbuffer == NULL) {
      fprintf(stderr, "AkariSub: cannot allocate buffer for rendering\n");
      return NULL;
    }
    for (RenderResult *tmp = renderResult; img; img = img->next) {
      int w = img->w, h = img->h;
      if (w == 0 || h == 0)
        continue;

      double alpha = (255 - (img->color & 255)) / 255.0;
      if (alpha == 0.0)
        continue;

      unsigned int datasize = sizeof(uint32_t) * w * h;
      uint32_t *data = (uint32_t *)rawbuffer;
      decodeBitmap(alpha, data, img, w, h);
      RenderResult *result = (RenderResult *)(rawbuffer + datasize);
      result->w = w;
      result->h = h;
      result->x = img->dst_x;
      result->y = img->dst_y;
      result->image = (size_t)data;
      result->next = NULL;

      if (tmp) {
        tmp->next = result;
      } else {
        renderResult = result;
      }
      tmp = result;

      rawbuffer += datasize + sizeof(RenderResult);
      ++count;
    }
    return renderResult;
  }

  void decodeBitmap(double alpha, uint32_t *out, ASS_Image *img, int w, int h) {
    uint32_t color = ((img->color << 8) & 0xff0000) |
                     ((img->color >> 8) & 0xff00) | ((img->color >> 24) & 0xff);
    uint8_t *bitmap = img->bitmap;
    int stride = img->stride;

    // Pre-compute alpha factor (avoid per-pixel double->float conversion)
    float alpha_f = (float)alpha;

    // Process 4 pixels at a time when possible
    int w4 = w & ~3; // Round down to multiple of 4

    for (int y = 0; y < h; ++y) {
      uint8_t *row = bitmap + y * stride;
      int row_offset = y * w;

      // Unrolled loop for 4 pixels at a time
      int x = 0;
      for (; x < w4; x += 4) {
        uint8_t m0 = row[x];
        uint8_t m1 = row[x + 1];
        uint8_t m2 = row[x + 2];
        uint8_t m3 = row[x + 3];

        out[row_offset + x] =
            m0 ? (((uint32_t)(alpha_f * m0)) << 24) | color : 0;
        out[row_offset + x + 1] =
            m1 ? (((uint32_t)(alpha_f * m1)) << 24) | color : 0;
        out[row_offset + x + 2] =
            m2 ? (((uint32_t)(alpha_f * m2)) << 24) | color : 0;
        out[row_offset + x + 3] =
            m3 ? (((uint32_t)(alpha_f * m3)) << 24) | color : 0;
      }

      // Handle remaining pixels
      for (; x < w; ++x) {
        uint8_t mask = row[x];
        out[row_offset + x] =
            mask ? (((uint32_t)(alpha_f * mask)) << 24) | color : 0;
      }
    }
  }

  RenderResult *renderImage(double tm, int force) {
    time = 0;
    count = 0;

    ASS_Image *imgs =
        ass_render_frame(ass_renderer, track, (int)(tm * 1000), &changed);
    if (imgs == NULL || (changed == 0 && !force))
      return NULL;

    if (debug)
      time = emscripten_get_now();

    return processImages(imgs);
  }

  void quitLibrary() {
    removeTrack();
    ass_renderer_done(ass_renderer);
    ass_library_done(ass_library);
    m_buffer.clear();
  }

  void setDefaultFont(const std::string &name) {
    defaultFont = copyString(name);
    reloadFonts();
  }

  // Set multiple fallback fonts (comma-separated list)
  // The first font is the primary, rest are fallbacks for fontconfig
  void setFallbackFonts(const std::string &fonts) {
    fallbackFonts = fonts;
    reloadFonts();
  }

  // Add a fallback font to the list (appends to existing)
  void addFallbackFont(const std::string &font) {
    if (!fallbackFonts.empty()) {
      fallbackFonts += ",";
    }
    fallbackFonts += font;
    // Note: don't reload fonts here, call reloadFonts() manually after adding all
  }

  // Get the current fallback fonts string
  std::string getFallbackFonts() const {
    return fallbackFonts;
  }

  void reloadFonts() {
    // libass expects a single fallback family here. Passing a comma-separated
    // list makes fontconfig treat the whole string as the default family and
    // can skew glyph metrics when no requested font matches.
    std::string fontFamilyStorage = getPrimaryFallbackFamily(fallbackFonts);
    const char *fontFamily = fontFamilyStorage.empty() ? defaultFont : fontFamilyStorage.c_str();
    ass_set_fonts(ass_renderer, NULL, fontFamily, ASS_FONTPROVIDER_FONTCONFIG, "/assets/fonts.conf", 1);
  }

  void addFont(const std::string &name, int data, unsigned long data_size) {
    ass_add_font(ass_library, name.c_str(), (char *)data, (size_t)data_size);
    free((char *)data);
  }

  void setMargin(int top, int bottom, int left, int right) {
    ass_set_margins(ass_renderer, top, bottom, left, right);
  }

  int getEventCount() const { return track->n_events; }

  int allocEvent() {
    return ass_alloc_event(track);
  }

  void removeEvent(int eid) {
    ass_free_event(track, eid);
  }

  int getStyleCount() const { return track->n_styles; }

  int allocStyle() { return ass_alloc_style(track); }

  void removeStyle(int sid) { ass_free_style(track, sid); }

  void removeAllEvents() {
    ass_flush_events(track);
  }

  void setMemoryLimits(int glyph_limit, int bitmap_cache_limit) {
    printf("AkariSub: setting total libass memory limits to: glyph=%d MiB, "
           "bitmap cache=%d MiB\n",
           glyph_limit, bitmap_cache_limit);
    ass_set_cache_limits(ass_renderer, glyph_limit, bitmap_cache_limit);
  }

  RenderResult *renderBlend(double tm, int force) {
    time = 0;
    count = 0;

    ASS_Image *img =
        ass_render_frame(ass_renderer, track, (int)(tm * 1000), &changed);
    if (img == NULL || (changed == 0 && !force)) {
      return NULL;
    }

    if (debug)
      time = emscripten_get_now();
    for (int i = 0; i < MAX_BLEND_STORAGES; i++) {
      m_blendParts[i].taken = false;
    }

    // split rendering region in 9 pieces (as on 3x3 grid)
    int split_x_low = canvas_w / 3, split_x_high = 2 * canvas_w / 3;
    int split_y_low = canvas_h / 3, split_y_high = 2 * canvas_h / 3;

    // First pass: determine which region each image belongs to based on center
    // Store the region assignment to use for bounding box expansion
    int region_assignments[1024];
    int image_count = 0;
    BoundingBox boxes[MAX_BLEND_STORAGES];

    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      if (cur->w == 0 || cur->h == 0) {
        if (image_count < 1024)
          region_assignments[image_count++] = -1;
        continue;
      }
      int index = 0;
      int middle_x = cur->dst_x + (cur->w >> 1),
          middle_y = cur->dst_y + (cur->h >> 1);
      if (middle_y > split_y_high) {
        index += 2 * 3;
      } else if (middle_y > split_y_low) {
        index += 1 * 3;
      }
      if (middle_x > split_x_high) {
        index += 2;
      } else if (middle_x > split_x_low) {
        index += 1;
      }
      if (image_count < 1024)
        region_assignments[image_count++] = index;
      // Mark region as having content (will expand bounds in second pass)
      boxes[index].add(middle_x, middle_y, 1, 1);
    }

    // Second pass: expand bounding boxes to include full bounds of all images
    // that will be rendered in each region (based on center-based assignment)
    image_count = 0;
    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      if (image_count >= 1024)
        break;
      int index = region_assignments[image_count++];
      if (index < 0 || cur->w == 0 || cur->h == 0)
        continue;
      // Expand the region's bounding box to fully include this image
      boxes[index].add(cur->dst_x, cur->dst_y, cur->w, cur->h);
    }

    // now merge regions as long as there are intersecting regions
    const int BLUR_MERGE_MARGIN = 100;
    for (;;) {
      bool merged = false;
      for (int box1 = 0; box1 < MAX_BLEND_STORAGES - 1; box1++) {
        if (boxes[box1].empty())
          continue;
        for (int box2 = box1 + 1; box2 < MAX_BLEND_STORAGES; box2++) {
          if (boxes[box2].empty())
            continue;
          if (boxes[box1].tryMergeWithMargin(boxes[box2], BLUR_MERGE_MARGIN)) {
            boxes[box2].clear();
            merged = true;
          }
        }
      }
      if (!merged)
        break;
    }

    RenderResult *renderResult = NULL;
    for (int box = 0; box < MAX_BLEND_STORAGES; box++) {
      if (boxes[box].empty()) {
        continue;
      }
      RenderResult *part = renderBlendPart(boxes[box], img);
      if (part == NULL) {
        break; // memory allocation error
      }
      if (renderResult) {
        part->next = renderResult->next;
        renderResult->next = part;
      } else {
        renderResult = part;
      }

      ++count;
    }

    return renderResult;
  }

  RenderResult *renderBlendPart(const BoundingBox &rect, ASS_Image *img) {
    // First pass: calculate actual bounding box including all images that
    // belong to this region
    int actual_min_x = rect.min_x, actual_min_y = rect.min_y;
    int actual_max_x = rect.max_x, actual_max_y = rect.max_y;

    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      int curw = cur->w, curh = cur->h;
      if (curw == 0 || curh == 0)
        continue;

      int center_x = cur->dst_x + (curw >> 1);
      int center_y = cur->dst_y + (curh >> 1);
      if (center_x < rect.min_x || center_x > rect.max_x ||
          center_y < rect.min_y || center_y > rect.max_y)
        continue;

      // This image belongs to our region - expand bounds to include full image
      actual_min_x = MIN(actual_min_x, cur->dst_x);
      actual_min_y = MIN(actual_min_y, cur->dst_y);
      actual_max_x = MAX(actual_max_x, cur->dst_x + curw - 1);
      actual_max_y = MAX(actual_max_y, cur->dst_y + curh - 1);
    }

    // Clamp to canvas bounds
    actual_min_x = MAX(actual_min_x, 0);
    actual_min_y = MAX(actual_min_y, 0);
    actual_max_x = MIN(actual_max_x, canvas_w - 1);
    actual_max_y = MIN(actual_max_y, canvas_h - 1);

    int width = actual_max_x - actual_min_x + 1;
    int height = actual_max_y - actual_min_y + 1;

    if (width <= 0 || height <= 0)
      return NULL;

    // make float buffer for blending
    const size_t buffer_size = width * height * 4 * sizeof(float);
    float *buf = (float *)m_buffer.take(buffer_size);
    if (buf == NULL) {
      fprintf(stderr, "AkariSub: cannot allocate buffer for blending\n");
      return NULL;
    }

    memset(buf, 0, buffer_size);

    // blend things in
    for (ASS_Image *cur = img; cur != NULL; cur = cur->next) {
      int curx_abs = cur->dst_x, cury_abs = cur->dst_y;
      int curw = cur->w, curh = cur->h;
      if (curw == 0 || curh == 0)
        continue; // skip empty images

      // Calculate image center - only render if center is in our region
      // This ensures each image is rendered exactly once by one region
      int center_x = curx_abs + (curw >> 1);
      int center_y = cury_abs + (curh >> 1);
      if (center_x < rect.min_x || center_x > rect.max_x ||
          center_y < rect.min_y || center_y > rect.max_y)
        continue;

      int a = (255 - (cur->color & 0xFF));
      if (a == 0)
        continue; // skip transparent images

      int curs = (cur->stride >= curw) ? cur->stride : curw;

      // Render full image, clipped only to canvas/actual bounds
      int img_right = curx_abs + curw - 1;
      int img_bottom = cury_abs + curh - 1;

      int render_left = MAX(curx_abs, actual_min_x);
      int render_top = MAX(cury_abs, actual_min_y);
      int render_right = MIN(img_right, actual_max_x);
      int render_bottom = MIN(img_bottom, actual_max_y);

      int src_x_off = render_left - curx_abs;
      int src_y_off = render_top - cury_abs;
      int dst_x = render_left - actual_min_x;
      int dst_y = render_top - actual_min_y;
      int render_w = render_right - render_left + 1;
      int render_h = render_bottom - render_top + 1;

      if (render_w <= 0 || render_h <= 0)
        continue;

      unsigned char *bitmap = cur->bitmap;

      // Pre-compute color components as floats
      float normalized_a = a * INV_255;
      float r = ((cur->color >> 24) & 0xFF) * INV_255;
      float g = ((cur->color >> 16) & 0xFF) * INV_255;
      float b_val = ((cur->color >> 8) & 0xFF) * INV_255;
      float a_factor = normalized_a * INV_255;

      for (int y = 0; y < render_h; y++) {
        int buf_line_start = (dst_y + y) * width + dst_x;
        unsigned char *bitmap_row = bitmap + (src_y_off + y) * curs + src_x_off;

        for (int x = 0; x < render_w; x++) {
          unsigned char mask = bitmap_row[x];
          if (mask == 0)
            continue; // Early exit for transparent pixels

          float pix_alpha = mask * a_factor;
          float inv_alpha = 1.0f - pix_alpha;

          int buf_idx = (buf_line_start + x) << 2;

          // Pre-multiply image RGB with alpha for current pixel
          float old_a = buf[buf_idx + 3];
          buf[buf_idx + 3] = pix_alpha + old_a * inv_alpha;
          buf[buf_idx] = r * pix_alpha + buf[buf_idx] * inv_alpha;
          buf[buf_idx + 1] = g * pix_alpha + buf[buf_idx + 1] * inv_alpha;
          buf[buf_idx + 2] = b_val * pix_alpha + buf[buf_idx + 2] * inv_alpha;
        }
      }
    }

    // find closest free buffer
    size_t needed = sizeof(unsigned int) * width * height;
    RenderBlendStorage *storage = m_blendParts, *bigBuffer = NULL,
                       *smallBuffer = NULL;
    for (int buffer_index = 0; buffer_index < MAX_BLEND_STORAGES;
         buffer_index++, storage++) {
      if (storage->taken)
        continue;
      if (storage->buf.size >= needed) {
        if (bigBuffer == NULL || bigBuffer->buf.size > storage->buf.size)
          bigBuffer = storage;
      } else {
        if (smallBuffer == NULL || smallBuffer->buf.size > storage->buf.size)
          smallBuffer = storage;
      }
    }

    if (bigBuffer != NULL) {
      storage = bigBuffer;
    } else if (smallBuffer != NULL) {
      storage = smallBuffer;
    } else {
      printf("AkariSub: cannot get a buffer for rendering part!\n");
      return NULL;
    }

    unsigned int *result = (unsigned int *)storage->buf.take(needed);
    if (result == NULL) {
      printf("AkariSub: cannot make a buffer for rendering part!\n");
      return NULL;
    }
    storage->taken = true;

    // now build the result
    int total_pixels = width * height;
    const float MIN_ALPHA_THRESHOLD = 4.0f / 255.0f;

    for (int i = 0; i < total_pixels; i++) {
      int buf_coord = i << 2;
      float alpha = buf[buf_coord + 3];

      // Only output if alpha is above minimum threshold
      if (alpha >= MIN_ALPHA_THRESHOLD) {
        // un-multiply the result
        float inv_alpha = 1.0f / alpha;

        float r_f = buf[buf_coord] * inv_alpha;
        float g_f = buf[buf_coord + 1] * inv_alpha;
        float b_f = buf[buf_coord + 2] * inv_alpha;

        // Clamp to 0-1 range
        r_f = r_f > 1.0f ? 1.0f : (r_f < 0.0f ? 0.0f : r_f);
        g_f = g_f > 1.0f ? 1.0f : (g_f < 0.0f ? 0.0f : g_f);
        b_f = b_f > 1.0f ? 1.0f : (b_f < 0.0f ? 0.0f : b_f);

        int r = (int)(r_f * 255.0f + 0.5f);
        int g = (int)(g_f * 255.0f + 0.5f);
        int b_val = (int)(b_f * 255.0f + 0.5f);
        int a = (int)(alpha * 255.0f + 0.5f);

        result[i] = (a << 24) | (b_val << 16) | (g << 8) | r;
      } else {
        result[i] = 0;
      }
    }

    // return the thing
    storage->next.x = actual_min_x;
    storage->next.y = actual_min_y;
    storage->next.w = width;
    storage->next.h = height;
    storage->next.image = (size_t)result;

    return &storage->next;
  }

  // BINDING
  ASS_Event *getEvent(int i) { return &track->events[i]; }

  ASS_Style *getStyle(int i) { return &track->styles[i]; }

  void styleOverride(ASS_Style style) {
    int set_force_flags =
        ASS_OVERRIDE_BIT_STYLE | ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE;

    ass_set_selective_style_override_enabled(ass_renderer, set_force_flags);
    ass_set_selective_style_override(ass_renderer, &style);
    ass_set_font_scale(ass_renderer, 0.3);
  }

  void disableStyleOverride() {
    ass_set_selective_style_override_enabled(ass_renderer, 0);
    ass_set_font_scale(ass_renderer, 1);
  }
};

enum EventIntField {
  EVENT_START = 0,
  EVENT_DURATION = 1,
  EVENT_READ_ORDER = 2,
  EVENT_LAYER = 3,
  EVENT_STYLE = 4,
  EVENT_MARGIN_L = 5,
  EVENT_MARGIN_R = 6,
  EVENT_MARGIN_V = 7
};

enum EventStrField {
  EVENT_NAME = 0,
  EVENT_EFFECT = 1,
  EVENT_TEXT = 2
};

enum StyleNumField {
  STYLE_FONT_SIZE = 0,
  STYLE_PRIMARY_COLOUR = 1,
  STYLE_SECONDARY_COLOUR = 2,
  STYLE_OUTLINE_COLOUR = 3,
  STYLE_BACK_COLOUR = 4,
  STYLE_BOLD = 5,
  STYLE_ITALIC = 6,
  STYLE_UNDERLINE = 7,
  STYLE_STRIKEOUT = 8,
  STYLE_SCALE_X = 9,
  STYLE_SCALE_Y = 10,
  STYLE_SPACING = 11,
  STYLE_ANGLE = 12,
  STYLE_BORDER_STYLE = 13,
  STYLE_OUTLINE = 14,
  STYLE_SHADOW = 15,
  STYLE_ALIGNMENT = 16,
  STYLE_MARGIN_L = 17,
  STYLE_MARGIN_R = 18,
  STYLE_MARGIN_V = 19,
  STYLE_ENCODING = 20,
  STYLE_TREAT_FONTNAME_AS_PATTERN = 21,
  STYLE_BLUR = 22,
  STYLE_JUSTIFY = 23
};

enum StyleStrField {
  STYLE_NAME = 0,
  STYLE_FONT_NAME = 1
};

static ASS_Event *get_event_ptr(AkariSub *instance, int index) {
  if (!instance || !instance->track || index < 0 || index >= instance->track->n_events)
    return NULL;
  return &instance->track->events[index];
}

static ASS_Style *get_style_ptr(AkariSub *instance, int index) {
  if (!instance || !instance->track || index < 0 || index >= instance->track->n_styles)
    return NULL;
  return &instance->track->styles[index];
}

extern "C" {

EMSCRIPTEN_KEEPALIVE AkariSub *akarisub_create(int width, int height, const char *fallback_font, int debug) {
  std::string fallback = fallback_font ? fallback_font : "";
  return new AkariSub(width, height, fallback, !!debug);
}

EMSCRIPTEN_KEEPALIVE void akarisub_destroy(AkariSub *instance) {
  if (!instance)
    return;
  instance->quitLibrary();
  delete instance;
}

EMSCRIPTEN_KEEPALIVE void akarisub_set_drop_animations(AkariSub *instance, int value) {
  if (instance)
    instance->setDropAnimations(value);
}

EMSCRIPTEN_KEEPALIVE void akarisub_create_track_mem(AkariSub *instance, const char *content) {
  if (instance)
    instance->createTrackMem(content ? std::string(content) : std::string());
}

EMSCRIPTEN_KEEPALIVE void akarisub_remove_track(AkariSub *instance) {
  if (instance)
    instance->removeTrack();
}

EMSCRIPTEN_KEEPALIVE void akarisub_resize_canvas(AkariSub *instance, int width, int height, int video_w, int video_h) {
  if (instance)
    instance->resizeCanvas(width, height, video_w, video_h);
}

EMSCRIPTEN_KEEPALIVE void akarisub_add_font(AkariSub *instance, const char *name, int data, unsigned long data_size) {
  if (instance)
    instance->addFont(name ? std::string(name) : std::string(), data, data_size);
}

EMSCRIPTEN_KEEPALIVE void akarisub_reload_fonts(AkariSub *instance) {
  if (instance)
    instance->reloadFonts();
}

EMSCRIPTEN_KEEPALIVE void akarisub_set_default_font(AkariSub *instance, const char *name) {
  if (instance)
    instance->setDefaultFont(name ? std::string(name) : std::string());
}

EMSCRIPTEN_KEEPALIVE void akarisub_set_fallback_fonts(AkariSub *instance, const char *fonts) {
  if (instance)
    instance->setFallbackFonts(fonts ? std::string(fonts) : std::string());
}

EMSCRIPTEN_KEEPALIVE void akarisub_set_memory_limits(AkariSub *instance, int glyph_limit, int bitmap_cache_limit) {
  if (instance)
    instance->setMemoryLimits(glyph_limit, bitmap_cache_limit);
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_event_count(AkariSub *instance) {
  return instance ? instance->getEventCount() : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_alloc_event(AkariSub *instance) {
  return instance ? instance->allocEvent() : -1;
}

EMSCRIPTEN_KEEPALIVE void akarisub_remove_event(AkariSub *instance, int index) {
  if (instance)
    instance->removeEvent(index);
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_style_count(AkariSub *instance) {
  return instance ? instance->getStyleCount() : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_alloc_style(AkariSub *instance) {
  return instance ? instance->allocStyle() : -1;
}

EMSCRIPTEN_KEEPALIVE void akarisub_remove_style(AkariSub *instance, int index) {
  if (instance)
    instance->removeStyle(index);
}

EMSCRIPTEN_KEEPALIVE void akarisub_style_override_index(AkariSub *instance, int index) {
  ASS_Style *style = get_style_ptr(instance, index);
  if (instance && style)
    instance->styleOverride(*style);
}

EMSCRIPTEN_KEEPALIVE void akarisub_disable_style_override(AkariSub *instance) {
  if (instance)
    instance->disableStyleOverride();
}

EMSCRIPTEN_KEEPALIVE RenderResult *akarisub_render_blend(AkariSub *instance, double tm, int force) {
  return instance ? instance->renderBlend(tm, force) : NULL;
}

EMSCRIPTEN_KEEPALIVE RenderResult *akarisub_render_image(AkariSub *instance, double tm, int force) {
  return instance ? instance->renderImage(tm, force) : NULL;
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_changed(AkariSub *instance) {
  return instance ? instance->changed : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_count(AkariSub *instance) {
  return instance ? instance->count : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_time(AkariSub *instance) {
  return instance ? instance->time : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_get_track_color_space(AkariSub *instance) {
  return instance ? instance->trackColorSpace : 0;
}

EMSCRIPTEN_KEEPALIVE int akarisub_event_get_int(AkariSub *instance, int index, int field) {
  ASS_Event *evt = get_event_ptr(instance, index);
  if (!evt)
    return 0;

  switch (field) {
  case EVENT_START:
    return evt->Start;
  case EVENT_DURATION:
    return evt->Duration;
  case EVENT_READ_ORDER:
    return evt->ReadOrder;
  case EVENT_LAYER:
    return evt->Layer;
  case EVENT_STYLE:
    return evt->Style;
  case EVENT_MARGIN_L:
    return evt->MarginL;
  case EVENT_MARGIN_R:
    return evt->MarginR;
  case EVENT_MARGIN_V:
    return evt->MarginV;
  default:
    return 0;
  }
}

EMSCRIPTEN_KEEPALIVE void akarisub_event_set_int(AkariSub *instance, int index, int field, int value) {
  ASS_Event *evt = get_event_ptr(instance, index);
  if (!evt)
    return;

  switch (field) {
  case EVENT_START:
    evt->Start = value;
    break;
  case EVENT_DURATION:
    evt->Duration = value;
    break;
  case EVENT_READ_ORDER:
    evt->ReadOrder = value;
    break;
  case EVENT_LAYER:
    evt->Layer = value;
    break;
  case EVENT_STYLE:
    evt->Style = value;
    break;
  case EVENT_MARGIN_L:
    evt->MarginL = value;
    break;
  case EVENT_MARGIN_R:
    evt->MarginR = value;
    break;
  case EVENT_MARGIN_V:
    evt->MarginV = value;
    break;
  }
}

EMSCRIPTEN_KEEPALIVE const char *akarisub_event_get_str(AkariSub *instance, int index, int field) {
  ASS_Event *evt = get_event_ptr(instance, index);
  if (!evt)
    return "";

  switch (field) {
  case EVENT_NAME:
    return evt->Name ? evt->Name : "";
  case EVENT_EFFECT:
    return evt->Effect ? evt->Effect : "";
  case EVENT_TEXT:
    return evt->Text ? evt->Text : "";
  default:
    return "";
  }
}

EMSCRIPTEN_KEEPALIVE void akarisub_event_set_str(AkariSub *instance, int index, int field, const char *value) {
  ASS_Event *evt = get_event_ptr(instance, index);
  if (!evt)
    return;
  const char *src = value ? value : "";

  switch (field) {
  case EVENT_NAME:
    free(evt->Name);
    evt->Name = copyString(src);
    break;
  case EVENT_EFFECT:
    free(evt->Effect);
    evt->Effect = copyString(src);
    break;
  case EVENT_TEXT:
    free(evt->Text);
    evt->Text = copyString(src);
    break;
  }
}

EMSCRIPTEN_KEEPALIVE double akarisub_style_get_num(AkariSub *instance, int index, int field) {
  ASS_Style *style = get_style_ptr(instance, index);
  if (!style)
    return 0;

  switch (field) {
  case STYLE_FONT_SIZE:
    return style->FontSize;
  case STYLE_PRIMARY_COLOUR:
    return style->PrimaryColour;
  case STYLE_SECONDARY_COLOUR:
    return style->SecondaryColour;
  case STYLE_OUTLINE_COLOUR:
    return style->OutlineColour;
  case STYLE_BACK_COLOUR:
    return style->BackColour;
  case STYLE_BOLD:
    return style->Bold;
  case STYLE_ITALIC:
    return style->Italic;
  case STYLE_UNDERLINE:
    return style->Underline;
  case STYLE_STRIKEOUT:
    return style->StrikeOut;
  case STYLE_SCALE_X:
    return style->ScaleX;
  case STYLE_SCALE_Y:
    return style->ScaleY;
  case STYLE_SPACING:
    return style->Spacing;
  case STYLE_ANGLE:
    return style->Angle;
  case STYLE_BORDER_STYLE:
    return style->BorderStyle;
  case STYLE_OUTLINE:
    return style->Outline;
  case STYLE_SHADOW:
    return style->Shadow;
  case STYLE_ALIGNMENT:
    return style->Alignment;
  case STYLE_MARGIN_L:
    return style->MarginL;
  case STYLE_MARGIN_R:
    return style->MarginR;
  case STYLE_MARGIN_V:
    return style->MarginV;
  case STYLE_ENCODING:
    return style->Encoding;
  case STYLE_TREAT_FONTNAME_AS_PATTERN:
    return style->treat_fontname_as_pattern;
  case STYLE_BLUR:
    return style->Blur;
  case STYLE_JUSTIFY:
    return style->Justify;
  default:
    return 0;
  }
}

EMSCRIPTEN_KEEPALIVE void akarisub_style_set_num(AkariSub *instance, int index, int field, double value) {
  ASS_Style *style = get_style_ptr(instance, index);
  if (!style)
    return;

  switch (field) {
  case STYLE_FONT_SIZE:
    style->FontSize = value;
    break;
  case STYLE_PRIMARY_COLOUR:
    style->PrimaryColour = value;
    break;
  case STYLE_SECONDARY_COLOUR:
    style->SecondaryColour = value;
    break;
  case STYLE_OUTLINE_COLOUR:
    style->OutlineColour = value;
    break;
  case STYLE_BACK_COLOUR:
    style->BackColour = value;
    break;
  case STYLE_BOLD:
    style->Bold = value;
    break;
  case STYLE_ITALIC:
    style->Italic = value;
    break;
  case STYLE_UNDERLINE:
    style->Underline = value;
    break;
  case STYLE_STRIKEOUT:
    style->StrikeOut = value;
    break;
  case STYLE_SCALE_X:
    style->ScaleX = value;
    break;
  case STYLE_SCALE_Y:
    style->ScaleY = value;
    break;
  case STYLE_SPACING:
    style->Spacing = value;
    break;
  case STYLE_ANGLE:
    style->Angle = value;
    break;
  case STYLE_BORDER_STYLE:
    style->BorderStyle = value;
    break;
  case STYLE_OUTLINE:
    style->Outline = value;
    break;
  case STYLE_SHADOW:
    style->Shadow = value;
    break;
  case STYLE_ALIGNMENT:
    style->Alignment = value;
    break;
  case STYLE_MARGIN_L:
    style->MarginL = value;
    break;
  case STYLE_MARGIN_R:
    style->MarginR = value;
    break;
  case STYLE_MARGIN_V:
    style->MarginV = value;
    break;
  case STYLE_ENCODING:
    style->Encoding = value;
    break;
  case STYLE_TREAT_FONTNAME_AS_PATTERN:
    style->treat_fontname_as_pattern = value;
    break;
  case STYLE_BLUR:
    style->Blur = value;
    break;
  case STYLE_JUSTIFY:
    style->Justify = value;
    break;
  }
}

EMSCRIPTEN_KEEPALIVE const char *akarisub_style_get_str(AkariSub *instance, int index, int field) {
  ASS_Style *style = get_style_ptr(instance, index);
  if (!style)
    return "";

  switch (field) {
  case STYLE_NAME:
    return style->Name ? style->Name : "";
  case STYLE_FONT_NAME:
    return style->FontName ? style->FontName : "";
  default:
    return "";
  }
}

EMSCRIPTEN_KEEPALIVE void akarisub_style_set_str(AkariSub *instance, int index, int field, const char *value) {
  ASS_Style *style = get_style_ptr(instance, index);
  if (!style)
    return;
  const char *src = value ? value : "";

  switch (field) {
  case STYLE_NAME:
    free(style->Name);
    style->Name = copyString(src);
    break;
  case STYLE_FONT_NAME:
    free(style->FontName);
    style->FontName = copyString(src);
    break;
  }
}

EMSCRIPTEN_KEEPALIVE int akarisub_render_result_x(RenderResult *result) { return result ? result->x : 0; }
EMSCRIPTEN_KEEPALIVE int akarisub_render_result_y(RenderResult *result) { return result ? result->y : 0; }
EMSCRIPTEN_KEEPALIVE int akarisub_render_result_w(RenderResult *result) { return result ? result->w : 0; }
EMSCRIPTEN_KEEPALIVE int akarisub_render_result_h(RenderResult *result) { return result ? result->h : 0; }
EMSCRIPTEN_KEEPALIVE size_t akarisub_render_result_image(RenderResult *result) { return result ? result->image : 0; }
EMSCRIPTEN_KEEPALIVE RenderResult *akarisub_render_result_next(RenderResult *result) {
  return result ? result->next : NULL;
}

// Fill metadata for a linked list of RenderResult nodes in one call.
// out layout per image (6 ints): x, y, w, h, image_ptr, next_ptr
EMSCRIPTEN_KEEPALIVE int akarisub_render_result_collect(RenderResult *result, int *out, int max_items) {
  if (!out || max_items <= 0)
    return 0;

  int count = 0;
  RenderResult *cur = result;
  while (cur && count < max_items) {
    int base = count * 6;
    out[base + 0] = cur->x;
    out[base + 1] = cur->y;
    out[base + 2] = cur->w;
    out[base + 3] = cur->h;
    out[base + 4] = (int)(uintptr_t)cur->image;
    out[base + 5] = (int)(uintptr_t)cur->next;
    cur = cur->next;
    count++;
  }

  return count;
}

// Combined render + collect: render, then collect results into `out` buffer in one WASM call.
// Returns the number of images written. Also writes header metadata at out[0..2]:
//   out[0] = changed, out[1] = count, out[2] = render_time
// Image data starts at out[3], with 5 ints per image: x, y, w, h, image_ptr
EMSCRIPTEN_KEEPALIVE int akarisub_render_blend_collect(
    AkariSub *instance, double tm, int force, int *out, int max_items) {
  if (!instance || !out || max_items < 3)
    return 0;

  RenderResult *result = instance->renderBlend(tm, force);

  // Write header: changed, count, time
  out[0] = instance->changed;
  out[1] = instance->count;
  out[2] = instance->time;

  if (!result || instance->count == 0)
    return 0;

  // Collect render results starting at out[3]
  int *img_out = out + 3;
  int written = 0;
  int img_max = (max_items - 3) / 5; // 5 ints per image
  if (img_max > instance->count)
    img_max = instance->count;

  RenderResult *cur = result;
  while (cur && written < img_max) {
    int base = written * 5;
    img_out[base + 0] = cur->x;
    img_out[base + 1] = cur->y;
    img_out[base + 2] = cur->w;
    img_out[base + 3] = cur->h;
    img_out[base + 4] = (int)(uintptr_t)cur->image;
    cur = cur->next;
    written++;
  }

  return written;
}

// Same as above but for renderImage mode
EMSCRIPTEN_KEEPALIVE int akarisub_render_image_collect(
    AkariSub *instance, double tm, int force, int *out, int max_items) {
  if (!instance || !out || max_items < 3)
    return 0;

  RenderResult *result = instance->renderImage(tm, force);

  out[0] = instance->changed;
  out[1] = instance->count;
  out[2] = instance->time;

  if (!result || instance->count == 0)
    return 0;

  int *img_out = out + 3;
  int written = 0;
  int img_max = (max_items - 3) / 5;
  if (img_max > instance->count)
    img_max = instance->count;

  RenderResult *cur = result;
  while (cur && written < img_max) {
    int base = written * 5;
    img_out[base + 0] = cur->x;
    img_out[base + 1] = cur->y;
    img_out[base + 2] = cur->w;
    img_out[base + 3] = cur->h;
    img_out[base + 4] = (int)(uintptr_t)cur->image;
    cur = cur->next;
    written++;
  }

  return written;
}

}

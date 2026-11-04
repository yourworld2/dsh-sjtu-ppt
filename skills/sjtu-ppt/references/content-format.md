# Content JSON Format

## Overview

The generator consumes a single JSON file that defines the presentation metadata and an ordered list of slides.

## Top-Level Structure

```json
{
  "title": "Presentation Title",
  "subtitle": "Optional Subtitle",
  "date": "2026年1月",
  "author": "Research Team",
  "slides": [
    { ...slide object... },
    { ...slide object... }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | Yes | Main presentation title shown on the cover slide. |
| subtitle | string | No | Subtitle shown on the cover slide. |
| date | string | No | Date string shown on the cover slide. |
| author | string | No | Author or organization shown on the cover slide. |
| slides | array | Yes | Ordered list of slide objects. |
| cover_image | string | No | Path to an image file (jpg/png). For templates with a cover picture placeholder (e.g. SJTU-origin), fills the cover slide picture. |
| page_numbers | bool | No | Top-level toggle for slide numbers. Default `true`. Only takes effect if the template has a SLIDE_NUMBER placeholder. |

## Slide Object

```json
{
  "layout": "content",
  "title": "Slide Title",
  "subtitle": "Optional Subtitle",
  "content": ["Bullet 1", "Bullet 2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| layout | string | No | Layout type. Default is `content`. See Layout Types below. |
| title | string | No | Slide heading. |
| subtitle | string | No | Subtitle or short description. |
| content | array or string | No | Main body bullets or plain text. |
| image | string | No | Path to an image file (jpg/png). For templates with picture placeholders (e.g. SJTU-origin cover and section slides), fills the picture placeholder with this image. |
| left | array | No | Bullets for the left column. Only filled when the template has a body placeholder named 左/left; otherwise silently skipped. |
| right | array | No | Bullets for the right column. Only filled when the template has a body placeholder named 右/right; otherwise silently skipped. |
| page_numbers | bool | No | Per-slide override. When set, overrides the top-level `page_numbers` and the default-by-layout behavior. |

## Layout Types

| Value | Matching Template Layout | Usage |
|-------|-------------------------|-------|
| cover / title_slide | 封面1 | Title + date + author. Uses top-level `title`, `date`, `author`. |
| toc / table_of_contents | 目录1 | Table of contents list. Uses `content` array as TOC entries. |
| content / title_and_content | 内页版式1 | Title with bulleted content below. |
| section / section_header | 过渡页1 | Large section divider with title. |
| end / closing | 封底2 | Closing slide with thank-you message. |
| blank | Any available | Minimal layout; uses first available text shape. |

The script automatically matches layout names in both Chinese and English. If you use a custom template, the script will attempt to match by layout name keywords.

## Bullet Levels

Nest bullets by using objects inside `content` arrays:

```json
{
  "content": [
    "Top-level point",
    {"text": "Nested point", "level": 1},
    {"text": "Deeper nested point", "level": 2}
  ]
}
```

- `level: 0` is the default top-level bullet.
- Increase `level` to indent further.

## Cover Slide Fields

The cover slide is generated from the top-level metadata, not from a slide object:

| JSON Field | Cover Placeholder | Fallback |
|------------|-------------------|----------|
| title | Title placeholder | -- |
| date | Content / Object placeholder | subtitle |
| author | Text / Body placeholder | subtitle |
| subtitle | Used as date or author fallback | -- |
| cover_image | Picture placeholder (if present) | Ignored if no picture placeholder |

## Page Numbers

Slide numbers are controlled via the `showSldNum` attribute on each slide's XML, which is the native PowerPoint mechanism (no manual textboxes are added).

| Layer | Field | Effect |
|-------|-------|--------|
| Top level | `page_numbers` (bool, default `true`) | Master switch. If `false`, all slides have numbers hidden. |
| Per slide | `page_numbers` (bool) | Overrides the default-by-layout behavior for that slide. |

Default visibility by layout type:

| Layout | Default |
|--------|---------|
| `cover` / `title_slide` | hidden |
| `toc` / `table_of_contents` | hidden |
| `end` / `closing` | hidden |
| `section` / `section_header` | hidden |
| `content` / `title_and_content` | shown |

**Template support matrix** (which built-in layouts have a SLIDE_NUMBER placeholder):

| Template | 封面 | 目录 | 内页 | 过渡 | 封底 |
|---|---|---|---|---|---|
| SJTU-basic | – | – | 🔢 | – | – |
| SJTU-130 | – | – | 🔢 | – | – |
| SJTU-blue | – | 🔢 | 🔢 | – | – |
| SJTU-crimson | – | 🔢 | 🔢 | 🔢 | – |
| SJTU-global | – | – | 🔢 | 🔢 | 🔢 |
| SJTU-origin | – | – | 🔢 | – | 🔢 |
| SJTU-star | – | – | 🔢 | 🔢 | 🔢 |
| SJTU-wine | – | 🔢 | 🔢 | 🔢 | – |

All 8 built-in templates display page numbers on content slides. Layouts without a SLIDE_NUMBER placeholder in the template won't show numbers regardless of `showSldNum`.

## Complete Example

```json
{
  "title": "Q3 Product Roadmap",
  "subtitle": "Updated August 2025",
  "date": "2025年8月",
  "author": "Product Team",
  "slides": [
    {
      "layout": "toc",
      "title": "目录",
      "content": [
        "Overview",
        "Key Objectives",
        "Timeline & Owners"
      ]
    },
    {
      "layout": "section",
      "title": "Overview"
    },
    {
      "layout": "content",
      "title": "Key Objectives",
      "content": [
        "Launch v2.0 API",
        "Expand to three new regions",
        {"text": "APAC rollout", "level": 1},
        {"text": "EMEA rollout", "level": 1},
        "Improve system reliability to 99.99%"
      ]
    },
    {
      "layout": "content",
      "title": "Timeline & Owners",
      "left": [
        "July: Design freeze",
        "August: Beta build",
        "September: GA release"
      ],
      "right": [
        "PM: Alice Chen",
        "Engineering: Bob Martinez",
        "QA: Carol White"
      ]
    },
    {
      "layout": "end",
      "title": "Thank you",
      "subtitle": "Questions & Discussion"
    }
  ]
}
```

## Validation Rules

1. `title` (top-level) must be a non-empty string.
2. `slides` must be an array; empty array yields only the cover slide.
3. Each slide object must be a dictionary.
4. `content` must be a string or array when provided.
5. If `layout` is omitted, `content` is assumed.

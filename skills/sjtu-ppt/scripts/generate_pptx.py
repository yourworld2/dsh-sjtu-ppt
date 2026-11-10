#!/usr/bin/env python3
"""
PPTX Auto-Generator
Load a template, parse a JSON content definition, and generate a .pptx file.
Preserves all theme styles (fonts, colors, sizes) from the template.
Optimized for Chinese templates with named layouts and placeholders.
"""

import argparse
import json
import os
import sys

from lxml import etree
from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt


def create_basic_template(output_path):
    """Create a minimal built-in template with common layouts."""
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    blank_layout = prs.slide_layouts[6]

    # Layout 0: Title Slide
    s1 = prs.slides.add_slide(blank_layout)
    t1 = s1.shapes.add_textbox(Inches(1), Inches(2.2), Inches(11.333), Inches(1.5))
    t1.text_frame.text = "Title Placeholder"
    t1.text_frame.paragraphs[0].font.size = Pt(44)
    t1.text_frame.paragraphs[0].font.bold = True

    sub1 = s1.shapes.add_textbox(Inches(1), Inches(4.0), Inches(11.333), Inches(1.0))
    sub1.text_frame.text = "Subtitle Placeholder"
    sub1.text_frame.paragraphs[0].font.size = Pt(24)

    # Layout 1: Title and Content
    s2 = prs.slides.add_slide(blank_layout)
    t2 = s2.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.733), Inches(1.0))
    t2.text_frame.text = "Slide Title"
    t2.text_frame.paragraphs[0].font.size = Pt(36)
    t2.text_frame.paragraphs[0].font.bold = True

    c2 = s2.shapes.add_textbox(Inches(1.0), Inches(1.7), Inches(11.333), Inches(5.2))
    c2.text_frame.text = "Content Placeholder"
    c2.text_frame.paragraphs[0].font.size = Pt(20)

    # Layout 2: Section Header
    s3 = prs.slides.add_slide(blank_layout)
    t3 = s3.shapes.add_textbox(Inches(1), Inches(2.8), Inches(11.333), Inches(1.5))
    t3.text_frame.text = "Section Title"
    t3.text_frame.paragraphs[0].font.size = Pt(40)
    t3.text_frame.paragraphs[0].font.bold = True
    t3.text_frame.paragraphs[0].alignment = 2  # CENTER

    # Layout 3: Two Content
    s4 = prs.slides.add_slide(blank_layout)
    t4 = s4.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.733), Inches(1.0))
    t4.text_frame.text = "Slide Title"
    t4.text_frame.paragraphs[0].font.size = Pt(36)
    t4.text_frame.paragraphs[0].font.bold = True

    l4 = s4.shapes.add_textbox(Inches(0.8), Inches(1.7), Inches(5.3), Inches(5.2))
    l4.text_frame.text = "Left Content"
    l4.text_frame.paragraphs[0].font.size = Pt(18)

    r4 = s4.shapes.add_textbox(Inches(7.2), Inches(1.7), Inches(5.3), Inches(5.2))
    r4.text_frame.text = "Right Content"
    r4.text_frame.paragraphs[0].font.size = Pt(18)

    prs.save(output_path)
    return output_path


def get_layout_map(prs):
    """
    Build a mapping from canonical layout names to actual slide_layout objects.
    Supports both Chinese template names (e.g., 封面1, 内页版式1) and English aliases.
    """
    canonical_map = {}
    for layout in prs.slide_layouts:
        name = layout.name.strip().lower()
        canonical_map[name] = layout

    alias_map = {}

    def find(*keywords):
        for name, layout in canonical_map.items():
            if any(k in name for k in keywords):
                return layout
        return None

    # Cover / Title slide
    alias_map["cover"] = find("封面", "title slide", "cover")
    alias_map["title_slide"] = alias_map["cover"]

    # Table of Contents
    alias_map["toc"] = find("目录", "toc", "agenda")
    alias_map["table_of_contents"] = alias_map["toc"]

    # Content / Body
    alias_map["content"] = find("内页", "content", "title and content", "正文", "标题和内容", "内容")
    alias_map["title_and_content"] = alias_map["content"]

    # Section / Transition
    alias_map["section"] = find("过渡", "section", "transition", "divider", "自定义", "节")
    alias_map["section_header"] = alias_map["section"]

    # End / Closing
    alias_map["end"] = find("封底", "end", "closing", "thank", "结尾")
    alias_map["closing"] = alias_map["end"]

    # Fallbacks: if no Chinese layout matched, try heuristics
    if alias_map["content"] is None:
        alias_map["content"] = find("标题", "title")

    return alias_map, canonical_map


# Single source of truth for layout-name → kind classification.
# Update here when adding support for new template naming conventions.
LAYOUT_KIND_KEYWORDS = {
    "cover":    ["封面", "cover", "title slide", "标题幻灯片", "标题样式"],
    "toc":      ["目录", "toc", "agenda"],
    # Note: "自定义" matches SJTU-crimson/wine's 4_自定义版式 / 6_自定义版式
    # (the alias_map also uses "自定义" — keep both in sync).
    "section":  ["过渡", "section", "transition", "divider", "节标题", "自定义"],
    "end":      ["封底", "end", "closing", "thank", "结尾"],
    "content":  ["内页", "content", "title and content", "正文", "标题和内容"],
}


def layout_kind(layout_name, kind):
    """Return True if layout_name matches the given kind's keyword set."""
    name = layout_name.lower() if layout_name else ""
    return any(k in name for k in LAYOUT_KIND_KEYWORDS[kind])


def template_supports_page_numbers(prs):
    """
    True iff the template declares a SLIDE_NUMBER placeholder on the
    master or any layout. Without it, setting showSldNum has no visual
    effect — we deliberately skip rather than inject textboxes.
    """
    for layout in prs.slide_layouts:
        for ph in layout.placeholders:
            try:
                if "SLIDE_NUMBER" in str(ph.placeholder_format.type).upper():
                    return True
            except Exception:
                pass
    for ph in prs.slide_masters[0].placeholders:
        try:
            if "SLIDE_NUMBER" in str(ph.placeholder_format.type).upper():
                return True
        except Exception:
            pass
    return False


def ensure_slide_number(slide):
    """
    Copy the SLIDE_NUMBER placeholder instance from the slide's layout
    onto the slide itself. python-pptx's add_slide() does NOT inherit
    sldNum placeholders automatically, so without this the showSldNum
    attribute alone has no visual effect.

    The placeholder uses <a:fld type="slidenum"> which PowerPoint
    renders as the current slide number automatically.
    """
    from copy import deepcopy
    layout = slide.slide_layout
    sld_num_sp = None
    for ph in layout.placeholders:
        try:
            if "SLIDE_NUMBER" in str(ph.placeholder_format.type).upper():
                sld_num_sp = ph._element
                break
        except Exception:
            pass
    if sld_num_sp is None:
        return

    # Don't duplicate if the slide already has one
    for sh in slide.shapes:
        try:
            if sh.is_placeholder and "SLIDE_NUMBER" in str(sh.placeholder_format.type).upper():
                return
        except Exception:
            pass

    new_sp = deepcopy(sld_num_sp)
    # Assign a fresh id to avoid collision with existing shapes
    existing_ids = set()
    for sh in slide.shapes:
        try:
            existing_ids.add(int(sh._element.nvSpPr.cNvPr.get('id', '0')))
        except Exception:
            pass
    new_id = (max(existing_ids) if existing_ids else 0) + 1
    new_sp.nvSpPr.cNvPr.set('id', str(new_id))
    slide.shapes._spTree.append(new_sp)


def configure_page_numbers(prs, slides_data, top_level_enabled=True):
    """
    Set showSldNum attribute per slide based on layout kind.

    Defaults: cover / end / section → hidden, content / toc → shown.
    Per-slide override via slide_def["page_numbers"] (bool).
    Top-level toggle via content_json["page_numbers"] (default True).

    No-op if the template lacks a SLIDE_NUMBER placeholder.
    """
    if not template_supports_page_numbers(prs):
        return

    if not top_level_enabled:
        for slide in prs.slides:
            slide.element.set("showSldNum", "0")
        return

    # Cover slide (first one) is always hidden
    if prs.slides:
        prs.slides[0].element.set("showSldNum", "0")

    # Materialize to a list first — pptx's Slides collection doesn't
    # support list-style slicing in all versions (returns a bare list
    # of sldId elements that lacks the .rId attribute expected by
    # Slide.__getitem__).
    content_slides = list(prs.slides)[1:]
    for slide, slide_def in zip(content_slides, slides_data):
        layout = slide.slide_layout
        # Default: cover / end / section / toc → hidden;
        #          content → shown.
        if (layout_kind(layout.name, "cover") or
                layout_kind(layout.name, "toc") or
                layout_kind(layout.name, "end") or
                layout_kind(layout.name, "section")):
            show = False
        else:
            show = True
        # Per-slide explicit override wins
        if "page_numbers" in slide_def:
            show = bool(slide_def["page_numbers"])
        # Copy sldNum placeholder from layout onto slide BEFORE
        # toggling showSldNum — the attribute has no visual effect
        # unless a sldNum instance exists on the slide itself.
        if show:
            ensure_slide_number(slide)
        slide.element.set("showSldNum", "1" if show else "0")


def get_layout_by_key(alias_map, canonical_map, key):
    """Resolve a layout key to an actual slide_layout object."""
    key = key.lower().strip()
    if key in alias_map and alias_map[key] is not None:
        return alias_map[key]
    if key in canonical_map:
        return canonical_map[key]
    # Partial match
    for name, layout in canonical_map.items():
        if key in name or name in key:
            return layout
    # Ultimate fallback
    return list(canonical_map.values())[0] if canonical_map else None


def find_shape_by_type_and_name(slide, type_keywords, name_keywords, exclude=None):
    """
    Find the best matching shape on a slide by placeholder type and/or name.
    type_keywords: e.g., ['TITLE'] for title placeholders.
    name_keywords: e.g., ['标题', 'title'].
    """
    candidates = []
    for shape in slide.shapes:
        if exclude and shape == exclude:
            continue
        if not shape.has_text_frame:
            continue
        score = 0
        name_lower = shape.name.lower()
        if any(k in name_lower for k in name_keywords):
            score += 10
        if shape.is_placeholder:
            ph_type = str(shape.placeholder_format.type).lower()
            if any(k.lower() in ph_type for k in type_keywords):
                score += 20
        if score > 0:
            candidates.append((score, shape))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]
    return None


def find_any_text_shape(slide, exclude=None):
    """Return the first text shape that is not excluded."""
    for shape in slide.shapes:
        if exclude and shape == exclude:
            continue
        if shape.has_text_frame:
            return shape
    return None


def set_text_frame_text(shape, text_or_list, preserve_style=True):
    """
    Populate a shape's text frame.
    If preserve_style is True, try to keep the first run's font settings
    for new paragraphs (only setting text and level, not color/size).
    """
    if shape is None:
        return
    tf = shape.text_frame
    tf.clear()

    if isinstance(text_or_list, str):
        p = tf.paragraphs[0]
        p.text = text_or_list
        p.level = 0
        return

    if not isinstance(text_or_list, list):
        return

    # Try to capture base style from original paragraph 0 if exists.
    # Note: theme colors (inherited from layout) cannot be read reliably
    # via r.font.color, so we deliberately only preserve name/size/bold.
    base_font_name = None
    base_font_size = None
    base_font_bold = None
    try:
        if tf.paragraphs and tf.paragraphs[0].runs:
            r = tf.paragraphs[0].runs[0]
            base_font_name = r.font.name
            base_font_size = r.font.size
            base_font_bold = r.font.bold
    except Exception:
        pass

    for idx, item in enumerate(text_or_list):
        if idx == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        if isinstance(item, dict):
            p.text = item.get("text", "")
            p.level = item.get("level", 0)
        else:
            p.text = str(item)
            p.level = 0

        # Only set font if it was explicitly defined on the template
        # (not inherited/theme colors which we can't read correctly)
        if preserve_style and base_font_size and p.runs:
            for run in p.runs:
                if base_font_name:
                    run.font.name = base_font_name
                run.font.size = base_font_size
                if base_font_bold is not None:
                    run.font.bold = base_font_bold


def fill_picture_placeholder(slide, image_path):
    """
    Find a PICTURE placeholder on the slide and insert the image.
    Returns True if a picture was inserted, False otherwise.

    Logs a warning when:
      - the image file does not exist on disk
      - the slide has no PICTURE placeholder
      - insert_picture fails (e.g. unreadable file)
    """
    if not os.path.exists(image_path):
        print(f"  warning: image not found, skipping: {image_path}",
              file=sys.stderr)
        return False

    for shape in slide.shapes:
        if not shape.is_placeholder:
            continue
        ph_type = str(shape.placeholder_format.type).lower()
        if "picture" in ph_type:
            try:
                ph_idx = shape.placeholder_format.idx
                pic = shape.insert_picture(image_path)
                # A cloned picture placeholder may carry no explicit geometry;
                # LibreOffice then renders it nowhere. Copy the layout box so
                # PowerPoint and LibreOffice agree on the position.
                try:
                    target = None
                    for layout_shape in slide.slide_layout.shapes:
                        if not layout_shape.is_placeholder:
                            continue
                        if layout_shape.placeholder_format.idx == ph_idx:
                            target = layout_shape
                            break
                    if target is not None:
                        sp_pr = pic._element.spPr
                        for old in sp_pr.findall(qn("a:xfrm")):
                            sp_pr.remove(old)
                        xfrm = etree.Element(qn("a:xfrm"))
                        off = etree.SubElement(xfrm, qn("a:off"))
                        off.set("x", str(int(target.left or 0)))
                        off.set("y", str(int(target.top or 0)))
                        ext = etree.SubElement(xfrm, qn("a:ext"))
                        ext.set("cx", str(int(target.width or 0)))
                        ext.set("cy", str(int(target.height or 0)))
                        sp_pr.insert(0, xfrm)
                except Exception:
                    pass
                return True
            except Exception as e:
                print(f"  warning: insert_picture failed for {image_path}: {e}",
                      file=sys.stderr)
                return False

    # python-pptx 1.x does not clone PICTURE placeholders from the layout onto
    # new slides, so insert the image at the layout's picture box and send it
    # behind the text.
    try:
        for shape in slide.slide_layout.shapes:
            if not shape.is_placeholder:
                continue
            if "picture" not in str(shape.placeholder_format.type).lower():
                continue
            left, top, width, height = shape.left, shape.top, shape.width, shape.height
            if not width or not height:
                continue
            pic = slide.shapes.add_picture(image_path, left, top, width=width)
            if pic.height > height:
                crop = 1 - height / pic.height
                pic.crop_top = crop / 2
                pic.crop_bottom = crop / 2
                pic.height = height
            elif pic.height < height:
                slide.shapes._spTree.remove(pic._element)
                pic = slide.shapes.add_picture(image_path, left, top, height=height)
                if pic.width > width:
                    crop = 1 - width / pic.width
                    pic.crop_left = crop / 2
                    pic.crop_right = crop / 2
                    pic.width = width
            tree = slide.shapes._spTree
            tree.remove(pic._element)
            tree.insert(2, pic._element)
            return True
    except Exception as e:
        print(f"  warning: insert_picture failed for {image_path}: {e}",
              file=sys.stderr)
        return False

    print(f"  warning: no PICTURE placeholder on slide, skipping image: {image_path}",
          file=sys.stderr)
    return False


def fill_toc_slide(prs, slide, toc_items):
    """
    Fill a TOC slide using one of three strategies:
    1. Use BODY / OBJECT placeholders directly (SJTU-basic, SJTU-wine)
    2. Detect and reuse existing decorative text shapes on the right side (SJTU-130, others)
    3. Fallback: add textboxes at fixed positions matching SJTU layouts
    """
    # Strategy 1: direct BODY placeholders
    toc_placeholders = []
    for shape in slide.shapes:
        if shape.is_placeholder and shape.has_text_frame:
            ph_type = str(shape.placeholder_format.type).lower()
            if "body" in ph_type or "object" in ph_type:
                toc_placeholders.append(shape)

    if toc_placeholders:
        toc_placeholders.sort(key=lambda s: s.top)
        for idx, item in enumerate(toc_items):
            if idx < len(toc_placeholders):
                target = toc_placeholders[idx]
                set_text_frame_text(target, item if not isinstance(item, dict) else item.get("text", ""))
        return

    # Strategy 2: detect existing decorative text shapes on the right half
    right_half = prs.slide_width / 2
    right_text_shapes = [s for s in slide.shapes if not s.is_placeholder and s.has_text_frame and s.left >= right_half]

    if right_text_shapes:
        right_text_shapes.sort(key=lambda s: s.top)
        for idx, item in enumerate(toc_items):
            if idx < len(right_text_shapes):
                target = right_text_shapes[idx]
                set_text_frame_text(target, item if not isinstance(item, dict) else item.get("text", ""))
        return

    # Strategy 3: fallback — add textboxes at fixed positions (right side, vertically spaced)
    positions = [
        (Inches(6.5), Inches(1.8)),
        (Inches(6.5), Inches(3.0)),
        (Inches(6.5), Inches(4.2)),
        (Inches(6.5), Inches(5.4)),
        (Inches(6.5), Inches(6.6)),
    ]
    for idx, item in enumerate(toc_items):
        if idx >= len(positions):
            break
        left, top = positions[idx]
        shape = slide.shapes.add_textbox(left, top, Inches(6), Inches(1))
        tf = shape.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        if isinstance(item, dict):
            p.text = item.get("text", "")
            p.level = item.get("level", 0)
        else:
            p.text = str(item)
            p.level = 0


def clear_template_slides(prs):
    """Remove all existing slides from a template, keeping only master layouts."""
    while len(prs.slides) > 0:
        rId = prs.slides._sldIdLst[0].rId
        prs.part.drop_rel(rId)
        del prs.slides._sldIdLst[0]



def text_placeholders(slide, exclude=None):
    """Text placeholders on a slide, top-to-bottom, without footer/date/number fields."""
    skip = ("slide_number", "footer", "date")
    out = []
    for shape in slide.shapes:
        if exclude is not None and shape.shape_id == exclude.shape_id:
            continue
        if not shape.has_text_frame or not shape.is_placeholder:
            continue
        ph_type = str(shape.placeholder_format.type).lower()
        if any(key in ph_type for key in skip):
            continue
        if any(key in ph_type for key in ("title", "body", "object", "subtitle", "text")):
            out.append(shape)
    return sorted(out, key=lambda shape: (shape.top or 0, shape.left or 0))


def fill_cover_fields(slide, title_shape, title, subtitle, date_str, author):
    """Fill the cover's title and meta slots without losing subtitle/date/author.

    Templates expose one, two or three body slots. Narrow slots (the 3.18"
    date line on several templates) get the short date, while the wider slot
    carries "subtitle · author"; a single slot gets everything on one line.
    """
    slots = text_placeholders(slide, exclude=title_shape)

    def put_title(shape):
        # A tall, narrow title placeholder (wine) reads better as two balanced
        # lines at the " · " separator than as an orphaned last word.
        if " · " in title and len(title) >= 10 and shape.width and shape.height:
            if shape.width / 914400 <= 8.7 and shape.height / 914400 >= 1.8:
                left, right = title.split(" · ", 1)
                if left and right:
                    set_text_frame_text(shape, [left, right])
                    fit_placeholder_text(shape)
                    return
        set_text_frame_text(shape, title)
        fit_placeholder_text(shape)

    if title_shape:
        put_title(title_shape)
    elif slots:
        put_title(slots.pop(0))
    if not slots:
        return
    if len(slots) == 1:
        meta = " · ".join(value for value in (date_str, author) if value)
        if subtitle and meta:
            put_meta(slots[0], [subtitle, meta], allow_two_lines=True)
        else:
            put_meta(slots[0], [subtitle or meta])
        return
    if subtitle and date_str and author:
        narrow = min(slots, key=lambda shape: shape.width or 0)
        wide = slots[1] if slots[0] is narrow else slots[0]
        if (narrow.width or 0) / 914400 < 4.8:
            put_meta(wide, [subtitle, author], allow_two_lines=True)
            put_meta(narrow, [date_str])
            return
    fields = [value for value in (subtitle, date_str, author) if value]
    if not fields:
        return
    if len(fields) <= len(slots):
        for shape, value in zip(slots, fields):
            put_meta(shape, [value])
        return
    head = fields[: len(slots) - 1]
    for shape, value in zip(slots[: len(head)], head):
        put_meta(shape, [value])
    put_meta(slots[-1], fields[len(slots) - 1:], allow_two_lines=True)


def append_subtitle_paragraph(shape, subtitle):
    """Append a smaller subtitle line to a title shape, keeping the theme color."""
    if shape is None or not subtitle:
        return
    tf = shape.text_frame
    base = None
    try:
        if tf.paragraphs and tf.paragraphs[0].runs:
            base = tf.paragraphs[0].runs[0].font.size
    except Exception:
        pass
    try:
        paragraph = tf.add_paragraph()
        paragraph.text = subtitle
        paragraph.level = 0
        paragraph.space_before = Pt(8)
        size = Pt(max(12, round(base.pt * 0.42))) if base is not None else Pt(16)
        for run in paragraph.runs:
            run.font.size = size
    except Exception:
        pass


def fill_section_or_end(slide, title_shape, title, subtitle):
    """Section / closing slides: use a spare text placeholder for the subtitle when
    there is one, otherwise append a smaller line under the title."""
    shape = title_shape or (text_placeholders(slide, exclude=title_shape)[:1] or [None])[0]
    extra = None
    if shape is not None:
        candidates = text_placeholders(slide, exclude=shape)
        extra = candidates[0] if candidates else None
    if shape is not None and title:
        set_text_frame_text(shape, title)
    if not subtitle:
        return
    if extra is not None:
        set_text_frame_text(extra, subtitle)
    elif shape is not None:
        append_subtitle_paragraph(shape, subtitle)



def placeholder_base_size(shape):
    """The design font size for a placeholder, read from its slide layout."""
    try:
        layout = shape.part.slide.slide_layout
        for ph in layout.placeholders:
            if ph.placeholder_format.idx != shape.placeholder_format.idx:
                continue
            sizes = []
            for node in ph.text_frame._txBody.iter():
                tag = str(node.tag)
                if (tag.endswith("}defRPr") or tag.endswith("}rPr")) and node.get("sz"):
                    try:
                        sizes.append(int(node.get("sz")))
                    except ValueError:
                        pass
            if sizes:
                return Pt(max(sizes) / 100)
    except Exception:
        pass
    try:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.font.size is not None:
                    return run.font.size
    except Exception:
        pass
    return None


def visual_units(text):
    units = 0.0
    for ch in text:
        if ch in " \t":
            units += 0.34
        elif ord(ch) > 0x2E80:
            units += 1.08
        else:
            units += 0.62
    return units


def fit_placeholder_text(shape):
    """Shrink a cover line only when it would wrap, keeping the template's size when it fits."""
    if shape is None or not shape.has_text_frame:
        return
    base = None
    try:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.font.size is not None:
                    base = run.font.size
                    break
            if base is not None:
                break
    except Exception:
        pass
    if base is None:
        base = placeholder_base_size(shape)
    width = ((shape.width or 0) / 914400 - 0.2) * 0.92
    if base is None or width <= 0.5:
        return
    lines = [line for line in shape.text_frame.text.split("\n") if line.strip()]
    if not lines:
        return
    units = max(visual_units(line) for line in lines)
    needed = units * base.pt / 72
    if needed <= width:
        return
    size = max(9.0, base.pt * width / needed)
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.size = Pt(size)

def put_meta(shape, parts, allow_two_lines=False):
    """Put one or more meta strings into a cover slot, wrapping to two lines when
    the joined line would overflow but every part still fits the slot height."""
    parts = [part for part in parts if part]
    if not parts:
        return
    base = None
    try:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.font.size is not None:
                    base = run.font.size
                    break
            if base is not None:
                break
    except Exception:
        pass
    if base is None:
        base = placeholder_base_size(shape)
    width = ((shape.width or 0) / 914400 - 0.2) * 0.92
    joined = " · ".join(parts)
    units = visual_units(joined)
    needed = units * (base.pt if base is not None else 16) / 72
    if allow_two_lines and len(parts) > 1 and width > 0.5 and needed > width:
        set_text_frame_text(shape, parts)
        size = min(base.pt if base is not None else 18, 18)
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(size)
    else:
        set_text_frame_text(shape, joined)
    fit_placeholder_text(shape)


def generate_presentation(template_path, content_json, output_path):
    prs = Presentation(template_path)
    clear_template_slides(prs)
    alias_map, canonical_map = get_layout_map(prs)

    title = content_json.get("title", "")
    subtitle = content_json.get("subtitle", "")
    date_str = content_json.get("date", "")
    author = content_json.get("author", "")
    slides_data = content_json.get("slides", [])

    # --- Cover slide ---
    if title:
        layout = get_layout_by_key(alias_map, canonical_map, "cover")
        if layout is None:
            layout = list(canonical_map.values())[0]
        slide = prs.slides.add_slide(layout)

        title_shape = find_shape_by_type_and_name(slide, ["TITLE"], ["标题", "title"])
        fill_cover_fields(slide, title_shape, title, subtitle, date_str, author)

        # Cover image (for templates with picture placeholders like SJTU-origin)
        cover_image = content_json.get("cover_image", "")
        if cover_image:
            fill_picture_placeholder(slide, cover_image)

    # --- Content slides ---
    for slide_def in slides_data:
        layout_key = slide_def.get("layout") or slide_def.get("type", "content")
        layout = get_layout_by_key(alias_map, canonical_map, layout_key)
        if layout is None:
            layout = list(canonical_map.values())[0]
        slide = prs.slides.add_slide(layout)

        s_title = slide_def.get("title", "")
        s_subtitle = slide_def.get("subtitle", "")
        s_content = slide_def.get("content", [])
        s_left = slide_def.get("left", [])
        s_right = slide_def.get("right", [])

        # Locate title placeholder (do NOT fill here — the layout-specific
        # branches below handle title filling to avoid duplicate writes).
        title_shape = find_shape_by_type_and_name(slide, ["TITLE"], ["标题", "title"])

        # 页面素材：模板里有 PICTURE 占位就放进去；没有就跳过并给 warning。
        s_image = slide_def.get("image", "")
        if s_image:
            fill_picture_placeholder(slide, s_image)

        # --- TOC layout (目录) ---
        if layout_kind(layout.name, "toc"):
            # TOC layouts: try placeholders first, then fallback to fixed positions
            toc_items = s_content if s_content else [s_title] if s_title else []
            if toc_items:
                fill_toc_slide(prs, slide, toc_items)
            continue

        # --- Section / Transition layout (过渡页) ---
        if layout_kind(layout.name, "section"):
            fill_section_or_end(slide, title_shape, s_title, s_subtitle)
            continue

        # --- End / Closing layout (封底) ---
        if layout_kind(layout.name, "end"):
            fill_section_or_end(slide, title_shape, s_title, s_subtitle)
            continue

        # --- Content layout (内页 / title_and_content) ---
        # Collect all BODY placeholders on this slide
        body_placeholders = []
        for shape in slide.shapes:
            if shape.has_text_frame and shape.is_placeholder:
                ph_type = str(shape.placeholder_format.type).lower()
                if "body" in ph_type or "object" in ph_type:
                    if shape != title_shape:
                        body_placeholders.append(shape)

        if title_shape and s_title:
            # Title placeholder exists: fill title there, first BODY for content
            set_text_frame_text(title_shape, s_title)
            if body_placeholders and s_content:
                set_text_frame_text(body_placeholders[0], s_content)
            elif body_placeholders and s_subtitle:
                set_text_frame_text(body_placeholders[0], s_subtitle)
        elif len(body_placeholders) >= 2 and not title_shape:
            # No title placeholder but multiple BODY placeholders:
            # first BODY acts as title area, second BODY as content area
            if s_title:
                set_text_frame_text(body_placeholders[0], s_title)
            if s_content:
                set_text_frame_text(body_placeholders[1], s_content)
            elif s_subtitle:
                set_text_frame_text(body_placeholders[1], s_subtitle)
        elif body_placeholders:
            # Single BODY fallback
            if s_content:
                set_text_frame_text(body_placeholders[0], s_content)
            elif s_subtitle:
                set_text_frame_text(body_placeholders[0], s_subtitle)
        else:
            # Ultimate fallback: any non-title text shape
            for shape in slide.shapes:
                if shape.has_text_frame and shape != title_shape:
                    if s_content:
                        set_text_frame_text(shape, s_content)
                    elif s_subtitle:
                        set_text_frame_text(shape, s_subtitle)
                    break

        # Two-column support (templates with named "左/右" placeholders)
        if s_left or s_right:
            left_shape = find_shape_by_type_and_name(
                slide, ["BODY", "OBJECT"], ["左", "left"], exclude=title_shape
            )
            right_shape = find_shape_by_type_and_name(
                slide, ["BODY", "OBJECT"], ["右", "right"], exclude=title_shape
            )
            # Only fill when the template actually has matching placeholders.
            # Otherwise we silently skip — filling into arbitrary shapes
            # would misposition content and risk NameError on undefined refs.
            if left_shape and s_left:
                set_text_frame_text(left_shape, s_left)
            if right_shape and s_right:
                set_text_frame_text(right_shape, s_right)

    # Configure page numbers (defaults: hidden on cover/end/section,
    # shown on content/toc; per-slide override via "page_numbers" field)
    page_numbers_enabled = content_json.get("page_numbers", True)
    configure_page_numbers(prs, slides_data, top_level_enabled=page_numbers_enabled)

    # An unfilled PICTURE placeholder renders its "Double-click to add an
    # image" prompt in viewers and PDF exports. Remove those prompts when the
    # content did not provide an image.
    def drop_picture_placeholders(shapes):
        for shape in list(shapes):
            try:
                if not shape.is_placeholder:
                    continue
                if "PICTURE" not in str(shape.placeholder_format.type).upper():
                    continue
                # A filled picture placeholder still reports itself as a
                # placeholder; only the empty prompt should be removed.
                if shape._element.findall(".//" + qn("a:blip")):
                    continue
                shape._element.getparent().remove(shape._element)
            except Exception:
                pass

    for slide in prs.slides:
        drop_picture_placeholders(slide.shapes)
    for layout in prs.slide_layouts:
        drop_picture_placeholders(layout.shapes)
    for master in prs.slide_masters:
        drop_picture_placeholders(master.shapes)

    prs.save(output_path)


def normalize_json_text(text):
    """Replace common CJK punctuation with ASCII equivalents to avoid JSON parse errors.

    Note: this normalizes the whole file, including punctuation inside
    user-facing strings. That trade-off is deliberate — hand-written JSON
    with fullwidth punctuation fails to parse at all, which is the worse
    outcome.
    """
    return text.translate(str.maketrans({
        '“': '"', '”': '"',  # Left/Right double quotation mark
        '‘': "'", '’': "'",  # Left/Right single quotation mark
        '：': ':', '；': ';',  # Fullwidth colon / semicolon
        '，': ',', '、': ',',  # Fullwidth comma / enumeration comma
        '（': '(', '）': ')',  # Fullwidth parentheses
        '《': '<', '》': '>',  # Left/Right double angle bracket
        '〈': '<', '〉': '>',  # Left/Right angle bracket
        '【': '[', '】': ']',  # Left/Right black lenticular bracket
        '［': '[', '］': ']',  # Fullwidth square brackets
        '｛': '{', '｝': '}',  # Fullwidth curly brackets
    }))


def main():
    parser = argparse.ArgumentParser(description="Generate PPTX from template and JSON content.")
    parser.add_argument("--template", required=False, default="",
                        help="Path to .pptx template. If omitted, built-in SJTU-basic template is used.")
    parser.add_argument("--content", required=True, help="Path to JSON file defining content.")
    parser.add_argument("--output", required=True, help="Path for the generated .pptx file.")
    parser.add_argument("--create-template", required=False, default="",
                        help="If provided, generate a basic template to this path and exit.")
    args = parser.parse_args()

    if args.create_template:
        path = create_basic_template(args.create_template)
        print(json.dumps({"status": "success", "template_path": path}, ensure_ascii=False))
        sys.exit(0)

    if not os.path.exists(args.content):
        print(json.dumps({"status": "error", "message": f"Content file not found: {args.content}"}, ensure_ascii=False))
        sys.exit(1)

    with open(args.content, "r", encoding="utf-8") as f:
        raw_text = f.read()

    # 先按原样解析：合法 JSON 里的中文引号、全角标点是正文，不能改。
    # 只有原样解析失败时，才用全角→半角兜底（兼容手写 JSON）。
    try:
        content_data = json.loads(raw_text)
    except json.JSONDecodeError:
        normalized_text = normalize_json_text(raw_text)
        try:
            content_data = json.loads(normalized_text)
        except json.JSONDecodeError as e:
            print(json.dumps({"status": "error", "message": f"Invalid JSON: {e}"}, ensure_ascii=False))
            sys.exit(1)

    template_path = args.template
    if not template_path or not os.path.exists(template_path):
        # Priority: SJTU-basic > SJTU-wine > SJTU-130
        skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        tpl_candidates = [
            os.path.join(skill_dir, "assets", "SJTU-basic.pptx"),
            os.path.join(skill_dir, "assets", "SJTU-wine.pptx"),
            os.path.join(skill_dir, "assets", "SJTU-130.pptx"),
        ]
        for cand in tpl_candidates:
            if os.path.exists(cand):
                template_path = cand
                break
        else:
            template_path = "/tmp/default-template.pptx"
            create_basic_template(template_path)

    try:
        generate_presentation(template_path, content_data, args.output)
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps({"status": "success", "output_path": os.path.abspath(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

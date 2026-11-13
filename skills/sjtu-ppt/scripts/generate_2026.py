"""Special generator for the SJTU-2026 deck.

The 2026 design is a finished 41-slide deck, not a clean 5-layout template.
The generic layout-based generator cannot fill its cover/toc/end slides, so
this module clones five prototype slides (cover/toc/section/content/end) and
replaces their text while keeping the original design and relationships.
"""

import copy
import re

from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.opc.constants import RELATIONSHIP_TYPE as RT

R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
TOC_TITLE = "添加目录项标题"
TOC_NUMBER = re.compile(r"^0[1-6]$")


def _shape_by_name(slide, name):
    for shape in slide.shapes:
        if shape.name == name:
            return shape
    return None


def _base_run(shape):
    if shape is None or not shape.has_text_frame:
        return None
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            return run._r
        fld = paragraph._p.find(qn("a:fld"))
        if fld is not None:
            return fld
    return None


def _apply_run_style(run_el, base_run):
    if base_run is None:
        return
    base_rpr = base_run.find(qn("a:rPr"))
    if base_rpr is None:
        return
    old = run_el.find(qn("a:rPr"))
    if old is not None:
        run_el.remove(old)
    run_el.insert(0, copy.deepcopy(base_rpr))


def set_text_preserve(shape, text):
    """Replace a shape's text while keeping the first run's font/colour."""
    if shape is None or not shape.has_text_frame:
        return
    text = "" if text is None else str(text)
    lines = text.replace("\v", "\n").split("\n")
    tf = shape.text_frame
    base_run = _base_run(shape)
    tf.clear()
    for index, line in enumerate(lines):
        paragraph = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
        paragraph.text = line
        for run in paragraph.runs:
            _apply_run_style(run._r, base_run)


def _clone_slide(prs, source):
    new = prs.slides.add_slide(source.slide_layout)
    for shape in list(new.shapes):
        shape._element.getparent().remove(shape._element)

    if source.element.cSld.bg is not None:
        new.element.cSld.bg = copy.deepcopy(source.element.cSld.bg)

    for shape in source.shapes:
        new.shapes._spTree.insert_element_before(copy.deepcopy(shape.element), "p:extLst")

    mapping = {}
    for r_id, rel in source.part.rels.items():
        if rel.reltype in (RT.NOTES_SLIDE, RT.SLIDE_LAYOUT):
            continue
        try:
            mapping[r_id] = new.part.rels.get_or_add(rel.reltype, rel._target)
        except Exception:
            continue

    for element in new.element.iter():
        for attr, value in list(element.attrib.items()):
            if attr.startswith("{" + R_NS + "}") and value in mapping:
                element.set(attr, mapping[value])
    return new


def _toc_pairs(slide):
    numbers = []
    titles = []
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        text = shape.text.strip()
        if TOC_NUMBER.match(text):
            numbers.append((int(text), shape))
        elif text == TOC_TITLE:
            titles.append(shape)

    pairs = []
    for number, number_shape in sorted(numbers, key=lambda item: item[0]):
        center = number_shape.top + number_shape.height / 2
        candidates = [
            title for title in titles
            if title.left >= number_shape.left
            and abs((title.top + title.height / 2) - center) < number_shape.height
        ]
        if candidates:
            title = min(candidates, key=lambda item: item.left)
            pairs.append((number, title, number_shape))
    return pairs


def _fill_body(shape, items):
    if shape is None or not shape.has_text_frame:
        return
    tf = shape.text_frame
    if not items:
        tf.clear()
        return
    def paragraph_base(level):
        for paragraph in tf.paragraphs:
            if paragraph.level == level:
                return copy.deepcopy(paragraph._p)
        return copy.deepcopy(tf.paragraphs[0]._p)

    base0 = paragraph_base(0)
    base1 = paragraph_base(1)
    for paragraph in list(tf._txBody.findall(qn("a:p"))):
        tf._txBody.remove(paragraph)

    for item in items:
        text = item.get("text", "") if isinstance(item, dict) else str(item)
        level = int(item.get("level", 0)) if isinstance(item, dict) else 0
        p_el = copy.deepcopy(base1 if level > 0 else base0)
        runs = p_el.findall(qn("a:r"))
        if runs:
            for extra in runs[1:]:
                p_el.remove(extra)
            t = runs[0].find(qn("a:t"))
            if t is None:
                t = p_el.makeelement(qn("a:t"), {})
                runs[0].append(t)
            t.text = text
        else:
            p_el.text = text
        tf._txBody.append(p_el)


def _remove_slides(prs, slide_ids):
    for sld_id in list(prs.slides._sldIdLst):
        if int(sld_id.id) in slide_ids:
            r_id = sld_id.get(qn("r:id"))
            prs.part.drop_rel(r_id)
            prs.slides._sldIdLst.remove(sld_id)


def generate_2026_presentation(template_path, content_json, output_path):
    prs = Presentation(template_path)
    originals = list(prs.slides)
    if len(originals) < 41:
        raise ValueError("SJTU-2026 template is missing prototype slides")
    cover = originals[0]
    toc = originals[1]
    section = originals[2]
    body = originals[5]
    end = originals[40]
    source_ids = {slide.slide_id for slide in originals}

    slides_data = content_json.get("slides", [])
    has_toc = any((s.get("layout") or s.get("type")) == "toc" for s in slides_data)
    has_end = any((s.get("layout") or s.get("type")) == "end" for s in slides_data)
    sequence = [("cover", cover)]
    if has_toc:
        sequence.append(("toc", toc))
    for slide_def in slides_data:
        layout = slide_def.get("layout") or slide_def.get("type") or "content"
        if layout == "section":
            sequence.append(("section", section))
        elif layout == "end":
            continue
        elif layout != "toc":
            sequence.append(("content", body))
    if has_end:
        sequence.append(("end", end))

    cloned = []
    for kind, source in sequence:
        cloned.append((kind, _clone_slide(prs, source)))
    _remove_slides(prs, source_ids)

    toc_items = next((s.get("content", []) for s in slides_data if (s.get("layout") or s.get("type")) == "toc"), [])
    if not toc_items:
        toc_items = [s.get("title", "") for s in slides_data if (s.get("layout") or s.get("type")) == "section"]
    toc_pairs = []
    section_slides = []
    content_slides = []
    for kind, slide in cloned:
        if kind == "toc":
            toc_pairs = _toc_pairs(slide)
        elif kind == "section":
            section_slides.append(slide)
        elif kind == "content":
            content_slides.append(slide)
        elif kind == "cover":
            set_text_preserve(_shape_by_name(slide, "标题 8"), content_json.get("title", ""))
            author = content_json.get("author", "") or "思源"
            set_text_preserve(_shape_by_name(slide, "文本占位符 9"), f"汇报人:{author}")
            set_text_preserve(_shape_by_name(slide, "内容占位符 2"), content_json.get("date", "") or "2026年11月")
        elif kind == "end":
            end_title = next((s.get("title") for s in reversed(slides_data) if (s.get("layout") or s.get("type")) == "end"), "")
            set_text_preserve(_shape_by_name(slide, "文本占位符 12"), end_title or "感谢您的关注！")

    # TOC: fill 01..06 in numeric order; remove unused rows.
    for index, (_, title_shape, number_shape) in enumerate(toc_pairs):
        if index < len(toc_items):
            item = toc_items[index]
            set_text_preserve(title_shape, item.get("text", "") if isinstance(item, dict) else str(item))
        else:
            for shape in (title_shape, number_shape):
                if shape is not None:
                    shape._element.getparent().remove(shape._element)

    section_data = [s for s in slides_data if (s.get("layout") or s.get("type")) == "section"]
    for index, slide in enumerate(section_slides):
        data = section_data[index] if index < len(section_data) else {}
        set_text_preserve(_shape_by_name(slide, "标题 1"), data.get("title", ""))
        set_text_preserve(_shape_by_name(slide, "矩形 3"), f"{index + 1:02d}")

    content_data = [s for s in slides_data if (s.get("layout") or s.get("type")) not in ("toc", "section", "end")]
    for index, slide in enumerate(content_slides):
        data = content_data[index] if index < len(content_data) else {}
        set_text_preserve(_shape_by_name(slide, "文本占位符 3"), data.get("title", ""))
        items = data.get("content", [])
        if not items:
            items = list(data.get("left", [])) + list(data.get("right", []))
        _fill_body(_shape_by_name(slide, "内容占位符 2"), items)

    prs.save(output_path)
    return output_path

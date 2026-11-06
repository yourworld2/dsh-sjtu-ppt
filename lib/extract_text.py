#!/usr/bin/env python3
"""把 docx / pptx / xlsx 里的文字抽出来，给「交大演示」的材料台用。

用法：python3 extract_text.py <文件路径>
输出：一行 JSON {"ok": true, "text": "..."} 或 {"ok": false, "error": "..."}
"""
import json
import sys


def read_docx(path):
    from docx import Document

    doc = Document(path)
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append("\t".join(cells))
    return "\n".join(parts)


def read_pptx(path):
    from pptx import Presentation

    prs = Presentation(path)
    out = []
    for index, slide in enumerate(prs.slides, 1):
        out.append(f"--- 第 {index} 页 ---")
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    out.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        out.append("\t".join(cells))
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                out.append(f"备注：{notes}")
    return "\n".join(out)


def read_xlsx(path):
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"--- {ws.title} ---")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None and str(c).strip()]
            if cells:
                out.append("\t".join(cells))
    wb.close()
    return "\n".join(out)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "缺少文件路径"}, ensure_ascii=False))
        return
    path = sys.argv[1]
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    try:
        if ext == "docx":
            text = read_docx(path)
        elif ext == "pptx":
            text = read_pptx(path)
        elif ext == "xlsx":
            text = read_xlsx(path)
        else:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        print(json.dumps({"ok": True, "text": text[:2_000_000]}, ensure_ascii=False))
    except Exception as error:  # noqa: BLE001 - 把原因原样交给 Node 侧展示
        print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()

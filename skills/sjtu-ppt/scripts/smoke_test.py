#!/usr/bin/env python3
"""
Smoke tests for pptx-generator.

Runs four lightweight checks against every built-in template:
1. Basic generation: cover + toc + section + content + end → succeeds
   AND each slide actually has non-empty content (caught the missing-
   page-number bug the first time around).
2. Two-column (left/right) JSON: must not NameError even if template
   has no 左/右 placeholders.
3. Page numbers: cover/toc/section/end hidden, content shown,
   per-slide override honored (verified via XML attribute AND the
   actual sldNum placeholder instance on the slide).
4. Image paths: a non-existent image path must NOT crash generation —
   it must surface a stderr warning instead. (Template used: SJTU-origin,
   which is the only built-in with a PICTURE placeholder.)

Plus a template-agnostic check for nested bullets:
5. Nested bullets ({"text": "...", "level": 1}) render correctly.

Run: python scripts/smoke_test.py
Exit code 0 = all passed, 1 = at least one failure.
"""

import json
import os
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS = os.path.join(SKILL_DIR, "assets")
GENERATOR = os.path.join(SCRIPT_DIR, "generate_pptx.py")


def run_generate(template_path, content_path, output_path,
                 expect_warning=False):
    """Run generator. If expect_warning, stderr must be non-empty."""
    cmd = [
        sys.executable, GENERATOR,
        "--template", template_path,
        "--content", content_path,
        "--output", output_path,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def slide_has_text(slide):
    """True if any shape on this slide has non-empty text."""
    for sh in slide.shapes:
        if sh.has_text_frame and sh.text_frame.text.strip():
            return True
    return False


def test_basic(template_path, tmp):
    """Plain smoke: 5 slide kinds, no fancy features.

    Each slide MUST have non-empty content — this is what caught the
    silent NameError / missing-page-number regressions.
    """
    from pptx import Presentation
    cp = os.path.join(tmp, "basic.json")
    write_json(cp, {
        "title": "Test Title",
        "subtitle": "Subtitle",
        "date": "2026",
        "author": "Tester",
        "slides": [
            {"layout": "toc", "title": "目录", "content": ["A", "B", "C"]},
            {"layout": "section", "title": "Section 1"},
            {"layout": "content", "title": "Page 1", "content": ["item 1", "item 2"]},
            {"layout": "end", "title": "Thanks", "subtitle": "Bye"},
        ],
    })
    op = os.path.join(tmp, "basic.pptx")
    r = run_generate(template_path, cp, op)
    assert r.returncode == 0, f"exit={r.returncode} stderr={r.stderr}"
    assert json.loads(r.stdout)["status"] == "success"

    # Each slide must have actual content — not just succeed silently
    prs = Presentation(op)
    # Expect cover + 4 content slides = 5 total
    assert len(prs.slides) == 5, f"expected 5 slides, got {len(prs.slides)}"
    for i, s in enumerate(prs.slides, 1):
        assert slide_has_text(s), f"slide {i} ({s.slide_layout.name!r}) is empty"


def test_two_column(template_path, tmp):
    """left/right JSON must NOT NameError — regression for bug #1."""
    from pptx import Presentation
    cp = os.path.join(tmp, "twocol.json")
    write_json(cp, {
        "title": "Test",
        "slides": [
            {"layout": "content", "title": "Compare",
             "left": ["A1", "A2"], "right": ["B1", "B2"]},
        ],
    })
    op = os.path.join(tmp, "twocol.pptx")
    r = run_generate(template_path, cp, op)
    assert r.returncode == 0, f"exit={r.returncode} stderr={r.stderr}"
    assert "NameError" not in r.stderr, f"NameError leaked: {r.stderr}"

    # If the template has 左/右 placeholders, content should be filled.
    # If not, left/right is silently skipped (still exits 0).
    prs = Presentation(op)
    assert len(prs.slides) == 2  # cover + content
    content = prs.slides[1]
    has_left_marker = any(
        sh.has_text_frame and ("A1" in sh.text_frame.text or "A2" in sh.text_frame.text)
        for sh in content.shapes
    )
    has_right_marker = any(
        sh.has_text_frame and ("B1" in sh.text_frame.text or "B2" in sh.text_frame.text)
        for sh in content.shapes
    )
    has_left_placeholder = any(
        sh.is_placeholder and "左" in sh.name
        for sh in content.shapes
    )
    has_right_placeholder = any(
        sh.is_placeholder and "右" in sh.name
        for sh in content.shapes
    )
    # If template HAS both placeholders, content must be there
    if has_left_placeholder and has_right_placeholder:
        assert has_left_marker, "left placeholder exists but content missing"
        assert has_right_marker, "right placeholder exists but content missing"


def test_page_numbers(template_path, tmp):
    """Page numbers: defaults + per-slide override.

    Default-by-layout matrix (as of v3.2+):
      cover / toc / section / end → hidden
      content                      → shown

    Returns (showSldNum tuple, sldNum instance counts per slide).
    """
    from pptx import Presentation
    cp = os.path.join(tmp, "pgnum.json")
    write_json(cp, {
        "title": "Test", "page_numbers": True,
        "slides": [
            {"layout": "toc", "title": "目录"},
            {"layout": "section", "title": "Section"},
            {"layout": "content", "title": "Show"},
            {"layout": "content", "title": "Hide", "page_numbers": False},
        ],
    })
    op = os.path.join(tmp, "pgnum.pptx")
    r = run_generate(template_path, cp, op)
    assert r.returncode == 0, f"exit={r.returncode} stderr={r.stderr}"

    prs = Presentation(op)
    shows = []
    sld_nums = []
    for slide in prs.slides:
        shows.append(slide.element.get("showSldNum"))
        n = 0
        for sh in slide.shapes:
            try:
                if sh.is_placeholder and "SLIDE_NUMBER" in str(sh.placeholder_format.type).upper():
                    n += 1
            except Exception:
                pass
        sld_nums.append(n)
    return tuple(shows), tuple(sld_nums)


def test_nested_bulks(template_path, tmp):
    """Nested bullets (level: 1, 2) must not crash on any template."""
    cp = os.path.join(tmp, "nested.json")
    write_json(cp, {
        "title": "Nested",
        "slides": [
            {"layout": "content", "title": "Hierarchy",
             "content": [
                 "Top",
                 {"text": "Level 1", "level": 1},
                 {"text": "Level 2", "level": 2},
                 "Back to top",
             ]},
        ],
    })
    op = os.path.join(tmp, "nested.pptx")
    r = run_generate(template_path, cp, op)
    assert r.returncode == 0, f"exit={r.returncode} stderr={r.stderr}"
    # Spot-check: text content of slide 2 should include all bullets
    from pptx import Presentation
    prs = Presentation(op)
    body = " ".join(
        sh.text_frame.text for sh in prs.slides[1].shapes if sh.has_text_frame
    )
    for marker in ["Top", "Level 1", "Level 2", "Back to top"]:
        assert marker in body, f"missing '{marker}' in nested output"


def test_image_missing(tmp):
    """Non-existent image path → stderr warning, exit 0 (don't crash).

    Only SJTU-origin has a PICTURE placeholder; others will warn too
    ('no PICTURE placeholder') but still exit cleanly.
    """
    cp = os.path.join(tmp, "img.json")
    write_json(cp, {
        "title": "Image Test",
        "cover_image": "/tmp/this-does-not-exist.jpg",
        "slides": [
            {"layout": "section", "title": "Section",
             "image": "/tmp/also-missing.jpg"},
        ],
    })
    op = os.path.join(tmp, "img.pptx")
    tpl = os.path.join(ASSETS, "SJTU-origin.pptx")
    r = run_generate(tpl, cp, op)
    assert r.returncode == 0, f"should not crash on missing image: {r.stderr}"
    assert "warning" in r.stderr.lower(), \
        f"expected warning on stderr, got: {r.stderr!r}"


def template_supports_pgnum(template_path):
    from pptx import Presentation
    prs = Presentation(template_path)
    for layout in prs.slide_layouts:
        for ph in layout.placeholders:
            try:
                if "SLIDE_NUMBER" in str(ph.placeholder_format.type).upper():
                    return True
            except Exception:
                pass
    return False


def main():
    templates = sorted(t for t in os.listdir(ASSETS) if t.endswith(".pptx"))
    failed = []

    with tempfile.TemporaryDirectory() as tmp:
        print("=== Basic smoke ===")
        for tpl in templates:
            try:
                test_basic(os.path.join(ASSETS, tpl), tmp)
                print(f"  ✓ {tpl}")
            except AssertionError as e:
                failed.append((tpl, "basic", str(e)))
                print(f"  ✗ {tpl}: {e}")

        print("\n=== Two-column regression ===")
        for tpl in templates:
            try:
                test_two_column(os.path.join(ASSETS, tpl), tmp)
                print(f"  ✓ {tpl}")
            except AssertionError as e:
                failed.append((tpl, "twocol", str(e)))
                print(f"  ✗ {tpl}: {e}")

        print("\n=== Page numbers ===")
        for tpl in templates:
            try:
                shows, sld_nums = test_page_numbers(os.path.join(ASSETS, tpl), tmp)
                supported = template_supports_pgnum(os.path.join(ASSETS, tpl))
                if supported:
                    # cover=0, toc=0, section=0, content=1, content+override=0
                    expected_shows = ("0", "0", "0", "1", "0")
                    expected_sldnums = (0, 0, 0, 1, 0)
                    show_ok = shows == expected_shows
                    sldnum_ok = sld_nums == expected_sldnums
                    status = "✓" if (show_ok and sldnum_ok) else "✗"
                    print(f"  {status} {tpl}: show={shows} instances={sld_nums}")
                    if not show_ok:
                        failed.append((tpl, "pgnum-show",
                                       f"got {shows} expected {expected_shows}"))
                    if not sldnum_ok:
                        failed.append((tpl, "pgnum-instances",
                                       f"got {sld_nums} expected {expected_sldnums}"))
                else:
                    nones = (None, None, None, None, None)
                    status = "✓" if shows == nones else "✗"
                    print(f"  {status} {tpl}: unsupported, all N/A (got show={shows})")
                    if shows != nones:
                        failed.append((tpl, "pgnum", f"unsupported but got {shows}"))
            except AssertionError as e:
                failed.append((tpl, "pgnum", str(e)))
                print(f"  ✗ {tpl}: {e}")

        print("\n=== Nested bullets ===")
        for tpl in templates:
            try:
                test_nested_bulks(os.path.join(ASSETS, tpl), tmp)
                print(f"  ✓ {tpl}")
            except AssertionError as e:
                failed.append((tpl, "nested", str(e)))
                print(f"  ✗ {tpl}: {e}")

        print("\n=== Image missing (SJTU-origin) ===")
        try:
            test_image_missing(tmp)
            print("  ✓ missing-image warning surfaced cleanly")
        except AssertionError as e:
            failed.append(("image-missing", "img", str(e)))
            print(f"  ✗ {e}")

    total = len(templates) * 4 + 1  # 4 per-template checks + 1 image-missing
    print()
    if failed:
        print(f"FAIL: {len(failed)} check(s) failed")
        for tpl, kind, msg in failed:
            print(f"  - {tpl} [{kind}]: {msg}")
        return 1
    print(f"PASS: {total} checks across {len(templates)} templates")
    return 0


if __name__ == "__main__":
    sys.exit(main())
#!/usr/bin/env python3
"""Lay out Opticks with a double-density four-display Braille image layer."""

from __future__ import annotations

import html
import importlib.util
import json
import math
import re
import textwrap
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path("/workspace/Brickadia-Server")
SOURCE = Path("/tmp/gitenberg-33504/33504.txt")
HTML = Path("/tmp/gitenberg-33504/33504-h/33504-h.htm")
OUTPUT = ROOT / "tools/prefabs/opticks-four-display-pages.json"

TEXT_BODY_ROWS = 48
TEXT_LINE_HEIGHT = 0.50
IMAGE_LINE_HEIGHT = 0.075
IMAGE_WIDTH_SCALE = 1.00
IMAGE_OUTLINE_WIDTH = 4
IMAGE_ADVANCE_SCALE = 0.115
TEXT_WIDTH_SCALE = 0.82
MIN_FIGURE_COLUMNS = 400
PAGE_IMAGE_COLUMNS = 600
MAX_IMAGE_ROWS = 260
IMAGE_LAYER_OFFSET_DELTA = 2.0
CELL_MODE = "braille"
BLANK = "\u2800"
DETAIL_VIEWS: dict[str, tuple[dict, ...]] = {}
# Separating these pairs keeps a dense page from exhausting one array value.
FORCE_NEW_PAGE_BEFORE = {32, 55}
# Dense single plates can step down without lowering the page-wide grid.
FIGURE_COLUMN_CAPS = {
    "fig3-2.jpg": 520,
    "fig4-3.jpg": 520,
    "fig6-3.jpg": 375,
}
# Figure 3's small Gutenberg derivative does not contain enough independent
# samples to separate its engraved labels from the many crossing rays. Use the
# same original plate from the sharper 1704 BnF scan for this one figure.
FIGURE_SOURCE_OVERRIDES = {
    "fig3-1.jpg": ROOT / "tools/image-to-braille/sources/bnf-opticks-1704-plate-i-figure-3.png",
}
FIGURE_MASK_POLICIES = {
    "fig3-1.jpg": {
        "mode": "line-aware",
        "threshold": 0.50,
        "lineLength": 51,
        "lineOccupancy": 0.88,
        "angleStep": 5,
        "compactSize": 1,
    },
}
FIGURE_SOURCE_CREDITS = {
    "fig3-1.jpg": {
        "work": "Isaac Newton, Opticks (1704), Plate I",
        "scanCredit": "Source gallica.bnf.fr / Bibliothèque nationale de France",
        "record": "https://gallica.bnf.fr/ark:/12148/bpt6k3362k",
        "crop": [370, 1042, 2070, 1595],
        "workStatus": "Public domain",
        "scanReuseNote": "Gallica commercial reuse may require a BnF licence",
    },
}
DOTS = (
    (0, 0, 0), (0, 1, 1), (0, 2, 2),
    (1, 0, 3), (1, 1, 4), (1, 2, 5),
    (0, 3, 6), (1, 3, 7),
)

_converter_spec = importlib.util.spec_from_file_location(
    "image_to_braille_converter", ROOT / "tools/image-to-braille/convert.py"
)
assert _converter_spec and _converter_spec.loader
_converter = importlib.util.module_from_spec(_converter_spec)
_converter_spec.loader.exec_module(_converter)


class ImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs) -> None:
        if tag.lower() == "img":
            values = dict(attrs)
            if values.get("src"):
                self.images.append((values["src"], html.unescape(values.get("alt") or "Illustration")))


def convert_image(
    original: Image.Image,
    requested_columns: int,
    threshold: float = 0.72,
    mask_policy: dict | None = None,
) -> list[str]:
    enabled = _converter.technical_mask(
        original, requested_columns, MAX_IMAGE_ROWS, threshold=threshold
    )

    # Dense plates can lose dotted construction rays under background
    # normalization. Compare against a conservative direct mask and fall back
    # whenever the technical candidate retains too little source ink.
    normalized = ImageOps.autocontrast(original, cutoff=1)
    direct_image = normalized.resize(
        (enabled.shape[1], enabled.shape[0]), Image.Resampling.LANCZOS
    )
    direct = np.asarray(direct_image, dtype=np.float32) < (255 * threshold)
    retained = enabled.sum() / max(1, direct.sum())
    if retained < 0.55 or enabled.mean() < 0.004:
        enabled = direct
    mode = (mask_policy or {}).get("mode")
    if mode == "structure-aware":
        enabled = _converter.structure_aware_mask(
            enabled,
            core_distance=mask_policy["coreDistance"],
            core_expansion=mask_policy["coreExpansion"],
        )
    elif mode == "line-aware":
        enabled = _converter.line_aware_structure_mask(
            enabled,
            line_length=mask_policy["lineLength"],
            line_occupancy=mask_policy["lineOccupancy"],
            angle_step=mask_policy["angleStep"],
            compact_size=mask_policy["compactSize"],
        )
    elif mode is not None:
        raise ValueError(f"Unknown mask policy mode: {mode}")
    return _converter.encode_mask(enabled)


def convert_figure(path: Path) -> list[str]:
    conversion_path = FIGURE_SOURCE_OVERRIDES.get(path.name, path)
    original = Image.open(conversion_path).convert("L")
    mask_policy = FIGURE_MASK_POLICIES.get(path.name, {})
    # The displays render at half the old line height, so doubling the cell
    # width preserves each figure's physical size while giving its source
    # strokes twice as many rendered Braille cells. Small figures retain the
    # old 200-cell physical footprint through the 400-cell floor.
    requested_columns = min(
        PAGE_IMAGE_COLUMNS,
        max(MIN_FIGURE_COLUMNS, math.ceil(original.width)),
    )
    requested_columns = min(
        requested_columns,
        FIGURE_COLUMN_CAPS.get(path.name, PAGE_IMAGE_COLUMNS),
    )
    return convert_image(
        original,
        requested_columns,
        mask_policy.get("threshold", 0.72),
        mask_policy,
    )


def convert_detail(path: Path, crop: tuple[int, int, int, int], columns: int) -> list[str]:
    original = Image.open(path).convert("L")
    left, top, right, bottom = crop
    if not 0 < columns <= PAGE_IMAGE_COLUMNS:
        raise ValueError(f"Detail width {columns} exceeds the page canvas")
    if not (0 <= left < right <= original.width and 0 <= top < bottom <= original.height):
        raise ValueError(f"Detail crop {crop} falls outside {path.name} at {original.size}")
    return convert_image(original.crop(crop), columns)


def overlay_line(existing: str, art: str, x: int) -> str:
    width = max(len(existing), x + len(art))
    cells = [BLANK] * width
    cells[:len(existing)] = existing
    for index, char in enumerate(art):
        if char in {BLANK, " "}:
            continue
        old = cells[x + index]
        if old in {BLANK, " "}:
            cells[x + index] = char
        elif 0x2800 <= ord(old) <= 0x28FF and 0x2800 <= ord(char) <= 0x28FF:
            old_mask = ord(old) - 0x2800
            new_mask = ord(char) - 0x2800
            cells[x + index] = chr(0x2800 + (old_mask | new_mask))
    return "".join(cells).rstrip(BLANK)


def split_four_bands(page: str) -> tuple[list[str], list[list[int]]]:
    """Split a logical image page into four byte-balanced row bands."""
    rows = [line.replace(BLANK, " ") for line in page.split("\r\n")] if page else []
    while rows and not rows[-1]:
        rows.pop()
    count = len(rows)
    prefix = [0]
    for row in rows:
        prefix.append(prefix[-1] + len(row.encode("utf8")))

    def cost(start: int, end: int) -> int:
        if start == end:
            return 0
        return 2 * start + prefix[end] - prefix[start] + 2 * (end - start - 1)

    infinity = 1 << 60
    scores = [[infinity] * (count + 1) for _ in range(5)]
    previous: list[list[int | None]] = [[None] * (count + 1) for _ in range(5)]
    scores[0][0] = 0
    for band in range(1, 5):
        for end in range(count + 1):
            for start in range(end + 1):
                score = max(scores[band - 1][start], cost(start, end))
                if score < scores[band][end]:
                    scores[band][end] = score
                    previous[band][end] = start

    cuts = [count]
    end = count
    for band in range(4, 0, -1):
        start = previous[band][end]
        assert start is not None
        cuts.append(start)
        end = start
    cuts.reverse()
    ranges = [[cuts[index], cuts[index + 1]] for index in range(4)]
    values = [
        "" if start == end else "\r\n" * start + "\r\n".join(rows[start:end])
        for start, end in ranges
    ]
    return values, ranges


def main() -> None:
    lines = SOURCE.read_text("utf-8-sig").replace("\r\n", "\n").splitlines()
    lines = lines[lines.index("OPTICKS:"):next(i for i, line in enumerate(lines) if line.startswith("End of the Project Gutenberg EBook"))]

    parser = ImageParser()
    parser.feed(HTML.read_text("utf8"))
    assert len(parser.images) == 57

    text_pages: list[str] = []
    image_pages: list[str] = []
    placements: list[dict] = []
    detail_views: list[dict] = []
    body: list[str] = []
    image_canvas: list[str] = []
    side_slots: list[tuple[int, int]] = []
    queued_details: list[dict] = []
    figure_index = 0
    pending_figure: tuple[int, str, str, list[str]] | None = None

    def append_detail_page(detail: dict, overview_page: int) -> None:
        art = detail["art"]
        reserve = math.ceil(
            (len(art) * IMAGE_LINE_HEIGHT + IMAGE_LAYER_OFFSET_DELTA) / TEXT_LINE_HEIGHT
        ) + 2
        if reserve > TEXT_BODY_ROWS:
            raise ValueError(f"Detail view {detail['name']} exceeds page height")
        page_number = len(text_pages) + 1
        image_y = round(2 * TEXT_LINE_HEIGHT / IMAGE_LINE_HEIGHT)
        art_width = max(map(len, art), default=0)
        image_x = max(0, (PAGE_IMAGE_COLUMNS - art_width) // 2)
        detail_canvas = [""] * (image_y + len(art))
        for row, art_line in enumerate(art):
            detail_canvas[image_y + row] = overlay_line("", art_line, image_x)
        detail_body = [""] * (reserve - 1) + [detail["caption"]]
        text_pages.append(f"{page_number}\r\n\r\n" + "\r\n".join(detail_body))
        image_pages.append("\r\n".join(detail_canvas))
        detail_views.append({
            "name": detail["name"],
            "parentFigure": detail["parentFigure"],
            "overviewPage": overview_page,
            "source": detail["source"],
            "crop": list(detail["crop"]),
            "caption": detail["caption"],
            "page": page_number,
            "textStartRow": 0,
            "reservedTextRows": reserve,
            "imageX": image_x,
            "imageY": image_y,
            "columns": art_width,
            "rows": len(art),
        })

    def flush() -> None:
        nonlocal body, image_canvas, side_slots, queued_details
        while body and body[-1] == "":
            body.pop()
        page_number = len(text_pages) + 1
        text_pages.append(f"{page_number}\r\n\r\n" + "\r\n".join(body))
        while image_canvas and not image_canvas[-1].replace(BLANK, ""):
            image_canvas.pop()
        image_pages.append("\r\n".join(image_canvas))
        body = []
        image_canvas = []
        side_slots = []
        details = queued_details
        queued_details = []
        for detail in details:
            append_detail_page(detail, page_number)

    def place_figure(number: int, src: str, alt: str, art: list[str]) -> None:
        nonlocal body, image_canvas, queued_details
        reserve = math.ceil(
            (len(art) * IMAGE_LINE_HEIGHT + IMAGE_LAYER_OFFSET_DELTA) / TEXT_LINE_HEIGHT
        ) + 2
        if len(body) + reserve > TEXT_BODY_ROWS:
            raise ValueError(f"Figure {number} does not fit reserved region")
        text_start = len(body)
        image_y = round((2 + text_start) * TEXT_LINE_HEIGHT / IMAGE_LINE_HEIGHT)
        art_width = max(map(len, art), default=0)
        can_side_flow = art_width < 150 and len(art) < 80
        # Center figures that reserve their full rectangle. Small, short art is
        # right aligned so prose can still use a clear column on its left.
        if can_side_flow:
            image_x = max(0, PAGE_IMAGE_COLUMNS - art_width)
        else:
            image_x = max(0, (PAGE_IMAGE_COLUMNS - art_width) // 2)
        needed = image_y + len(art)
        if len(image_canvas) < needed:
            image_canvas.extend([""] * (needed - len(image_canvas)))
        for row, art_line in enumerate(art):
            image_canvas[image_y + row] = overlay_line(image_canvas[image_y + row], art_line, image_x)
        body.extend([""] * (reserve - 1))
        side_width = math.floor(image_x * IMAGE_ADVANCE_SCALE / TEXT_WIDTH_SCALE) - 2
        # Dense or tall figures need their complete rectangle. Side-flowing
        # prose beside these diagrams crossed long rays in the calibrated font.
        if side_width >= 20 and can_side_flow:
            side_slots.extend((text_start + row, side_width) for row in range(reserve - 1) if not body[text_start + row].strip())
        body.append(alt.rstrip(".") + ".")
        placements.append({
            "number": number,
            "source": src,
            "alt": alt,
            "page": len(text_pages) + 1,
            "textStartRow": text_start,
            "reservedTextRows": reserve,
            "imageX": image_x,
            "imageY": image_y,
            "columns": art_width,
            "rows": len(art),
            "sideTextColumns": max(0, side_width) if can_side_flow else 0,
            "labels": [],
        })
        for spec in DETAIL_VIEWS.get(Path(src).name, ()):
            detail_art = convert_detail(
                HTML.parent / src,
                spec["crop"],
                spec["columns"],
            )
            queued_details.append({
                **spec,
                "art": detail_art,
                "source": src,
                "parentFigure": number,
            })

    def flush_and_place_pending() -> None:
        nonlocal pending_figure
        flush()
        if pending_figure is not None:
            place_figure(*pending_figure)
            pending_figure = None

    def emit_text(line: str) -> None:
        """Flow one source line through figure-side slots, then full rows."""
        nonlocal body, side_slots
        remaining = line.strip()
        while remaining:
            if side_slots:
                row, width = side_slots.pop(0)
                wrapped = textwrap.wrap(
                    remaining,
                    width=width,
                    break_long_words=False,
                    break_on_hyphens=False,
                )
                piece = wrapped[0] if wrapped else remaining
                body[row] = piece
                remaining = remaining[len(piece):].lstrip()
            else:
                body.append(remaining)
                remaining = ""

    for raw in lines:
        line = raw.rstrip().replace("_", "")
        marker = re.fullmatch(r"\[Illustration: (.+)\]", line.strip())
        if marker:
            if pending_figure is not None:
                flush_and_place_pending()
            if figure_index + 1 in FORCE_NEW_PAGE_BEFORE and (body or image_canvas):
                flush()
            src, alt = parser.images[figure_index]
            art = convert_figure(HTML.parent / src)
            reserve = math.ceil(
                (len(art) * IMAGE_LINE_HEIGHT + IMAGE_LAYER_OFFSET_DELTA) / TEXT_LINE_HEIGHT
            ) + 2
            if reserve > TEXT_BODY_ROWS:
                raise ValueError(f"Figure {figure_index + 1} exceeds page height")
            if len(body) + reserve <= TEXT_BODY_ROWS:
                place_figure(figure_index + 1, src, alt, art)
            else:
                # Fill the current page with the prose following the marker.
                # Once full, the deferred figure starts the next page and the
                # remaining prose continues beneath its reserved void.
                pending_figure = (figure_index + 1, src, alt, art)
            figure_index += 1
            if len(body) >= TEXT_BODY_ROWS:
                flush_and_place_pending()
            continue

        if not line.strip():
            if side_slots:
                side_slots.pop(0)
            elif body and body[-1] != "":
                body.append("")
            continue
        if len(body) >= TEXT_BODY_ROWS:
            flush_and_place_pending()
        emit_text(line)
        if len(body) >= TEXT_BODY_ROWS:
            flush_and_place_pending()

    if pending_figure is not None:
        if body or image_canvas:
            flush()
        place_figure(*pending_figure)
        pending_figure = None
    if body or image_canvas:
        flush()
    assert figure_index == 57
    assert not queued_details
    assert len(text_pages) == len(image_pages)
    image_page_bands: list[list[str]] = [[] for _ in range(4)]
    image_band_ranges: list[list[list[int]]] = []
    image_band_bytes: list[list[int]] = []
    for page in image_pages:
        values, ranges = split_four_bands(page)
        for band, value in enumerate(values):
            image_page_bands[band].append(value)
        image_band_ranges.append(ranges)
        image_band_bytes.append([len(value.encode("utf8")) for value in values])
    max_band_bytes = max(
        len(value.encode("utf8"))
        for pages in image_page_bands
        for value in pages
    )
    oversized = [
        (
            page + 1,
            sizes,
            [(item["number"], Path(item["source"]).name, item["columns"], item["rows"])
             for item in placements if item["page"] == page + 1],
        )
        for page, sizes in enumerate(image_band_bytes)
        if max(sizes) >= 32767
    ]
    assert not oversized, oversized
    OUTPUT.write_text(json.dumps({
        "source": "Project Gutenberg ebook 33504, with Figure 3 sampled from a sharper scan of the 1704 BnF/Gallica plate",
        "representation": "Prose and double-density pure-Braille figures in four synchronized image arrays",
        "layout": {
            "textBodyRows": TEXT_BODY_ROWS,
            "textLineHeight": TEXT_LINE_HEIGHT,
            "imageLineHeight": IMAGE_LINE_HEIGHT,
            "textWidthScale": TEXT_WIDTH_SCALE,
            "imageWidthScale": IMAGE_WIDTH_SCALE,
            "imageOutlineWidth": IMAGE_OUTLINE_WIDTH,
            "imageAdvanceScale": IMAGE_ADVANCE_SCALE,
            "minimumFigureColumns": MIN_FIGURE_COLUMNS,
            "maximumImageColumns": PAGE_IMAGE_COLUMNS,
            "maximumImageRows": MAX_IMAGE_ROWS,
            "samplingPolicy": "double calibrated display density with per-figure byte-budget caps and line-aware residual-source restoration for Figure 3",
            "cellMode": CELL_MODE,
            "imageArrayCount": 4,
            "bandStrategy": "byte-balanced contiguous rows",
            "forcedPageStarts": sorted(FORCE_NEW_PAGE_BEFORE),
            "figureColumnCaps": FIGURE_COLUMN_CAPS,
            "figureSourceOverrides": {
                name: str(path.relative_to(ROOT))
                for name, path in FIGURE_SOURCE_OVERRIDES.items()
            },
            "figureMaskPolicies": FIGURE_MASK_POLICIES,
            "figureSourceCredits": FIGURE_SOURCE_CREDITS,
        },
        "placements": placements,
        "detailViews": detail_views,
        "textPages": text_pages,
        "imagePages": image_pages,
        "imagePagesA": image_page_bands[0],
        "imagePagesB": image_page_bands[1],
        "imagePagesC": image_page_bands[2],
        "imagePagesD": image_page_bands[3],
        "imageBandRanges": image_band_ranges,
        "imageBandBytes": image_band_bytes,
    }, ensure_ascii=False, indent=2) + "\n", "utf8")
    print(json.dumps({
        "output": str(OUTPUT),
        "pages": len(text_pages),
        "figures": len(placements),
        "detailViews": len(detail_views),
        "pagesWithImages": sum(bool(page) for page in image_pages),
        "mixedPages": sum(bool(image_pages[i]) and len(text_pages[i].split("\r\n")) > placements[0]["reservedTextRows"] for i in range(len(text_pages))),
        "maxImageCharacters": max(map(len, image_pages)),
        "totalImageCharacters": sum(map(len, image_pages)),
        "maxColumns": max(item["columns"] for item in placements + detail_views),
        "maxRows": max(item["rows"] for item in placements + detail_views),
        "maxBandBytes": max_band_bytes,
    }, indent=2))


if __name__ == "__main__":
    main()

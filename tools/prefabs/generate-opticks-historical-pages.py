#!/usr/bin/env python3
"""Generate Opticks pages that follow the printed 1730 pagination.

The approved v28 layout deliberately repaginates the transcription for the
game leaf. This separate dataset treats Project Gutenberg's embedded Page_1
through Page_406 anchors as authoritative. Entry zero is a blank left leaf so
printed page 1 opens on the right.
"""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import importlib.util
import json
import math
from pathlib import Path
import re
import textwrap


ROOT = Path(__file__).resolve().parents[2]
SOURCE_HTML = ROOT / "tools/image-to-braille/sources/gutenberg-33504/33504-h/33504-h.htm"
DEFAULT_OUTPUT = ROOT / "tools/prefabs/opticks-four-display-pages-v29-historical.json"
BASE_PATH = ROOT / "tools/prefabs/generate-opticks-four-display-pages.py"
ORIGINAL_FIRST_PAGE = 1
ORIGINAL_LAST_PAGE = 406
MISSING_PRINTED_PAGES = (112, 192, 316)
# Printed page 117 contains two dense full-width diagrams. A small uniform
# reduction keeps their shared four-band payload below Brickadia's per-string
# limit while preserving their source page and relative scale.
PAGE_SCALE_CAPS = {117: 0.92}
TEXT_COLUMNS = 78
BLANK = "\u2800"


_base_spec = importlib.util.spec_from_file_location(
    "opticks_four_display_generator", BASE_PATH
)
assert _base_spec and _base_spec.loader
base = importlib.util.module_from_spec(_base_spec)
_base_spec.loader.exec_module(base)


def attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    return {name.lower(): value or "" for name, value in attrs}


class HistoricalParser(HTMLParser):
    """Collect text and figure events between the original page anchors."""

    BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pages: dict[int, list[dict]] = {
            page: [] for page in range(ORIGINAL_FIRST_PAGE, ORIGINAL_LAST_PAGE + 1)
        }
        self.page_anchors: list[int] = []
        self.anchor_pages: dict[str, int] = {}
        self.figures: list[tuple[str, str, int]] = []
        self.current_page: int | None = None
        self.current_kind = "paragraph"
        self.buffer: list[str] = []
        self.pagenum_depth = 0
        self.caption_depth = 0
        self.pre_depth = 0
        self.footnotes_div_depth: int | None = None
        self.div_depth = 0

    @property
    def ignored(self) -> bool:
        return bool(
            self.pagenum_depth
            or self.caption_depth
            or self.pre_depth
            or self.footnotes_div_depth is not None
        )

    def flush_text(self, end_block: bool) -> None:
        raw = html.unescape("".join(self.buffer))
        self.buffer = []
        lines = [re.sub(r"\s+", " ", line).strip() for line in raw.split("\n")]
        text = "\n".join(line for line in lines if line)
        if text and self.current_page is not None:
            self.pages[self.current_page].append({
                "type": "text",
                "text": text,
                "kind": self.current_kind,
                "endBlock": end_block,
            })

    def switch_page(self, page: int) -> None:
        self.flush_text(end_block=False)
        assert ORIGINAL_FIRST_PAGE <= page <= ORIGINAL_LAST_PAGE
        assert page not in self.page_anchors, f"Duplicate original page anchor {page}"
        self.current_page = page
        self.page_anchors.append(page)

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        values = attrs_dict(attrs)
        identity = values.get("id") or values.get("name") or ""
        match = re.fullmatch(r"Page_(\d+)", identity)
        if match:
            self.switch_page(int(match.group(1)))
        if identity.startswith("FNanchor_") and self.current_page is not None:
            self.anchor_pages[identity] = self.current_page

        classes = set(values.get("class", "").split())
        if tag == "div":
            self.div_depth += 1
            if "footnotes" in classes and self.footnotes_div_depth is None:
                self.flush_text(end_block=True)
                self.footnotes_div_depth = self.div_depth
        if tag == "span" and "pagenum" in classes:
            self.pagenum_depth += 1
        if tag == "span" and "caption" in classes:
            self.caption_depth += 1
        if tag == "pre":
            self.pre_depth += 1

        if self.ignored:
            return
        if tag in self.BLOCK_TAGS:
            self.flush_text(end_block=True)
            self.current_kind = "heading" if tag.startswith("h") else "paragraph"
        elif tag == "br":
            self.buffer.append("\n")
        elif tag == "img" and values.get("src", "").startswith("images/fig"):
            assert self.current_page is not None, values["src"]
            self.flush_text(end_block=False)
            source = values["src"]
            alt = html.unescape(values.get("alt") or "Illustration")
            self.pages[self.current_page].append({
                "type": "figure",
                "source": source,
                "alt": alt,
            })
            self.figures.append((source, alt, self.current_page))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        was_ignored = self.ignored
        if tag == "span" and self.pagenum_depth:
            self.pagenum_depth -= 1
        if tag == "span" and self.caption_depth:
            self.caption_depth -= 1
        if tag == "pre" and self.pre_depth:
            self.pre_depth -= 1
        if tag == "div":
            if self.footnotes_div_depth == self.div_depth:
                self.footnotes_div_depth = None
            self.div_depth -= 1
        if was_ignored:
            return
        if tag in self.BLOCK_TAGS:
            self.flush_text(end_block=True)
            self.current_kind = "paragraph"

    def handle_data(self, data: str) -> None:
        if self.current_page is not None and not self.ignored:
            self.buffer.append(data)

    def close(self) -> None:
        super().close()
        self.flush_text(end_block=True)


class FootnoteParser(HTMLParser):
    """Collect Gutenberg's relocated footnotes for their reference pages."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.div_depth = 0
        self.container_depth: int | None = None
        self.note_depth: int | None = None
        self.note_id: str | None = None
        self.buffer: list[str] = []
        self.notes: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        values = attrs_dict(attrs)
        classes = set(values.get("class", "").split())
        if tag == "div":
            self.div_depth += 1
            if "footnotes" in classes and self.container_depth is None:
                self.container_depth = self.div_depth
            elif "footnote" in classes and self.container_depth is not None:
                assert self.note_depth is None
                self.note_depth = self.div_depth
                self.note_id = None
                self.buffer = []
        if self.note_depth is not None:
            identity = values.get("id") or values.get("name") or ""
            if identity.startswith("Footnote_"):
                self.note_id = identity
            if tag == "br":
                self.buffer.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag != "div":
            return
        if self.note_depth == self.div_depth:
            text = re.sub(r"\s+", " ", "".join(self.buffer)).strip()
            assert self.note_id and text
            self.notes.append((self.note_id, text))
            self.note_depth = None
            self.note_id = None
            self.buffer = []
        if self.container_depth == self.div_depth:
            self.container_depth = None
        self.div_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.note_depth is not None:
            self.buffer.append(data)


def wrapped_lines(text: str, width: int) -> list[str]:
    output: list[str] = []
    for explicit_line in text.split("\n"):
        output.extend(textwrap.wrap(
            explicit_line,
            width=width,
            break_long_words=False,
            break_on_hyphens=False,
        ) or ([""] if explicit_line else []))
    return output


def configure_base() -> None:
    base.TEXT_BODY_ROWS = base.COMPACT_TEXT_BODY_ROWS
    base.TEXT_LINE_HEIGHT = base.COMPACT_TEXT_LINE_HEIGHT
    base.TEXT_WIDTH_SCALE = base.COMPACT_TEXT_WIDTH_SCALE
    base.LIVE_BRAILLE_ROW_ASPECT = 0.70
    base.COMPACT_LIVE_LAYOUT = True


def text_event_rows(event: dict) -> int:
    rows = len(wrapped_lines(re.sub(r"\s+", " ", event["text"]).strip(), TEXT_COLUMNS))
    return rows + (1 if event["endBlock"] and event["kind"] == "heading" else 0)


def page_geometry_fits(events: list[dict], arts: dict[str, list[str]]) -> bool:
    """Conservatively test one printed page without side-flow savings."""
    body_rows = 0
    for event in events:
        if event["type"] == "text":
            body_rows += text_event_rows(event)
            if body_rows > base.TEXT_BODY_ROWS:
                return False
            continue
        art = arts[event["source"]]
        image_y = base.image_row_for_text(2 + body_rows + 1)
        reserve = base.reservation_rows_for_art(len(art))
        if body_rows + reserve > base.TEXT_BODY_ROWS:
            return False
        if image_y + len(art) > base.COMPACT_MAX_ACTIVE_IMAGE_BOTTOM:
            return False
        body_rows += reserve
    return body_rows <= base.TEXT_BODY_ROWS


def estimate_scale(events: list[dict], arts: dict[str, list[str]]) -> float:
    """Find one relative plate scale that preserves a page's composition."""
    if not any(event["type"] == "figure" for event in events):
        return 1.0
    if page_geometry_fits(events, arts):
        return 1.0

    def estimated_fits(scale: float) -> bool:
        body_rows = 0
        for event in events:
            if event["type"] == "text":
                body_rows += text_event_rows(event)
                if body_rows > base.TEXT_BODY_ROWS:
                    return False
                continue
            rows = max(1, math.ceil(len(arts[event["source"]]) * scale))
            image_y = base.image_row_for_text(2 + body_rows + 1)
            reserve = base.reservation_rows_for_art(rows)
            if body_rows + reserve > base.TEXT_BODY_ROWS:
                return False
            if image_y + rows > base.COMPACT_MAX_ACTIVE_IMAGE_BOTTOM:
                return False
            body_rows += reserve
        return body_rows <= base.TEXT_BODY_ROWS

    low = 0.20
    high = 1.0
    if not estimated_fits(low):
        return low
    for _ in range(24):
        middle = (low + high) / 2
        if estimated_fits(middle):
            low = middle
        else:
            high = middle
    return min(1.0, low * 0.98)


def convert_scaled_figure(source: str, base_art: list[str], scale: float) -> list[str]:
    if scale >= 0.995:
        return base_art
    source_path = base.HTML.parent / source
    conversion_path = base.FIGURE_SOURCE_OVERRIDES.get(source_path.name, source_path)
    original = base.Image.open(conversion_path).convert("L")
    mask_policy = base.FIGURE_MASK_POLICIES.get(source_path.name, {})
    base_columns = max(map(len, base_art), default=base.MIN_FIGURE_COLUMNS)
    requested_columns = max(120, min(base.PAGE_IMAGE_COLUMNS, round(base_columns * scale)))
    return base.convert_image(
        original,
        requested_columns,
        mask_policy.get("threshold", 0.72),
        mask_policy,
    )


def parse_source() -> HistoricalParser:
    source = SOURCE_HTML.read_text("utf8")
    parser = HistoricalParser()
    parser.feed(source)
    parser.close()

    notes = FootnoteParser()
    notes.feed(source)
    notes.close()
    for note_id, text in notes.notes:
        anchor = note_id.replace("Footnote_", "FNanchor_", 1)
        page = parser.anchor_pages.get(anchor)
        if page is None:
            raise ValueError(f"Footnote {note_id} has no page-bound reference anchor")
        parser.pages[page].append({
            "type": "text",
            "text": text,
            "kind": "footnote",
            "endBlock": True,
        })
    return parser


def build_historical_data() -> dict:
    configure_base()
    parser = parse_source()
    expected_anchors = set(range(ORIGINAL_FIRST_PAGE, ORIGINAL_LAST_PAGE + 1))
    expected_anchors.difference_update(MISSING_PRINTED_PAGES)
    assert set(parser.page_anchors) == expected_anchors
    assert len(parser.figures) == 57

    base_converted: dict[str, list[str]] = {}
    scaled_converted: dict[tuple[str, int], list[str]] = {}
    page_scales: dict[int, float] = {}
    text_pages = [""]
    image_pages = [""]
    placements: list[dict] = []
    overflow: list[dict] = []

    for printed_page in range(ORIGINAL_FIRST_PAGE, ORIGINAL_LAST_PAGE + 1):
        events = [] if printed_page in MISSING_PRINTED_PAGES else parser.pages[printed_page]
        if not events:
            text_pages.append("")
            image_pages.append("")
            continue

        figure_sources = [
            event["source"] for event in events if event["type"] == "figure"
        ]
        for source in figure_sources:
            if source not in base_converted:
                base_converted[source] = base.convert_figure(base.HTML.parent / source)
        base_page_arts = {source: base_converted[source] for source in figure_sources}
        page_scale = estimate_scale(events, base_page_arts)
        page_scale = min(page_scale, PAGE_SCALE_CAPS.get(printed_page, 1.0))
        page_arts: dict[str, list[str]] = {}
        for _ in range(12):
            page_arts = {}
            scale_key = round(page_scale * 1_000_000)
            for source in figure_sources:
                key = (source, scale_key)
                if key not in scaled_converted:
                    scaled_converted[key] = convert_scaled_figure(
                        source, base_converted[source], page_scale
                    )
                page_arts[source] = scaled_converted[key]
            if page_geometry_fits(events, page_arts):
                break
            page_scale *= 0.94
        else:
            overflow.append({
                "printedPage": printed_page,
                "figure": "page-scale",
                "scale": page_scale,
                "reason": "page does not fit even after historical figure scaling",
            })
        if page_scale < 0.995:
            page_scales[printed_page] = page_scale

        body: list[str] = []
        image_canvas: list[str] = []
        side_slots: list[tuple[int, int]] = []

        def emit_text(value: str, kind: str, end_block: bool) -> None:
            nonlocal body, side_slots
            remaining = re.sub(r"\s+", " ", value).strip()
            while remaining:
                if side_slots:
                    row, width = side_slots.pop(0)
                    pieces = textwrap.wrap(
                        remaining,
                        width=width,
                        break_long_words=False,
                        break_on_hyphens=False,
                    )
                    piece = pieces[0] if pieces else remaining
                    body[row] = piece
                    remaining = remaining[len(piece):].lstrip()
                else:
                    pieces = wrapped_lines(remaining, TEXT_COLUMNS)
                    if kind == "heading":
                        pieces = [line.center(TEXT_COLUMNS).rstrip() for line in pieces]
                    body.extend(pieces)
                    remaining = ""
            # The 1730 setting separates ordinary paragraphs with an indent,
            # not a modern blank line. Reserve vertical whitespace only after
            # display headings; otherwise the historical page cannot retain
            # its original text/plate composition.
            if end_block and kind == "heading" and body and body[-1] != "":
                body.append("")

        for event in events:
            if event["type"] == "text":
                emit_text(event["text"], event["kind"], event["endBlock"])
                continue

            source = event["source"]
            art = page_arts[source]
            reserve = base.reservation_rows_for_art(len(art))
            text_start = len(body)
            image_y = base.image_row_for_text(2 + text_start + 1)
            art_width = max(map(len, art), default=0)
            can_side_flow = art_width < 150 and len(art) < 80
            image_x = (
                max(0, base.PAGE_IMAGE_COLUMNS - art_width)
                if can_side_flow
                else max(0, (base.PAGE_IMAGE_COLUMNS - art_width) // 2)
            )
            needed = image_y + len(art)
            if len(body) + reserve > base.TEXT_BODY_ROWS or needed > base.COMPACT_MAX_ACTIVE_IMAGE_BOTTOM:
                overflow.append({
                    "printedPage": printed_page,
                    "figure": source,
                    "bodyRowsBefore": len(body),
                    "reservedRows": reserve,
                    "requiredRows": len(body) + reserve,
                    "imageBottom": needed,
                })
                continue
            if len(image_canvas) < needed:
                image_canvas.extend([""] * (needed - len(image_canvas)))
            for row, art_line in enumerate(art):
                image_canvas[image_y + row] = base.overlay_line(
                    image_canvas[image_y + row], art_line, image_x
                )
            body.extend([""] * (reserve - 1))
            side_width = math.floor(
                image_x * base.IMAGE_ADVANCE_SCALE / base.TEXT_WIDTH_SCALE
            ) - 2
            if side_width >= 20 and can_side_flow:
                side_slots.extend(
                    (text_start + row, side_width)
                    for row in range(reserve - 1)
                    if not body[text_start + row].strip()
                )
            body.append(event["alt"].rstrip(".") + ".")
            placements.append({
                "number": len(placements) + 1,
                "source": source,
                "alt": event["alt"],
                "page": printed_page + 1,
                "originalPage": printed_page,
                "textStartRow": text_start,
                "reservedTextRows": reserve,
                "imageX": image_x,
                "imageY": image_y,
                "columns": art_width,
                "rows": len(art),
                "layoutRows": base.layout_rows_for_art(len(art)),
                "historicalScale": page_scale,
                "sideTextColumns": max(0, side_width) if can_side_flow else 0,
                "labels": [],
            })

        while body and body[-1] == "":
            body.pop()
        if len(body) > base.TEXT_BODY_ROWS:
            overflow.append({
                "printedPage": printed_page,
                "figure": None,
                "requiredRows": len(body),
                "availableRows": base.TEXT_BODY_ROWS,
            })
        while image_canvas and not image_canvas[-1].replace(BLANK, ""):
            image_canvas.pop()
        text_pages.append(f"{printed_page}\r\n\r\n" + "\r\n".join(body))
        image_pages.append("\r\n".join(image_canvas))

    if overflow:
        raise ValueError(
            "Historical pages exceed the calibrated leaf; no content was spilled:\n"
            + json.dumps(overflow, indent=2)
        )
    assert len(text_pages) == len(image_pages) == ORIGINAL_LAST_PAGE + 1
    assert len(placements) == 57

    image_page_bands: list[list[str]] = [[] for _ in range(4)]
    image_band_ranges: list[list[list[int]]] = []
    image_band_bytes: list[list[int]] = []
    for page in image_pages:
        values, ranges = base.split_four_bands(page)
        for band, value in enumerate(values):
            image_page_bands[band].append(value)
        image_band_ranges.append(ranges)
        image_band_bytes.append([len(value.encode("utf8")) for value in values])
    maximum_band_bytes = max(max(values) for values in image_band_bytes)
    if maximum_band_bytes >= 32767:
        oversized = [
            {"arrayPage": index + 1, "printedPage": index, "bandBytes": values}
            for index, values in enumerate(image_band_bytes)
            if max(values) >= 32767
        ]
        raise ValueError(
            "Historical image band exceeds string limit:\n"
            + json.dumps(oversized, indent=2)
        )

    layout = {
        "textBodyRows": base.TEXT_BODY_ROWS,
        "textLineHeight": base.TEXT_LINE_HEIGHT,
        "imageLineHeight": base.IMAGE_RENDER_LINE_HEIGHT,
        "imageLayoutLineHeight": base.IMAGE_LAYOUT_LINE_HEIGHT,
        "textWidthScale": base.TEXT_WIDTH_SCALE,
        "imageWidthScale": base.IMAGE_WIDTH_SCALE,
        "imageOutlineWidth": base.IMAGE_OUTLINE_WIDTH,
        "imageFont": base.IMAGE_FONT,
        "imageKerning": base.IMAGE_KERNING,
        "imageAdvanceScale": base.IMAGE_ADVANCE_SCALE,
        "minimumFigureColumns": base.MIN_FIGURE_COLUMNS,
        "maximumImageColumns": base.PAGE_IMAGE_COLUMNS,
        "maximumImageRows": base.MAX_IMAGE_ROWS,
        "maximumActiveImageBottom": base.COMPACT_MAX_ACTIVE_IMAGE_BOTTOM,
        "cellMode": base.CELL_MODE,
        "imageArrayCount": 4,
        "bandStrategy": "byte-balanced contiguous rows",
        "liveBrailleRowAspect": base.LIVE_BRAILLE_ROW_ASPECT,
        "compactLiveLayout": True,
        "figureTopMarginTextRows": 1,
        "historicalPagination": True,
        "historicalEdition": "Fourth Edition, corrected (London, 1730)",
        "originalPageRange": [ORIGINAL_FIRST_PAGE, ORIGINAL_LAST_PAGE],
        "sourcePageAnchors": len(parser.page_anchors),
        "leadingBlankPages": 1,
        "blankOriginalPages": list(MISSING_PRINTED_PAGES),
        "frontMatterPolicy": "excluded",
        "customDetailPages": 0,
        "relocatedFootnotes": len(parser.anchor_pages),
        "historicallyScaledPages": {
            str(page): round(scale, 6) for page, scale in sorted(page_scales.items())
        },
        "pageScaleCaps": {str(page): scale for page, scale in PAGE_SCALE_CAPS.items()},
        "paginationPolicy": (
            "one array entry per 1730 printed page, preceded by one blank left leaf; "
            "figures remain on their Gutenberg-recorded original pages and overflow fails"
        ),
        "samplingPolicy": (
            "Opticks v25 live calibration with source geometry vertically sampled at "
            "the measured Brickadia Braille-cell aspect"
        ),
        "figureColumnCaps": base.FIGURE_COLUMN_CAPS,
        "figureSourceOverrides": {
            name: str(path.relative_to(ROOT))
            for name, path in base.FIGURE_SOURCE_OVERRIDES.items()
        },
        "figureMaskPolicies": base.FIGURE_MASK_POLICIES,
        "figureSourceCredits": base.FIGURE_SOURCE_CREDITS,
    }
    return {
        "source": (
            "Project Gutenberg ebook 33504 page anchors for Isaac Newton, Opticks, "
            "Fourth Edition corrected (London, 1730); Figure 3 sampled from the "
            "sharper 1704 BnF/Gallica plate"
        ),
        "representation": (
            "Original 1730 printed pagination with prose and native-font "
            "double-density pure-Braille figures in four synchronized image arrays"
        ),
        "layout": layout,
        "placements": placements,
        "detailViews": [],
        "textPages": text_pages,
        "imagePages": image_pages,
        "imagePagesA": image_page_bands[0],
        "imagePagesB": image_page_bands[1],
        "imagePagesC": image_page_bands[2],
        "imagePagesD": image_page_bands[3],
        "imageBandRanges": image_band_ranges,
        "imageBandBytes": image_band_bytes,
        "name": "Newton Opticks - 1730 Historical Pagination",
        "description": (
            "Isaac Newton's Opticks arranged by the Fourth Edition's printed "
            "pages 1-406, with one opening blank leaf and figures kept on their "
            "source pages."
        ),
    }


def main() -> None:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = argument_parser.parse_args()
    result = build_historical_data()
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf8")
    maximum_band = max(max(values) for values in result["imageBandBytes"])
    print(json.dumps({
        "output": str(arguments.output),
        "arrayEntries": len(result["textPages"]),
        "printedPages": ORIGINAL_LAST_PAGE,
        "spreads": math.ceil(len(result["textPages"]) / 2),
        "figures": len(result["placements"]),
        "pagesWithImages": sum(bool(value) for value in result["imagePages"]),
        "maximumBandBytes": maximum_band,
        "blankOriginalPages": list(MISSING_PRINTED_PAGES),
    }, indent=2))


if __name__ == "__main__":
    main()

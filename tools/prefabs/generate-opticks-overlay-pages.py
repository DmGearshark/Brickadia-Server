#!/usr/bin/env python3
"""Lay out Opticks prose and Braille figures as synchronized page overlays."""

from __future__ import annotations

import html
import json
import math
import re
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path("/workspace/Brickadia-Server")
SOURCE = Path("/tmp/gitenberg-33504/33504.txt")
HTML = Path("/tmp/gitenberg-33504/33504-h/33504-h.htm")
OUTPUT = ROOT / "tools/prefabs/opticks-overlay-pages.json"

TEXT_BODY_ROWS = 48
TEXT_LINE_HEIGHT = 0.42
IMAGE_LINE_HEIGHT = 0.36
IMAGE_WIDTH_SCALE = 0.30
TEXT_WIDTH_SCALE = 0.82
MAX_IMAGE_COLUMNS = 200
MAX_IMAGE_ROWS = 44
BLANK = "\u2800"
DOTS = (
    (0, 0, 0), (0, 1, 1), (0, 2, 2),
    (1, 0, 3), (1, 1, 4), (1, 2, 5),
    (0, 3, 6), (1, 3, 7),
)


class ImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs) -> None:
        if tag.lower() == "img":
            values = dict(attrs)
            if values.get("src"):
                self.images.append((values["src"], html.unescape(values.get("alt") or "Illustration")))


def convert_figure(path: Path) -> list[str]:
    source = Image.open(path).convert("L")
    # Scans vary greatly in darkness. Normalizing each figure independently
    # preserves faint construction lines while keeping the direct conversion
    # that worked best for lettering and technical diagrams.
    source = ImageOps.autocontrast(source, cutoff=1)
    width = min(
        MAX_IMAGE_COLUMNS,
        max(1, math.floor(2 * MAX_IMAGE_ROWS * source.width / source.height)),
    )
    rows = math.ceil(width * source.height / source.width / 2)
    resized = source.resize((2 * width, 4 * rows), Image.Resampling.BILINEAR)
    enabled = np.asarray(resized, dtype=np.float32) < 127.5
    output: list[str] = []
    for cell_y in range(rows):
        line = []
        for cell_x in range(width):
            mask = 0
            for dx, dy, bit in DOTS:
                if enabled[cell_y * 4 + dy, cell_x * 2 + dx]:
                    mask |= 1 << bit
            line.append(chr(0x2800 + mask))
        output.append("".join(line))
    left = min(len(line) - len(line.lstrip(BLANK)) for line in output)
    right = min(len(line) - len(line.rstrip(BLANK)) for line in output)
    output = [line[left:len(line) - right if right else len(line)] for line in output]
    while output and not output[0].replace(BLANK, ""):
        output.pop(0)
    while output and not output[-1].replace(BLANK, ""):
        output.pop()
    return output


def overlay_line(existing: str, art: str, x: int) -> str:
    width = max(len(existing), x + len(art))
    cells = [BLANK] * width
    cells[:len(existing)] = existing
    for index, char in enumerate(art):
        old_mask = ord(cells[x + index]) - 0x2800
        new_mask = ord(char) - 0x2800
        cells[x + index] = chr(0x2800 + (old_mask | new_mask))
    return "".join(cells).rstrip(BLANK)


def main() -> None:
    lines = SOURCE.read_text("utf-8-sig").replace("\r\n", "\n").splitlines()
    lines = lines[lines.index("OPTICKS:"):next(i for i, line in enumerate(lines) if line.startswith("End of the Project Gutenberg EBook"))]

    parser = ImageParser()
    parser.feed(HTML.read_text("utf8"))
    assert len(parser.images) == 57

    text_pages: list[str] = []
    image_pages: list[str] = []
    placements: list[dict] = []
    body: list[str] = []
    image_canvas: list[str] = []
    figure_index = 0

    def flush() -> None:
        nonlocal body, image_canvas
        while body and body[-1] == "":
            body.pop()
        page_number = len(text_pages) + 1
        text_pages.append(f"{page_number}\r\n\r\n" + "\r\n".join(body))
        while image_canvas and not image_canvas[-1].replace(BLANK, ""):
            image_canvas.pop()
        image_pages.append("\r\n".join(image_canvas))
        body = []
        image_canvas = []

    major_headings = {
        "THE FIRST BOOK OF OPTICKS",
        "THE SECOND BOOK OF OPTICKS",
        "THE THIRD BOOK OF OPTICKS",
    }

    for raw in lines:
        line = raw.rstrip().replace("_", "")
        marker = re.fullmatch(r"\[Illustration: (.+)\]", line.strip())
        if marker:
            src, alt = parser.images[figure_index]
            art = convert_figure(HTML.parent / src)
            reserve = math.ceil(len(art) * IMAGE_LINE_HEIGHT / TEXT_LINE_HEIGHT) + 2
            # Start a new page only when the figure cannot coexist with the
            # text already present. Text following it can use remaining rows.
            if body and len(body) + reserve > TEXT_BODY_ROWS:
                flush()
            if reserve > TEXT_BODY_ROWS:
                raise ValueError(f"Figure {figure_index + 1} exceeds page height")

            text_start = len(body)
            image_y = round((2 + text_start) * TEXT_LINE_HEIGHT / IMAGE_LINE_HEIGHT)
            image_x = max(0, (MAX_IMAGE_COLUMNS - max(map(len, art), default=0)) // 2)
            needed = image_y + len(art)
            if len(image_canvas) < needed:
                image_canvas.extend([""] * (needed - len(image_canvas)))
            for row, art_line in enumerate(art):
                image_canvas[image_y + row] = overlay_line(image_canvas[image_y + row], art_line, image_x)

            body.extend([""] * (reserve - 1))
            body.append(alt.rstrip(".") + ".")
            placements.append({
                "number": figure_index + 1,
                "source": src,
                "alt": alt,
                "page": len(text_pages) + 1,
                "textStartRow": text_start,
                "reservedTextRows": reserve,
                "imageX": image_x,
                "imageY": image_y,
                "columns": max(map(len, art), default=0),
                "rows": len(art),
            })
            figure_index += 1
            if len(body) >= TEXT_BODY_ROWS:
                flush()
            continue

        if line.strip() in major_headings and body:
            flush()
        if not line.strip():
            if body and body[-1] != "":
                body.append("")
            continue
        if len(body) >= TEXT_BODY_ROWS:
            flush()
        body.append(line)
        if len(body) >= TEXT_BODY_ROWS:
            flush()

    if body or image_canvas:
        flush()
    assert figure_index == 57
    assert len(text_pages) == len(image_pages)
    OUTPUT.write_text(json.dumps({
        "source": "Project Gutenberg ebook 33504, Opticks by Isaac Newton",
        "representation": "Prose and contrast-normalized Braille figures in synchronized overlay arrays",
        "layout": {
            "textBodyRows": TEXT_BODY_ROWS,
            "textLineHeight": TEXT_LINE_HEIGHT,
            "imageLineHeight": IMAGE_LINE_HEIGHT,
            "textWidthScale": TEXT_WIDTH_SCALE,
            "imageWidthScale": IMAGE_WIDTH_SCALE,
            "maximumImageColumns": MAX_IMAGE_COLUMNS,
            "maximumImageRows": MAX_IMAGE_ROWS,
        },
        "placements": placements,
        "textPages": text_pages,
        "imagePages": image_pages,
    }, ensure_ascii=False, indent=2) + "\n", "utf8")
    print(json.dumps({
        "output": str(OUTPUT),
        "pages": len(text_pages),
        "figures": len(placements),
        "pagesWithImages": sum(bool(page) for page in image_pages),
        "mixedPages": sum(bool(image_pages[i]) and len(text_pages[i].split("\r\n")) > placements[0]["reservedTextRows"] for i in range(len(text_pages))),
        "maxImageCharacters": max(map(len, image_pages)),
        "totalImageCharacters": sum(map(len, image_pages)),
        "maxColumns": max(item["columns"] for item in placements),
        "maxRows": max(item["rows"] for item in placements),
    }, indent=2))


if __name__ == "__main__":
    main()

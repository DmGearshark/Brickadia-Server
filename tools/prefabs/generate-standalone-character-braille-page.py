#!/usr/bin/env python3
"""Render one character portrait on the proven four-display parchment page."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools/image-to-braille/sources/standalone-character-page.png"
OUTPUT = ROOT / "tools/prefabs/standalone-character-braille-page.json"
CONVERTER = ROOT / "tools/image-to-braille/convert.py"
OPTICKS_GENERATOR = ROOT / "tools/prefabs/generate-opticks-four-display-pages.py"

CANVAS_COLUMNS = 600
CANVAS_ROWS = 260
THRESHOLD = 0.76
BLANK = "\u2800"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


converter = load_module("standalone_braille_converter", CONVERTER)
opticks = load_module("standalone_opticks_layout", OPTICKS_GENERATOR)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    mask = converter.technical_mask(
        source,
        CANVAS_COLUMNS,
        CANVAS_ROWS,
        threshold=THRESHOLD,
    )
    art = converter.encode_mask(mask)
    columns = max(map(len, art), default=0)
    rows = len(art)
    assert 0 < columns <= CANVAS_COLUMNS
    assert 0 < rows <= CANVAS_ROWS

    image_x = (CANVAS_COLUMNS - columns) // 2
    image_y = (CANVAS_ROWS - rows) // 2
    canvas_rows = [""] * image_y
    canvas_rows.extend((BLANK * image_x + line).rstrip(BLANK) for line in art)
    image_page = "\r\n".join(canvas_rows)
    bands, ranges = opticks.split_four_bands(image_page)
    band_bytes = [len(value.encode("utf8")) for value in bands]
    assert max(band_bytes) < 32767

    raised_dots = sum(
        (ord(character) - 0x2800).bit_count()
        for line in art
        for character in line
    )
    occupied_cells = sum(character != BLANK for line in art for character in line)
    data = {
        "name": "Standalone Character - Braille Portrait Page",
        "description": (
            "A single full-page character portrait rendered as native Unicode "
            "Braille across four synchronized parchment displays."
        ),
        "source": str(SOURCE.relative_to(ROOT)),
        "sourceNote": (
            "Faithful high-resolution intermediate derived from the supplied "
            "chat image because its original attachment bytes were unavailable."
        ),
        "representation": "One centered native-font pure-Braille portrait page",
        "layout": {
            "textBodyRows": 48,
            "textLineHeight": 0.50,
            "imageLineHeight": 0.075,
            "imageLayoutLineHeight": 0.084,
            "textWidthScale": 0.82,
            "imageWidthScale": 1.20,
            "imageOutlineWidth": 4,
            "imageFont": "IosevkaTerm",
            "imageKerning": -6,
            "imageAdvanceScale": 0.115,
            "maximumImageColumns": CANVAS_COLUMNS,
            "maximumImageRows": CANVAS_ROWS,
            "imageArrayCount": 4,
            "bandStrategy": "byte-balanced contiguous rows",
            "cellMode": "braille",
            "conversionMode": "technical",
            "threshold": THRESHOLD,
        },
        "portrait": {
            "sourceWidth": source.width,
            "sourceHeight": source.height,
            "imageX": image_x,
            "imageY": image_y,
            "columns": columns,
            "rows": rows,
            "occupiedCells": occupied_cells,
            "raisedDots": raised_dots,
        },
        "textPages": [""],
        "imagePages": [image_page],
        "imagePagesA": [bands[0]],
        "imagePagesB": [bands[1]],
        "imagePagesC": [bands[2]],
        "imagePagesD": [bands[3]],
        "imageBandRanges": [ranges],
        "imageBandBytes": [band_bytes],
    }
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf8")
    print(json.dumps({
        "output": str(OUTPUT),
        "portrait": data["portrait"],
        "bandBytes": band_bytes,
    }, indent=2))


if __name__ == "__main__":
    main()

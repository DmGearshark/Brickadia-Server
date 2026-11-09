#!/usr/bin/env python3
"""Validate the four-band double-density Opticks page data."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path("/workspace/Brickadia-Server")
DATA = ROOT / "tools/prefabs/opticks-four-display-pages.json"
BRAILLE_BLANK = "\u2800"


def rows(value: str) -> list[str]:
    return value.replace(BRAILLE_BLANK, " ").split("\r\n") if value else []


def main() -> None:
    data = json.loads(DATA.read_text("utf8"))
    bands = [data[f"imagePages{name}"] for name in "ABCD"]
    page_count = len(data["textPages"])
    assert page_count == len(data["imagePages"])
    assert all(len(values) == page_count for values in bands)
    assert len(data["imageBandRanges"]) == page_count
    assert len(data["imageBandBytes"]) == page_count
    assert len(data["placements"]) == 57
    assert not data["detailViews"]
    assert data["layout"]["imageArrayCount"] == 4
    assert data["layout"]["maximumImageColumns"] == 600
    assert data["layout"]["maximumImageRows"] == 260
    assert data["layout"]["imageLineHeight"] == 0.075
    assert data["layout"]["imageOutlineWidth"] == 4
    assert data["layout"]["figureThresholds"] == {"fig3-1.jpg": 0.50}

    for placement in data["placements"]:
        assert 0 <= placement["imageX"]
        assert placement["imageX"] + placement["columns"] <= 600
        assert placement["rows"] <= 260

    figure3 = next(item for item in data["placements"] if item["number"] == 3)
    assert figure3["columns"] >= 580
    assert figure3["rows"] >= 95

    maximum_bytes = 0
    for page in range(page_count):
        original = [line.rstrip(" ") for line in rows(data["imagePages"][page])]
        ranges = data["imageBandRanges"][page]
        assert len(ranges) == 4
        assert ranges[0][0] == 0
        assert all(ranges[index][1] == ranges[index + 1][0] for index in range(3))
        assert ranges[-1][1] == len(original)

        merged = [""] * len(original)
        for band, values in enumerate(bands):
            value = values[page]
            byte_count = len(value.encode("utf8"))
            assert byte_count == data["imageBandBytes"][page][band]
            assert byte_count < 32767
            maximum_bytes = max(maximum_bytes, byte_count)
            assert all(
                character in " \r\n" or 0x2800 <= ord(character) <= 0x28FF
                for character in value
            )
            start, end = ranges[band]
            band_rows = rows(value)
            for row in range(start, end):
                line = band_rows[row] if row < len(band_rows) else ""
                assert not merged[row]
                merged[row] = line.rstrip(" ")
        assert merged == original, f"Four-band reconstruction failed on page {page + 1}"

    assert maximum_bytes == max(max(values) for values in data["imageBandBytes"])
    print(json.dumps({
        "pages": page_count,
        "figures": len(data["placements"]),
        "maximumBandBytes": maximum_bytes,
        "figure3": {
            "page": figure3["page"],
            "columns": figure3["columns"],
            "rows": figure3["rows"],
        },
    }, indent=2))


if __name__ == "__main__":
    main()

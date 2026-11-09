#!/usr/bin/env python3
"""Validate the standalone four-band character portrait page data."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "tools/prefabs/standalone-character-braille-page.json"
BLANK = "\u2800"


def normalized_rows(value: str) -> list[str]:
    return [row.rstrip(" ") for row in value.replace(BLANK, " ").split("\r\n")]


def main() -> None:
    data = json.loads(DATA.read_text("utf8"))
    assert data["textPages"] == [""]
    assert len(data["imagePages"]) == 1
    assert data["layout"]["imageArrayCount"] == 4
    assert data["layout"]["conversionMode"] == "technical"
    assert data["layout"]["threshold"] == 0.76
    assert data["portrait"] == {
        "sourceWidth": 1166,
        "sourceHeight": 1349,
        "imageX": 75,
        "imageY": 25,
        "columns": 449,
        "rows": 209,
        "occupiedCells": 15600,
        "raisedDots": 108682,
    }

    logical = normalized_rows(data["imagePages"][0])
    reconstructed = [""] * len(logical)
    for band_name, bounds, expected_bytes in zip(
        "ABCD",
        data["imageBandRanges"][0],
        data["imageBandBytes"][0],
    ):
        value = data[f"imagePages{band_name}"][0]
        assert len(value.encode("utf8")) == expected_bytes < 32767
        assert all(
            character in " \r\n" or 0x2800 <= ord(character) <= 0x28FF
            for character in value
        )
        start, end = bounds
        band_rows = normalized_rows(value)
        for row in range(start, end):
            reconstructed[row] = band_rows[row] if row < len(band_rows) else ""
    assert reconstructed == logical
    assert max(data["imageBandBytes"][0]) <= 25000
    print(json.dumps({
        "portrait": data["portrait"],
        "bandBytes": data["imageBandBytes"][0],
    }, indent=2))


if __name__ == "__main__":
    main()

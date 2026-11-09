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
    assert page_count == 226
    assert page_count == len(data["imagePages"])
    assert all(len(values) == page_count for values in bands)
    assert len(data["imageBandRanges"]) == page_count
    assert len(data["imageBandBytes"]) == page_count
    assert len(data["placements"]) == 57
    assert len(data["detailViews"]) == 1
    assert data["layout"]["imageArrayCount"] == 4
    assert data["layout"]["maximumImageColumns"] == 600
    assert data["layout"]["maximumImageRows"] == 260
    assert data["layout"]["imageLineHeight"] == 0.075
    assert data["layout"]["imageLayoutLineHeight"] == 0.084
    assert data["layout"]["imageWidthScale"] == 1.2
    assert data["layout"]["imageOutlineWidth"] == 4
    assert data["layout"]["imageFont"] == "IosevkaTerm"
    assert data["layout"]["imageKerning"] == -6
    assert data["layout"]["figureSourceOverrides"] == {
        "fig3-1.jpg": "tools/image-to-braille/sources/bnf-opticks-1704-plate-i-figure-3.png",
    }
    assert data["layout"]["figureMaskPolicies"] == {
        "fig3-1.jpg": {
            "mode": "line-aware",
            "threshold": 0.50,
            "lineLength": 51,
            "lineOccupancy": 0.88,
            "angleStep": 5,
            "compactSize": 1,
        },
    }
    assert data["layout"]["figureSourceCredits"]["fig3-1.jpg"]["record"] == (
        "https://gallica.bnf.fr/ark:/12148/bpt6k3362k"
    )

    for placement in data["placements"]:
        assert 0 <= placement["imageX"]
        assert placement["imageX"] + placement["columns"] <= 600
        assert placement["rows"] <= 260
        caption_row = 2 + placement["textStartRow"] + placement["reservedTextRows"] - 1
        image_bottom = (
            (placement["imageY"] + placement["rows"])
            * data["layout"]["imageLayoutLineHeight"]
            + 2.0
        )
        assert image_bottom <= caption_row * data["layout"]["textLineHeight"]
        intended_top = (
            (2 + placement["textStartRow"])
            * data["layout"]["textLineHeight"]
        )
        actual_top = placement["imageY"] * data["layout"]["imageLayoutLineHeight"]
        assert abs(actual_top - intended_top) <= data["layout"]["imageLayoutLineHeight"] / 2

    expected_live_layout = {
        1: (6, 0, 39, 12),
        4: (10, 11, 27, 77),
        28: (65, 0, 48, 12),
        49: (127, 0, 26, 12),
    }
    for number, expected in expected_live_layout.items():
        placement = next(item for item in data["placements"] if item["number"] == number)
        assert (
            placement["page"],
            placement["textStartRow"],
            placement["reservedTextRows"],
            placement["imageY"],
        ) == expected

    figure3 = next(item for item in data["placements"] if item["number"] == 3)
    assert figure3["columns"] >= 580
    assert 90 <= figure3["rows"] <= 100
    assert figure3["page"] == 8
    assert figure3["reservedTextRows"] == 23
    assert figure3["imageY"] == 83

    figure3_rows = data["imagePages"][figure3["page"] - 1].split("\r\n")
    figure3_cells: list[str] = []
    for row_index in range(figure3["imageY"], figure3["imageY"] + figure3["rows"]):
        row = figure3_rows[row_index] if row_index < len(figure3_rows) else ""
        figure3_cells.extend(
            row[figure3["imageX"]:figure3["imageX"] + figure3["columns"]]
            .ljust(figure3["columns"], BRAILLE_BLANK)
        )
    occupied_cells = sum(character != BRAILLE_BLANK for character in figure3_cells)
    raised_dots = sum(
        (ord(character) - 0x2800).bit_count()
        for character in figure3_cells
        if 0x2800 <= ord(character) <= 0x28FF
    )
    assert 9200 <= occupied_cells <= 9300
    assert 22000 <= raised_dots <= 22500
    assert 2.38 <= raised_dots / occupied_cells <= 2.43

    detail = data["detailViews"][0]
    assert detail == {
        "name": "center",
        "parentFigure": 3,
        "overviewPage": 8,
        "source": "images/fig3-1.jpg",
        "conversionSource": "tools/image-to-braille/sources/bnf-opticks-1704-plate-i-figure-3.png",
        "crop": [550, 15, 980, 480],
        "requestedColumns": 600,
        "maskPolicy": {
            "mode": "line-aware",
            "threshold": 0.50,
            "lineLength": 111,
            "lineOccupancy": 0.88,
            "angleStep": 5,
            "compactSize": 1,
        },
        "caption": "Fig. 3. Enlarged central detail from the original plate.",
        "page": 9,
        "textStartRow": 0,
        "reservedTextRows": 48,
        "imageX": 60,
        "imageY": 12,
        "columns": 480,
        "rows": 249,
    }
    detail_rows = data["imagePages"][detail["page"] - 1].split("\r\n")
    detail_cells: list[str] = []
    for row_index in range(detail["imageY"], detail["imageY"] + detail["rows"]):
        row = detail_rows[row_index] if row_index < len(detail_rows) else ""
        detail_cells.extend(
            row[detail["imageX"]:detail["imageX"] + detail["columns"]]
            .ljust(detail["columns"], BRAILLE_BLANK)
        )
    detail_occupied = sum(character != BRAILLE_BLANK for character in detail_cells)
    detail_dots = sum(
        (ord(character) - 0x2800).bit_count()
        for character in detail_cells
        if 0x2800 <= ord(character) <= 0x28FF
    )
    assert detail_occupied == 10349
    assert detail_dots == 32415
    assert data["imageBandBytes"][detail["page"] - 1] == [30745, 30567, 30913, 30951]
    assert data["imageBandRanges"][detail["page"] - 1] == [
        [0, 87], [87, 138], [138, 186], [186, 261],
    ]
    detail_text_rows = data["textPages"][detail["page"] - 1].split("\r\n")
    caption_row = detail_text_rows.index(detail["caption"])
    image_bottom = (
        (detail["imageY"] + detail["rows"])
        * data["layout"]["imageLayoutLineHeight"]
    )
    assert image_bottom + 2.0 <= caption_row * data["layout"]["textLineHeight"]
    for name, (left, top, right, bottom), minimum in (
        ("K", (205, 198, 267, 227), 100),
        ("L", (322, 198, 384, 227), 100),
        ("B", (266, 223, 334, 255), 200),
    ):
        dense_cells = 0
        for row_index in range(top, bottom):
            row = detail_rows[row_index] if row_index < len(detail_rows) else ""
            for character in row[left:right].ljust(right - left, BRAILLE_BLANK):
                if 0x2800 <= ord(character) <= 0x28FF:
                    dense_cells += (ord(character) - 0x2800).bit_count() >= 5
        assert dense_cells >= minimum, f"Detail lost {name}: {dense_cells} dense cells"

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
            "occupiedCells": occupied_cells,
            "raisedDots": raised_dots,
        },
    }, indent=2))


if __name__ == "__main__":
    main()

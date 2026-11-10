#!/usr/bin/env python3
"""Regression checks for the Opticks v27 live-geometry correction."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "tools/prefabs/opticks-four-display-pages-v27-live-geometry.json"
BLANK = "\u2800"
DOTS = (
    (0, 0, 0), (0, 1, 1), (0, 2, 2),
    (1, 0, 3), (1, 1, 4), (1, 2, 5),
    (0, 3, 6), (1, 3, 7),
)


def placement_mask(data: dict, placement: dict) -> np.ndarray:
    page = data["imagePages"][placement["page"] - 1].split("\r\n")
    mask = np.zeros((placement["rows"] * 4, placement["columns"] * 2), dtype=bool)
    for cell_y in range(placement["rows"]):
        page_y = placement["imageY"] + cell_y
        line = page[page_y] if page_y < len(page) else ""
        line = line[
            placement["imageX"]:placement["imageX"] + placement["columns"]
        ].ljust(placement["columns"], BLANK)
        for cell_x, character in enumerate(line):
            value = ord(character) - 0x2800 if BLANK <= character <= "\u28ff" else 0
            for dx, dy, bit in DOTS:
                if value & (1 << bit):
                    mask[cell_y * 4 + dy, cell_x * 2 + dx] = True
    return mask


def main() -> None:
    data = json.loads(DATA.read_text("utf8"))
    assert len(data["textPages"]) == 227
    assert len(data["placements"]) == 57
    assert len(data["detailViews"]) == 1
    assert data["layout"]["liveBrailleRowAspect"] == 0.70
    assert data["layout"]["forcedPageStarts"] == [13, 32, 55]
    assert all(len(data[key]) == 227 for key in (
        "imagePages", "imagePagesA", "imagePagesB", "imagePagesC", "imagePagesD",
    ))

    by_number = {placement["number"]: placement for placement in data["placements"]}
    figure3 = by_number[3]
    assert (figure3["columns"], figure3["rows"], figure3["layoutRows"]) == (589, 68, 97)
    assert figure3["imageX"] == 5

    figure12 = by_number[12]
    figure13 = by_number[13]
    assert figure12["page"] + 1 == figure13["page"]
    assert figure12["imageY"] + figure12["rows"] == 94
    assert figure13["imageY"] + figure13["rows"] == 75

    figure27 = by_number[27]
    assert (figure27["columns"], figure27["rows"], figure27["layoutRows"]) == (309, 123, 176)
    labels, count = ndimage.label(placement_mask(data, figure27), np.ones((3, 3), dtype=bool))
    components = []
    for label in range(1, count + 1):
        ys, xs = np.where(labels == label)
        if len(xs):
            components.append((len(xs), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))
    _, width, height = max(components)
    live_aspect = width * data["layout"]["liveBrailleRowAspect"] / height
    assert 0.95 <= live_aspect <= 0.99, live_aspect

    all_items = data["placements"] + data["detailViews"]
    assert max(item["imageY"] + item["rows"] for item in all_items) <= 240
    assert max(max(sizes) for sizes in data["imageBandBytes"]) < 32767
    assert all(item["rows"] <= item["layoutRows"] for item in all_items)

    print(json.dumps({
        "pages": len(data["textPages"]),
        "figures": len(data["placements"]),
        "figure27LiveAspect": live_aspect,
        "maximumImageBottom": max(item["imageY"] + item["rows"] for item in all_items),
        "maximumBandBytes": max(max(sizes) for sizes in data["imageBandBytes"]),
    }, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Convert the supplied 6x-enlarged clown sprite to exact Brickadia rich text."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools/image-to-braille/sources/clown-character-page.png"
OUTPUT = ROOT / "outputs/clown-square-format-string.txt"

BACKGROUND = (37, 37, 42)
CELL_SIZE = 6
X_CENTER = 4
Y_CENTER = 5
GRID_COLUMNS = 29
GRID_ROWS = 35
# The source sprite has one background-colored hole at the exact center of the
# upper pants/base. Fill that requested correction with true black.
BLACK_OVERRIDES = {(14, 24): (0, 0, 0)}


PIXEL = "█"


def encode_run(color: tuple[int, int, int], count: int) -> str:
    hexadecimal = "".join(f"{channel:02x}" for channel in color)
    # U+2588 has no side bearings. U+25A0 (■) leaves visible seams between
    # adjacent cells even when the TextDisplay metrics are otherwise correct.
    return f'<color="{hexadecimal}">{PIXEL * count}</>'


def main() -> None:
    image = Image.open(SOURCE).convert("RGB")
    assert image.size == (176, 213), image.size

    grid = [
        [image.getpixel((X_CENTER + x * CELL_SIZE, Y_CENTER + y * CELL_SIZE))
         for x in range(GRID_COLUMNS)]
        for y in range(GRID_ROWS)
    ]
    for (x, y), color in BLACK_OVERRIDES.items():
        grid[y][x] = color
    occupied = [
        (x, y)
        for y, row in enumerate(grid)
        for x, color in enumerate(row)
        if color != BACKGROUND
    ]
    left = min(x for x, _ in occupied)
    right = max(x for x, _ in occupied)
    top = min(y for _, y in occupied)
    bottom = max(y for _, y in occupied)

    encoded_rows: list[str] = []
    for source_row in grid[top:bottom + 1]:
        row = source_row[left:right + 1]
        encoded = ""
        index = 0
        while index < len(row):
            color = row[index]
            end = index + 1
            while end < len(row) and row[end] == color:
                end += 1
            count = end - index
            encoded += " " * count if color == BACKGROUND else encode_run(color, count)
            index = end
        encoded_rows.append(encoded.rstrip())

    output = "\r\n".join(encoded_rows)
    OUTPUT.write_text(output, encoding="utf8", newline="")
    print(json.dumps({
        "source": str(SOURCE.relative_to(ROOT)),
        "output": str(OUTPUT.relative_to(ROOT)),
        "sourceSize": list(image.size),
        "logicalGrid": [GRID_COLUMNS, GRID_ROWS],
        "croppedGrid": [right - left + 1, bottom - top + 1],
        "visibleCells": len(occupied),
        "sourceColors": len({color for row in grid for color in row}),
        "utf8Bytes": len(output.encode("utf8")),
    }, indent=2))


if __name__ == "__main__":
    main()

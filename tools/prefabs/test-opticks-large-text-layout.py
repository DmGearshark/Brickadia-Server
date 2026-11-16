#!/usr/bin/env python3
"""Validate the calibrated 47-column large-text Opticks page data."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path


BLANK = "\u2800"
BAND_KEYS = tuple(f"imagePages{name}" for name in "ABCD")
EXPECTED_TEXT_COLUMNS = 47
EXPECTED_BODY_ROWS = 29


def text_rows(value: str) -> list[str]:
    return value.split("\r\n")


def image_rows(value: str) -> list[str]:
    if not value:
        return []
    return [line.replace(BLANK, " ").rstrip(" ") for line in value.split("\r\n")]


def wrap_caption(value: str, width: int) -> list[str]:
    """Mirror the generator's word wrapping for figure captions."""
    remaining = value.strip()
    rows: list[str] = []
    while remaining:
        split = remaining.rfind(" ", 0, width + 1)
        piece = remaining if len(remaining) <= width else remaining[:split if split > 0 else width]
        rows.append(piece)
        remaining = remaining[len(piece):].lstrip()
    return rows


def assert_text_pages(data: dict, columns: int, body_rows: int) -> int:
    pages = data["textPages"]
    nonblank_rows = 0
    for page_number, page in enumerate(pages, start=1):
        rows = text_rows(page)
        assert rows[0] == str(page_number), (
            f"Page {page_number} has number row {rows[0]!r}"
        )
        assert len(rows) <= body_rows + 2, (
            f"Page {page_number} has {len(rows)} rows; maximum is {body_rows + 2}"
        )
        for row_number, row in enumerate(rows, start=1):
            assert len(row) <= columns, (
                f"Page {page_number}, row {row_number} is {len(row)} characters; "
                f"maximum is {columns}: {row!r}"
            )
            nonblank_rows += bool(row)
    return nonblank_rows


def assert_four_band_reconstruction(data: dict) -> int:
    page_count = len(data["textPages"])
    image_pages = data["imagePages"]
    bands = [data[key] for key in BAND_KEYS]
    assert len(image_pages) == page_count
    assert all(len(values) == page_count for values in bands)
    assert len(data["imageBandRanges"]) == page_count
    assert len(data["imageBandBytes"]) == page_count
    maximum_bytes = 0

    for page_index in range(page_count):
        original = image_rows(image_pages[page_index])
        while original and not original[-1]:
            original.pop()
        assert all(len(row) <= data["layout"]["maximumImageColumns"] for row in original), (
            f"Image page {page_index + 1} exceeds the image canvas width"
        )

        ranges = data["imageBandRanges"][page_index]
        sizes = data["imageBandBytes"][page_index]
        assert len(ranges) == len(sizes) == 4
        assert ranges[0][0] == 0
        assert all(ranges[index][1] == ranges[index + 1][0] for index in range(3))
        assert ranges[-1][1] == len(original)

        reconstructed = [""] * len(original)
        for band_index, values in enumerate(bands):
            value = values[page_index]
            byte_count = len(value.encode("utf8"))
            assert byte_count == sizes[band_index]
            assert byte_count < 32767, (
                f"Image page {page_index + 1}, band {band_index} is too large: {byte_count} bytes"
            )
            maximum_bytes = max(maximum_bytes, byte_count)
            assert all(
                character in " \r\n" or 0x2800 <= ord(character) <= 0x28FF
                for character in value
            )

            start, end = ranges[band_index]
            rows = image_rows(value)
            for row_index in range(start, end):
                assert not reconstructed[row_index]
                reconstructed[row_index] = rows[row_index] if row_index < len(rows) else ""
        assert reconstructed == original, (
            f"Four-band reconstruction failed on image page {page_index + 1}"
        )
    return maximum_bytes


def assert_art_layout(data: dict) -> tuple[int, int]:
    layout = data["layout"]
    text_height = layout["textLineHeight"]
    image_height = layout["imageLayoutLineHeight"]
    top_margin = layout["figureTopMarginTextRows"]
    text_columns = layout["textColumns"]
    body_rows = layout["textBodyRows"]
    page_count = len(data["textPages"])
    maximum_bottom = 0
    intervals_by_page: dict[int, list[tuple[int, int, str]]] = defaultdict(list)

    figures = data["placements"]
    assert len(figures) == 57
    assert {item["number"] for item in figures} == set(range(1, 58))
    all_items = [
        (item, item["alt"].rstrip(".") + ".", True, f"Figure {item['number']}")
        for item in figures
    ]
    all_items.extend(
        (item, item["caption"], False, f"Detail {item['name']}")
        for item in data["detailViews"]
    )

    for item, caption, is_figure, label in all_items:
        page = item["page"]
        assert 1 <= page <= page_count, f"{label} references invalid page {page}"
        text_start = item["textStartRow"]
        reserve = item["reservedTextRows"]
        caption_rows = wrap_caption(caption, text_columns)
        assert reserve >= len(caption_rows), f"{label} does not reserve its caption rows"
        assert text_start + reserve <= body_rows, f"{label} exceeds the text body"

        expected_y = round(
            (2 + text_start + (top_margin if is_figure else 0))
            * text_height / image_height
        )
        assert item["imageY"] == expected_y, (
            f"{label} has imageY {item['imageY']}; expected {expected_y}"
        )
        assert item["imageX"] >= 0
        assert item["imageX"] + item["columns"] <= layout["maximumImageColumns"]
        assert item["rows"] <= layout["maximumImageRows"]
        bottom = item["imageY"] + item["rows"]
        assert bottom <= layout["maximumActiveImageBottom"], (
            f"{label} ends at image row {bottom}; maximum is "
            f"{layout['maximumActiveImageBottom']}"
        )
        maximum_bottom = max(maximum_bottom, bottom)

        rows = text_rows(data["textPages"][page - 1])
        caption_start = 2 + text_start + reserve - len(caption_rows)
        assert rows[caption_start:caption_start + len(caption_rows)] == caption_rows, (
            f"{label} caption is not at the end of its reserved block"
        )
        reserved_rows = rows[2 + text_start:caption_start]
        side_columns = item.get("sideTextColumns", 0) if is_figure else 0
        if side_columns:
            assert all(len(row) <= min(side_columns, text_columns) for row in reserved_rows)
        else:
            assert all(not row for row in reserved_rows), (
                f"{label} has prose inside a non-side-flow art reservation"
            )

        # The image, including the calibrated two-unit bottom clearance, must
        # end no lower than the first caption row.
        caption_top = caption_start * text_height
        assert bottom * image_height + 2.0 <= caption_top + 1e-9, (
            f"{label} artwork collides with its caption"
        )
        intervals_by_page[page].append((item["imageY"], bottom, label))

    for page, intervals in intervals_by_page.items():
        intervals.sort()
        for prior, current in zip(intervals, intervals[1:]):
            assert prior[1] <= current[0], (
                f"Art overlaps on page {page}: {prior[2]} and {current[2]}"
            )

    return maximum_bottom, len(all_items)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path, help="Generated Opticks page-data JSON")
    arguments = parser.parse_args()
    data = json.loads(arguments.data.read_text("utf8"))
    layout = data["layout"]

    assert layout["textColumns"] == EXPECTED_TEXT_COLUMNS
    assert layout["textBodyRows"] == EXPECTED_BODY_ROWS
    assert math.isclose(layout["textLineHeight"], 0.8125)
    assert math.isclose(layout["textWidthScale"], 0.75)
    assert layout["compactLiveLayout"] is True
    assert layout["figureTopMarginTextRows"] == 1
    assert layout["maximumActiveImageBottom"] == 240
    assert layout["imageArrayCount"] == 4
    assert layout["bandStrategy"] == "byte-balanced contiguous rows"
    assert data["source"]
    assert data["representation"]
    assert data["name"]
    assert data["description"]

    page_count = len(data["textPages"])
    assert page_count > 0
    for key in ("imagePages", *BAND_KEYS):
        assert len(data[key]) == page_count, f"{key} has the wrong page count"

    nonblank_rows = assert_text_pages(
        data,
        layout["textColumns"],
        layout["textBodyRows"],
    )
    maximum_band_bytes = assert_four_band_reconstruction(data)
    maximum_image_bottom, art_count = assert_art_layout(data)

    assert len(data["detailViews"]) == 1
    detail = data["detailViews"][0]
    parent = next(
        item for item in data["placements"]
        if item["number"] == detail["parentFigure"]
    )
    assert detail["overviewPage"] == parent["page"]

    print(json.dumps({
        "pages": page_count,
        "spreads": math.ceil(page_count / 2),
        "maximumTextRows": max(len(text_rows(page)) for page in data["textPages"]),
        "maximumTextColumns": max(
            len(row)
            for page in data["textPages"]
            for row in text_rows(page)
        ),
        "nonblankTextRows": nonblank_rows,
        "artItems": art_count,
        "maximumImageBottom": maximum_image_bottom,
        "maximumBandBytes": maximum_band_bytes,
    }, indent=2))


if __name__ == "__main__":
    main()

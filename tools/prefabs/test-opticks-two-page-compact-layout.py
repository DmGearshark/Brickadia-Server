#!/usr/bin/env python3
"""Prove the large two-page Opticks layout only repaginates v27 content."""

from __future__ import annotations

from collections import Counter, defaultdict
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V27 = ROOT / "tools/prefabs/opticks-four-display-pages-v27-live-geometry.json"
COMPACT = ROOT / "tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json"
BLANK = "\u2800"
BAND_KEYS = tuple(f"imagePages{name}" for name in "ABCD")


def page_rows(value: str) -> list[str]:
    """Normalize both legal blank-cell forms while retaining row positions."""
    if not value:
        return []
    return [line.replace(BLANK, " ").rstrip(" ") for line in value.split("\r\n")]


def art_rectangle(data: dict, item: dict) -> tuple[str, ...]:
    """Extract one fixed-size Braille rectangle from a logical image page."""
    rows = data["imagePages"][item["page"] - 1].split("\r\n")
    extracted: list[str] = []
    for row_index in range(item["imageY"], item["imageY"] + item["rows"]):
        line = rows[row_index] if row_index < len(rows) else ""
        line = line.replace(" ", BLANK)
        extracted.append(
            line[item["imageX"]:item["imageX"] + item["columns"]]
            .ljust(item["columns"], BLANK)
        )
    return tuple(extracted)


def prose_counter(data: dict) -> Counter[str]:
    """Ignore generated page numbers and pagination-only blank rows."""
    values: list[str] = []
    for page_number, page in enumerate(data["textPages"], start=1):
        rows = page.split("\r\n")
        assert rows[0] == str(page_number)
        values.extend(row for row in rows[1:] if row)
    return Counter(values)


def immutable_layout(layout: dict) -> dict:
    keys = (
        "textBodyRows",
        "textLineHeight",
        "imageLineHeight",
        "imageLayoutLineHeight",
        "textWidthScale",
        "imageWidthScale",
        "imageOutlineWidth",
        "imageFont",
        "imageKerning",
        "imageAdvanceScale",
        "minimumFigureColumns",
        "maximumImageColumns",
        "maximumImageRows",
        "samplingPolicy",
        "cellMode",
        "imageArrayCount",
        "bandStrategy",
        "figureColumnCaps",
        "figureSourceOverrides",
        "figureMaskPolicies",
        "figureSourceCredits",
        "liveBrailleRowAspect",
    )
    return {key: layout[key] for key in keys}


def immutable_figure(item: dict) -> dict:
    mutable = {
        "page",
        "overviewPage",
        "textStartRow",
        "reservedTextRows",
        "imageY",
    }
    return {key: value for key, value in item.items() if key not in mutable}


def assert_four_band_reconstruction(data: dict) -> int:
    page_count = len(data["textPages"])
    bands = [data[key] for key in BAND_KEYS]
    assert all(len(values) == page_count for values in bands)
    assert len(data["imagePages"]) == page_count
    assert len(data["imageBandRanges"]) == page_count
    assert len(data["imageBandBytes"]) == page_count
    maximum_bytes = 0

    for page_index in range(page_count):
        original = page_rows(data["imagePages"][page_index])
        while original and not original[-1]:
            original.pop()
        ranges = data["imageBandRanges"][page_index]
        assert len(ranges) == 4
        assert ranges[0][0] == 0
        assert all(ranges[index][1] == ranges[index + 1][0] for index in range(3))
        assert ranges[-1][1] == len(original)

        reconstructed = [""] * len(original)
        for band_index, values in enumerate(bands):
            value = values[page_index]
            byte_count = len(value.encode("utf8"))
            assert byte_count == data["imageBandBytes"][page_index][band_index]
            assert byte_count < 32767
            maximum_bytes = max(maximum_bytes, byte_count)
            assert all(
                character in " \r\n" or 0x2800 <= ord(character) <= 0x28FF
                for character in value
            )
            start, end = ranges[band_index]
            rows = page_rows(value)
            for row_index in range(start, end):
                assert not reconstructed[row_index]
                reconstructed[row_index] = rows[row_index] if row_index < len(rows) else ""
        assert reconstructed == original, f"Band reconstruction failed on page {page_index + 1}"
    return maximum_bytes


def main() -> None:
    v27 = json.loads(V27.read_text("utf8"))
    compact = json.loads(COMPACT.read_text("utf8"))
    layout = compact["layout"]

    assert len(v27["textPages"]) == 227
    assert len(compact["textPages"]) == 237
    assert len(compact["placements"]) == len(v27["placements"]) == 57
    assert len(compact["detailViews"]) == len(v27["detailViews"]) == 1
    assert all(len(compact[key]) == 237 for key in ("imagePages", *BAND_KEYS))
    assert compact["source"] == v27["source"]
    assert compact["representation"] == v27["representation"]
    compact_layout = immutable_layout(layout)
    source_layout = immutable_layout(v27["layout"])
    for key in ("textBodyRows", "textLineHeight", "textWidthScale"):
        compact_layout.pop(key)
        source_layout.pop(key)
    assert compact_layout == source_layout
    assert layout["textBodyRows"] == 44
    assert layout["textLineHeight"] == 0.546875
    assert layout["textWidthScale"] == 0.75
    assert max(
        len(page.split("\r\n")) for page in compact["textPages"]
    ) == layout["textBodyRows"] + 2
    assert layout["compactLiveLayout"] is True
    assert layout["forcedPageStarts"] == [32, 55]
    assert layout["figureTopMarginTextRows"] == 1
    assert layout["maximumActiveImageBottom"] == 240
    assert "actual live-art row reservations" in layout["paginationPolicy"]
    assert prose_counter(compact) == prose_counter(v27)

    old_figures = {item["number"]: item for item in v27["placements"]}
    new_figures = {item["number"]: item for item in compact["placements"]}
    assert set(new_figures) == set(old_figures) == set(range(1, 58))
    for number in range(1, 58):
        old = old_figures[number]
        new = new_figures[number]
        assert immutable_figure(new) == immutable_figure(old), number
        assert art_rectangle(compact, new) == art_rectangle(v27, old), number

    # Preserve the reader-oriented editorial layout. Closely related simple
    # diagrams share a leaf, while all other figures keep an unshared image
    # canvas. This prevents a future facsimile-style repagination from
    # shrinking the plates back into their historical copperplate groupings.
    figures_by_page: dict[int, list[int]] = defaultdict(list)
    for item in compact["placements"]:
        figures_by_page[item["page"]].append(item["number"])
    expected_groups = {
        11: [4, 5],
        12: [6, 7],
        16: [9, 10],
        22: [12, 13],
        34: [18, 19],
    }
    actual_groups = {
        page: numbers
        for page, numbers in figures_by_page.items()
        if len(numbers) > 1
    }
    assert actual_groups == expected_groups
    assert all(
        current["page"] > previous["page"]
        or (
            current["page"] == previous["page"]
            and current["textStartRow"] >= previous["textStartRow"]
        )
        for previous, current in zip(
            compact["placements"], compact["placements"][1:]
        )
    )

    old_detail = v27["detailViews"][0]
    detail = compact["detailViews"][0]
    assert immutable_figure(detail) == immutable_figure(old_detail)
    assert art_rectangle(compact, detail) == art_rectangle(v27, old_detail)
    assert detail["overviewPage"] == new_figures[detail["parentFigure"]]["page"]

    text_height = layout["textLineHeight"]
    image_height = layout["imageLayoutLineHeight"]
    maximum_bottom = 0
    by_page: dict[int, list[tuple[int, int, str]]] = defaultdict(list)
    for item in compact["placements"]:
        expected_reserve = math.ceil((item["rows"] * image_height + 2.0) / text_height) + 3
        assert item["reservedTextRows"] == expected_reserve, item["number"]
        expected_y = round(
            (2 + item["textStartRow"] + layout["figureTopMarginTextRows"])
            * text_height / image_height
        )
        assert item["imageY"] == expected_y, item["number"]
        bottom = item["imageY"] + item["rows"]
        assert bottom <= layout["maximumActiveImageBottom"], item["number"]
        maximum_bottom = max(maximum_bottom, bottom)

        caption_row = 2 + item["textStartRow"] + item["reservedTextRows"] - 1
        intended_top = (2 + item["textStartRow"] + 1) * text_height
        actual_top = item["imageY"] * image_height
        assert abs(actual_top - intended_top) <= image_height / 2 + 1e-9
        actual_bottom = bottom * image_height + 2.0
        assert actual_bottom <= caption_row * text_height + 1e-9

        text_rows = compact["textPages"][item["page"] - 1].split("\r\n")
        assert caption_row < len(text_rows)
        assert text_rows[caption_row] == item["alt"].rstrip(".") + "."
        reserved = text_rows[2 + item["textStartRow"]:caption_row]
        if item["sideTextColumns"]:
            assert all(len(row) <= item["sideTextColumns"] for row in reserved)
        else:
            assert all(not row for row in reserved)
        by_page[item["page"]].append((item["imageY"], bottom, f"Fig. {item['number']}"))

    expected_detail_reserve = math.ceil(
        (detail["rows"] * image_height + 2.0) / text_height
    ) + 3
    assert detail["reservedTextRows"] == expected_detail_reserve
    assert detail["imageY"] == round(2 * text_height / image_height)
    detail_bottom = detail["imageY"] + detail["rows"]
    assert detail_bottom <= layout["maximumActiveImageBottom"]
    maximum_bottom = max(maximum_bottom, detail_bottom)
    detail_caption_row = 2 + detail["reservedTextRows"] - 1
    detail_rows = compact["textPages"][detail["page"] - 1].split("\r\n")
    assert detail_rows[detail_caption_row] == detail["caption"]
    assert all(not row for row in detail_rows[2:detail_caption_row])
    assert detail_bottom * image_height + 2.0 <= detail_caption_row * text_height
    by_page[detail["page"]].append((detail["imageY"], detail_bottom, "Fig. 3 detail"))

    for page_number, intervals in by_page.items():
        intervals.sort()
        for prior, current in zip(intervals, intervals[1:]):
            assert prior[1] <= current[0], (
                f"Image rectangles overlap on page {page_number}: {prior[2]} and {current[2]}"
            )

    figure12 = new_figures[12]
    figure13 = new_figures[13]
    assert figure12["page"] == figure13["page"] == 22
    assert figure12["imageY"] + figure12["rows"] == 102
    assert figure13["imageY"] + figure13["rows"] == 213

    maximum_band_bytes = assert_four_band_reconstruction(compact)
    assert maximum_bottom == 238
    assert maximum_band_bytes == max(max(values) for values in compact["imageBandBytes"])

    print(json.dumps({
        "pages": len(compact["textPages"]),
        "spreads": math.ceil(len(compact["textPages"]) / 2),
        "figures": len(compact["placements"]),
        "detailViews": len(compact["detailViews"]),
        "maximumImageBottom": maximum_bottom,
        "maximumBandBytes": maximum_band_bytes,
        "proseLinesRetained": sum(prose_counter(compact).values()),
        "artRectanglesIdentical": len(compact["placements"]) + len(compact["detailViews"]),
    }, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Verify that the Opticks historical layout follows the 1730 foliation."""

from __future__ import annotations

from collections import Counter, defaultdict
import html
import importlib.util
import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "tools/image-to-braille/sources/gutenberg-33504/33504-h/33504-h.htm"
GENERATOR = ROOT / "tools/prefabs/generate-opticks-historical-pages.py"
HISTORICAL = ROOT / "tools/prefabs/opticks-four-display-pages-v29-historical.json"
BLANK_CELL = "\u2800"
PRINTED_PAGE_COUNT = 406
LEADING_BLANK_ENTRIES = 1
STORED_PAGE_COUNT = LEADING_BLANK_ENTRIES + PRINTED_PAGE_COUNT
BLANK_PRINTED_PAGES = (112, 192, 316)
BAND_KEYS = tuple(f"imagePages{name}" for name in "ABCD")


def page_rows(value: str) -> list[str]:
    """Normalize legal blank-cell forms while preserving row positions."""
    if not value:
        return []
    return [line.replace(BLANK_CELL, " ").rstrip(" ") for line in value.split("\r\n")]


def source_figure_events() -> list[tuple[str, int]]:
    """Return the 1730 printed page containing each Gutenberg figure."""
    source = HTML.read_text("utf8")
    event_pattern = re.compile(
        r'<span class=[\'\"]pagenum[\'\"]>.*?Page_(\d+).*?</span>'
        r'|<img\s+src=[\'\"]([^\'\"]+)[\'\"]',
        re.IGNORECASE | re.DOTALL,
    )
    page: int | None = None
    figures: list[tuple[str, int]] = []
    for event in event_pattern.finditer(source):
        if event.group(1):
            page = int(event.group(1))
        else:
            assert page is not None, f"Figure precedes printed page 1: {event.group(2)}"
            figures.append((html.unescape(event.group(2)), page))
    return figures


def canonical_words(value: str) -> list[str]:
    """Normalize display wrapping while retaining source word order."""
    value = value.replace("Æ", "AE").replace("æ", "ae")
    value = value.replace("Œ", "OE").replace("œ", "oe")
    decomposed = unicodedata.normalize("NFKD", value)
    value = "".join(character for character in decomposed if not unicodedata.combining(character))
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", value.casefold())


def displayed_prose(value: str, captions: set[str]) -> str:
    if not value:
        return ""
    rows = value.split("\r\n")[1:]
    return " ".join(
        row.strip() for row in rows
        if row.strip() and row.strip() not in captions
    )


def source_parser():
    spec = importlib.util.spec_from_file_location("opticks_historical_generator", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.parse_source()


def subsequence_count(values: list[str], target: list[str]) -> int:
    assert target
    return sum(
        values[index:index + len(target)] == target
        for index in range(len(values) - len(target) + 1)
    )


def assert_prose_order(historical: dict) -> None:
    """Compare every page's prose events and relocated footnotes to the HTML."""
    parsed = source_parser()
    captions = {
        item["alt"].rstrip(".") + "." for item in historical["placements"]
    }
    actual_by_page: dict[int, list[str]] = {}
    for printed_page in range(1, PRINTED_PAGE_COUNT + 1):
        actual = displayed_prose(historical["textPages"][printed_page], captions)
        actual_by_page[printed_page] = canonical_words(actual)
        expected = " ".join(
            event["text"] for event in parsed.pages[printed_page]
            if event["type"] == "text"
        )
        assert actual_by_page[printed_page] == canonical_words(expected), (
            f"Printed page {printed_page} changed or reordered its source prose"
        )

    footnotes = [
        (page, event["text"])
        for page in range(1, PRINTED_PAGE_COUNT + 1)
        for event in parsed.pages[page]
        if event["type"] == "text" and event["kind"] == "footnote"
    ]
    assert len(footnotes) == 13
    for reference_page, note in footnotes:
        note_words = canonical_words(note)
        assert subsequence_count(actual_by_page[reference_page], note_words) == 1
        assert sum(
            subsequence_count(words, note_words)
            for words in actual_by_page.values()
        ) == 1, f"Footnote from page {reference_page} is duplicated or misplaced"


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
        assert reconstructed == original, f"Band reconstruction failed at entry {page_index}"
    return maximum_bytes


def art_rectangle(data: dict, item: dict) -> tuple[str, ...]:
    """Extract the fixed figure rectangle from its stored image page."""
    page_index = item["page"] - 1
    rows = data["imagePages"][page_index].split("\r\n")
    extracted: list[str] = []
    for row_index in range(item["imageY"], item["imageY"] + item["rows"]):
        line = rows[row_index] if row_index < len(rows) else ""
        line = line.replace(" ", BLANK_CELL)
        extracted.append(
            line[item["imageX"]:item["imageX"] + item["columns"]]
            .ljust(item["columns"], BLANK_CELL)
        )
    return tuple(extracted)


def rectangles_overlap(left: dict, right: dict) -> bool:
    return (
        left["imageX"] < right["imageX"] + right["columns"]
        and right["imageX"] < left["imageX"] + left["columns"]
        and left["imageY"] < right["imageY"] + right["rows"]
        and right["imageY"] < left["imageY"] + left["rows"]
    )


def main() -> None:
    historical = json.loads(HISTORICAL.read_text("utf8"))
    layout = historical["layout"]

    assert layout["historicalPagination"] is True
    assert layout["historicalEdition"] == "Fourth Edition, corrected (London, 1730)"
    assert layout["originalPageRange"] == [1, PRINTED_PAGE_COUNT]
    assert layout["leadingBlankPages"] == LEADING_BLANK_ENTRIES
    assert layout["sourcePageAnchors"] == 403
    assert layout["blankOriginalPages"] == list(BLANK_PRINTED_PAGES)
    assert layout["frontMatterPolicy"] == "excluded"
    assert layout["customDetailPages"] == 0
    assert historical.get("detailViews", []) == []

    assert len(historical["textPages"]) == STORED_PAGE_COUNT
    for key in ("imagePages", *BAND_KEYS):
        assert len(historical[key]) == STORED_PAGE_COUNT, key

    # The first blank makes printed page 1 the right leaf. Printed page N is
    # therefore always stored at zero-based index N.
    assert historical["textPages"][0] == ""
    assert historical["imagePages"][0] == ""
    assert all(historical[key][0] == "" for key in BAND_KEYS)
    for printed_page in range(1, PRINTED_PAGE_COUNT + 1):
        value = historical["textPages"][printed_page]
        if printed_page in BLANK_PRINTED_PAGES:
            assert value == "", f"Printed blank page {printed_page} contains prose"
            assert historical["imagePages"][printed_page] == ""
            assert all(historical[key][printed_page] == "" for key in BAND_KEYS)
        else:
            assert value.split("\r\n", 1)[0] == str(printed_page), printed_page
        assert len(value.encode("utf8")) < 32767

    expected_events = source_figure_events()
    assert len(expected_events) == 57
    placements = historical["placements"]
    assert len(placements) == 57
    assert [item["number"] for item in placements] == list(range(1, 58))
    assert [(item["source"], item["originalPage"]) for item in placements] == expected_events
    assert len({item["source"] for item in placements}) == 57
    assert all(item["page"] == item["originalPage"] + 1 for item in placements)

    by_number = {item["number"]: item for item in placements}
    assert by_number[3]["originalPage"] == 9
    assert by_number[12]["originalPage"] == 27
    assert by_number[13]["originalPage"] == 27
    assert by_number[15]["originalPage"] == 38
    assert not any(item["originalPage"] in BLANK_PRINTED_PAGES for item in placements)

    page_width = layout["maximumImageColumns"]
    page_height = layout.get("maximumActiveImageBottom", layout["maximumImageRows"])
    by_page: dict[int, list[dict]] = defaultdict(list)
    for item in placements:
        assert item["columns"] > 0 and item["rows"] > 0
        assert 0 <= item["imageX"]
        assert 0 <= item["imageY"]
        assert item["imageX"] + item["columns"] <= page_width, item["number"]
        assert item["imageY"] + item["rows"] <= page_height, item["number"]
        rectangle = art_rectangle(historical, item)
        assert len(rectangle) == item["rows"]
        assert all(len(row) == item["columns"] for row in rectangle)
        assert any(row.replace(BLANK_CELL, "") for row in rectangle), item["number"]
        by_page[item["page"]].append(item)

    for page, items in by_page.items():
        for left_index, left in enumerate(items):
            for right in items[left_index + 1:]:
                assert not rectangles_overlap(left, right), (
                    f"Figures {left['number']} and {right['number']} overlap "
                    f"on stored page {page}"
                )

    active_image_pages = {
        index + 1
        for index, value in enumerate(historical["imagePages"])
        if value.replace("\r", "").replace("\n", "").replace(BLANK_CELL, "").strip()
    }
    assert active_image_pages == set(by_page), (
        "Image canvas exists without a figure placement, or vice versa"
    )

    assert_prose_order(historical)
    maximum_band_bytes = assert_four_band_reconstruction(historical)
    assert maximum_band_bytes == max(
        max(values) for values in historical["imageBandBytes"]
    )

    source_page_counts = Counter(page for _, page in expected_events)
    print(json.dumps({
        "storedPages": STORED_PAGE_COUNT,
        "printedPages": PRINTED_PAGE_COUNT,
        "spreads": (STORED_PAGE_COUNT + 1) // 2,
        "blankPrintedPages": list(BLANK_PRINTED_PAGES),
        "figures": len(placements),
        "illustratedPrintedPages": len(source_page_counts),
        "maximumBandBytes": maximum_band_bytes,
        "proseOrderRetained": True,
    }, indent=2))


if __name__ == "__main__":
    main()

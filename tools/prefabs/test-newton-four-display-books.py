#!/usr/bin/env python3
"""Structural regression checks for the Newton four-display collection."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PREFABS = ROOT / "tools/prefabs"
SOURCES = ROOT / "tools/image-to-braille/sources"
BLANK = "\u2800"

BOOKS = {
    "newton-principia-latin-four-display-pages.json": {
        "figures": 181, "formulae": 0, "source": "gutenberg-28233",
        "html": "28233-h/28233-h.htm",
        "needles": ["LIBER PRIMUS", "LIBER SECUNDUS", "LIBER TERTIUS", "FINIS"],
    },
    "newton-principia-english-four-display-pages.json": {
        "figures": 274, "formulae": 1936, "source": "gutenberg-76404",
        "html": "76404-h.htm",
        "needles": ["BOOK I.", "BOOK II.", "BOOK III.", "GENERAL SCHOLIUM", "THE SYSTEM OF THE WORLD."],
    },
    "newton-system-of-the-world-four-display-pages.json": {
        "figures": 13, "formulae": 132, "source": "gutenberg-76404",
        "html": "system-of-world.html",
        "needles": ["THE SYSTEM OF THE WORLD.", "Q.E.F."],
    },
    "newton-chronology-four-display-pages.json": {
        "figures": 3, "formulae": 0, "source": "gutenberg-15784",
        "html": "15784-h/15784-h.htm",
        "needles": ["CHRONOLOGY", "CHAP. I.", "CHAP. VI."],
    },
    "newton-observations-four-display-pages.json": {
        "figures": 0, "formulae": 0, "source": "gutenberg-16878",
        "html": "16878-h/16878-h.htm",
        "needles": ["OBSERVATIONS", "PART I.", "PART II.", "FINIS."],
    },
}


def verify_checksums(directory: Path) -> None:
    for line in (directory / "SHA256SUMS").read_text("utf8").splitlines():
        expected, relative = line.split("  ", 1)
        actual = hashlib.sha256((directory / relative).read_bytes()).hexdigest()
        assert actual == expected, f"Checksum mismatch: {directory.name}/{relative}"


def expected_bands(page: str) -> tuple[list[str], list[list[int]]]:
    rows = [line.replace(BLANK, " ") for line in page.split("\r\n")] if page else []
    while rows and not rows[-1]:
        rows.pop()
    count = len(rows)
    prefix = [0]
    for row in rows:
        prefix.append(prefix[-1] + len(row.encode("utf8")))

    def cost(start: int, end: int) -> int:
        if start == end:
            return 0
        return 2 * start + prefix[end] - prefix[start] + 2 * (end - start - 1)

    infinity = 1 << 60
    scores = [[infinity] * (count + 1) for _ in range(5)]
    previous = [[None] * (count + 1) for _ in range(5)]
    scores[0][0] = 0
    for band in range(1, 5):
        for end in range(count + 1):
            for start in range(end + 1):
                score = max(scores[band - 1][start], cost(start, end))
                if score < scores[band][end]:
                    scores[band][end] = score
                    previous[band][end] = start
    cuts = [count]
    end = count
    for band in range(4, 0, -1):
        start = previous[band][end]
        assert start is not None
        cuts.append(start)
        end = start
    cuts.reverse()
    ranges = [[cuts[i], cuts[i + 1]] for i in range(4)]
    values = [
        "" if start == end else "\r\n" * start + "\r\n".join(rows[start:end])
        for start, end in ranges
    ]
    return values, ranges


def check_book(filename: str, expected: dict) -> dict:
    path = PREFABS / filename
    data = json.loads(path.read_text("utf8"))
    page_count = len(data["textPages"])
    assert page_count > 0
    keys = ["imagePages", "imagePagesA", "imagePagesB", "imagePagesC", "imagePagesD"]
    assert all(len(data[key]) == page_count for key in keys)
    assert len(data["placements"]) == expected["figures"]
    assert data["formulaImagesTranscribed"] == expected["formulae"]
    assert data["layout"]["imageLineHeight"] == 0.075
    assert data["layout"]["imageLayoutLineHeight"] == 0.084
    assert data["layout"]["imageWidthScale"] == 1.2
    assert data["layout"]["imageFont"] == "IosevkaTerm"
    assert data["layout"]["imageKerning"] == -6

    combined_text = "\n".join(data["textPages"])
    searchable_text = re.sub(r"\s+", " ", combined_text).casefold()
    assert "Project Gutenberg License" not in combined_text
    assert "End of the Project Gutenberg" not in combined_text
    for needle in expected["needles"]:
        assert needle.casefold() in searchable_text, (filename, needle)
    if expected["formulae"]:
        assert "\\" not in combined_text, f"Unconverted TeX in {filename}"

    for index, page in enumerate(data["textPages"], 1):
        assert page.startswith(f"{index}\r\n\r\n")
        assert "\n" not in page.replace("\r\n", "")
        body = page.split("\r\n")[2:]
        assert len(body) <= data["layout"]["textBodyRows"], (filename, index, len(body))
        assert max(map(len, body), default=0) <= data["layout"]["textColumns"], (filename, index)

    bands = [data[f"imagePages{letter}"] for letter in "ABCD"]
    for index, page in enumerate(data["imagePages"]):
        assert re.fullmatch(r"[\u2800-\u28ff \r\n]*", page)
        expected_values, expected_ranges = expected_bands(page)
        actual_values = [band[index] for band in bands]
        assert actual_values == expected_values, (filename, index + 1, "band reconstruction")
        assert data["imageBandRanges"][index] == expected_ranges
        sizes = [len(value.encode("utf8")) for value in actual_values]
        assert data["imageBandBytes"][index] == sizes
        assert max(sizes, default=0) < 32767

    figure_root = SOURCES / expected["source"] / Path(expected["html"]).parent
    for placement in data["placements"]:
        assert (figure_root / placement["source"]).is_file()
        assert 1 <= placement["page"] <= page_count
        assert data["imagePages"][placement["page"] - 1]
    for detail in data["detailViews"]:
        source = figure_root / detail["source"]
        assert source.is_file()
        with Image.open(source) as image:
            left, top, right, bottom = detail["crop"]
            assert 0 <= left < right <= image.width
            assert 0 <= top < bottom <= image.height
        assert 1 <= detail["overviewPage"] < detail["page"] <= page_count
        assert data["imagePages"][detail["page"] - 1]

    return {
        "book": filename, "pages": page_count,
        "figures": len(data["placements"]), "details": len(data["detailViews"]),
        "maxBandBytes": max(max(row, default=0) for row in data["imageBandBytes"]),
    }


def main() -> None:
    for source in sorted({spec["source"] for spec in BOOKS.values()}):
        verify_checksums(SOURCES / source)
    for filename, expected in BOOKS.items():
        print(json.dumps(check_book(filename, expected), ensure_ascii=False))


if __name__ == "__main__":
    main()

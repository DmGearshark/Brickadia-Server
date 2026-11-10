#!/usr/bin/env python3
"""Generate Newton books with the proven Opticks v25 display layout."""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import math
import re
import textwrap
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "tools/image-to-braille/sources"
OUTPUT_DIR = ROOT / "tools/prefabs"

# Locked live-tested Opticks v25 calibration.
TEXT_BODY_ROWS = 48
TEXT_COLUMNS = 72
TEXT_LINE_HEIGHT = 0.50
IMAGE_RENDER_LINE_HEIGHT = 0.075
IMAGE_LAYOUT_LINE_HEIGHT = 0.084
IMAGE_WIDTH_SCALE = 1.20
IMAGE_OUTLINE_WIDTH = 4
IMAGE_FONT = "IosevkaTerm"
IMAGE_KERNING = -6
IMAGE_ADVANCE_SCALE = 0.115
TEXT_WIDTH_SCALE = 0.82
MIN_FIGURE_COLUMNS = 400
PAGE_IMAGE_COLUMNS = 600
MAX_IMAGE_ROWS = 245
IMAGE_LAYER_OFFSET_DELTA = 2.0
MAX_ARRAY_ENTRY_BYTES = 32766
TARGET_ARRAY_ENTRY_BYTES = 30000
DETAIL_WIDTH_THRESHOLD = 300
DETAIL_CROP_HEIGHT_RATIO = 1.25
DETAIL_CROP_OVERLAP = 0.18
MAX_DETAIL_CROPS = 8
BLANK = "\u2800"

_converter_spec = importlib.util.spec_from_file_location(
    "image_to_braille_converter", ROOT / "tools/image-to-braille/convert.py"
)
assert _converter_spec and _converter_spec.loader
_converter = importlib.util.module_from_spec(_converter_spec)
_converter_spec.loader.exec_module(_converter)


@dataclass(frozen=True)
class TextToken:
    line: str


@dataclass(frozen=True)
class FigureToken:
    source: str
    alt: str
    kind: str = "line-art"


Token = TextToken | FigureToken

BOOKS = {
    "principia-latin": {
        "title": "Philosophiae Naturalis Principia Mathematica",
        "name": "Newton Principia Mathematica - Complete 1687 Latin Edition",
        "description": "Complete 1687 Latin Principia from Project Gutenberg 28233, with all three books and every source diagram rendered through four live-calibrated pure-Braille image displays.",
        "source": "Project Gutenberg ebook 28233 (complete 1687 Latin first edition)",
        "sourceRoot": SOURCES / "gutenberg-28233",
        "text": "28233-8.txt", "html": "28233-h/28233-h.htm", "encoding": "latin-1", "htmlEncoding": "latin-1",
        "start": "Transcriber's note:", "end": "End of the Project Gutenberg EBook",
        "figurePattern": r"images/\d+[a-z]?\.png$",
        "output": "newton-principia-latin-four-display-pages.json", "expectedFigures": 181,
    },
    "chronology": {
        "title": "The Chronology of Ancient Kingdoms Amended",
        "name": "Newton Chronology of Ancient Kingdoms - Complete Edition",
        "description": "Complete text of Newton's Chronology of Ancient Kingdoms Amended from Project Gutenberg 15784, including all three original plates.",
        "source": "Project Gutenberg ebook 15784",
        "sourceRoot": SOURCES / "gutenberg-15784",
        "text": "15784-0.txt", "html": "15784-h/15784-h.htm", "encoding": "utf-8-sig", "htmlEncoding": "latin-1",
        "start": "\nTHE\nCHRONOLOGY\nOF\nANCIENT KINGDOMS", "end": "End of the Project Gutenberg EBook",
        "figurePattern": r"images/plate(?:I|II|III)\.png$",
        "output": "newton-chronology-four-display-pages.json", "expectedFigures": 3,
    },
    "observations": {
        "title": "Observations upon the Prophecies of Daniel and the Apocalypse of St. John",
        "name": "Newton Observations upon the Prophecies - Complete Edition",
        "description": "Complete text of Newton's Observations upon the Prophecies of Daniel and the Apocalypse of St. John from Project Gutenberg 16878.",
        "source": "Project Gutenberg ebook 16878",
        "sourceRoot": SOURCES / "gutenberg-16878",
        "text": "16878.txt", "html": "16878-h/16878-h.htm", "encoding": "utf-8-sig", "htmlEncoding": "latin-1",
        "start": "\nOBSERVATIONS\nUPON THE\nPROPHECIES", "end": "End of the Project Gutenberg EBook",
        "figurePattern": None,
        "output": "newton-observations-four-display-pages.json", "expectedFigures": 0,
    },
    "principia-english": {
        "title": "Newton's Principia: The Mathematical Principles of Natural Philosophy",
        "name": "Newton Principia - Complete Motte English Edition",
        "description": "Complete Andrew Motte English Principia from Project Gutenberg 76404: Books I-III, The System of the World, inline formula text, and all 274 source illustrations on four pure-Braille displays.",
        "source": "Project Gutenberg ebook 76404 (1846 Chittenden edition of the Andrew Motte translation)",
        "sourceRoot": SOURCES / "gutenberg-76404", "html": "76404-h.htm",
        "output": "newton-principia-english-four-display-pages.json",
        "expectedFigures": 274, "expectedFormulaImages": 1936, "expectedTables": 33,
        "adapter": "html", "htmlMode": "principia",
    },
    "system-of-the-world": {
        "title": "The System of the World",
        "name": "Newton The System of the World - Complete Edition",
        "description": "Complete System of the World from Project Gutenberg 76404, extracted as a standalone Newton volume with all 13 original figures and readable inline formulae.",
        "source": "The System of the World section of Project Gutenberg ebook 76404 (1846 Motte/Chittenden edition)",
        "sourceRoot": SOURCES / "gutenberg-76404", "html": "system-of-world.html",
        "output": "newton-system-of-the-world-four-display-pages.json",
        "expectedFigures": 13, "expectedFormulaImages": 132, "expectedTables": 6,
        "adapter": "html", "htmlMode": "system",
    },
}


class ImageListParser(HTMLParser):
    def __init__(self, pattern: str) -> None:
        super().__init__()
        self.pattern = re.compile(pattern, re.I)
        self.images: list[FigureToken] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() != "img":
            return
        values = dict(attrs)
        source = values.get("src", "")
        if self.pattern.search(source):
            self.images.append(FigureToken(
                source, html.unescape(values.get("alt") or values.get("title") or "Illustration")
            ))


def tex_to_plain(source: str) -> str:
    """Turn Project Gutenberg data-tex into compact readable display text."""
    value = html.unescape(source).strip().replace("\n", " ")
    value = re.sub(r"\\begin\{(?:matrix|array)\}", "[", value)
    value = re.sub(r"\\end\{(?:matrix|array)\}", "]", value)
    value = value.replace("\\\\", "; ")
    value = re.sub(r"\\(?:left|right)\.?", "", value)
    for _ in range(12):
        old = value
        value = re.sub(r"\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", value)
        value = re.sub(r"\\sqrt\s*\[([^{}]*)\]\s*\{([^{}]*)\}", r"root[\1](\2)", value)
        value = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r"sqrt(\1)", value)
        value = re.sub(r"\\(?:mathrm|mathit|mathbf|textit|textbf|text|operatorname)\s*\{([^{}]*)\}", r"\1", value)
        value = re.sub(r"\\overline\s*\{([^{}]*)\}", r"overline(\1)", value)
        value = re.sub(r"\^\s*\{([^{}]*)\}", r"^(\1)", value)
        value = re.sub(r"_\s*\{([^{}]*)\}", r"_(\1)", value)
        if value == old:
            break
    commands = {
        "times": "×", "cdot": "·", "pm": "±", "mp": "∓", "infty": "∞",
        "leq": "≤", "geq": "≥", "neq": "≠", "approx": "≈", "sim": "~",
        "propto": "∝", "vert": "|", "alpha": "α", "beta": "β", "gamma": "γ",
        "delta": "δ", "epsilon": "ε", "theta": "θ", "lambda": "λ", "mu": "μ",
        "pi": "π", "rho": "ρ", "sigma": "σ", "phi": "φ", "omega": "ω",
        "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Pi": "Π",
        "Sigma": "Σ", "Phi": "Φ", "Omega": "Ω",
    }
    for command, replacement in commands.items():
        value = re.sub(rf"\\{command}\b", replacement, value)
    value = value.replace("\\&", "&").replace("\\(", "").replace("\\)", "")
    value = value.replace("\\{", "{").replace("\\}", "}")
    value = re.sub(r"\\\s", " ", value)
    value = re.sub(r"\\(?:quad|qquad)\b|\\[,;:!]", " ", value)
    value = re.sub(r"\\([A-Za-z]+)", r"\1", value)
    value = value.replace("{", "(").replace("}", ")")
    value = re.sub(r"\[[\s;\\]*\]", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    if "\\" in value:
        raise ValueError(f"Unconverted TeX control in {source!r}: {value!r}")
    return value


class Gutenberg76404Parser(HTMLParser):
    """Extract historical prose, formula source, and JPG figures from PG 76404."""

    BLOCK_TAGS = {
        "address", "blockquote", "caption", "dd", "div", "dt", "figcaption",
        "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "pre", "section",
        "td", "th", "tr",
    }
    IGNORED_TAGS = {"script", "style", "nav"}

    def __init__(self, mode: str = "principia") -> None:
        super().__init__(convert_charrefs=True)
        self.mode = mode
        self.active = False
        self.done = False
        self.ignore_depth = 0
        self.current: list[str] = []
        self.tokens: list[Token] = []
        self.formula_count = 0
        self.table_count = 0
        self._supsub: list[str] = []
        self._suppressed_tag: str | None = None
        self._in_table = False
        self._table_rows: list[list[str]] = []
        self._table_row: list[str] | None = None
        self._table_cell: list[str] | None = None
        self._table_misc: list[str] = []

    @staticmethod
    def _clean_cell(parts: list[str]) -> str:
        return re.sub(r"\s+", " ", "".join(parts)).strip()

    def _finish_table_cell(self) -> None:
        if self._table_cell is not None:
            if self._table_row is None:
                self._table_row = []
            self._table_row.append(self._clean_cell(self._table_cell))
            self._table_cell = None

    def _finish_table_row(self) -> None:
        self._finish_table_cell()
        if self._table_row is not None and any(self._table_row):
            self._table_rows.append(self._table_row)
        self._table_row = None

    def _finish_table(self) -> None:
        self._finish_table_row()
        misc = self._clean_cell(self._table_misc)
        if misc:
            for line in textwrap.wrap(misc, TEXT_COLUMNS) or [misc]:
                self.tokens.append(TextToken(line))
        for row in self._table_rows:
            joined = " | ".join(cell for cell in row if cell)
            for line in textwrap.wrap(
                joined, TEXT_COLUMNS, subsequent_indent="  ",
                break_long_words=True, break_on_hyphens=False,
            ) or [joined]:
                self.tokens.append(TextToken(line))
        if misc or self._table_rows:
            self.tokens.append(TextToken(""))
        self.table_count += 1
        self._in_table = False
        self._table_rows = []
        self._table_row = None
        self._table_cell = None
        self._table_misc = []

    def _flush(self) -> None:
        if not self.current:
            return
        raw = "".join(self.current)
        self.current = []
        emitted = False
        for raw_line in raw.splitlines() or [raw]:
            line = re.sub(r"[\t \u00a0]+", " ", raw_line).strip()
            if not line:
                continue
            for wrapped in textwrap.wrap(
                line, width=TEXT_COLUMNS, break_long_words=True,
                break_on_hyphens=False,
            ) or [line]:
                self.tokens.append(TextToken(wrapped))
                emitted = True
        if emitted:
            self.tokens.append(TextToken(""))

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if self.done:
            return
        if tag in self.IGNORED_TAGS:
            self.ignore_depth += 1
            return
        values = dict(attrs)
        if not self.active and self.mode == "system" and values.get("id") == "THE_SYSTEM_OF_THE_WORLD":
            self.active = True
        if self.ignore_depth or not self.active:
            return
        if "pagenum" in values.get("class", "").split():
            self._suppressed_tag = tag
            return
        if self._suppressed_tag:
            return
        if tag == "table":
            self._flush()
            self._in_table = True
            self._table_rows = []
            self._table_misc = []
            return
        if self._in_table:
            if tag == "tr":
                self._finish_table_row()
                self._table_row = []
            elif tag in {"td", "th"}:
                self._finish_table_cell()
                self._table_cell = []
            elif tag == "br":
                (self._table_cell if self._table_cell is not None else self._table_misc).append(" ")
            elif tag == "img" and values.get("data-tex") is not None:
                formula = tex_to_plain(values["data-tex"])
                (self._table_cell if self._table_cell is not None else self._table_misc).append(f" {formula} ")
                self.formula_count += 1
            return
        if tag == "img":
            tex = values.get("data-tex")
            source = values.get("src", "")
            if tex is not None:
                formula = tex_to_plain(tex)
                if formula:
                    self.current.append(f" {formula} ")
                self.formula_count += 1
            elif source.lower().endswith(".jpg"):
                self._flush()
                basename = Path(source).name.lower()
                kind = "engraving" if basename in {"cover.jpg", "i_001.jpg"} else "line-art"
                self.tokens.append(FigureToken(
                    source,
                    html.unescape(values.get("alt") or "Illustration"),
                    kind,
                ))
            return
        if tag in self.BLOCK_TAGS:
            self._flush()
        elif tag == "br":
            self.current.append("\n")
        elif tag == "sup":
            self.current.append("^(")
            self._supsub.append(")")
        elif tag == "sub":
            self.current.append("_(")
            self._supsub.append(")")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.IGNORED_TAGS:
            self.ignore_depth = max(0, self.ignore_depth - 1)
            return
        if self._suppressed_tag == tag:
            self._suppressed_tag = None
            return
        if self.ignore_depth or not self.active or self.done:
            return
        if self._in_table:
            if tag in {"td", "th"}:
                self._finish_table_cell()
            elif tag == "tr":
                self._finish_table_row()
            elif tag == "table":
                self._finish_table()
            return
        if tag in {"sup", "sub"} and self._supsub:
            self.current.append(self._supsub.pop())
        if tag in self.BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self.done or self.ignore_depth or self._suppressed_tag:
            return
        if not self.active:
            if self.mode == "principia" and "*** START OF THE PROJECT GUTENBERG EBOOK NEWTON'S PRINCIPIA ***" in data:
                self.active = True
            return
        reached_end = (
            self.mode == "principia"
            and "*** END OF THE PROJECT GUTENBERG EBOOK NEWTON'S PRINCIPIA ***" in data
        ) or (
            self.mode == "system" and "END OF THE SYSTEM OF THE WORLD." in data
        )
        if reached_end:
            self._flush()
            self.done = True
            self.active = False
            return
        if self._in_table:
            (self._table_cell if self._table_cell is not None else self._table_misc).append(data)
        else:
            self.current.append(data)


def clean_plain_line(raw: str) -> list[str]:
    line = raw.rstrip().replace("\t", "    ").replace("_", "")
    if not line.strip():
        return [""]
    leading = min(len(line) - len(line.lstrip()), 8)
    content = line.strip()
    width = max(16, TEXT_COLUMNS - leading)
    return textwrap.wrap(
        content,
        width=width,
        initial_indent=" " * leading,
        subsequent_indent=" " * leading,
        break_long_words=True,
        break_on_hyphens=False,
        replace_whitespace=False,
        drop_whitespace=True,
    ) or [" " * leading + content]


def plain_text_tokens(spec: dict) -> tuple[list[Token], int]:
    root: Path = spec["sourceRoot"]
    text = (root / spec["text"]).read_text(spec["encoding"])
    start = text.find(spec["start"])
    if start < 0:
        raise ValueError(f"Start marker missing from {spec['text']}: {spec['start']!r}")
    if spec["start"].startswith("\n"):
        start += 1
    end = text.find(spec["end"], start)
    if end < 0:
        raise ValueError(f"End marker missing from {spec['text']}: {spec['end']!r}")
    source = text[start:end].replace("\r\n", "\n")

    figures: list[FigureToken] = []
    if spec.get("figurePattern"):
        parser = ImageListParser(spec["figurePattern"])
        parser.feed((root / spec["html"]).read_text(spec.get("htmlEncoding", "utf8")))
        figures = parser.images

    tokens: list[Token] = []
    figure_index = 0
    marker_pattern = re.compile(r"\[Illustration(?:[^\]]*)\]", re.I)
    for raw in source.splitlines():
        markers = list(marker_pattern.finditer(raw))
        if markers:
            cursor = 0
            for marker in markers:
                before = raw[cursor:marker.start()]
                if before.strip():
                    tokens.extend(TextToken(line) for line in clean_plain_line(before))
                if figure_index >= len(figures):
                    raise ValueError(f"More illustration markers than HTML figures in {spec['title']}")
                tokens.append(figures[figure_index])
                figure_index += 1
                cursor = marker.end()
            after = raw[cursor:]
            if after.strip():
                tokens.extend(TextToken(line) for line in clean_plain_line(after))
            continue
        if re.fullmatch(r"\s*\[Illustration(?::[^\]]*)?\]\s*", raw, re.I):
            if figure_index >= len(figures):
                raise ValueError(f"More illustration markers than HTML figures in {spec['title']}")
            tokens.append(figures[figure_index])
            figure_index += 1
            continue
        for line in clean_plain_line(raw):
            if line or not tokens or not isinstance(tokens[-1], TextToken) or tokens[-1].line:
                tokens.append(TextToken(line))
    if figure_index != len(figures):
        raise ValueError(
            f"Mapped {figure_index} illustration markers but found {len(figures)} HTML figures in {spec['title']}"
        )
    return tokens, 0


def html_tokens(spec: dict) -> tuple[list[Token], int]:
    parser = Gutenberg76404Parser(spec.get("htmlMode", "principia"))
    parser.feed((spec["sourceRoot"] / spec["html"]).read_text("utf8"))
    parser.close()
    parser._flush()
    if not parser.done:
        raise ValueError(f"End marker missing from {spec['title']}")
    if parser.table_count != spec["expectedTables"]:
        raise ValueError(f"Expected {spec['expectedTables']} tables, extracted {parser.table_count}")
    return parser.tokens, parser.formula_count


def direct_mask(original: Image.Image, requested_columns: int, max_rows: int,
                threshold: float) -> np.ndarray:
    gray = ImageOps.autocontrast(original.convert("L"), cutoff=1)
    columns = min(requested_columns, max(1, math.floor(2 * max_rows * gray.width / gray.height)))
    rows = math.ceil(columns * gray.height / gray.width / 2)
    resized = gray.resize((2 * columns, 4 * rows), Image.Resampling.LANCZOS)
    return np.asarray(resized, dtype=np.float32) < (255 * threshold)


def convert_image(path: Path, requested_columns: int, max_rows: int,
                  kind: str, threshold: float = 0.72,
                  crop: tuple[int, int, int, int] | None = None) -> list[str]:
    original = Image.open(path).convert("L")
    if crop is not None:
        original = original.crop(crop)
    if kind == "engraving":
        # Continuous-tone cover and portrait: keep the source texture with a
        # conservative Atkinson pass instead of making a solid Braille block.
        columns = min(requested_columns, max(1, math.floor(2 * max_rows * original.width / original.height)))
        rows = math.ceil(columns * original.height / original.width / 2)
        gray = ImageOps.autocontrast(original, cutoff=1).resize(
            (2 * columns, 4 * rows), Image.Resampling.LANCZOS
        )
        dithered = _converter.atkinson(np.asarray(gray, dtype=np.uint8)) < 128
        return _converter.encode_mask(dithered)

    enabled = _converter.technical_mask(original, requested_columns, max_rows, threshold=threshold)
    direct = direct_mask(original, requested_columns, max_rows, threshold)
    retained = enabled.sum() / max(1, direct.sum())
    if retained < 0.55 or enabled.mean() < 0.004:
        enabled = direct
    return _converter.encode_mask(enabled)


def overlay_line(existing: str, art: str, x: int) -> str:
    width = max(len(existing), x + len(art))
    cells = [BLANK] * width
    cells[:len(existing)] = existing
    for index, char in enumerate(art):
        if char in {BLANK, " "}:
            continue
        old = cells[x + index]
        if old in {BLANK, " "}:
            cells[x + index] = char
        elif 0x2800 <= ord(old) <= 0x28FF and 0x2800 <= ord(char) <= 0x28FF:
            cells[x + index] = chr(0x2800 + ((ord(old) - 0x2800) | (ord(char) - 0x2800)))
    return "".join(cells).rstrip(BLANK)


def split_four_bands(page: str) -> tuple[list[str], list[list[int]]]:
    """Split a logical image page into four byte-balanced row bands."""
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
    previous: list[list[int | None]] = [[None] * (count + 1) for _ in range(5)]
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
    ranges = [[cuts[index], cuts[index + 1]] for index in range(4)]
    values = [
        "" if start == end else "\r\n" * start + "\r\n".join(rows[start:end])
        for start, end in ranges
    ]
    return values, ranges


def reserved_text_rows(image_rows: int) -> int:
    return math.ceil(
        (image_rows * IMAGE_LAYOUT_LINE_HEIGHT + IMAGE_LAYER_OFFSET_DELTA) / TEXT_LINE_HEIGHT
    ) + 2


def image_row_for_text(text_row: int) -> int:
    return round(text_row * TEXT_LINE_HEIGHT / IMAGE_LAYOUT_LINE_HEIGHT)


def maximum_image_rows(caption_rows: int) -> int:
    allowed_reserve = TEXT_BODY_ROWS - max(0, caption_rows - 1)
    for rows in range(MAX_IMAGE_ROWS, 0, -1):
        if reserved_text_rows(rows) <= allowed_reserve:
            return rows
    raise ValueError(f"Caption consumes the whole page ({caption_rows} rows)")


def figure_art(token: FigureToken, source_root: Path, caption_rows: int,
               crop: tuple[int, int, int, int] | None = None) -> tuple[list[str], int]:
    path = source_root / Path(token.source)
    if not path.is_file():
        raise FileNotFoundError(path)
    with Image.open(path) as original:
        source_width = original.width if crop is None else crop[2] - crop[0]
        initial_columns = min(PAGE_IMAGE_COLUMNS, max(MIN_FIGURE_COLUMNS, source_width))
    max_rows = maximum_image_rows(caption_rows)

    def evaluate(columns: int) -> tuple[list[str], int]:
        art = convert_image(path, columns, max_rows, token.kind, crop=crop)
        art_width = max(map(len, art), default=0)
        image_x = max(0, (PAGE_IMAGE_COLUMNS - art_width) // 2)
        image_y = image_row_for_text(2)
        canvas = [""] * (image_y + len(art))
        for row, art_line in enumerate(art):
            canvas[image_y + row] = overlay_line("", art_line, image_x)
        values, _ = split_four_bands("\r\n".join(canvas))
        largest = max((len(value.encode("utf8")) for value in values), default=0)
        return art, largest

    columns = initial_columns
    unsafe_upper: int | None = None
    best: tuple[list[str], int] | None = None
    while True:
        art, largest = evaluate(columns)
        if largest <= TARGET_ARRAY_ENTRY_BYTES:
            best = (art, columns)
            break
        unsafe_upper = columns - 1
        scale = math.sqrt(TARGET_ARRAY_ENTRY_BYTES / largest) * 0.98
        next_columns = max(120, math.floor(columns * min(0.90, scale)))
        if next_columns == columns:
            raise ValueError(f"Cannot fit {path} below the array byte limit")
        columns = next_columns

    # Recover the largest safe sampling width after the fast downward jump.
    if unsafe_upper is not None:
        lower = columns + 1
        upper = unsafe_upper
        while lower <= upper:
            candidate = (lower + upper) // 2
            art, largest = evaluate(candidate)
            if largest <= TARGET_ARRAY_ENTRY_BYTES:
                best = (art, candidate)
                lower = candidate + 1
            else:
                upper = candidate - 1
    assert best is not None
    return best


def vertical_detail_crops(token: FigureToken, source_root: Path) -> list[tuple[int, int, int, int]]:
    """Return overlapping full-width crops for a tall, narrow overview."""
    path = source_root / Path(token.source)
    with Image.open(path) as source:
        width, height = source.size
    window = min(height, max(1, round(width * DETAIL_CROP_HEIGHT_RATIO)))
    if height <= window * 1.35:
        return []
    step = max(1, round(window * (1.0 - DETAIL_CROP_OVERLAP)))
    starts = list(range(0, max(1, height - window + 1), step))
    final_start = height - window
    if starts and final_start - starts[-1] < step * 0.5:
        starts[-1] = final_start
    elif not starts or starts[-1] != final_start:
        starts.append(final_start)
    if len(starts) > MAX_DETAIL_CROPS:
        starts = [round(index * final_start / (MAX_DETAIL_CROPS - 1))
                  for index in range(MAX_DETAIL_CROPS)]
    return [(0, top, width, top + window) for top in dict.fromkeys(starts)]


def paginate(spec: dict, tokens: Iterable[Token], formula_count: int) -> dict:
    text_pages: list[str] = []
    image_pages: list[str] = []
    placements: list[dict] = []
    detail_views: list[dict] = []
    body: list[str] = []
    image_canvas: list[str] = []

    def flush() -> None:
        nonlocal body, image_canvas
        while body and body[-1] == "":
            body.pop()
        if not body and not image_canvas:
            return
        page_number = len(text_pages) + 1
        text_pages.append(f"{page_number}\r\n\r\n" + "\r\n".join(body))
        while image_canvas and not image_canvas[-1].replace(BLANK, ""):
            image_canvas.pop()
        image_pages.append("\r\n".join(image_canvas))
        body = []
        image_canvas = []

    def emit_line(line: str) -> None:
        nonlocal body
        if len(body) >= TEXT_BODY_ROWS:
            flush()
        if not line and (not body or body[-1] == ""):
            return
        body.append(line)
        if len(body) >= TEXT_BODY_ROWS:
            flush()

    def place_figure(number: int, token: FigureToken) -> None:
        nonlocal body, image_canvas
        # One drawing per logical image page avoids overlapping unrelated art
        # and keeps each four-array entry predictable.
        if body or image_canvas:
            flush()
        caption = token.alt.strip().replace("_", "") or f"Illustration {number}."
        caption_lines = textwrap.wrap(
            caption.rstrip(".") + ".",
            width=TEXT_COLUMNS,
            break_long_words=True,
            break_on_hyphens=False,
        ) or [f"Illustration {number}."]
        figure_root = spec["sourceRoot"] / Path(spec["html"]).parent
        art, requested_columns = figure_art(token, figure_root, len(caption_lines))
        reserve = reserved_text_rows(len(art)) - 1 + len(caption_lines)
        if len(body) + reserve > TEXT_BODY_ROWS:
            flush()
        text_start = len(body)
        image_y = image_row_for_text(2 + text_start)
        art_width = max(map(len, art), default=0)
        image_x = max(0, (PAGE_IMAGE_COLUMNS - art_width) // 2)
        image_canvas = [""] * (image_y + len(art))
        for row, art_line in enumerate(art):
            image_canvas[image_y + row] = overlay_line("", art_line, image_x)
        body.extend([""] * (reserved_text_rows(len(art)) - 1))
        body.extend(caption_lines)
        placements.append({
            "number": number, "source": token.source, "alt": token.alt,
            "kind": token.kind, "page": len(text_pages) + 1,
            "textStartRow": text_start, "reservedTextRows": reserve,
            "imageX": image_x, "imageY": image_y,
            "requestedColumns": requested_columns,
            "columns": art_width, "rows": len(art),
        })
        overview_page = len(text_pages) + 1
        crops = (
            vertical_detail_crops(token, figure_root)
            if token.kind == "line-art" and art_width < DETAIL_WIDTH_THRESHOLD
            else []
        )
        if crops:
            flush()
            for detail_number, crop in enumerate(crops, 1):
                detail_caption = (
                    f"{caption.rstrip('.')} — enlarged vertical detail "
                    f"{detail_number} of {len(crops)}."
                )
                detail_caption_lines = textwrap.wrap(
                    detail_caption, width=TEXT_COLUMNS,
                    break_long_words=True, break_on_hyphens=False,
                )
                detail_art, detail_requested_columns = figure_art(
                    token, figure_root, len(detail_caption_lines), crop=crop
                )
                detail_reserve = reserved_text_rows(len(detail_art)) - 1 + len(detail_caption_lines)
                detail_image_y = image_row_for_text(2)
                detail_width = max(map(len, detail_art), default=0)
                detail_image_x = max(0, (PAGE_IMAGE_COLUMNS - detail_width) // 2)
                image_canvas = [""] * (detail_image_y + len(detail_art))
                for row, art_line in enumerate(detail_art):
                    image_canvas[detail_image_y + row] = overlay_line("", art_line, detail_image_x)
                body.extend([""] * (reserved_text_rows(len(detail_art)) - 1))
                body.extend(detail_caption_lines)
                detail_views.append({
                    "name": f"vertical-{detail_number}",
                    "parentFigure": number, "overviewPage": overview_page,
                    "source": token.source, "crop": list(crop),
                    "caption": detail_caption, "page": len(text_pages) + 1,
                    "textStartRow": 0, "reservedTextRows": detail_reserve,
                    "imageX": detail_image_x, "imageY": detail_image_y,
                    "requestedColumns": detail_requested_columns,
                    "columns": detail_width, "rows": len(detail_art),
                })
                flush()
        elif len(body) >= TEXT_BODY_ROWS:
            flush()

    figure_number = 0
    for token in tokens:
        if isinstance(token, FigureToken):
            figure_number += 1
            place_figure(figure_number, token)
        else:
            emit_line(token.line)
    flush()

    if figure_number != spec["expectedFigures"]:
        raise ValueError(f"Expected {spec['expectedFigures']} figures, generated {figure_number}")
    if "expectedFormulaImages" in spec and formula_count != spec["expectedFormulaImages"]:
        raise ValueError(f"Expected {spec['expectedFormulaImages']} formula images, extracted {formula_count}")
    if len(text_pages) != len(image_pages):
        raise AssertionError("Text and image page counts differ")

    image_page_bands: list[list[str]] = [[] for _ in range(4)]
    image_band_ranges: list[list[list[int]]] = []
    image_band_bytes: list[list[int]] = []
    for page_number, page in enumerate(image_pages, 1):
        values, ranges = split_four_bands(page)
        sizes = [len(value.encode("utf8")) for value in values]
        if max(sizes, default=0) > MAX_ARRAY_ENTRY_BYTES:
            raise ValueError(f"Page {page_number} exceeds array limit: {sizes}")
        for band, value in enumerate(values):
            image_page_bands[band].append(value)
        image_band_ranges.append(ranges)
        image_band_bytes.append(sizes)

    return {
        "name": spec["name"], "description": spec["description"],
        "title": spec["title"], "source": spec["source"],
        "representation": "Complete source text with source-derived native-font pure-Braille figures in four synchronized byte-balanced image arrays",
        "formulaImagesTranscribed": formula_count,
        "layout": {
            "textBodyRows": TEXT_BODY_ROWS, "textColumns": TEXT_COLUMNS,
            "textLineHeight": TEXT_LINE_HEIGHT,
            "imageLineHeight": IMAGE_RENDER_LINE_HEIGHT,
            "imageLayoutLineHeight": IMAGE_LAYOUT_LINE_HEIGHT,
            "textWidthScale": TEXT_WIDTH_SCALE,
            "imageWidthScale": IMAGE_WIDTH_SCALE,
            "imageOutlineWidth": IMAGE_OUTLINE_WIDTH,
            "imageFont": IMAGE_FONT, "imageKerning": IMAGE_KERNING,
            "imageAdvanceScale": IMAGE_ADVANCE_SCALE,
            "minimumFigureColumns": MIN_FIGURE_COLUMNS,
            "maximumImageColumns": PAGE_IMAGE_COLUMNS,
            "maximumImageRows": MAX_IMAGE_ROWS,
            "cellMode": "braille", "imageArrayCount": 4,
            "bandStrategy": "byte-balanced contiguous rows",
            "samplingPolicy": "Opticks v25 live calibration; adaptive source sampling only when a dense figure approaches Brickadia's string byte limit",
        },
        "placements": placements, "detailViews": detail_views,
        "textPages": text_pages, "imagePages": image_pages,
        "imagePagesA": image_page_bands[0], "imagePagesB": image_page_bands[1],
        "imagePagesC": image_page_bands[2], "imagePagesD": image_page_bands[3],
        "imageBandRanges": image_band_ranges, "imageBandBytes": image_band_bytes,
    }


def generate(book_key: str) -> dict:
    spec = BOOKS[book_key]
    tokens, formula_count = html_tokens(spec) if spec.get("adapter") == "html" else plain_text_tokens(spec)
    data = paginate(spec, tokens, formula_count)
    output = OUTPUT_DIR / spec["output"]
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf8")
    band_bytes = [size for page in data["imageBandBytes"] for size in page]
    result = {
        "book": book_key, "output": str(output),
        "pages": len(data["textPages"]), "figures": len(data["placements"]),
        "formulaImagesTranscribed": formula_count,
        "pagesWithImages": sum(bool(page) for page in data["imagePages"]),
        "maxBandBytes": max(band_bytes, default=0),
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("books", nargs="*", choices=sorted(BOOKS), help="Book keys (default: all)")
    args = parser.parse_args()
    for key in args.books or list(BOOKS):
        generate(key)


if __name__ == "__main__":
    main()

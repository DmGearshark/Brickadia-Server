#!/usr/bin/env python3
"""Convert Gutenberg 33504 into Brickadia text pages with ASCII figures."""

from __future__ import annotations

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


class ImageListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "img":
            return
        values = dict(attrs)
        if values.get("src"):
            self.images.append((values["src"], html.unescape(values.get("alt") or "Illustration")))


def ascii_figure(path: Path, width: int = 75, max_rows: int = 44) -> list[str]:
    image = Image.open(path).convert("L")
    ink = ImageOps.invert(image).point(lambda value: 255 if value > 10 else 0)
    box = ink.getbbox()
    if box:
        image = image.crop(box)
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Contrast(image).enhance(1.35)
    rows = max(8, round(image.height / image.width * width * 0.5))
    if rows > max_rows:
        width = max(20, round(width * max_rows / rows))
        rows = max_rows
    image = image.resize((width, rows), Image.Resampling.LANCZOS)
    palette = "@%#*+=-:. "
    output = []
    for y in range(rows):
        line = "".join(palette[min(len(palette) - 1, value * len(palette) // 256)]
                       for value in (image.getpixel((x, y)) for x in range(width)))
        output.append(line.rstrip())
    while output and not output[0]:
        output.pop(0)
    while output and not output[-1]:
        output.pop()
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("text", type=Path)
    parser.add_argument("html", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source_lines = args.text.read_text(encoding="utf-8-sig").replace("\r\n", "\n").splitlines()
    start = source_lines.index("OPTICKS:")
    end = next(index for index, line in enumerate(source_lines)
               if line.startswith("End of the Project Gutenberg EBook"))
    source_lines = source_lines[start:end]

    image_parser = ImageListParser()
    image_parser.feed(args.html.read_text(encoding="utf-8"))
    images = image_parser.images
    markers = [line for line in source_lines if re.fullmatch(r"\[Illustration: .+\]", line.strip())]
    if len(images) != 57 or len(markers) != len(images):
        raise ValueError(f"Expected 57 ordered figures, found {len(images)} images and {len(markers)} markers")

    row_limit = 48
    bodies: list[list[str]] = []
    illustration_body_indices: list[int] = []
    illustration_metadata: list[dict[str, object]] = []
    current: list[str] = []
    image_index = 0

    def flush() -> None:
        nonlocal current
        while current and not current[-1]:
            current.pop()
        if current:
            bodies.append(current)
        current = []

    major_headings = {
        "THE FIRST BOOK OF OPTICKS",
        "THE SECOND BOOK OF OPTICKS",
        "THE THIRD BOOK OF OPTICKS",
    }

    for raw_line in source_lines:
        line = raw_line.rstrip().replace("_", "")
        marker = re.fullmatch(r"\[Illustration: (.+)\]", line.strip())
        if marker:
            flush()
            src, alt = images[image_index]
            image_path = args.html.parent / src
            art = ascii_figure(image_path)
            body = [f"ILLUSTRATION {image_index + 1} OF {len(images)} — {alt}", "", *art]
            if len(body) > row_limit:
                raise ValueError(f"Figure page {image_index + 1} has {len(body)} rows")
            illustration_body_indices.append(len(bodies))
            illustration_metadata.append({
                "number": image_index + 1,
                "alt": alt,
                "source": src,
                "rows": len(art),
                "columns": max(map(len, art), default=0),
            })
            bodies.append(body)
            image_index += 1
            continue

        if line.strip() in major_headings:
            flush()
        if not line.strip():
            if current and current[-1]:
                current.append("")
            continue
        if len(current) >= row_limit:
            flush()
        current.append(line)
        if len(current) >= row_limit:
            flush()

    flush()
    if image_index != len(images):
        raise ValueError(f"Consumed {image_index} of {len(images)} figures")

    pages = [f"{index + 1}\r\n\r\n" + "\r\n".join(body) for index, body in enumerate(bodies)]
    illustration_pages = [index + 1 for index in illustration_body_indices]
    payload = {
        "source": "Project Gutenberg ebook 33504, Opticks by Isaac Newton",
        "representation": "Complete book text with all 57 source illustrations converted to monospaced ASCII line art",
        "rowLimit": row_limit,
        "illustrationPages": illustration_pages,
        "illustrations": illustration_metadata,
        "pages": pages,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "pages": len(pages),
        "illustrations": len(images),
        "characters": sum(map(len, pages)),
        "maxPageRows": max(len(page.split("\r\n")) for page in pages),
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()

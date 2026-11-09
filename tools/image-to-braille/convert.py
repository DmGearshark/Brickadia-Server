#!/usr/bin/env python3
"""Offline image-to-Unicode-Braille converter recovered from EmojiCombos."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

BLANK = "\u2800"
DOTS = (
    (0, 0, 0), (0, 1, 1), (0, 2, 2),
    (1, 0, 3), (1, 1, 4), (1, 2, 5),
    (0, 3, 6), (1, 3, 7),
)


def normalize_source(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    if image.width > 768:
        image = image.resize(
            (768, round(image.height * 768 / image.width)),
            Image.Resampling.BILINEAR,
        )
    if image.width > 20:
        width = image.width - image.width % 4
        height = image.height - image.height % 4
        image = image.resize((width, height), Image.Resampling.BILINEAR)
    return image


def atkinson(image: np.ndarray) -> np.ndarray:
    """Site-compatible Atkinson diffusion on normalized grayscale pixels."""
    work = image.astype(np.float32) / 255.0
    height, width = work.shape
    offsets = ((1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (0, 2))
    for y in range(height):
        for x in range(width):
            old = work[y, x]
            new = 1.0 if old > 0.5 else 0.0
            work[y, x] = new
            error = (old - new) / 8.0
            for dx, dy in offsets:
                xx, yy = x + dx, y + dy
                if 0 <= xx < width and 0 <= yy < height:
                    work[yy, xx] += error
    return np.where(work > 0.5, 255, 0).astype(np.uint8)


def auto_preprocess(
    image: Image.Image,
    model_path: Path,
    cutoff: float = 0.80,
    sensitivity: int = 9,
    thickness: int = 2,
) -> Image.Image:
    try:
        import onnxruntime as ort
    except ImportError as error:
        raise RuntimeError("Auto mode requires: pip install onnxruntime") from error

    rgb = np.asarray(image, dtype=np.float32)
    gray = np.rint(rgb.mean(axis=2)).astype(np.uint8)
    histogram = np.bincount(gray.ravel(), minlength=256)
    percentages = np.rint(10000 * histogram / (image.width * image.height)).astype(int)

    low = 255
    running = 0
    for value in range(256):
        running += percentages[value]
        if running >= 30 or percentages[value] > 2:
            low = value
            break
    high = 0
    running = 0
    for value in range(255, -1, -1):
        running += percentages[value]
        if running >= 30 or percentages[value] > 2:
            high = value
            break

    if high == low:
        normalized = rgb / 255.0
    else:
        normalized = np.where(
            rgb <= low,
            0.0,
            np.where(rgb >= high, 1.0, (rgb - low) / (high - low)),
        )

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    tensor = (rgb.transpose(2, 0, 1)[None] / 255.0).astype(np.float32)
    line = np.asarray(session.run(None, {session.get_inputs()[0].name: tensor})[0]).squeeze()
    if line.ndim == 3:
        line = line[0]
    combined = normalized * (np.clip(line, 0, 1)[:, :, None] ** sensitivity)
    binary = np.where(combined.mean(axis=2) < (1.0 - cutoff), 0, 255).astype(np.uint8)

    for _ in range(thickness):
        padded = np.pad(binary, 1, constant_values=255)
        binary = np.minimum.reduce([
            padded[dy:dy + binary.shape[0], dx:dx + binary.shape[1]]
            for dy in range(3) for dx in range(3)
        ])
    return Image.fromarray(binary, "L").convert("RGB")


def encode_braille(image: Image.Image, width: int, threshold: float) -> list[str]:
    rows = math.ceil(2 * width * (image.height / image.width) / 4)
    resized = image.resize((2 * width, 4 * rows), Image.Resampling.BILINEAR)
    rgb = np.asarray(resized, dtype=np.float32)
    enabled = rgb[:, :, :3].mean(axis=2) < 255 * threshold
    output: list[str] = []
    for cell_y in range(rows):
        line = []
        for cell_x in range(width):
            mask = 0
            for dx, dy, bit in DOTS:
                if enabled[cell_y * 4 + dy, cell_x * 2 + dx]:
                    mask |= 1 << bit
            line.append(chr(0x2800 + mask))
        output.append("".join(line))
    return crop(output)


def encode_mask(enabled: np.ndarray) -> list[str]:
    """Pack a boolean dot-resolution mask into Unicode Braille."""
    height, width = enabled.shape
    assert width % 2 == 0 and height % 4 == 0
    output: list[str] = []
    for cell_y in range(height // 4):
        line = []
        for cell_x in range(width // 2):
            mask = 0
            for dx, dy, bit in DOTS:
                if enabled[cell_y * 4 + dy, cell_x * 2 + dx]:
                    mask |= 1 << bit
            line.append(chr(0x2800 + mask))
        output.append("".join(line))
    return crop(output)


def technical_mask(
    image: Image.Image,
    width: int,
    max_rows: int | None = None,
    threshold: float = 0.72,
) -> np.ndarray:
    """Produce a conservative line mask for scanned technical drawings.

    Unlike the recovered site's Auto mode, this does not broadly dilate every
    stroke. It normalizes uneven paper, keeps antialiased pixels only when they
    touch strong ink, and removes isolated JPEG speckles.
    """
    try:
        from scipy import ndimage
    except ImportError as error:
        raise RuntimeError("Technical mode requires: pip install scipy") from error

    gray = ImageOps.autocontrast(image.convert("L"), cutoff=1)
    if max_rows:
        width = min(width, max(1, math.floor(2 * max_rows * gray.width / gray.height)))
    rows = math.ceil(width * gray.height / gray.width / 2)
    resized = gray.resize((2 * width, 4 * rows), Image.Resampling.LANCZOS)
    pixels = np.asarray(resized, dtype=np.float32)
    sigma = max(2.0, min(pixels.shape) / 36.0)
    background = ndimage.gaussian_filter(pixels, sigma=sigma)
    normalized = np.clip(pixels / np.maximum(background, 1.0) * 255.0, 0, 255)

    strong = normalized < 255 * threshold
    weak = normalized < 255 * min(0.92, threshold + 0.14)
    cross = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
    enabled = strong | (weak & ndimage.binary_dilation(strong, structure=cross))
    neighbors = ndimage.convolve(enabled.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant")
    enabled &= neighbors >= 2
    return enabled


def hybridize(lines: list[str]) -> list[str]:
    """Replace only unambiguous straight Braille cells with line glyphs.

    Curves, dense intersections, and uncertain cells remain Braille. This is
    intentionally conservative because font rendering varies between clients.
    """
    if not lines:
        return []
    width = max(map(len, lines))
    grid = [line.ljust(width, BLANK) for line in lines]

    def bits(char: str) -> np.ndarray:
        value = ord(char) - 0x2800
        cell = np.zeros((4, 2), dtype=bool)
        for dx, dy, bit in DOTS:
            cell[dy, dx] = bool(value & (1 << bit))
        return cell

    masks = [[bits(char) for char in row] for row in grid]
    result = [list(row) for row in grid]
    for y, row in enumerate(masks):
        for x, cell in enumerate(row):
            count = int(cell.sum())
            if count < 2 or count > 5:
                continue
            left = bool(cell[:, 0].any())
            right = bool(cell[:, 1].any())
            top = bool(cell[0, :].any())
            bottom = bool(cell[-1, :].any())
            horizontal = int(cell.sum(axis=1).max()) == 2 and left and right
            vertical = int(cell.sum(axis=0).max()) >= 3 and top and bottom
            if horizontal and not vertical and 0 < x < width - 1:
                if grid[y][x - 1] != BLANK and grid[y][x + 1] != BLANK:
                    result[y][x] = "─"
                    continue
            if vertical and not horizontal and 0 < y < len(grid) - 1:
                if grid[y - 1][x] != BLANK and grid[y + 1][x] != BLANK:
                    result[y][x] = "│"
                    continue
            down = int(cell[0, 0]) + int(cell[1, 0]) + int(cell[2, 1]) + int(cell[3, 1])
            up = int(cell[0, 1]) + int(cell[1, 1]) + int(cell[2, 0]) + int(cell[3, 0])
            if down >= 3 and down >= up + 2:
                result[y][x] = "╲"
            elif up >= 3 and up >= down + 2:
                result[y][x] = "╱"
    return ["".join(row).rstrip(BLANK) for row in result]


def crop(lines: list[str]) -> list[str]:
    if not lines or all(not line.replace(BLANK, "") for line in lines):
        return []
    left = min(len(line) - len(line.lstrip(BLANK)) for line in lines)
    right = min(len(line) - len(line.rstrip(BLANK)) for line in lines)
    lines = [line[left:len(line) - right if right else len(line)] for line in lines]
    while lines and not lines[0].replace(BLANK, ""):
        lines.pop(0)
    while lines and not lines[-1].replace(BLANK, ""):
        lines.pop()
    return lines


def invert(text: str) -> str:
    return "".join(
        chr(0x2800 + ((ord(char) - 0x2800) ^ 0xFF))
        if 0x2800 <= ord(char) <= 0x28FF else char
        for char in text
    )


def convert(args: argparse.Namespace) -> str:
    image = normalize_source(Image.open(args.input))
    width = args.width
    if args.max_rows:
        width = min(width, max(1, math.floor(2 * args.max_rows * image.width / image.height)))
    technical = None
    if args.mode == "auto":
        image = auto_preprocess(image, args.model, args.cutoff, args.sensitivity, args.thickness)
    elif args.mode == "dither":
        pixel_height = round(2 * width * image.height / image.width)
        image = image.resize((2 * width, pixel_height), Image.Resampling.BILINEAR)
        gray = np.asarray(image, dtype=np.float32).mean(axis=2) * args.brightness
        image = Image.fromarray(atkinson(np.clip(gray, 0, 255)), "L").convert("RGB")
    elif args.mode == "technical":
        technical = technical_mask(image, width, args.max_rows, args.threshold)
    lines = encode_mask(technical) if technical is not None else encode_braille(image, width, args.threshold)
    if args.glyphs == "hybrid":
        lines = hybridize(lines)
    text = "\n".join(lines)
    return invert(text) if args.invert else text


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("input", type=Path)
    result.add_argument("output", type=Path)
    result.add_argument("--width", type=int, default=50)
    result.add_argument("--max-rows", type=int)
    result.add_argument("--threshold", type=float, default=0.50)
    result.add_argument("--invert", action="store_true")
    result.add_argument("--mode", choices=("direct", "dither", "auto", "technical"), default="direct")
    result.add_argument("--glyphs", choices=("braille", "hybrid"), default="braille")
    result.add_argument("--brightness", type=float, default=0.50)
    result.add_argument("--cutoff", type=float, default=0.80)
    result.add_argument("--sensitivity", type=int, default=9)
    result.add_argument("--thickness", type=int, default=2)
    result.add_argument("--model", type=Path, default=Path(__file__).parent / "vendor/line-art-model.onnx")
    return result


if __name__ == "__main__":
    arguments = parser().parse_args()
    result = convert(arguments)
    arguments.output.write_text(result, encoding="utf-8")
    print(f"Wrote {len(result.splitlines()[0]) if result else 0} x {len(result.splitlines())} characters to {arguments.output}")

#!/usr/bin/env python3
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image, ImageDraw

from convert import (
    BLANK,
    DOTS,
    convert,
    encode_braille,
    encode_mask,
    invert,
    line_aware_structure_mask,
    normalize_source,
    parser,
    structure_aware_mask,
    technical_mask,
    zhang_suen_thin,
)


def expect_value_error(callback) -> None:
    try:
        callback()
    except ValueError:
        return
    raise AssertionError("Expected ValueError")


def main() -> None:
    assert [bit for _, _, bit in DOTS] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert invert(BLANK) == "⣿"
    assert invert("⣿") == BLANK
    assert invert(invert("⠁⠂⠄⡀")) == "⠁⠂⠄⡀"

    empty = np.zeros((8, 10), dtype=bool)
    assert not zhang_suen_thin(empty).any()
    assert not structure_aware_mask(empty).any()
    assert not empty.any(), "Structure-aware cleanup mutated its input"

    plus = np.zeros((7, 7), dtype=bool)
    plus[3, :] = True
    plus[:, 3] = True
    assert np.array_equal(zhang_suen_thin(plus), plus)
    assert np.array_equal(structure_aware_mask(plus), plus)

    square = np.zeros((9, 9), dtype=bool)
    square[1:8, 1:8] = True
    square_before = square.copy()
    square_skeleton = zhang_suen_thin(square)
    square_structured = structure_aware_mask(square)
    assert square_skeleton.sum() == 1
    assert square_structured.sum() == 45
    assert np.all(square_structured >= square_skeleton)
    assert not np.any(square_structured & ~square)
    assert np.array_equal(square, square_before)
    square_255 = square.astype(np.uint8) * 255
    assert zhang_suen_thin(square_255).sum() == 1
    assert structure_aware_mask(square_255).sum() == 45

    edge_square = np.ones((3, 3), dtype=bool)
    expected_cross = np.array([
        [False, True, False],
        [True, True, True],
        [False, True, False],
    ])
    assert np.array_equal(structure_aware_mask(edge_square), expected_cross)
    expect_value_error(lambda: zhang_suen_thin(np.zeros((2, 2, 2), dtype=bool)))
    expect_value_error(lambda: structure_aware_mask(square, core_distance=0))

    diagram = np.zeros((31, 81), dtype=bool)
    diagram[14:17, 5:76] = True
    diagram[3:10, 35:42] = True
    line_aware = line_aware_structure_mask(
        diagram,
        line_length=21,
        line_occupancy=0.88,
    )
    assert not np.any(line_aware & ~diagram)
    assert line_aware[3:10, 35:42].sum() == 49
    assert line_aware[14:17, 5:76].sum() < diagram[14:17, 5:76].sum()
    assert line_aware[14:17, 5:76].any(axis=0).sum() >= 68
    coarse_line_aware = line_aware_structure_mask(
        diagram,
        line_length=21,
        line_occupancy=0.88,
        angle_step=30,
    )
    assert coarse_line_aware[14:17, 5:76].sum() < diagram[14:17, 5:76].sum()
    assert coarse_line_aware[14:17, 5:76].any(axis=0).sum() >= 68
    expect_value_error(lambda: line_aware_structure_mask(diagram, line_length=20))
    expect_value_error(lambda: line_aware_structure_mask(diagram, line_occupancy=0))
    expect_value_error(lambda: line_aware_structure_mask(diagram, angle_step=0))
    expect_value_error(lambda: line_aware_structure_mask(diagram, compact_size=2))

    with TemporaryDirectory() as directory:
        path = Path(directory) / "circle.png"
        image = Image.new("RGB", (128, 128), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((12, 12, 115, 115), outline="black", width=2)
        draw.text((52, 52), "A", fill="black")
        image.save(path)
        normalized = normalize_source(Image.open(path))
        first = encode_braille(normalized, 64, 0.5)
        second = encode_braille(normalized, 64, 0.5)
        assert first == second
        assert first and all(line for line in first)
        assert max(map(len, first)) <= 64
        assert len(first) <= 32
        mask = technical_mask(normalized, 64, threshold=0.72)
        technical = encode_mask(mask)
        assert technical and max(map(len, technical)) <= 64
        assert mask[50:64, 50:64].any(), "Source lettering disappeared from technical conversion"
        invalid = parser().parse_args([
            str(path),
            str(Path(directory) / "invalid.txt"),
            "--mode", "dither",
            "--structure-aware",
        ])
        expect_value_error(lambda: convert(invalid))
        conflicting = parser().parse_args([
            str(path),
            str(Path(directory) / "conflicting.txt"),
            "--mode", "technical",
            "--structure-aware",
            "--line-aware",
        ])
        expect_value_error(lambda: convert(conflicting))
        line_aware_args = parser().parse_args([
            str(path),
            str(Path(directory) / "line-aware.txt"),
            "--mode", "technical",
            "--width", "64",
            "--line-aware",
            "--line-length", "21",
            "--angle-step", "30",
            "--compact-size", "3",
        ])
        line_aware_text = convert(line_aware_args)
        assert line_aware_text and all(line for line in line_aware_text.splitlines())

    print("image-to-braille tests passed")


if __name__ == "__main__":
    main()

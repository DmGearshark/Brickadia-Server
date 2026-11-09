#!/usr/bin/env python3
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

from convert import BLANK, DOTS, encode_braille, encode_mask, hybridize, invert, normalize_source, technical_mask


def main() -> None:
    assert [bit for _, _, bit in DOTS] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert invert(BLANK) == "⣿"
    assert invert("⣿") == BLANK
    assert invert(invert("⠁⠂⠄⡀")) == "⠁⠂⠄⡀"

    with TemporaryDirectory() as directory:
        path = Path(directory) / "circle.png"
        image = Image.new("RGB", (128, 128), "white")
        ImageDraw.Draw(image).ellipse((12, 12, 115, 115), outline="black", width=2)
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
        hybrid = hybridize(technical)
        assert len(hybrid) == len(technical)
        assert any(char in "─│╱╲" for line in hybrid for char in line) or hybrid == technical

    print("image-to-braille tests passed")


if __name__ == "__main__":
    main()

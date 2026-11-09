# Image to Unicode Braille converter

This directory permanently records the image conversion method recovered from
`https://emojicombos.com/dot-art-generator` on 2026-11-09. It is independent
of that website and can generate Brickadia-ready text containing Unicode
Braille characters (`U+2800` through `U+28FF`).

## Direct conversion used by the Opticks book

```bash
python convert.py input.png output.txt --width 400 --threshold 0.50
```

The Newton *Opticks* book uses this converter for its source-derived artwork.
It preserves technical diagrams and engraved lettering better than the site's
neural line-art mode.

Useful options:

```text
--width N             Braille characters before blank-edge cropping
--threshold 0..1      Pixels darker than this become raised dots
--invert              Complement all eight bits in every Braille character
--max-rows N          Reduce width as needed to fit portrait images
--mode direct         No preprocessing (recommended for diagrams)
--mode dither         Site-compatible Atkinson error diffusion
--mode auto           Recovered neural line-art preprocessing
--mode technical      Conservative cleanup for scanned technical drawings
```

Auto mode requires `numpy`, `Pillow`, and `onnxruntime`. Its model is stored at
`vendor/line-art-model.onnx`, so it does not need to be downloaded. Direct and
dither modes require only `numpy` and `Pillow`.

## Recovered generator algorithm

1. Decode the image with browser-equivalent RGB output.
2. If its width exceeds 768 pixels, resize it to width 768 while preserving its
   aspect ratio.
3. For images wider than 20 pixels, reduce both dimensions to multiples of 4.
4. For requested character width `W`, create a pixel canvas of width `2W` and
   height `4 * ceil(2W * sourceHeight / sourceWidth / 4)`.
5. Draw the processed image across that entire canvas.
6. Calculate pixel brightness as `(R + G + B) / 3` in direct conversion.
7. Enable a Braille dot when brightness is below `255 * threshold`.
8. Pack each 2-by-4 pixel block using standard Braille ordering:

   ```text
   1 4
   2 5
   3 6
   7 8
   ```

9. Add the resulting eight-bit mask to `0x2800`.
10. Use `U+2800`, rather than ASCII space, for empty cells.
11. Crop rows and columns that contain only `U+2800`.
12. Inversion complements the mask with `mask XOR 0xFF`.

The original site generated Auto variants at 60%, 100%, and 130% of the chosen
width. Its defaults were cutoff 0.80, line sensitivity 9, and two erosion
steps. The recovered Atkinson source is preserved under `vendor/dither.js`.

Technical mode requires SciPy. It normalizes uneven paper, uses hysteresis to
retain antialiased pixels adjacent to strong ink, and removes isolated JPEG
speckles without the broad dilation that makes diagram intersections and small
letters merge. Engraved labels remain part of the source artwork and are packed
into Braille with the surrounding geometry.

For scanned diagrams, use:

```bash
python convert.py input.jpg output.txt \
  --width 200 --max-rows 130 --threshold 0.72 --mode technical
```

`direct` mode remains unchanged for exact reproduction of earlier conversions.
The current Opticks pipeline uses per-figure fallback: adaptive cleanup is
accepted for sparse scans, while dense ray plates retain conservative direct
thresholding. It requests 400–600 Braille columns, renders them at a 0.075
line height, and retains the donor's outline width of 4 for readable dot
weight. This gives the artwork twice the previous cell density at the same
physical size. Four coplanar TextDisplays carry disjoint, byte-balanced row
bands of the same logical image. This keeps every array value below Brickadia's
32,767-byte string limit without seams, duplicated dots, hybrid line glyphs,
or normal-font label overlays. Exceptionally dense plates use narrow per-image
caps, and adjacent figures start separate pages when their combined data would
exceed an array value.

Generate and validate the four-display book data with:

```bash
python tools/prefabs/generate-opticks-four-display-pages.py
python tools/prefabs/test-opticks-four-display-pages.py
```

## Verification

```bash
python test_converter.py
```

The test verifies the Unicode bit layout, cropping, inversion, dimensions, and
deterministic direct conversion.

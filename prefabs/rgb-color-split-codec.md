# Split RGB Color Codec

Two independent, placeable Brickadia chips with exactly one public input and one public output each.

- `rgb-color-encoder.brz`: `Color` -> `Integer`
- `rgb-color-decoder.brz`: `Integer` -> `Color`

The encoder stores RGB as `R × 65,536 + G × 256 + B`. The decoder clamps its integer input to `0..16,777,215`, extracts each 0–255 channel, and produces an opaque sRGB color. Example: `#55AA33` becomes `5,614,131` and decodes back to the same color.

Both prefabs retain Brickadia CL16507 metadata and pass strict placement validation with no invalid bricks or overlaps.

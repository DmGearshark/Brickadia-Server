# RGB Integer Color Codec

A reusable Brickadia microchip for storing a full RGB color in one integer leaderboard score.

## Wiring

- Color picker/output -> `ColorToEncode`
- `EncodedInteger` -> leaderboard score setter
- Leaderboard score getter -> `PackedColor`
- `DecodedColor` -> the display, light, decal, or component color input

Diagnostic outputs `Red`, `Green`, `Blue`, and `HexRGB` expose the decoded channels.

## Format

`EncodedInteger = Red × 65,536 + Green × 256 + Blue`

The decoder clamps incoming data to `0..16,777,215`, extracts the three 0–255 channels, and rebuilds an opaque sRGB color. Alpha is fixed to 255 so every stored value remains safe for a signed 32-bit integer leaderboard score.

Example: `#55AA33` has RGB `(85, 170, 51)` and stores as decimal integer `5,614,131`.

Validation: Brickadia CL16507 metadata; 24 bricks; 24 wires; one flat chip link; strict placement clean.

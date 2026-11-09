@flat
@layout("cube")

// Lossless 24-bit RGB codec for integer-only storage such as leaderboard
// scores. Alpha is intentionally omitted so every packed value stays within
// 0..16,777,215 and is safe for a signed 32-bit score.

in ColorToEncode: color
in PackedColor: int

let source = ColorToEncode.ToSRGB()
let encoded = source.R * 65536 + source.G * 256 + source.B

// Clamp data read from storage so corrupt/negative scores still decode to a
// valid opaque color.
let packed = min(max(PackedColor, 0), 16777215)
let red = packed / 65536
let green = (packed / 256) % 256
let blue = packed % 256
let decoded = ColorSRGB(red, green, blue, 255)

out EncodedInteger: int = encoded
out DecodedColor: color = decoded
out Red: int = red
out Green: int = green
out Blue: int = blue
out HexRGB: string = decoded.ToHex().Substring(0, 6)

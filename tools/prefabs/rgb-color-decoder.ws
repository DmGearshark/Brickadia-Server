@flat
@layout("cube")

// Decode one 24-bit leaderboard integer into an opaque RGB color.
in Integer: int

let packed = min(max(Integer, 0), 16777215)
let red = packed / 65536
let green = (packed / 256) % 256
let blue = packed % 256
out Color: color = ColorSRGB(red, green, blue, 255)

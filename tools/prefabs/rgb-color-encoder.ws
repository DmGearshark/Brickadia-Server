@flat
@layout("cube")

// Losslessly pack an opaque RGB color into one 24-bit integer.
in Color: color

let channels = Color.ToSRGB()
out Integer: int = channels.R * 65536 + channels.G * 256 + channels.B

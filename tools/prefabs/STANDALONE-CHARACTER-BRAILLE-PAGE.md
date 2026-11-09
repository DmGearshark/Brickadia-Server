# Standalone character Braille page

This prefab places one centered character portrait on the proven parchment
display from the *Opticks* book. It has one page, no prose, and four coplanar
`IosevkaTerm` Braille displays with byte-balanced row bands.

The chat attachment was visible to the model but its original file bytes were
not exposed to the workspace. The tracked 1166×1349 source is therefore a
faithful high-resolution intermediate derived from that attachment. Replace it
with the original file and regenerate if pixel-exact source fidelity is needed.

## Rendering

- Technical mask threshold: 0.76
- Logical canvas: 600×260 Braille cells
- Portrait: 449×209 cells at `(75, 25)`
- Raised dots: 108,682 across 15,600 occupied cells
- Largest of four array entries: 24,758 bytes

## Preserved files and SHA-256

| File | SHA-256 |
| --- | --- |
| `prefabs/standalone-character-braille-page.brz` | `efea1065f64d5fb2d48a32486ce1583e49f06987055e06962cab6d1666c852fe` |
| `tools/prefabs/standalone-character-braille-page.json` | `9cc8c2ac7337357c8933d1ace7a76e77402bbbd1697d0d9bdbc08f054e62c19b` |
| `tools/image-to-braille/sources/standalone-character-page.png` | `82a3b155697401ba29b453e2c0be3d09ab79d78e8f244cc29a1c272d4d9f093a` |
| `prefabs/previews/standalone-character-braille-page.png` | `b0ec97d5a0a69b0200dd452f739a7b59f811b0ea2d8973559e2b33377c0cd9a7` |

## Rebuild and validate

```sh
python tools/prefabs/generate-standalone-character-braille-page.py
node tools/prefabs/build-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  prefabs/standalone-character-braille-page.brz \
  tools/prefabs/standalone-character-braille-page.json

python tools/prefabs/test-standalone-character-braille-page.py
node tools/prefabs/test-standalone-character-braille-page.cjs \
  prefabs/standalone-character-braille-page.brz \
  tools/prefabs/standalone-character-braille-page.json
```

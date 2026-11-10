# Newton Opticks v27 live-geometry candidate

This revision makes three narrowly scoped display corrections while preserving
the approved v25 prefab and its immutable tag:

- Corrects the physical aspect of Unicode Braille artwork in Brickadia.
- Keeps wide figures at the same 589–600-column source sampling instead of
  widening the TextDisplay beyond the parchment.
- Starts Figure 13 on a new page so Figures 12 and 13 no longer share the
  lower render boundary.

The source scans, dirt, thresholding, four-display wiring, font, line height,
width scale, kerning, outline, and prose pagination policy remain unchanged.

## Measured correction

The Figure 27 outer circle is the calibration target:

| Representation | Width / height |
| --- | ---: |
| Original scan | 0.971 |
| v25 live capture | approximately 0.68 |
| v27 live-predicted geometry | 0.967 |

The converter already preserved source geometry in its dot raster. Brickadia's
rendered IosevkaTerm Braille cells are physically narrower than the converter's
square-dot assumption. v27 therefore retains every figure's horizontal sample
count and generates 70 percent as many Braille rows. Increasing `WidthScale`
would push 589–600-column plates beyond the parchment edge.

Figure 3 remains 589 columns wide. Its row count changes from 96 to 68. Figure
27 changes from 310 by 175 cells to 309 by 123 cells. The complete Figure 3
detail remains 480 columns wide and changes from 249 to 174 rows.

Figures 12 and 13 now begin on pages 21 and 22 respectively. Across the entire
book, active image content ends no lower than Braille row 240, leaving 20 rows
of safety under the 260-row canvas. The final book has 227 pages, 57 figures,
one enlarged detail, and a maximum stored image-band value of 23,391 bytes.

## Artifacts

- Prefab: `prefabs/newton-opticks-pure-braille-v27-live-geometry.brz`
- Page data: `tools/prefabs/opticks-four-display-pages-v27-live-geometry.json`
- Prefab SHA-256:
  `ea371cd80bfa7b9337c71b24046f1f2a6c2e46a5634b018dcc2ca80877701a1f`
- Page-data SHA-256:
  `2dddde496c47f345d936c0e366867da9aaf49c9eec92e0a43475ee7313766fb3`

The preserved v25 prefab still has SHA-256
`b4a7f7c1f3e63b5f2204d5937c5ba5f34755f8a6ef042a55996181c786949e6c`.

## Regeneration

```sh
python3 tools/prefabs/generate-opticks-four-display-pages.py \
  --output tools/prefabs/opticks-four-display-pages-v27-live-geometry.json \
  --live-row-aspect 0.70 \
  --force-new-page-before 13 \
  --name "Newton Opticks - Live Geometry Corrected Edition" \
  --description "Complete Opticks text with the preserved v25 four-display system, live-measured Braille aspect correction, safe figure pagination, and source-derived diagrams."

node tools/prefabs/build-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  prefabs/newton-opticks-pure-braille-v27-live-geometry.brz \
  tools/prefabs/opticks-four-display-pages-v27-live-geometry.json
```

Run the geometry, converter, prefab, and preserved-v25 regressions:

```sh
python3 tools/image-to-braille/test_converter.py
python3 tools/prefabs/test-opticks-live-geometry.py
python3 tools/prefabs/test-opticks-four-display-pages.py
node tools/prefabs/test-newton-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v27-live-geometry.brz \
  tools/prefabs/opticks-four-display-pages-v27-live-geometry.json
```

# Newton Opticks large two-page v1

This prefab moves the approved Opticks v27 content into the supplied large,
open two-page shell. Its compact layout is repaginated for the taller leaves
while preserving every source line and every Braille figure cell from v27.

## Behavior

- 237 pages are arranged as 119 spreads: 1/2, 3/4, through 237/blank.
- **Turn page Right** advances to the next spread.
- **Turn page Left** returns to the previous spread.
- A single 119-state Cycle drives both leaves.
- Each leaf has one prose array and four byte-balanced Unicode Braille image
  arrays, for ten arrays and ten getters total.
- All four image layers on a leaf have one physical origin. This preserves the
  leading-row offsets already stored in v27's A/B/C/D image bands.
- The final single-page book's dead Var/Blend/NOT/VarSet chain is omitted.

The initial scale is 1.6 times the single-page v27 scale. Prose is repaginated
to 44 body rows plus the page-number and margin rows. Its live LineHeight is
0.875 and WidthScale is 0.75, making the glyphs 9.375% taller while retaining
essentially the same horizontal advance and occupied page height as the
previous 0.8/0.82 setting. Image LineHeight remains 0.12 and image WidthScale
remains 1.2, so circles and other source geometry keep the corrected v27
aspect.

Both prose and image displays use the approved v27 `Outlined` mode. Prose uses
OutlineWidth 2 and Braille artwork uses OutlineWidth 4. This restores the old
book's full text weight and its larger, closely packed illustration dots; the
earlier large-book build had retained those widths while leaving outline mode
disabled.

The earlier two-page candidate retained v27's deliberately oversized v25
figure reservations. The compact layout reserves each figure's actual
live-corrected rows, adds one full prose row above the art, carries the caption
down by the same row, and defers any placement that would pass image row 240.
This avoids the earlier oversized gaps while leaving the artwork itself
unchanged. Figures 12 and 13 share page 22 instead of occupying two sparse
leaves.

## Preserved inputs

- Shell: `tools/prefabs/sources/big-book-two-page-shell.brz`
- Shell SHA-256:
  `e971ea4f6aeb591b17304eabb61364e2b0c817c5debb1ab3287229bd54942a89`
- Approved v27 source layout: `tools/prefabs/opticks-four-display-pages-v27-live-geometry.json`
- V27 source-layout SHA-256:
  `2dddde496c47f345d936c0e366867da9aaf49c9eec92e0a43475ee7313766fb3`
- Compact two-page layout: `tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json`
- Compact-layout SHA-256:
  `ec53765caf00fea2c85e09372ce8c153ee52c9941afd121ead14daa48c97958e`
- Output: `prefabs/newton-opticks-large-two-page-v1.brz`
- Output SHA-256:
  `eea9c396639ffe3d06db4d52be581e8949aedc225cfc8608504523c91b08327a`

The source dataset retains the original scan dirt selected for the final
single-page book. The compact layout contains all prose, 57 source-derived
figures, and the enlarged Figure 3 detail page.

## Regeneration and checks

```sh
python3 tools/prefabs/generate-opticks-four-display-pages.py \
  --output tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json \
  --live-row-aspect 0.70 \
  --compact-live-layout \
  --name "Newton Opticks - Large Two-Page Compact Live Layout" \
  --description "Complete Opticks text and retained-dirt v27 source-derived figures, repaginated for the large two-page shell with actual live-art reservations and protected prose clearance."

node tools/prefabs/build-opticks-two-page-spread-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-v1.brz \
  tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json

node tools/prefabs/test-opticks-two-page-big-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-v1.brz \
  tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json

python3 tools/prefabs/test-opticks-two-page-compact-layout.py
```

The structural check verifies exact odd/even reconstruction of all five compact
streams, the 44-wire graph, initial and final spreads, synchronized image
origins, shell preservation, metadata, and strict zero-warning placement.

## First live check

1. Paste the prefab and confirm that the placement report has no blocked,
   invalid, or unconnectable parts.
2. Confirm page 1 is on the left and page 2 is on the right.
3. Use **Turn page Right** once and confirm the spread becomes pages 3/4;
   use **Turn page Left** to return to pages 1/2.
4. Advance to pages 7/8 and 9/10 to inspect the wide Figure 3 plate and its
   enlarged detail page. The four Braille bands should form one seamless image.
5. Inspect page 22: Figures 12 and 13 should share the leaf with clear prose
   separation and no large artificial gap between them.
6. Capture a full spread and a close view of one image page. Those views are
   enough to tune scale and offsets without changing the stored book data.

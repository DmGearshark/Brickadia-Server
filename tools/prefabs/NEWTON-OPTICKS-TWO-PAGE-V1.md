# Newton Opticks large two-page v1

This prefab moves the approved Opticks v27 content into the supplied large,
open two-page shell. Its compact layout is repaginated for the taller leaves
while preserving every source line and every Braille figure cell from v27.

## Behavior

- 219 pages are arranged as 110 spreads: 1/2, 3/4, through 219/blank.
- **Turn page Right** advances to the next spread.
- **Turn page Left** returns to the previous spread.
- A single 110-state Cycle drives both leaves.
- Each leaf has one prose array and four byte-balanced Unicode Braille image
  arrays, for ten arrays and ten getters total.
- All four image layers on a leaf have one physical origin. This preserves the
  leading-row offsets already stored in v27's A/B/C/D image bands.
- The final single-page book's dead Var/Blend/NOT/VarSet chain is omitted.

The initial scale is 1.6 times the single-page v27 scale. The larger shell's
own guide fits roughly 27 rows at LineHeight 1.5; the new setting fits the
source's 50-row maximum at LineHeight 0.8. Image LineHeight is 0.12. The
approved prose and image WidthScale values remain 0.82 and 1.2 so circles and
other source geometry keep the corrected v27 aspect.

The earlier two-page candidate retained v27's deliberately oversized v25
figure reservations. The compact layout reserves each figure's actual
live-corrected rows, adds one full prose row above the art, carries the caption
down by the same row, and defers any placement that would pass image row 240.
This removes eight mostly blank pages without changing font size or artwork.
Figures 12 and 13 now share page 20 instead of occupying two sparse leaves.

## Preserved inputs

- Shell: `tools/prefabs/sources/big-book-two-page-shell.brz`
- Shell SHA-256:
  `e971ea4f6aeb591b17304eabb61364e2b0c817c5debb1ab3287229bd54942a89`
- Approved v27 source layout: `tools/prefabs/opticks-four-display-pages-v27-live-geometry.json`
- V27 source-layout SHA-256:
  `2dddde496c47f345d936c0e366867da9aaf49c9eec92e0a43475ee7313766fb3`
- Compact two-page layout: `tools/prefabs/opticks-four-display-pages-v28-two-page-compact.json`
- Compact-layout SHA-256:
  `b43adddcf39786e99bcdd24266c2c1f1bfbbbe1815f6e041d3e44ea9402a1a90`
- Output: `prefabs/newton-opticks-large-two-page-v1.brz`
- Output SHA-256:
  `479ab4d362cc263c39d6dfec22b0782c25010d5fc9661432ae2ba23bc8eaacc6`

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
5. Inspect page 20: Figures 12 and 13 should share the leaf with clear prose
   separation and no large artificial gap between them.
6. Capture a full spread and a close view of one image page. Those views are
   enough to tune scale and offsets without changing the stored book data.

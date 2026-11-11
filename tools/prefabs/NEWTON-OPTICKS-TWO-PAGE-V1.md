# Newton Opticks large two-page v1

This prefab moves the approved Opticks v27 content into the supplied large,
open two-page shell. It is the first live-calibration candidate for this new
geometry; the book logic and source content are complete.

## Behavior

- 227 source pages are arranged as 114 spreads: 1/2, 3/4, through 227/blank.
- **Turn page Right** advances to the next spread.
- **Turn page Left** returns to the previous spread.
- A single 114-state Cycle drives both leaves.
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

## Preserved inputs

- Shell: `tools/prefabs/sources/big-book-two-page-shell.brz`
- Shell SHA-256:
  `e971ea4f6aeb591b17304eabb61364e2b0c817c5debb1ab3287229bd54942a89`
- Approved content: `tools/prefabs/opticks-four-display-pages-v27-live-geometry.json`
- Content SHA-256:
  `2dddde496c47f345d936c0e366867da9aaf49c9eec92e0a43475ee7313766fb3`
- Output: `prefabs/newton-opticks-large-two-page-v1.brz`
- Output SHA-256:
  `dd2a857a13b3f4db4bf05e741cb008658afa66c69428a5dbe92324d9d4ec121c`

The v27 dataset retains the original scan dirt selected for the final
single-page book. It contains all 227 prose pages, 57 source-derived figures,
and the enlarged Figure 3 detail page.

## Regeneration and checks

```sh
node tools/prefabs/build-opticks-two-page-spread-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-v1.brz \
  tools/prefabs/opticks-four-display-pages-v27-live-geometry.json

node tools/prefabs/test-opticks-two-page-big-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-v1.brz \
  tools/prefabs/opticks-four-display-pages-v27-live-geometry.json
```

The structural check verifies exact odd/even reconstruction of all five v27
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
5. Capture a full spread and a close view of one image page. Those views are
   enough to tune scale and offsets without changing the stored book data.

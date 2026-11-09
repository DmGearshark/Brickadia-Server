# Newton *Opticks* v26 isolated-speck cleanup

This checkpoint keeps the complete live-calibrated v25 layout while removing
only tiny source-scan components that are detached from every diagram. Its
stable Git tag is `newton-opticks-v26-isolated-speck-clean`.

## Locked behavior

- Pure source-derived Unicode Braille artwork; no hybrid line glyphs, OCR
  lettering, or normal-font label overlays.
- Four coplanar, byte-balanced image arrays.
- `IosevkaTerm`, render `LineHeight` 0.075, effective layout footprint 0.084,
  width scale 1.2, kerning -6, and outline width 4.
- 226 pages, 57 figures, one source-derived Figure 3 detail page, and a maximum
  array entry of 31,540 bytes.
- Eight-connected components of at most 12 raised dots are removed only when
  the nearest other ink is at least 24 dot pixels away. Cleanup runs after
  Braille encoding and retains each figure's existing row count and widths.

## Difference from v25

The prose, figure placements, figure dimensions, and Figure 3 detail metadata
are byte-identical to v25. The image layer removes 278 raised dots from 21 of
57 figures and adds or moves none. Page 10 loses 19 dots corresponding to its
two detached scan specks. The enlarged Figure 3 detail is unchanged.

The preserved v25 rollback remains available at tag
`newton-opticks-v25-live-calibrated`.

## Preserved files and SHA-256

| File | SHA-256 |
| --- | --- |
| `prefabs/newton-opticks-pure-braille-v26-isolated-speck-clean.brz` | `74ff6bb1ba177e985ae3d9f75e8252559d8e9774387f0a2480cfb99efd7bc541` |
| `tools/prefabs/opticks-four-display-pages.json` | `7f11f596bd54bfac740e0efbb58fdd03af5c018857572a2384f06c802e188568` |
| `prefabs/newton-opticks-pure-braille-v17-detail-page.brz` (donor) | `a7ab2eeb8e372e7df3bfe73e8e901fb91185e99315c569b3f2392abb042e4231` |
| `tools/image-to-braille/sources/bnf-opticks-1704-plate-i-figure-3.png` | `b4994db29e966aa5d1d44166c1f36bff5d1dcd7f80004f2d09bdfb6ae99e1b28` |

The Gutenberg source snapshot, its complete license, upstream commit, and 57
illustration hashes remain recorded under
`tools/image-to-braille/sources/gutenberg-33504/`.

## Exact regeneration

The preserved run used Python 3.12.14, Node.js 24.19.0, `numpy==2.3.5`,
`Pillow==12.3.0`, `scipy==1.17.0`, and `brs-js==4.0.4` from the tracked npm
lockfile.

```sh
python3 -m venv .venv-opticks-v26
. .venv-opticks-v26/bin/activate
python -m pip install -r tools/image-to-braille/requirements-opticks-v26.txt
npm ci --prefix tools/prefabs

sha256sum -c tools/image-to-braille/sources/gutenberg-33504/SHA256SUMS
python tools/prefabs/generate-opticks-four-display-pages.py
node tools/prefabs/build-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  /tmp/newton-opticks-v26-rebuilt.brz \
  tools/prefabs/opticks-four-display-pages.json
sha256sum \
  tools/prefabs/opticks-four-display-pages.json \
  /tmp/newton-opticks-v26-rebuilt.brz
```

The two final hashes must match the table above. Validate the complete pipeline
with:

```sh
python tools/image-to-braille/test_converter.py
python tools/prefabs/test-opticks-four-display-pages.py
node tools/prefabs/test-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  /tmp/newton-opticks-v26-rebuilt.brz \
  tools/prefabs/opticks-four-display-pages.json
```

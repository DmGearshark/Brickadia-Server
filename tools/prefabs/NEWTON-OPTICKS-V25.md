# Newton *Opticks* v25 preservation checkpoint

This checkpoint preserves the exact live-tested four-display book system. Its
stable Git tag is `newton-opticks-v25-live-calibrated`.

## Locked behavior

- Pure source-derived Unicode Braille artwork; no hybrid line glyphs, OCR
  lettering, or normal-font label overlays.
- Four coplanar, byte-balanced image arrays.
- `IosevkaTerm`, render `LineHeight` 0.075, effective layout footprint 0.084,
  width scale 1.2, kerning -6, and outline width 4.
- 226 pages, 57 figures, one source-derived Figure 3 detail page, and a maximum
  array entry of 31,548 bytes.

## Preserved files and SHA-256

| File | SHA-256 |
| --- | --- |
| `prefabs/newton-opticks-pure-braille-v25-live-calibrated-layout.brz` | `b4a7f7c1f3e63b5f2204d5937c5ba5f34755f8a6ef042a55996181c786949e6c` |
| `tools/prefabs/opticks-four-display-pages.json` | `72d1385316cce1170bfe844042e5c34d58d80c59ad92b52be799834c35a8e76f` |
| `prefabs/newton-opticks-pure-braille-v17-detail-page.brz` (donor) | `a7ab2eeb8e372e7df3bfe73e8e901fb91185e99315c569b3f2392abb042e4231` |
| `tools/image-to-braille/sources/bnf-opticks-1704-plate-i-figure-3.png` | `b4994db29e966aa5d1d44166c1f36bff5d1dcd7f80004f2d09bdfb6ae99e1b28` |
| `tools/image-to-braille/sources/gutenberg-33504/33504.txt` | `f10edc441b26448cae18105c9ba13d732faa7ad5fd9d1dd1805d57b7aca34635` |
| `tools/image-to-braille/sources/gutenberg-33504/33504-h/33504-h.htm` | `a732b1879046b56d62f4ce4af95a62cfe3e8c0921abecdf5e520610925e25b9d` |

The 57 Gutenberg illustration checksums are recorded in
`tools/image-to-braille/sources/gutenberg-33504/SHA256SUMS`. That source
snapshot comes from GITenberg commit
`ea7d161812f0cab3ac29d47e5c4806557628cf5a` and retains its complete license.

## Exact regeneration

The preserved run used Python 3.12.14, Node.js 24.19.0, `numpy==2.3.5`,
`Pillow==12.3.0`, and `brs-js==4.0.4` from the tracked npm lockfile.

```sh
python3 -m venv .venv-opticks-v25
. .venv-opticks-v25/bin/activate
python -m pip install -r tools/image-to-braille/requirements-opticks-v25.txt
npm ci --prefix tools/prefabs

sha256sum -c tools/image-to-braille/sources/gutenberg-33504/SHA256SUMS
python tools/prefabs/generate-opticks-four-display-pages.py
sha256sum tools/prefabs/opticks-four-display-pages.json

node tools/prefabs/build-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  /tmp/newton-opticks-v25-rebuilt.brz \
  tools/prefabs/opticks-four-display-pages.json
sha256sum /tmp/newton-opticks-v25-rebuilt.brz
```

The two final hashes must match the table above. Validate the complete pipeline
with:

```sh
(cd tools/image-to-braille && python test_converter.py)
python tools/prefabs/test-opticks-four-display-pages.py
node tools/prefabs/test-opticks-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  /tmp/newton-opticks-v25-rebuilt.brz \
  tools/prefabs/opticks-four-display-pages.json
```

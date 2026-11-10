# Newton four-display book collection

This collection extends the preserved Opticks v25 system without changing its
live-tested rendering constants or wiring. Every title is an independent `.brz`
prefab, and every source snapshot, generated page array, build script, and final
hash is tracked in Git.

The machine-readable preservation record is
[`newton-collection-manifest.json`](newton-collection-manifest.json). The exact
Opticks checkpoint remains the Git tag `newton-opticks-v25-live-calibrated` and
is documented separately in [`NEWTON-OPTICKS-V25.md`](NEWTON-OPTICKS-V25.md).

## Included volumes

| Work | Source | Pages | Figures | Enlarged details | Formula images transcribed | Prefab |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| *Opticks* | Project Gutenberg 33504 | 226 | 57 | 1 | 0 | `prefabs/newton-opticks-pure-braille-v25-live-calibrated-layout.brz` |
| *Newton's Principia* (English) | Project Gutenberg 76404 | 899 | 274 | 22 | 1,936 | `prefabs/newton-principia-english-complete.brz` |
| *Philosophiae Naturalis Principia Mathematica* (1687 Latin) | Project Gutenberg 28233 | 661 | 181 | 29 | 0 | `prefabs/newton-principia-latin-complete.brz` |
| *The System of the World* | Complete section of Project Gutenberg 76404 | 75 | 13 | 0 | 132 | `prefabs/newton-system-of-the-world-complete.brz` |
| *The Chronology of Ancient Kingdoms Amended* | Project Gutenberg 15784 | 207 | 3 | 0 | 0 | `prefabs/newton-chronology-complete.brz` |
| *Observations upon the Prophecies* | Project Gutenberg 16878 | 169 | 0 | 0 | 0 | `prefabs/newton-observations-prophecies-complete.brz` |

The standalone *System of the World* duplicates the complete section appended
to the English *Principia*. It was also published posthumously as a distinct
work, and a shorter independent prefab is useful in-game.

## Source snapshots

- English *Principia* and *System of the World*: Project Gutenberg 76404,
  retrieved through `sigma5a/Principia-Modern` commit
  `15a0a48530804c6ce49100656a2046aeb77d3b89`. Only the Gutenberg historical
  text, inline `data-tex`, and 274 original JPG images are used; the mirror's
  modern experiments are excluded.
- Latin *Principia*: GITenberg commit
  `8dc1e338cb8140a2b2be642b02ab2a33b79acc8d`.
- *Chronology*: GITenberg commit
  `5aaeb4d68f4d4551811e97ec9aa9bc0f2daa1999`.
- *Observations*: GITenberg commit
  `c607f3041c41b904393012d957a4dc2ea01ef740`.
- *Opticks*: GITenberg commit
  `ea7d161812f0cab3ac29d47e5c4806557628cf5a` plus the documented BnF Plate I
  source override for Figure 3.

Each new source directory has `SOURCE.md` and `SHA256SUMS`. GITenberg licenses
and metadata are preserved where supplied; Project Gutenberg 76404 carries its
license in the vendored source HTML.

## Locked renderer behavior

- Four synchronized, byte-balanced pure-Braille image arrays.
- `IosevkaTerm`, render line height `0.075`, measured layout footprint `0.084`,
  width scale `1.2`, kerning `-6`, and outline width `4`.
- 48 prose rows per page at line height `0.50` and width scale `0.82`.
- Every array value remains below Brickadia's 32,767-byte string limit.
- Dense figures are sampled at the largest safe width. Tall figures retain a
  complete overview and receive overlapping source-derived detail pages when
  the overview would fall below 300 Braille columns.
- Gutenberg 76404's 1,936 formula images are read from their exact `data-tex`
  source and converted to readable inline notation. Its 33 tables remain in
  row order with visible column separators.

## Exact regeneration

Use Python 3.12, Node.js 24, `brs-js==4.0.4` from the tracked npm lockfile, and
the pinned Python dependencies:

```sh
python3 -m venv .venv-newton
. .venv-newton/bin/activate
python -m pip install -r tools/image-to-braille/requirements-newton-collection.txt
npm ci --prefix tools/prefabs

python tools/prefabs/generate-newton-four-display-books.py

node tools/prefabs/build-newton-four-display-book.cjs \
  prefabs/newton-opticks-pure-braille-v17-detail-page.brz \
  prefabs/newton-principia-english-complete.brz \
  tools/prefabs/newton-principia-english-four-display-pages.json
```

Repeat the builder command for each pages JSON and corresponding prefab path
listed in the manifest. Then run:

```sh
python tools/prefabs/test-newton-four-display-books.py
```

The test verifies the vendored source checksums, complete-work landmarks,
pagination limits, crop bounds, synchronized array reconstruction, and every
stored byte count. The manifest records the expected SHA-256 digest of each
page JSON and final prefab.

## Additional Newton works needing scans

Project Gutenberg's complete Isaac Newton catalog currently contains the five
standalone records represented above. Two further major works are available as
public-domain scans but do not have reliable Gutenberg text editions:

- *Universal Arithmetick*, English Raphson/Cunn edition: Internet Archive item
  `universalarithme00newt`.
- *The Method of Fluxions and Infinite Series*, 1736 John Colson edition:
  Internet Archive item `methodoffluxions00newt`.

Those should be converted from verified page-image PDFs so their mathematical
notation is not damaged by OCR.

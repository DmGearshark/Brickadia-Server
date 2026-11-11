# Newton *Opticks* historical two-page edition v1

This is a separate, historically paginated edition of the large two-page
*Opticks* book. It does not replace
`prefabs/newton-opticks-large-two-page-v1.brz`, whose compact pagination is
kept as the readable game edition. The historical edition uses the printed
1730 page boundaries and accepts the original book's deliberate white space,
plate leaves, and uneven page density.

## Edition and facsimile reference

The text is Isaac Newton, *Opticks: or, A Treatise of the Reflexions,
Refractions, Inflexions and Colours of Light. Also Two Treatises of the Species
and Magnitude of Curvilinear Figures*, **fourth edition, corrected** (London:
printed for William Innys at the West-End of St. Paul's, 1730; MDCCXXX).

Two independent scans of that edition are used to check composition and page
parity:

- Internet Archive item [`opticksortreatis1730newt`](https://archive.org/details/opticksortreatis1730newt), University of California Libraries copy.
- Internet Archive item [`opticksoratreat00newtgoog`](https://archive.org/details/opticksoratreat00newtgoog), Oxford/Google copy.

These are layout references for the same edition. Project Gutenberg does not
identify which physical copy supplied its transcription, so the facsimiles are
not claimed to be that exact copy.

## Pinned text and artwork source

The build reads the repository's unmodified Project Gutenberg ebook 33504
snapshot:

- `tools/image-to-braille/sources/gutenberg-33504/33504.txt`
- `tools/image-to-braille/sources/gutenberg-33504/33504-h/33504-h.htm`
- `tools/image-to-braille/sources/gutenberg-33504/33504-h/images/` (57 figures)
- `tools/image-to-braille/sources/gutenberg-33504/SHA256SUMS`

The snapshot is pinned to GITenberg commit
[`ea7d161812f0cab3ac29d47e5c4806557628cf5a`](https://github.com/GITenberg/Opticks--13-Or-A-Treatise-of-the-Reflections-Refractions-Inflections-and-Colours-of-Light_33504/tree/ea7d161812f0cab3ac29d47e5c4806557628cf5a).
The text SHA-256 is
`f10edc441b26448cae18105c9ba13d732faa7ad5fd9d1dd1805d57b7aca34635`;
the HTML SHA-256 is
`a732b1879046b56d62f4ce4af95a62cfe3e8c0921abecdf5e520610925e25b9d`.

## Historical page policy

The Gutenberg HTML contains printed-page anchors from `Page_1` through
`Page_406`. The generator treats an anchor as a physical page boundary even
when it appears in the middle of a sentence. It does not reflow content across
that boundary merely to fill a leaf.

- A blank, unnumbered logical leaf precedes printed page 1. This puts every odd
  printed page on the right and every even printed page on the left.
- Printed pages 112, 192, and 316 have no HTML anchors. Each is represented by
  an explicit blank, unnumbered page slot. In the 1730 structure these are the
  blank versos before Book I Part II (page 113), Book II (page 193), and Book
  III (page 317).
- Printed page numbers remain the historical numbers 1–406. Controller indexes
  and the leading parity leaf are not exposed as page numbers.
- After printed page 406, the spread controller supplies a blank right leaf so
  the final even page remains on the left.
- Headings, paragraphs, footnotes, captions, and figures remain on the printed
  page indicated by the source HTML. Original white space is retained instead
  of borrowing content from the following page.
- Figures may be scaled uniformly to fit the usable leaf, but are not stretched,
  cropped, reordered, or moved to another historical page.

The historical source has 406 numbered page slots plus the leading parity
leaf: 407 generated entries displayed as 204 two-leaf spreads. This edition is
not a compression of the text. The 1730 pages have a median density of roughly
273 words per page, compared with roughly 489 words on a compact-edition page.
The lower density and resulting white space are part of the historical layout.

## Figure-to-page map

The mapping below is derived from the last active `Page_N` anchor at each HTML
`img` element. The filename disambiguates figure numbers that restart in later
books and parts.

| Source image | Printed page | Source image | Printed page |
| --- | ---: | --- | ---: |
| `fig1-1.jpg` | 6 | `fig2-1.jpg` | 8 |
| `fig3-1.jpg` | 9 | `fig4-1.jpg` | 11 |
| `fig5-1.jpg` | 11 | `fig6-1.jpg` | 12 |
| `fig7-1.jpg` | 12 | `fig8-1.jpg` | 17 |
| `fig9-1.jpg` | 18 | `fig10-1.jpg` | 19 |
| `fig11-1.jpg` | 23 | `fig12-1.jpg` | 27 |
| `fig13-1.jpg` | 27 | `fig14-1.jpg` | 36 |
| `fig15-1.jpg` | 38 | `fig16-1.jpg` | 43 |
| `fig17-1.jpg` | 43 | `fig18-1.jpg` | 47 |
| `fig20-1.jpg` | 47 | `fig19-1.jpg` | 49 |
| `fig21-1.jpg` | 56 | `fig22-1.jpg` | 58 |
| `fig23-1.jpg` | 64 | `fig24-1.jpg` | 68 |
| `fig25-1.jpg` | 71 | `fig26-1.jpg` | 77 |
| `fig27-1.jpg` | 96 | `fig28-1.jpg` | 101 |
| `fig29-1.jpg` | 109 | `fig1-2.jpg` | 115 |
| `fig2-2.jpg` | 117 | `fig3-2.jpg` | 117 |
| `fig4-2.jpg` | 127 | `fig5-2.jpg` | 127 |
| `fig6-2.jpg` | 137 | `fig7-2.jpg` | 143 |
| `fig8-2.jpg` | 143 | `fig9-2.jpg` | 145 |
| `fig10-2.jpg` | 147 | `fig11-2.jpg` | 154 |
| `fig12-2.jpg` | 163 | `fig13-2.jpg` | 166 |
| `fig14-2.jpg` | 168 | `fig15-2.jpg` | 174 |
| `fig16-2.jpg` | 187 | `fig1-3.jpg` | 195 |
| `fig2-3.jpg` | 200 | `fig3-3.jpg` | 209 |
| `fig4-3.jpg` | 213 | `fig5-3.jpg` | 223 |
| `fig6-3.jpg` | 227 | `fig7-3.jpg` | 238 |
| `fig8-3.jpg` | 270 | `fig1-4.jpg` | 321 |
| `fig2-4.jpg` | 321 | `fig3-4.jpg` | 333 |
| `fig4-4.jpg` | 356 |  |  |

The apparent Figure 20/Figure 19 reversal on pages 47 and 49 is the order in
the 1730-derived HTML and is intentionally preserved.

Original page 9 remains the Figure 3 plate leaf. The enlarged Figure 3 center
detail created for the compact game edition is a useful supplemental view, but
it is not a page in the 1730 book and is therefore excluded from this edition.
Accordingly, the historical data records `customDetailPages: 0`.

Across the book, 48 printed pages contain illustrations: 19 are plate-only
pages and 29 mix figures with text. Plate-only leaves are allowed to remain
sparse; mixed leaves retain their source order and page-local prose.

## Representative composition checks

- Page 9 is the Figure 3 plate leaf; page 10 begins AX. VI and its prose.
- Page 27 contains Figures 12 and 13; page 28 begins *Exper. 3*. Page-28 prose
  must not be pulled beneath the page-27 figures.
- Page 38 combines prose, Figure 15, and continuing prose, matching the source
  order before the paragraph continues on page 39.
- Pages 112, 192, and 316 are blank leaves, followed by right-hand opening
  pages 113, 193, and 317 respectively.

## Generated artifacts

- Generator: `tools/prefabs/generate-opticks-historical-pages.py`
- Page data: `tools/prefabs/opticks-four-display-pages-v29-historical.json`
- Builder: `tools/prefabs/build-opticks-two-page-historical-book.cjs`
- Output: `prefabs/newton-opticks-large-two-page-historical-v1.brz`
- Layout test: `tools/prefabs/test-opticks-historical-layout.py`
- Prefab test: `tools/prefabs/test-opticks-two-page-historical-book.cjs`

Deterministic-build values:

- Generated entries: **407**
- Displayed spreads: **204**
- Page-data SHA-256:
  **`c99245aee1f21bf1e2008a457f85e6a991db41ea3213e08caa2a61e016252d48`**
- Prefab SHA-256:
  **`a8b4e976476c070005f1f2294109bb99aed6ab929e0b56ddfaa505b433197f25`**
- Maximum image-band bytes: **28,005**

## Regeneration and checks

```sh
python3 tools/prefabs/generate-opticks-historical-pages.py \
  --output tools/prefabs/opticks-four-display-pages-v29-historical.json

node tools/prefabs/build-opticks-two-page-historical-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-historical-v1.brz \
  tools/prefabs/opticks-four-display-pages-v29-historical.json

python3 tools/prefabs/test-opticks-historical-layout.py

node tools/prefabs/test-opticks-two-page-historical-book.cjs \
  tools/prefabs/sources/big-book-two-page-shell.brz \
  prefabs/newton-opticks-large-two-page-historical-v1.brz \
  tools/prefabs/opticks-four-display-pages-v29-historical.json
```

The layout test must verify every printed page boundary, blank-page policy,
heading and figure assignment, figure-cell preservation, and array byte limit.
The prefab test must verify odd/right and even/left parity, first and last
spreads, page-turn direction, synchronized streams, shell preservation, wire
integrity, and strict zero-warning placement.

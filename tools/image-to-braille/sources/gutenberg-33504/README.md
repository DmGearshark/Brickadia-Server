# Newton's *Opticks*: pinned Project Gutenberg source

This directory preserves the exact book text, HTML, and 57 source illustrations
used to build the live-calibrated v25 Brickadia book. The files are an
unmodified snapshot of Project Gutenberg ebook 33504 from GITenberg commit
`ea7d161812f0cab3ac29d47e5c4806557628cf5a`:

<https://github.com/GITenberg/Opticks--13-Or-A-Treatise-of-the-Reflections-Refractions-Inflections-and-Colours-of-Light_33504/tree/ea7d161812f0cab3ac29d47e5c4806557628cf5a>

The complete Project Gutenberg license is retained in `LICENSE`. Verify every
vendored file from the repository root with:

```sh
sha256sum -c tools/image-to-braille/sources/gutenberg-33504/SHA256SUMS
```

`tools/prefabs/generate-opticks-four-display-pages.py` reads this snapshot
directly, so regeneration does not depend on a temporary checkout or a live
network source.

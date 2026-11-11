# SQM1 Piano Player V10.2

V10.2 keeps the complete V10.1 player and retunes its existing folded Piano
strike. It is intended to give hard notes a firmer hammer-like beginning without
adding a click, a pulse, or another sound source.

The only synthesis change is:

```text
V10.1 strike: 0.30 * brightness * exp(-6t)
V10.2 strike: 0.38 * brightness * exp(-10t)
```

The new strike is stronger for about the first 59 ms and then falls below the
V10.1 strike. The 6 ms attack, continuous sine oscillator, exact-zero retune
mask, silent state flush, adaptive headroom, COT V4 voice allocation, controls,
automatic cartridge intake, and all non-Piano profiles are unchanged. The
retune adds no bricks, wires, emitters, execution components, or sound slots.

At maximum velocity, visible volume 2, and the normal 0.35 Piano headroom, the
modeled solo onset is `1.38 * 2 * 0.35 = 0.966` before adaptive limiting.

Build and validate it with:

```bash
node tools/prefabs/build-sqm1-piano-player-v10-2.cjs
node tools/prefabs/test-sqm1-piano-player-v10-2.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v10-2-hammer.brz --strict
```

The approved V10.1 prefab remains available separately as the exact fallback.
For an audible check, compare hard isolated notes, rapid repeated notes while a
tail is active, the His Theme finale, and Cornfield Chase at volumes 1 and 2.
The desired result is a short rounded thump, no onset click or pulsing buzz, and
no loss of left-hand notes in dense passages.

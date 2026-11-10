# SQM1 stable Piano V10

`prefabs/sqm1-auto-zone-music-player-ui-piano-v10-stable.brz` keeps the V9
player, 24-lane scheduler and visible controls while addressing the remaining
Piano artifacts at the emitter and mix stages. It makes no score or cartridge
format changes. The pitch-continuity V4 *His Theme* cartridge remains the
recommended quality test.

## Stable Piano emitters

Piano body emitters now start once when playback becomes stable and stay on
until playback stops. Each lane still changes pitch for its next record, but an
exact-zero mask keeps that retuning inaudible. This avoids restarting a Sine
source for every note. Non-Piano body enable paths and all partial enable paths
retain their existing per-note behavior.

The audible attack and release are unchanged. Once a lane's guarded audible
window closes, its hidden Dampen state switches from the normal speed-scaled
70 ms release to a 6 ms flush. The V4 score reserves at least 120 ms of musical
silence after its 80 ms audible release, giving at least ten flush intervals at
the maximum speed of 2. The modeled old-state residue at lane reuse falls by
more than 3,900 times.

## Energy-aware Piano headroom

Sparse notes retain V9's `0.35` Piano gain ceiling. V10 measures the squared
pre-master amplitude of the 24 Piano bodies and lowers that scale only when the
combined peak would exceed a modeled `0.70` RMS ceiling:

```text
targetScale = min(0.35,
  0.70 * sqrt(2) / (visibleVolume * sqrt(sum(bodyAmplitude^2))))
```

A new dense peak attenuates immediately. Gain recovery takes 120 ms so notes
entering and leaving a chord do not cause rapid pumping. Numerical simulation
against the complete V4 *His Theme* score found the limiter active for about
`0.06%` of samples at visible volume 1, `1.4%` at 1.5 and `8.7%` at 2. A
maximum-velocity solo note remains at the V9 scale even at visible volume 2.

V10 adds 128 gates to V9: 54 for energy headroom, 50 for continuous Piano body
lifecycle and exact-zero masks, and 24 for silent flush selection. The final
prefab contains 7,838 bricks, 13,196 wires, 7,846 components, 72 physical Sine
emitters and at most 24 enabled Piano sources. Its SHA-256 is:

```text
db59f22fb80e1e1d2c2f797464c09299574a728c73665470939b51d6f9dc5e56
```

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v10.cjs
node tools/prefabs/test-sqm1-piano-player-v10.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v10-stable.brz --strict
```

For runtime acceptance, load
`prefabs/sqm1-his-theme-pitch-continuity-v4.brz`, select Piano and compare the
last sheet at speeds 1 and 0.5. Listen for the left-hand notes under the dense
right-hand passage, clean repeated attacks and the absence of a buzz when a
lane changes pitch. Then test visible volume 2 for dense-peak control and one
non-Piano profile to confirm its original timbre and note lifecycle.

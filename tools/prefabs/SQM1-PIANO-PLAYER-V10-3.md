# SQM1 Piano Player V10.3

V10.3 separates MIDI note strength from the player's master-volume dial and
adds an audible velocity-dependent hammer color while retaining the complete
V10.2 transport, cartridge, UI, spatial and non-Piano behavior.

The decoded MIDI velocity remains `(midiVelocity / 127)^1.4`. Piano maps it to:

```text
hit       = clamp(decodedVelocity, 0.1, 1.0)
hardness  = (hit - 0.1) / 0.9
impact    = hardness^2
weight    = hit * impact
```

`hit` controls the sustained note body. The existing master-volume dial is a
separate `1.0..2.0` multiplier, so changing the dial does not flatten MIDI
dynamics or alter the hard-hit calculation.

The hammer transient is:

```text
folded body strike = 0.50 * weight * exp(-18t)
H2 sine strike     = 0.40 * weight * exp(-18t)
```

The H2 strike reuses each voice's existing second-harmonic emitter at exactly
twice the fundamental pitch. It has a 6 ms Dampen and stays enabled through an
inaudible residual fade before switching off. H3 remains disabled for Piano.
The H2 source is active only while its transient exceeds `0.001`, so Piano uses
24 body sounds normally and at most 48 sounds during a 24-note hard onset.

The adaptive limiter measures the exact sum of all 24 body energies and all 24
H2 energies. Its two-frequency RMS ceiling is `0.65`; the normal `0.35` sparse
headroom is unchanged. At the maximum body/H2 onset ratio, this keeps the
phase-aligned modeled waveform peak below unity.

Representative response:

| MIDI velocity | Hit | Impact | Body strike | H2 strike |
| ---: | ---: | ---: | ---: | ---: |
| 32 | 0.145 | 0.003 | 0.000 | 0.000 |
| 48 | 0.256 | 0.030 | 0.004 | 0.003 |
| 64 | 0.383 | 0.099 | 0.019 | 0.015 |
| 80 | 0.524 | 0.222 | 0.058 | 0.046 |
| 96 | 0.676 | 0.409 | 0.138 | 0.111 |
| 112 | 0.839 | 0.674 | 0.282 | 0.226 |
| 127 | 1.000 | 1.000 | 0.500 | 0.400 |

Build and validate it with:

```bash
node tools/prefabs/build-sqm1-piano-player-v10-3.cjs
node tools/prefabs/test-sqm1-piano-player-v10-3.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v10-3-dynamic-hammer.brz --strict
```

V10.1 and V10.2 remain committed as exact fallbacks. The automated checks can
prove the velocity curve, routing, source ceiling, limiter, release safety and
graph integrity. Final timbre still requires an in-game listening comparison.

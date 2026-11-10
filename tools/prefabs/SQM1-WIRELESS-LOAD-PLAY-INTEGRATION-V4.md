# SQM1 wireless load/play integration V4

V4 is the default-safe end-to-end cartridge test. It retains V3's persistent
wireless request, exact staging and active copies, publication barriers,
shared `DecodeNote` Function, replay guard and two continuous Sine voices. It
adds explicit world defaults for the three optional numeric control ports.

## Why V4 exists

The returned V3 player proves every path before the numeric controls works:

- the exact 46-record score reached both staging and ActiveScore;
- validation, Loaded and acknowledgment succeeded;
- Play started and both ActiveScore reads and Function calls completed;
- both first notes armed with no abort, bounds or decode error;
- both Sine emitters became enabled.

The emitters nevertheless retained volume `0` and pitch `0.1`, while both
voices stayed on their first note. The stopwatch advanced normally. A placed
microchip's unwired numeric `RER_Output` is `0`; its `CallableDefault` and
`CallableMirror` values do not supply the standing world output. Consequently
raw speed `0` froze musical time, raw volume `0` silenced the enabled emitters,
and raw pitch `0` reached the emitter's `0.1` clamp.

V4 resolves each numeric port through a positive-value selector:

| Port | Positive wire value | Zero or unwired |
| --- | --- | --- |
| `Pitch (0=1)` | supplied multiplier | `1` |
| `Speed (0=1)` | supplied multiplier | `1` |
| `Volume (0=.08)` | supplied master volume | `0.08` |

This keeps all external controls optional. A value of zero means use the
internal default; the red Stop button remains the normal way to silence or
halt playback.

## Files

- Player: `prefabs/sqm1-wireless-sine-player-integration-v4.brz`
- Cartridge: `prefabs/sqm1-two-voice-test-cartridge-v1.brz`
- Builder: `build-sqm1-wireless-sine-player-integration-v4.cjs`
- Offline test: `test-sqm1-wireless-sine-player-integration-v4.cjs`
- Returned-save reader: `read-sqm1-wireless-sine-player-integration-v4.cjs`

The existing V1 cartridge is protocol-compatible and does not need a change.

## In-game test

Paste fresh player and cartridge copies as two separate entities. Leave every
player input unwired; use the three physical buttons.

1. Press the player's blue **LOAD / LISTEN** button.
2. Press the cartridge's green **Send SQM1 test song** button. There is no
   request deadline.
3. Wait about five seconds. Confirm `Validation true`, `Loaded true`, active
   length `46` and Ack `1`.
4. Delete the complete cartridge entity.
5. Press the player's purple **PLAY LOCAL COPY** button and let the eight-second
   duet finish.
6. Press Play again and let the second playthrough finish.
7. Export only the complete player entity and inspect it with the V4 reader.

The returned save can prove the exact wireless and local copies, both decoder
lanes, note timing, emitter transitions, replay, and the numeric fallback
topology. The operator must separately report whether both voices were audible.

## Rebuild and validation

```sh
node tools/prefabs/build-sqm1-wireless-sine-player-integration-v4.cjs \
  prefabs/sqm1-wireless-sine-player-integration-v4.brz
node tools/prefabs/read-sqm1-wireless-sine-player-integration-v4.cjs \
  returned-player.brz
```

The builder and reader require one `> 0` comparison and one default selector
per numeric input. They prove the effective speed drives musical time, effective
pitch drives both emitters, and effective volume drives both Dampen envelopes,
alongside all V3 transport, validation, decoder and publication checks.

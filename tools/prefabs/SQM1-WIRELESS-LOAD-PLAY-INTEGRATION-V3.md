# SQM1 wireless load/play integration V3

V3 is the timing-corrected end-to-end cartridge test. It retains V2's
persistent request window, SQM1 request/offer/ack protocol, independent staging
and active arrays, shared `DecodeNote` Function, replay guard and two continuous
Sine voices. It adds explicit publication timing at validation and playback
boundaries.

## Why V3 exists

The returned V2 player proves the wireless path now works:

- one matching offer was accepted with no rejection;
- all 46 Quaternions copied into the player's staging array exactly;
- the retained length and all five sampled headers matched the test score;
- the validation branch nevertheless recorded result `-3`;
- active copy, acknowledgment and playback were never reached.

The final staged-header setter executed the validation branch in the same tick.
Its pure `SplitQuaternion -> Compare -> AND` graph therefore still observed the
previous value even though the correct value was retained afterward. V3 adds
one publication tick at that boundary. It also adds the same guard after the
active-length setter and final active-header setter, preventing the next two
commit checks from encountering the same race.

V3 applies the same lesson to the first live sound path. Each voice waits one
tick after its `ActiveScore` Get before the wired `DecodeNote` call, call count
and out-of-bounds capture consume the record. After the Function completes and
its retained outputs are captured, the voice waits one more tick before the
pure iteration/abort/bounds acceptance graph branches. These four playback
guards leave cursor timing and note scheduling unchanged while making the
remaining query and pure-condition boundaries explicit.

The exact returned V2 state is preserved in
[`gate-reference/sqm1-wireless-sine-player-integration-v2-validation-observed.json`](gate-reference/sqm1-wireless-sine-player-integration-v2-validation-observed.json).

## Files

- Player: `prefabs/sqm1-wireless-sine-player-integration-v3.brz`
- Cartridge: `prefabs/sqm1-two-voice-test-cartridge-v1.brz`
- Builder: `build-sqm1-wireless-sine-player-integration-v3.cjs`
- Offline test: `test-sqm1-wireless-sine-player-integration-v3.cjs`
- Returned-save reader: `read-sqm1-wireless-sine-player-integration-v3.cjs`

V1 and V2 remain preserved with their observed results. The V1 cartridge is
protocol-compatible with V3 and does not need modification.

## In-game test

Paste fresh player and cartridge copies as two separate entities. Do not merge,
weld, open or rewire them.

1. Press the player's blue **LOAD / LISTEN** button.
2. Press the cartridge's green **Send SQM1 test song** button. The request does
   not expire, so there is no deadline.
3. Wait about five seconds. The player should show `Validation true`,
   `Loaded true`, active length `46` and Ack `1`. The cartridge should retain
   acknowledgment result `1`.
4. Delete the complete cartridge entity.
5. Press the player's purple **PLAY LOCAL COPY** button and let the eight-second
   duet finish.
6. Press Play again and let the second playthrough finish.
7. Export only the complete player entity and inspect it with the V3 reader.

The returned save can prove the exact wireless and local copies, validation,
both decoder lanes, note timing, emitter-enable transitions and replay. The
operator must separately report whether both Sine voices were audible during
both playthroughs.

## Rebuild and validation

```sh
node tools/prefabs/build-sqm1-wireless-sine-player-integration-v3.cjs \
  prefabs/sqm1-wireless-sine-player-integration-v3.brz
node tools/prefabs/read-sqm1-wireless-sine-player-integration-v3.cjs \
  returned-player.brz
```

The builder and returned-save reader require all three validation and all four
playback one-tick publication buffers in their exact control paths, along with
the persistent request window, same-callback remote reference copy, independent
active commit, replay guard, shared decoder and continuous Sine audio topology.

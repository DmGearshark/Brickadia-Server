# SQM1 wireless load/play integration V2

V2 is the follow-up to the first complete cartridge-to-player test. It keeps
the two-voice Sine engine, independent staging and active arrays, shared
`DecodeNote` Function and SQM1 request/offer/ack protocol from V1. Its only
runtime change is the request lifetime.

## Why V2 exists

The returned V1 save proves that the operator used both entities correctly:

- the player sent request nonce `1`;
- the cartridge returned one offer with the exact magic, channel, nonce,
  length, title, mode and format;
- the player received that offer after `request.waiting` had become false;
- the envelope branch therefore rejected it before either array copy;
- no playback start or audio event occurred.

V1 closed `request.waiting` after ten seconds. V2 removes that timer. A request
now stays open until a matching offer succeeds or the blue button starts a new
request with a new nonce. Magic, channel, nonce, length, title, mode, format and
copy-busy checks remain in place.

The exact returned V1 state is preserved in
[`gate-reference/sqm1-wireless-sine-player-integration-v1-timeout-observed.json`](gate-reference/sqm1-wireless-sine-player-integration-v1-timeout-observed.json).

## Files

- Player: `prefabs/sqm1-wireless-sine-player-integration-v2.brz`
- Cartridge: `prefabs/sqm1-two-voice-test-cartridge-v1.brz`
- Builder: `build-sqm1-wireless-sine-player-integration-v2.cjs`
- Offline test: `test-sqm1-wireless-sine-player-integration-v2.cjs`
- Returned-save reader: `read-sqm1-wireless-sine-player-integration-v2.cjs`

The V1 player and cartridge are retained unchanged.

## In-game test

Paste the V2 player and V1 cartridge as two separate entities. Do not merge,
weld, open or rewire them.

1. Press the player's blue **LOAD / LISTEN** button.
2. Walk to the cartridge at any comfortable pace and press its green
   **Send SQM1 test song** button.
3. Wait about three seconds. The player should show `Loaded true`, staging and
   active lengths `46`, validation true and Ack `1`. The cartridge should show
   acknowledgment result `1`.
4. Delete the complete cartridge entity.
5. Press the player's purple **PLAY LOCAL COPY** button and let the eight-second
   duet finish.
6. Press Play again and let the second playthrough finish.
7. Export only the complete player entity and inspect it with the V2 reader.

The save can prove wireless transfer, independent local storage, both decoder
lanes, note timing and replay. The operator must separately report whether both
Sine voices were audible in both playthroughs.

## Returned V2 validation observation

The returned V2 player retained the complete strict-placement graph and proves
that the timeout correction worked. It accepted one exact offer and copied all
46 Quaternions into staging. The staging array and all five saved validation
headers matched the cartridge exactly.

V2 nevertheless recorded validation result `-3`, made zero active copies and
left `Loaded` false. Its validation branch executes in the same tick as the
final header setter, before the pure Split/Compare/AND tree republishes the new
header values. The saved values are exact afterward, establishing a publication
race rather than corrupt wireless data. The active-length and active-header
checks use the same immediate pattern and require the same one-tick boundary.

No Play, decoder, note or emitter counter advanced because the failed validation
correctly blocked playback. Silence in this return does not establish an audio
failure. The corrected successor adds one tick before each of the three commit
validation branches.

[sqm1-wireless-sine-player-integration-v2-validation-observed.json](gate-reference/sqm1-wireless-sine-player-integration-v2-validation-observed.json)
records the source and returned hashes and exact retained state without storing
the user's complete returned save.

## Rebuild and validation

```sh
node tools/prefabs/build-sqm1-wireless-sine-player-integration-v2.cjs \
  prefabs/sqm1-wireless-sine-player-integration-v2.brz
node tools/prefabs/read-sqm1-wireless-sine-player-integration-v2.cjs \
  returned-player.brz
```

The builder checks every serialized wire and input, rejects non-finite numbers,
requires strict zero-warning placement, verifies the persistent request window,
and confirms both continuous Sine emitters.

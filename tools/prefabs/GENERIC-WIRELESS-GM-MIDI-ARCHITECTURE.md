# Generic wireless General MIDI player architecture

This document defines the production architecture that follows the single-array
MIDI player, shared `DecodeNote` Function probe, wireless cartridge-copy probe,
and waveform audition probe. It deliberately keeps
`build-single-quat-midi-player.cjs` and its committed Viva La Vida prefab as the
known-good, per-song Sine Studio fallback while the generic player is built and
tested separately.

## Current proof boundary

| Boundary | Current evidence | Production requirement |
| --- | --- | --- |
| Shared pure note decoder | Passed in Brickadia with two same-tick callers; output slots and one-tick retention are recorded in `gate-reference/midi-decode-function-observed.json` | Also exercise a wired `ArrayVar Get.Value -> FunctionCall.Input0` path and a 32-caller same-tick stress case |
| Hardwired cross-chip Quat `CopyFrom` | Exact serialized control path exists in `midi-wireless-cartridge-copy-probe-v1.brz` | Returned in-game probe must report the direct path passed |
| Global-event `ArrayVarRef` transport | Exact direct event-to-`CopyFrom.SourceRef` path serializes and round-trips | Returned in-game probe must report the wireless path passed |
| Dynamic synth descriptor | Four `AudioReference` objects, three generic selects, and a wired continuous emitter serialize and round-trip | In-game audition must prove Dynamic Sine matches Direct Sine and Triangle, Square, and Sawtooth are audible |

Offline serialization is necessary but does not establish the two live engine
boundaries above. The generic production player should not claim wireless or
dynamic-waveform support until the corresponding returned saves pass their
readers.

## Score and disk format

The disk contains one immutable Quat array in the existing format. The score
format remains version 1; wireless metadata does not consume score records.

| Element | X | Y | Z | W |
| --- | --- | --- | --- | --- |
| `q0` | magic `7701001` | version `1` | active voice count | duration seconds |
| `q1` | header length `34` | release tail seconds | minimum MIDI note | maximum MIDI note |
| `q2..q33` | absolute note offset | note count | instrument code | channel + 16 x track |
| `q34+` | start seconds | true key-off seconds | MIDI note | velocity |

Instrument codes `0..127` are melodic General MIDI programs. Channel 10 uses
program plus 128, preserving the existing percussion marker. The converter
continues to fail when more than 32 non-overlapping lanes are required; it does
not steal held notes.

Each disk prefab contains:

- the score ArrayVar;
- title, preferred render mode, and wireless channel metadata;
- an `SQM1.Request` receiver;
- a `Send Song` pulse input or visible button;
- an `SQM1.Offer` sender and `SQM1.Ack` receiver;
- optional waiting, sent, accepted, and rejected status indicators.

## Wireless protocol

Use transport magic `7702001`. All three events are global broadcasts: senders
leave `Target` unwired and receivers set `bIsObjectEvent=false`. The channel
routes intentional traffic and the nonce rejects stale replies. Neither is an
authentication mechanism.

### `SQM1.Request`

| Slot | Value |
| --- | --- |
| Data1 | transport magic `7702001` |
| Data2 | channel, integer `1..65535` |
| Data3 | random integer request nonce |
| Data4 | requested render mode: `0` Sine Studio, `1` GM Color, `2` disk preference |
| Data5 | maximum voices, `32` |
| Data6 | maximum accepted Quaternion count, initially `65536` |
| Data7 | supported score format, `1` |
| Data8 | capability bits: `1` cache copy, `2` Sine Studio, `4` GM Color |

### `SQM1.Offer`

| Slot | Value |
| --- | --- |
| Data1 | transport magic |
| Data2 | channel |
| Data3 | disk `ArrayVarRef` |
| Data4 | echoed request nonce |
| Data5 | exact Quaternion count |
| Data6 | title string |
| Data7 | preferred render mode, `0` or `1` |
| Data8 | score format, `1` |

Data3 intentionally matches the exact component-reference slot exercised by
the V1 wireless probe.

### `SQM1.Ack`

| Slot | Value |
| --- | --- |
| Data1 | transport magic |
| Data2 | channel |
| Data3 | request nonce |
| Data4 | result code |
| Data5 | copied Quaternion count |
| Data6 | title or short status text |
| Data7 | resolved render mode |
| Data8 | reserved `0` |

Result `1` means loaded. Errors are `-1` copy timeout/failure, `-2` bad length,
`-3` bad global header, `-4` bad voice table, and `-5` unsupported format or
capability.

## Handshake and copy transaction

The player owns two Quat arrays:

- `StagingScore` receives the remote copy;
- `ActiveScore` remains playable until staging passes validation.

The user pulses `Load Disk`. The player generates a nonce, marks itself waiting
for ten seconds, and broadcasts `SQM1.Request`. Matching disks cache the newest
request on their channel. The user presses `Send Song` on the chosen disk, and
that disk broadcasts its offer. Players sharing a world should use different
channels.

On the first matching offer, the player:

1. checks magic, channel, nonce, format, declared length, `waiting`, and
   `!copyBusy`;
2. latches only scalar metadata, then clears `waiting` and sets `copyBusy`;
3. wires `Offer.DataOut3` directly into
   `Exec_ArrayVar_CopyFrom.SourceRef`, with `StagingScore.ArrayVarRef` as the
   destination;
4. validates staging;
5. stops current playback only after validation succeeds;
6. copies staging into `ActiveScore`, refreshes active metadata and voice
   headers, resets all cursors, and marks the song loaded;
7. acknowledges success and optionally starts playback.

The remote component reference must not pass through a Var, Function, or the
`loadboard-lib.cjs` `inbox()` helper. That helper maps unknown WireValue variants
to an f64 ArrayVar and cannot preserve `BRSavedComponentRef`. If a live probe
later proves that `QueueTicks` preserves the reference, a single snapshot is
allowed, but the direct same-event copy remains the smaller path.

A two-second `QueueSeconds` watchdog carries the nonce and reports `-1` if the
copy never completes. The ten-second request timeout also carries the nonce so
an old timeout cannot cancel a newer request. A failed staging transaction
clears staging and leaves the previous active song intact.

## Validation

Validation checks the copied length against Data5, the configured cap, and the
minimum 34-record header. It then requires:

- `q0 = (7701001, 1, activeVoices, duration)`, with `activeVoices` in `1..32`
  and a positive duration;
- `q1.X = 34`, release tail in `0..5`, and MIDI bounds in `0..127` with
  minimum no greater than maximum;
- active segments that are contiguous, nonempty, and wholly within the array;
- active instrument codes in `0..255` and nonnegative channel/track codes;
- the percussion marker to agree with channel 10;
- unused headers with count `0`, instrument `-1`, and channel/track `-1`;
- the final active end offset to equal the actual array length.

The loader does not scan every note. Each lane validates a fetched record before
arming audio: start is nonnegative, end is greater than start and no later than
duration, pitch ratio is within the continuous emitter range, velocity curve is
within `(0, 1]`, and the cursor remains inside its validated segment. An invalid
record advances on the next tick instead of stalling the lane.

## Player interface and state

Preserve the current first five inputs and append the wireless controls:

| Order | Port | Type | Default |
| --- | --- | --- | --- |
| 1 | Play (Pulse) | Bool | false |
| 2 | Stop (Pulse) | Bool | false |
| 3 | Pitch Multiplier | Number | 1 |
| 4 | Speed Multiplier | Number | 1 |
| 5 | Master Volume | Number | 0.06 |
| 6 | Load Disk (Pulse) | Bool | false |
| 7 | Wireless Channel | Number | 1 |
| 8 | Synth Mode | Number | 2 |
| 9 | Auto Play After Load | Bool | false |

Expose `Loaded`, `Loading`, `Playing`, `Song Title`, and `Load Status` outputs.
Use separate `waiting`, `copyBusy`, `validating`, `loaded`, and `running` Bools
rather than overloading one numeric state. Keep the last nonce, title, declared
length, disk preference, resolved render mode, and result code in ordinary
Vars.

Resolve and latch the render mode before profile lookup and note loading. A mode
change therefore applies at the next Play or load rather than switching an
oscillator descriptor in the middle of a note.

## Fixed 32-voice engine

Build exactly 32 independent schedulers. An unused lane remains silent and does
not read a note record. After a successful active-array copy, each lane retains
its `q(2 + voiceIndex)` output and splits it into offset, count, instrument code,
and channel/track code.

The current builder's baked values change as follows:

| Current builder value | Generic source |
| --- | --- |
| `score.voices.length` loop | fixed `0..31` loop |
| initial and reset cursor `voice.offset` | active header X |
| last index `voice.offset + voice.count - 1` | active header X + Y - 1 |
| `voice.instrumentCode` | active header Z |
| finish time `score.duration + tail` | active q0.W + active q1.Y |
| release end literal | decoded end + active q1.Y |
| compile-time layer list | three fixed emitters controlled by profile gains |

Before loading a note, require both `voiceIndex < activeVoices` and
`header.count > 0`. Select a safe profile index for unused lanes so an unused
instrument code of `-1` never reaches profile arithmetic.

## Shared `DecodeNote` Function

One pure Function Definition is shared by all lanes. Each lane keeps its own
FunctionCall and all scheduler, envelope, Dampen, and emitter state.

Replace the current splitter, pitch calculation, velocity calculation, three
hold Vars, and their three setter chains with:

```text
ArrayGet.Value   -> FunctionCall.Input0
ArrayGet.ExecOut -> FunctionCall.Exec
FunctionCall.Completed -> ready setter
```

Verified output mapping:

| Output | Meaning |
| --- | --- |
| Output3 | start seconds |
| Output2 | true key-off seconds |
| Output1 | pitch ratio |
| Output0 | velocity curve |

Wire start to the begin comparison and age subtraction; end to the end,
before-end, and release-end paths; pitch to master pitch; and velocity to body
and harmonic envelopes. An aborted call or invalid output follows the
skip-record path.

## Render profiles

Use two small internal Quat profile arrays:

- Tone profile: waveform code, body gain, twin-fundamental relative gain,
  octave-harmonic gain.
- Envelope profile: sustain floor, attack seconds, release seconds, body decay
  rate.

Profile indices are `0` Sine Studio piano program 0, `1` Sine Studio other,
`2..17` the sixteen eight-program GM families, and `18` percussion.

```text
melodicProgram = instrumentCode mod 128
family = (melodicProgram - (melodicProgram mod 8)) / 8
gmIndex = instrumentCode >= 128 ? 18 : family + 2
studioIndex = instrumentCode == 0 ? 0 : 1
profileIndex = resolvedGMMode ? gmIndex : studioIndex
```

Waveform codes are `0` Sine, `1` Triangle, `2` Square, and `3` Sawtooth. Four
shared AudioReference gates feed a six-gate selector in each voice:

```text
s01 = index == 1 ? Triangle : Sine
s23 = index == 3 ? Sawtooth : Square
selected = index > 1 ? s23 : s01
```

The selected descriptor fans to all three emitters in that lane. The exact
asset names are `BA_Synth_Basic_Sine`, `BA_Synth_Basic_Triangle`,
`BA_Synth_Basic_Square`, and `BA_Synth_Basic_Sawtooth`.

Fixed pitch scales preserve the current piano recipe:

- layer 0: `2 ^ (-0.7 / 1200)`;
- layer 1: `2 ^ (0.9 / 1200)`;
- layer 2: `2.0015`.

Layer 0 and layer 1 use the body envelope. Layer 2 uses the faster harmonic
envelope. Zero-gain layers are disabled as well as muted. Layer 2 also requires
its scaled pitch to remain within the continuous emitter range.

Recommended initial profiles follow. They are conservative calibration values,
not a claim of SoundFont equivalence.

| Profile | Wave | Body / twin / harmonic | Floor / attack / release / decay |
| --- | --- | --- | --- |
| Studio piano 0 | Sine | `.55 / 1 / .15` | `.18 / .015 / .06 / 2.5` |
| Studio other | Sine | `.85 / 0 / 0` | `1 / .015 / .06 / 0` |
| 0–7 Piano | Sine | `.50 / .80 / .13` | `.16 / .012 / .08 / 2.7` |
| 8–15 Chromatic percussion | Sine | `.55 / .10 / .22` | `.02 / .004 / .10 / 6` |
| 16–23 Organ | Square | `.24 / .18 / .04` | `1 / .025 / .10 / 0` |
| 24–31 Guitar | Triangle | `.45 / .18 / .10` | `.06 / .008 / .12 / 3.7` |
| 32–39 Bass | Triangle | `.50 / .12 / .04` | `.32 / .008 / .10 / 1.8` |
| 40–47 Strings | Sawtooth | `.24 / .32 / .03` | `.72 / .16 / .18 / .15` |
| 48–55 Ensemble | Sawtooth | `.20 / .38 / .04` | `.82 / .20 / .18 / .08` |
| 56–63 Brass | Sawtooth | `.23 / .12 / .05` | `.66 / .045 / .14 / .22` |
| 64–71 Reed | Square | `.22 / .08 / .03` | `.78 / .035 / .12 / .10` |
| 72–79 Pipe | Sine | `.52 / .05 / .22` | `.92 / .025 / .16 / .03` |
| 80–87 Synth lead | Square | `.22 / .15 / .06` | `.82 / .008 / .08 / .08` |
| 88–95 Synth pad | Triangle | `.32 / .36 / .08` | `.86 / .18 / .18 / .04` |
| 96–103 Synth effects | Sawtooth | `.18 / .22 / .10` | `.52 / .10 / .18 / .35` |
| 104–111 Ethnic | Triangle | `.42 / .12 / .15` | `.25 / .012 / .16 / 1.5` |
| 112–119 Percussive | Triangle | `.50 / .05 / .18` | `0 / .003 / .09 / 8` |
| 120–127 Sound effects | Sine | `.48 / .10 / .08` | `.35 / .04 / .18 / .9` |
| Channel-10 percussion | Sine | `.55 / 0 / .20` | `0 / .002 / .08 / 10` |

Brickadia provides no sample bank, noise source, filter, or true drum engine.
GM Color supplies useful instrument families while Sine Studio preserves the
current sound. Raw Square and Sawtooth levels are lower because they are
perceptually louder than Sine.

## Size model

Counts from the current builder are exact:

- shared shell/control graph: 22 components and 21 wires;
- one one-layer voice: 70 components and 109 wires;
- each additional oscillator layer: 3 components and 5 wires;
- fixed 32 lanes with three layers: 2,454 components, 3,829 wires, and 96
  continuous emitters.

The shared decoder removes 12 components per lane, adds one FunctionCall per
lane, and adds a 14-component shared Function definition. Its projected base is
2,116 components and about 3,456 wires.

Runtime headers, two profile lookups, six selector gates per lane, staging and
active storage, protocol state, strict validation, and malformed-note handling
should put the production player near:

- 3,300–3,600 components;
- 5,000–5,800 wires;
- 96 continuous emitters;
- four AudioReference gates;
- four ArrayVars: staging, active, tone profiles, and envelope profiles.

These are design estimates until the generic builder performs its own saved
round-trip count. The per-voice descriptor selector itself is exact: three
comparisons and three selects, plus four one-time AudioReferences.

## Fallback matrix

| Observed result | Production response |
| --- | --- |
| Hardwired cross-chip CopyFrom passes; event reference transport fails | Ship a physical MIDI dock. Wire the disk ArrayVarRef directly to the dock/player CopyFrom gate; use wireless only for trigger and scalar metadata. |
| Cross-chip CopyFrom fails | Retain the current per-song builder and bake the score into the same chip. Do not stream thousands of indexed records through events. |
| Dynamic AudioDescriptor selection fails; individual assets work | Keep the generic wireless player in Sine Studio and bake descriptors into song-specific GM players. A full four-wave, three-layer bank would require 384 emitters and roughly 864 additional emitter/pitch/volume components. |
| Triangle, Square, or Sawtooth asset fails | Force that profile to a working waveform. If all non-Sine assets fail, force every profile to Sine and retain family color through gains, harmonics, and envelopes. |
| Shared DecodeNote wired input or 32-caller stress fails | Restore per-lane SplitQuaternion/pitch/velocity math. Wireless loading and GM profiles do not depend on the Function optimization. |
| Staging-to-active local copy fails | Use one active array, stop before copy, validate in place, and report that a failed load can discard the prior song. |

## Implementation sequence

1. Keep `build-single-quat-midi-player.cjs`, its tests, and the committed Viva
   prefab unchanged as the regression oracle.
2. Obtain returned live results for both V1 probes and record their observations
   beside the existing DecodeNote observation.
3. Add a disk builder and a new generic player builder with transactional
   wireless copy, fixed 32 lanes, and Sine Studio only.
4. Integrate the shared DecodeNote Function and stress wired inputs with 32
   simultaneous calls.
5. Add the two profile arrays and dynamic waveform selection.
6. Add strict staging validation, lazy record skipping, nonce-keyed watchdogs,
   acknowledgments, and status outputs.
7. Verify exact array copies, unique input drivers, all emitters inside the
   chip, descriptor resolution, zero one-shot emitters, legal pitch ranges,
   strict placement, malformed disks, two players and two disks, disk removal
   after copy, speed/pitch controls, and both render modes in game.

Only after those checks pass should shared helpers be extracted from the legacy
and generic builders.

# SQM1 wireless load-and-play integration V1

This is the smallest live test that joins the already proven pieces into one
real music path. It uses two independently pasted prefabs:

- `sqm1-two-voice-test-cartridge-v1.brz`, which owns one immutable score
  ArrayVar and the disk-side request/offer/ack logic;
- `sqm1-wireless-sine-player-integration-v1.brz`, which requests a disk,
  copies into staging, validates, copies into active storage, decodes notes
  through the shared Function and plays them with two continuous Sine voices.

The test deliberately stops at two voices and one Sine emitter per voice. Its
purpose is to prove the complete data and execution path before the same loader
is attached to the fixed 32-voice production engine. It does not replace the
known-good Viva La Vida player.

## Questions answered

One returned player save and an audible report establish all of these:

1. Can an independently pasted player request and accept an independently
   pasted cartridge with the production `SQM1` handshake?
2. Can the offered remote ArrayVar be copied into staging and then copied into
   a separate active ArrayVar after validation?
3. Does `ActiveScore ArrayGet.Value -> FunctionCall.Input0` work for repeated,
   live note records rather than saved Function input overrides?
4. Can two independent callers share one pure `DecodeNote` definition while
   scheduling overlapping notes?
5. Does the active copy keep playing and replaying after the entire cartridge
   prefab is deleted?

The earlier wireless probe already proves raw event reference transport. V1
tests the transaction around it and the first audible consumer of the copied
array.

## Test score

The cartridge contains one 46-Quaternion format-1 score. It lasts eight
seconds, uses two non-overlapping lanes and stays within the proven Sine pitch
range.

| Record | Value | Meaning |
| --- | --- | --- |
| `q0` | `(7701001, 1, 2, 8)` | score magic, version, two voices, duration |
| `q1` | `(34, 0.15, 48, 72)` | header length, release tail, pitch bounds |
| `q2` | `(34, 8, 0, 0)` | eight-note piano melody |
| `q3` | `(42, 4, 40, 16)` | four-note string counter-line |
| `q4..q33` | `(46, 0, -1, -1)` | unused voice headers |

Melody records `q34..q41` are:

| Start | End | MIDI | Velocity |
| ---: | ---: | ---: | ---: |
| 0.00 | 0.75 | 60 | 104 |
| 1.00 | 1.75 | 64 | 100 |
| 2.00 | 2.75 | 67 | 104 |
| 3.00 | 3.75 | 72 | 110 |
| 4.00 | 4.75 | 67 | 100 |
| 5.00 | 5.75 | 64 | 98 |
| 6.00 | 6.75 | 60 | 104 |
| 7.00 | 7.75 | 67 | 100 |

Counter-line records `q42..q45` are:

| Start | End | MIDI | Velocity |
| ---: | ---: | ---: | ---: |
| 0.00 | 1.75 | 48 | 82 |
| 2.00 | 3.75 | 55 | 84 |
| 4.00 | 5.75 | 53 | 82 |
| 6.00 | 7.75 | 55 | 86 |

The line changes once per second over four sustained bass notes, making two
active voices and a complete replay easy to hear.

## Exact protocol

All events are global broadcasts with sender `Target` unwired and receiver
`bIsObjectEvent=false`. The transport magic is `7702001`, the channel is `1`
and the score format is `1`.

### `SQM1.Request`

| Slot | Probe value |
| --- | --- |
| Data1 | transport magic `7702001` |
| Data2 | channel `1` |
| Data3 | integer nonce generated and retained by the player |
| Data4 | requested render mode `0` (Sine Studio) |
| Data5 | supported voice count `2` |
| Data6 | maximum accepted length `256` |
| Data7 | score format `1` |
| Data8 | capabilities `3` (cache copy plus Sine Studio) |

### `SQM1.Offer`

| Slot | Probe value |
| --- | --- |
| Data1 | transport magic `7702001` |
| Data2 | channel `1` |
| Data3 | cartridge score `ArrayVarRef` |
| Data4 | exact echoed nonce |
| Data5 | length `46` |
| Data6 | title `SQM1 two-voice load/play test` |
| Data7 | preferred mode `0` |
| Data8 | score format `1` |

### `SQM1.Ack`

| Slot | Probe value |
| --- | --- |
| Data1 | transport magic `7702001` |
| Data2 | channel `1` |
| Data3 | exact request nonce |
| Data4 | result `1` for success |
| Data5 | copied length `46` |
| Data6 | accepted title/status |
| Data7 | resolved mode `0` |
| Data8 | reserved `0` |

The disk accepts only a matching request and retains its nonce. The player
accepts only an offer matching its current magic, channel, nonce, format,
length cap, waiting state and idle copy state. It clears `waiting` before the
copy so a second disk cannot replace the in-flight transaction.

## Player transaction

The player owns empty `StagingScore` and `ActiveScore` Quat arrays.

1. The blue **LOAD / LISTEN** button increments the request count and retained
   nonce, sets `waiting=true`, and sends `SQM1.Request`.
2. An accepted offer wires `Offer.DataOut3` directly into
   `CopyFrom.SourceRef`; no Var, Function, queue or tick carries the remote
   reference. `StagingScore.ArrayVarRef` is the destination.
3. After copy completion, the player obtains staging length and validates q0,
   q1, q2, q3 and terminal header q33, proving the two segments are contiguous
   and end at the declared array length. The returned-save reader additionally
   compares the full staging array value-for-value with the known score.
4. Only a valid staging result executes a second, local
   `CopyFrom(StagingScore -> ActiveScore)`.
5. The player checks active length and the same headers, retains the accepted
   title and offered mode diagnostics, sets `loaded=true`, and sends the
   success `SQM1.Ack`. Both lane cursors reset when Play is pressed.
6. A failed staging check leaves the previous active score intact. A failed
   staging or active check records a negative result locally and sends no
   success acknowledgment. The production player adds explicit negative
   acknowledgments and transactional rollback after this valid integration
   path passes.

The disk can be deleted as soon as it shows acknowledgment result `1`. Neither
playback nor replay reads the remote reference.

## Wired shared decoder

One pure `DecodeNote(Quat)` Function definition is shared by two FunctionCall
gates. Each voice uses this exact path:

```text
ActiveScore ArrayGet.Value   -> FunctionCall.Input0
ActiveScore ArrayGet.ExecOut -> FunctionCall.Exec
FunctionCall.Completed       -> per-voice capture/ready chain
```

The calls use the live-observed output mapping:

| Slot | Value |
| --- | --- |
| `Output3` | start seconds |
| `Output2` | true key-off seconds |
| `Output1` | pitch ratio |
| `Output0` | velocity curve |

Each voice keeps independent cursor, decoded values, active state, Dampen and
continuous Sine emitter. The save retains Function completion and abort counts,
note-on counts, final cursor, and last decoded outputs for both lanes. Because
V1 tests one known-valid cartridge, a call abort, invalid record or
out-of-bounds result records the fault and marks only that lane finished. The
other lane continues, making a decoder failure visible without risking a
stalled test. Production adds bounded malformed-record skipping after this
valid path passes.

## Retained evidence

Hidden markers and visible readouts retain enough state to diagnose a returned
save without relying on a screenshot.

The cartridge retains:

- requests received/accepted/rejected;
- current request nonce and ready state;
- offers sent;
- acknowledgments received, matching acknowledgments and last result;
- its original complete score array.

The player retains:

- load requests, nonce, waiting and copy-busy state;
- offers received/accepted/rejected;
- staging-copy and active-copy completion counts;
- staging/active lengths and complete arrays;
- header and segment checks plus overall validation result;
- acknowledgments sent and result;
- loaded title, offered-mode diagnostics and loaded state;
- play starts, stops and completed playthroughs;
- for each voice: Function completions/aborts, notes armed, notes released,
  final cursor and last four decoded values.

The reader must identify arrays and Vars by unique hidden marker labels, accept
counters greater than the minimum, compare every active-array Quaternion, and
report protocol, transaction, decoder, scheduler and graph verdicts separately.

## In-game procedure

1. Paste one fresh **player** prefab. Record any blocked brick, invalid
   component or unconnectable wire warning.
2. Paste one fresh **cartridge** prefab several studs away. It must be a
   separate paste; do not weld, rewire or open either chip.
3. Press the player's blue **LOAD / LISTEN** button once.
4. Wait about one second. The cartridge should show one accepted request and a
   ready state.
5. Press the cartridge's green **Send SQM1 test song** button once, before the
   player's V1 ten-second request window closes.
6. Wait three seconds. The player should show `Loaded true`, staging and active
   lengths `46`, validation true and one acknowledgment sent. The cartridge
   should show acknowledgment result `1`.
7. Delete the **entire cartridge prefab**. Leave the player untouched.
8. Press the player's purple **PLAY LOCAL COPY** button once. Listen through
   the complete eight-second two-voice phrase.
9. Wait until the player reports one completed playthrough, then press
   **PLAY LOCAL COPY** again and listen through a second complete phrase.
10. Export only the complete player prefab, including its chip, buttons and
    status panels. Return that `.brz` and report whether both voices were
    audible for both playthroughs. A screenshot is optional.

If the cartridge cannot show its acknowledgment before deletion, export both
assemblies first for diagnosis and do not interpret the audio result yet.

## Returned V1 timeout observation

The first returned player save retained all 511 bricks, 609 components, 751
wires and both linked grids with a strict placement result. It sent one request
and received one offer whose magic, channel, nonce, length, title, mode and
format all matched exactly. The player nevertheless recorded one rejection,
zero copies and zero playback starts because `request.waiting` was already
false when the offer arrived. `copy.busy` was false, so the ten-second request
timeout was the only failed acceptance term.

The two Sine emitters and all audio-control wires were intact. No audio path ran
because `Loaded` remained false, so silence in this return does not establish an
emitter or decoder failure. The unexecuted FunctionCall inputs saved as scalar
placeholders while the Function definition retained its Quaternion input type;
the wired Quaternion decoder path therefore also remains untested.

[sqm1-wireless-sine-player-integration-v1-timeout-observed.json](gate-reference/sqm1-wireless-sine-player-integration-v1-timeout-observed.json)
records the source and returned hashes and the retained counters without storing
the user's complete returned save.

## Pass criteria

Offline construction must first show:

- two independently loadable, strictly placed prefabs;
- zero invalid bricks, confirmed overlaps, uncertain overlaps or warnings;
- exact event names, slot types, direct reference topology and unique input
  drivers;
- one staging array, one active array, two FunctionCalls sharing one Function
  definition and two continuous Sine emitters;
- no one-shot emitters and no reference stored in a Var;
- deterministic saved bytes and exact reader fixtures.

The returned player passes the live transaction when:

- one matching request and offer were accepted with no rejection;
- staging and active copies each completed and contain all 46 exact records;
- every required header/segment check and the overall validation Bool are true;
- acknowledgment result is `1` for the retained nonce;
- both FunctionCalls completed once per owned record and never aborted;
- melody notes armed at least eight times and counter-line notes at least four;
- both cursors reached the end of their validated segments;
- at least two play starts and two completions were retained after the disk was
  removed;
- the user heard both voices through both complete playthroughs.

A passing save authorizes the generic player's wireless loader, staging/active
transaction and wired shared decoder. The following production test can then
scale the same graph to 32 lanes and add the optional GM Color profiles without
changing the cartridge transport.

## Scope deliberately deferred

V1 does not need 32 lanes, malformed-cartridge matrices, competing disks,
timeout races, descriptor switching, three-layer piano synthesis or the full
Viva La Vida score. Those are production-scale tests after this decisive
two-voice path works. The disk format and all three event layouts remain the
production layouts, so no protocol redesign is required after a pass.

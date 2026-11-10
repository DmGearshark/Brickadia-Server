# MIDI wireless cartridge copy probe V1

`prefabs/midi-wireless-cartridge-copy-probe-v1.brz` is a two-path live-engine
probe for the proposed MIDI cartridge architecture. It contains a green disk
microchip, a blue player microchip, one green wireless-send button, one orange
direct-copy control and two independent player-owned Quat arrays.

The probe answers two separate questions:

1. Can `Exec_ArrayVar_CopyFrom` copy a Quat ArrayVar through a hardwired
   cross-chip `ArrayVarRef` connection?
2. Can a broadcast global custom event transport that same `ArrayVarRef` as a
   `WireValue`, so the receiver can synchronously `CopyFrom` it into local
   storage?

The orange path is the control for the first question. The green path tests the
second. Keeping both in one returned save makes a failure decisive: a passing
orange path with a failing green path isolates global-event reference transport
from ArrayVar copy support.

## Cartridge and event contract

The disk contains one valid 36-Quaternion array in the existing single-array
MIDI format:

- `q0`: `(7701001, 1, 1, 2)` — magic, version, one active voice, duration
- `q1`: `(34, 0.125, 60, 64)` — header size, release tail, pitch range
- `q2`: `(34, 2, 0, 0)` — voice-zero offset, note count, program, channel/track
- `q3..q33`: unused voice headers
- `q34`: `(0, 0.75, 60, 100)`
- `q35`: `(0.875, 1.5, 64, 80)`

The wireless event is `MIDI.Cartridge.Offer.V1` and uses this fixed mapping:

| Slot | Value |
| --- | --- |
| `DataOut1` | numeric protocol magic `7701001` |
| `DataOut2` | numeric player channel `1` |
| `DataOut3` | disk `ArrayVarRef` |
| `DataOut4` | cartridge title |
| `DataOut5` | declared array length `36` |

The sender leaves `Target` null, and the receiver has `bIsObjectEvent=false`,
so this is a broadcast. The player snapshots the scalar envelope, checks magic,
channel and declared length, and wires `Event_CustomGlobal.DataOut3` directly to
`Exec_ArrayVar_CopyFrom.SourceRef`. It does not store the remote component
reference in a Var or carry it through a tick buffer. Only the completed local
copy crosses a tick boundary.

The direct control wires `disk ArrayVarRef` straight to a separate player
`CopyFrom.SourceRef`. It also avoids a reference Var. Each path retains its
copy count, array length, selected Quaternion values, bounds flags, individual
checks, overall result and complete local cache for analysis after re-export.

## In-game procedure

1. Paste one fresh copy of the complete prefab.
2. Check the placement report. Preserve and report any blocked brick, invalid
   component or unconnectable wire instead of interpreting the test.
3. Press the orange **DIRECT COPY control** button exactly once.
4. Wait at least three seconds. Its readout should show `Copies 1`,
   `Length 36/36`, and `Passed true`.
5. Press the green **Transmit MIDI cartridge** button exactly once.
6. Wait at least three seconds. The wireless readout should show
   `Received 1`, `Accepted 1`, `Rejected 0`, `Copies 1`, `Length 36/36`, and
   `Passed true`.
7. Copy/export the **whole assembly**, including both colored microchips, both
   buttons and all three panels.
8. Return the exported `.brz` together with the exact placement warning text,
   if any. A screenshot is useful but does not replace the returned save.

Do not open, rewire, move apart or delete either chip before exporting. Pressing
a button more than once is harmless—the reader accepts counters greater than
one—but the single-press sequence is easier to diagnose.

Analyze a returned save with:

```sh
node tools/prefabs/read-midi-wireless-cartridge-copy-probe-v1.cjs returned.brz
```

The reader reports separate `direct` and `wireless` verdicts, the complete
retained envelope, selected records, exact cache comparison and a combined
interpretation.

## Offline verification

Rebuild and run serialization/placement checks with:

```sh
node tools/prefabs/build-midi-wireless-cartridge-copy-probe-v1.cjs \
  prefabs/midi-wireless-cartridge-copy-probe-v1.brz
node tools/prefabs/validate-placement.cjs \
  prefabs/midi-wireless-cartridge-copy-probe-v1.brz --strict
```

V1 serializes as 218 bricks, 261 components, 309 wires and two linked logic
grids. The builder itself owns 216 component-bearing nodes: five in the disk
logic grid, 206 in the player grid and five physical controls/panels. Strict
placement validation requires empty invalid, confirmed-overlap,
uncertain-overlap and warning lists. Offline checks prove the exact ports,
event mapping, two button paths, direct reference topology, empty initial
caches, retained diagnostics and wire endpoint survival. Live Brickadia is
required to prove component-reference transport through the global event; the
returned result below establishes that final boundary.

## Returned V1 result

The user returned a clean in-game save after running both controls once. It
retained all 218 bricks, 261 components, 309 wires and both linked grids, with
strict placement and no warnings.

The orange hardwired control completed one cross-chip copy. Its player-owned
cache contained all 36 Quaternions exactly, reported length 36, matched every
sampled record and set its engine result to true.

The green wireless path sent and received one event, accepted it once, rejected
zero events and completed one copy. The retained envelope contained magic
`7701001`, channel `1`, the exact title and declared length `36`. Its independent
player-owned cache also contained the exact complete score, and every sampled
header and note record matched with no out-of-bounds result.

This proves that the tested Brickadia runtime can carry an `ArrayVarRef` through
a broadcast global custom event and use it synchronously as
`Exec_ArrayVar_CopyFrom.SourceRef`. The reference required no Var, Function or
tick buffer. Production can therefore copy a wireless cartridge into local
staging storage instead of streaming individual note records.

Exact hashes, counters and retained values are recorded in
[midi-wireless-cartridge-copy-observed.json](gate-reference/midi-wireless-cartridge-copy-observed.json).

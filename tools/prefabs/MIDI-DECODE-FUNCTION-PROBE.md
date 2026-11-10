# MIDI DecodeNote Function probe V2

`midi-decode-function-probe-v2.brz` replaces the initial placement-broken
artifact. It passes strict placement validation with no invalid bricks,
confirmed overlaps or uncertain overlaps.

The probe tests the exact pure helper proposed for the
generic MIDI player. Two same-tick FunctionCall gates share one definition.
Each receives a packed note Quaternion and returns start time, end time, pitch
ratio and velocity curve. This also checks that concurrent voices retain
independent return values.

Call A uses `(3.125, 7.875, 81, 127)` and should return:

- start: `3.125`
- end: `7.875`
- pitch: `2`
- velocity: `1`

Call B uses `(13.25, 16.625, 57, 64)` and should return:

- start: `13.25`
- end: `16.625`
- pitch: `0.5`
- velocity: `0.3831128811637326`

The panel retains all four raw FunctionCall output slots both immediately and
after one tick, plus run/completion counts, iterations and aborted state in
ordinary Vars. This reveals the actual output-slot permutation, same-tick
sharing behavior and result retention without trusting the display or assuming
that `PortOrder` maps directly to `Output0..3`.

## In-game procedure

1. Paste one fresh copy of the complete prefab.
2. Press the blue **Run DecodeNote probe once** button exactly once.
3. Wait three seconds.
4. Copy/export the **whole assembly**, including both microchips and the panel.
5. Send the exported `.brz` back. A screenshot is optional.

Do not open, rewire or separate either chip. If Brickadia reports any missing
component or unconnectable wire while pasting, preserve the copy and report the
exact warning before interpreting the values.

Analyze the returned save with:

```sh
node tools/prefabs/read-midi-decode-function-probe.cjs returned-probe.brz
```

Rebuild and run offline serialization checks with:

```sh
cd tools/prefabs
node build-midi-decode-function-probe.cjs ../../prefabs/midi-decode-function-probe-v2.brz
```

Offline checks validate the serialized Quaternion, ports, wire endpoints,
result labels and callable-local references. Only an in-game run can establish
execution and the actual Function output ordering.

## Returned V2 result

The user returned a clean in-game save after pressing the button once and
waiting more than three seconds. It retained all 83 bricks, 115 components,
102 wires and both linked grids. Both Function Calls completed once in the same
tick, reported one iteration, did not abort and retained independent results
both immediately and after one tick.

The observed mapping for this exact definition is:

| Meaning | Function Call slot |
| --- | --- |
| start | `Output3` |
| end | `Output2` |
| pitch ratio | `Output1` |
| velocity curve | `Output0` |

The engine therefore orders these four outputs in the reverse of their
declared `PortOrder`. Production code must use the observed slots explicitly.
[midi-decode-function-observed.json](gate-reference/midi-decode-function-observed.json)
records the source/return hashes and exact retained values without committing
the user's complete returned save.

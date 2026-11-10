# MIDI waveform audition probe V1

`prefabs/midi-waveform-audition-probe-v1.brz` tests the exact descriptor
selection boundary needed for a multi-instrument MIDI player:

```text
AudioReference.Value x4
        |
        v
three generic Expr_Select gates
        |
        v
one continuous AudioEmitter.AudioDescriptor
```

The four referenced `BrickAudioDescriptor` assets are:

1. `BA_Synth_Basic_Sine`
2. `BA_Synth_Basic_Triangle`
3. `BA_Synth_Basic_Square`
4. `BA_Synth_Basic_Sawtooth`

Four colored **DYNAMIC** hold buttons select these descriptors directly. Each
button has a visible `bHeld` wire into its selection edge and a second visible
wire into the shared emitter-enable OR tree. The last selected index, dynamic
button-press count and changes observed at the final object-valued selector are
saved in ordinary Vars and shown on the status display.

There is also a white **DIRECT STATIC SINE** hold button and a second continuous
emitter whose saved `AudioDescriptor` is Sine directly. It bypasses every
`AudioReference` and `Expr_Select`. This diagnostic separates a bad/missing
audio asset or emitter problem from failure of generic object selection.

Both emitters default off and use the same conservative settings:

- volume multiplier: `0.02`
- pitch multiplier: `1.0`
- spatialization: enabled
- inner radius: `100`
- maximum distance: `800`

## Exact in-game procedure

Paste one fresh, complete V1 prefab and confirm Brickadia does not report any
blocked brick, invalid component or unconnectable wire. Stand close to it and
use only one hold button at a time.

1. Hold **DIRECT STATIC SINE** for about one second, listen, then release it
   fully. This control does not change the three status counters.
2. Hold the blue **DYNAMIC SINE** button for about one second, listen, then
   release. It should match the direct Sine. The status should show selection
   `Sine`, index `0`, and one dynamic audition press. Descriptor changes may
   remain zero because Sine is the initial selection.
3. Hold and release **DYNAMIC TRIANGLE**. It should sound distinct; selected
   index becomes `1` and descriptor changes becomes at least `1`.
4. Hold and release **DYNAMIC SQUARE**. Selected index becomes `2` and changes
   becomes at least `2`.
5. Hold and release **DYNAMIC SAWTOOTH**. Selected index becomes `3` and changes
   becomes at least `3`.
6. Hold and release **DYNAMIC SINE** once more. It should again match the direct
   path; selected index returns to `0`, dynamic presses becomes `5`, and
   descriptor changes becomes at least `4`.
7. Copy/export the **whole assembly**, including every gate, wire, display,
   button and both speakers, and return the exported `.brz`. Also report which
   of the five controls made sound and whether the two Sine controls matched.

The object-change counter can be one higher if a game version reports an
initial seed transition. The reader deliberately accepts `>= 4` after the
sequence.

Interpret silence as follows:

- Direct Sine is silent: the test has not established that the asset name and
  continuous-emitter path work in that game build.
- Direct Sine works, but all dynamic controls are silent: the failure is at or
  after `AudioReference.Value -> Expr_Select -> AudioEmitter.AudioDescriptor`.
- Dynamic Sine works, but one other dynamic control is silent: inspect that
  individual descriptor/reference rather than rejecting the shared selector.
- All controls work and the two Sines match: the dynamic descriptor topology is
  suitable for the MIDI player.

Analyze a returned save with:

```sh
cd tools/prefabs
node read-midi-waveform-audition-probe-v1.cjs /path/to/returned.brz
```

Rebuild the versioned artifact and run all offline checks with:

```sh
cd tools/prefabs
node build-midi-waveform-audition-probe-v1.cjs \
  ../../prefabs/midi-waveform-audition-probe-v1.brz
```

The builder calls `test-midi-waveform-audition-probe-v1.cjs` before writing the
artifact. The test asserts empty invalid-brick, confirmed-overlap,
uncertain-overlap and warning lists, plus `strictOk === true`. It also walks the
serialized selector tree from the dynamic emitter back to all four exact asset
names, checks every button wire, verifies the separate direct path, rejects
duplicate input wires, and checks the safe audio settings.

## Remaining schema boundary

`brs-js` round-trips all four `AudioReference.Asset` indices, all three generic
object selectors and the wired emitter. In the generated artifact, the dynamic
emitter's saved local `AudioDescriptor` is `null`; its sole descriptor wire
supplies the runtime object. A live Brickadia re-export may snapshot the
currently resolved descriptor into that local field and reorder external asset
indices while retaining the wire. The returned-save reader therefore
identifies the dynamic and direct emitters by their descriptor-wire topology
rather than by the local fallback field.

Offline tooling has no Brickadia audio simulator or runtime pin-type metadata.
It therefore cannot prove that the game accepts generic `WireValue` object
selection or that every synth descriptor name resolves to audible content.
The direct-versus-dynamic in-game sequence is the proof for that final boundary.

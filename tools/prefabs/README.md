# Prefab generator

## Single-array MIDI system

[SINGLE-ARRAY-MIDI.md](SINGLE-ARRAY-MIDI.md) documents the proven all-sine
player, its one-Quat-array score format, converter and retained General MIDI
program data. [MIDI-DECODE-FUNCTION-PROBE.md](MIDI-DECODE-FUNCTION-PROBE.md)
records the live-tested shared note decoder.

The next generic player is specified in
[GENERIC-WIRELESS-GM-MIDI-ARCHITECTURE.md](GENERIC-WIRELESS-GM-MIDI-ARCHITECTURE.md).
Its two live-engine prerequisites are independent, versioned prefabs:

- [MIDI-WIRELESS-CARTRIDGE-COPY-PROBE-V1.md](MIDI-WIRELESS-CARTRIDGE-COPY-PROBE-V1.md)
  tests direct cross-chip array copying and wireless `ArrayVarRef` transport;
- [MIDI-WAVEFORM-AUDITION-PROBE-V1.md](MIDI-WAVEFORM-AUDITION-PROBE-V1.md)
  tests four continuous synth descriptors through one runtime selector, with a
  direct Sine baseline.

Both builders run exact save round-trip checks and strict zero-warning
placement validation before writing their `.brz` artifacts.

[SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V1.md](SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V1.md)
joins the passed wireless transport to a two-voice Sine player. Its cartridge
and player are separate prefabs; the live procedure loads the song, deletes
the cartridge, and plays the retained local copy twice through two callers
sharing the verified `DecodeNote` Function.

[SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V2.md](SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V2.md)
removes V1's ten-second request timeout after the returned save proved that a
matching offer arrived only after the window closed. The matching request now
stays open until a valid cartridge offer is accepted; the transport, local
copy, shared decoder and two continuous Sine voices remain unchanged.

[SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V3.md](SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V3.md)
adds one-tick publication barriers before the staging-header, active-length and
active-header validation branches. The returned V2 save contained the exact
46-record staging score and exact retained headers but false-failed validation
in the final setter's tick. V3 also publishes each ActiveScore read before its
wired Function call and each decoder acceptance condition before branching.
It preserves V2's transport and audio graph while making every remaining
load-to-sound publication boundary explicit.

[SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V4.md](SQM1-WIRELESS-LOAD-PLAY-INTEGRATION-V4.md)
adds standing-world defaults for the optional numeric inputs after the returned
V3 save proved that unwired `MicrochipInput` outputs are zero despite their
callable defaults. Positive pitch, speed and volume values override internal
defaults `1`, `1` and `0.08`; zero or unwired ports select those defaults. V3's
wireless, validation, decoder, replay and Sine topology remains unchanged. The
user subsequently confirmed audible playback from the retained local song
after deleting the complete cartridge entity; detailed per-voice and two-replay
counters still need a successful returned V4 save.

## Isaac Newton book collection

[NEWTON-COLLECTION.md](NEWTON-COLLECTION.md) documents the complete preserved
four-display pipeline and six independent Newton book prefabs. The collection
tracks the exact public-domain sources, generated arrays, output hashes, and
regression checks. The original live-tested Opticks checkpoint remains locked
at the `newton-opticks-v25-live-calibrated` Git tag.

The later [Opticks v27 live-geometry candidate](NEWTON-OPTICKS-V27.md)
corrects the measured Braille-cell aspect and gives tightly packed figures a
safe page boundary while retaining v25 unchanged.

[Opticks large two-page v1](NEWTON-OPTICKS-TWO-PAGE-V1.md) repaginates that
exact v27 content into 219 compact pages for the supplied open-book shell. One
page turn advances a synchronized two-page spread; the tracked shell, builder,
output, hashes, and live-calibration procedure make the format reproducible.

## User's labeled display

To generate the selector inside the supplied nine-brick layout:

```sh
npm ci
node wire-reference.cjs references/display-reference.brz ../../prefabs/display-reference-wired.brz
```

This version uses the existing Scroll Up, Scroll Down, and Select buttons,
replaces Name 1–5 with the five live names, and feeds the selected-name display
from the latched string variable. It preserves the original nine bricks and
their appearance, external sound/font assets, component settings (except
placeholder text), and prefab paste metadata. Thirty logic bricks are placed
behind the display. The original thumbnail still shows the reference labels.

The reference version stores the current index in a numeric variable. Rising
edges of each scroll button's held signal execute a -1 or +1 increment, so
releasing a button retains the index. It does not use transient PressCount.

Validation rereads all geometry and original component data, checks all 41
wires and 45 components, models press/hold/release against the generated scroll
wiring, and runs the same 10,125 expression checks. The in-game
acceptance checks below still apply; runtime behavior remains unverified.

Requires Node.js 22.15 or newer. From this directory:

```sh
npm ci
node scroll-selector.cjs ../../prefabs/scrolling-name-selector.brz
```

The generator creates an upright, static panel facing negative Y. The top and
bottom buttons scroll through 20 sample names. The highlighted middle row is
the current candidate. Select copies its text into a string variable that
feeds the display on the right. The initial middle name is Casey; the selected
display starts at `(none)`. State is shared by players using the panel.

Up/down press counts feed subtraction, then each row applies an offset and
floored modulo 20. Names are stored as fixed-width, eight-character strings;
substring and trim gates retrieve each row. Select uses a rising-edge execution
gate and a variable setter. Logic bricks are accessible behind the panel.

The generator checks port directions, serializes and rereads the archive,
checks component/wire counts, and evaluates its expression graph against
10,125 expected row results. These checks do not emulate Brickadia's runtime.

## In-game acceptance check (pending)

1. Import and paste `prefabs/scrolling-name-selector.brz`.
2. Approach the front: initially Avery, Blake, Casey, Dakota, Emery should show.
3. Click Down once: the middle row should become Dakota.
4. Click Up once: the middle row should return to Casey.
5. Click Select: the right display should show Casey.
6. Scroll further: the right display should stay Casey until Select is clicked.
7. Scroll through both ends: Taylor and Avery should wrap correctly.
8. Hold a scroll button: verify whether PressCount increments once per press.

Text face, font sizing, native press-count behavior, string wire conversion,
and the execution edge still require confirmation in the game. Report the
first step that differs, ideally with a screenshot of the panel and wiring.

## Central load-board system

[LOADBOARD.md](LOADBOARD.md) documents `prefabs/loadboard-system.brz`, built from the supplied v5 layout. It includes the authoritative load server, event-driven `/loadboard` client, zone-bound pickup station, delivery station, editable catalogue and embedded cargo prefabs. Rebuild with `build-loadboard.cjs`; generation runs the graph, serialization and event-integration checks.

## Gate reference and native experiments

[GATE-STUDY.md](GATE-STUDY.md) reviews all 396 gate/component definitions exposed by the pinned library. [gate-reference/GATES.md](gate-reference/GATES.md) lists every definition's ports and saved fields; `gates.json` also retains known defaults and enum values. Refresh with `node catalogue-gates.cjs`.

[GATE-PROBE.md](GATE-PROBE.md) documents the independent GP1 native timing/function/loop experiments. Build with `node build-gate-probe.cjs ../../prefabs/gate-laboratory-gp1.brz`; inspect a returned save with `node read-gate-probe.cjs returned.brz`. This is a separate test assembly and does not replace the working loadboard.

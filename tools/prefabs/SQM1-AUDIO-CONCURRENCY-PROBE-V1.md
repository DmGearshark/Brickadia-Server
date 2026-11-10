# SQM1 audio concurrency probe V1

`prefabs/sqm1-audio-concurrency-probe-v1.brz` separates Brickadia audio-engine
limits from the SQM1 MIDI scheduler and Piano envelope. It contains one pool of
54 continuous non-spatial Sine `AudioEmitter`s and ten visible mode buttons.
There are no MIDI records, arrays, Functions, Dampens, note lanes, or playback
scheduler in this prefab.

Paste the probe by itself in a quiet map, keep the game volume and listening
position unchanged, and use one mode at a time. Press **STOP / RESET** between
comparisons.

1. Step through **STATIC LOW** at 18, 30, 33, 36, 48, and 54 sources. Listen
   for the first count that produces abrupt missing tones, cycling voices,
   pumping, breakup, or a chord that will not remain stable.
2. Compare **REALISTIC SUSTAIN | 54** with **REALISTIC 25% | 54**. These use
   the selected hard-strike Piano's steady body/partial proportions at full and
   quarter internal gain.
3. Run **PULSED LOW | 54 SOURCES** for several seconds. It directly toggles the
   same 54 emitters for 60 ms on and 60 ms off without any song logic.

The status panel reports the configured mode and source count. Brickadia has no
gate output for the number of voices the audio engine actually retained, so the
display is a command readout rather than engine feedback.

| Result | Meaning |
| --- | --- |
| Low static first breaks around 33 sources | Likely audio concurrency or voice stealing near a 32-source policy |
| Low static breaks at a higher repeatable count | Likely another engine source cap; report the first bad count |
| Low static 54 is clean, full realistic breaks, 25% is clean | Mix headroom, limiting, or amplitude buildup; the player needs polyphony-aware gain |
| Static 54 is clean, pulsed 54 breaks | AudioEmitter start/restart churn; the player should reduce `bEnabled` cycling |
| Every probe mode is clean | The cutoff is in player scheduling, envelope timing, or graph update load |

Report results in this compact form:

```text
STATIC: 18 __ / 30 __ / 33 __ / 36 __ / 48 __ / 54 __
REALISTIC: full __ / 25% __
PULSED 54: __
```

Build and validate:

```bash
node tools/prefabs/build-sqm1-audio-concurrency-probe-v1.cjs
node tools/prefabs/test-sqm1-audio-concurrency-probe-v1.cjs
node tools/prefabs/validate-placement.cjs prefabs/sqm1-audio-concurrency-probe-v1.brz
```

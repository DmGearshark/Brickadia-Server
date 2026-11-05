# Gate laboratory GP1

A separate manually operated research prefab, **not** a replacement loadboard. It does not spawn/destroy objects or modify player stats. Keep one copy loaded, because its queue experiment uses a shared global event name.

Paste `prefabs/gate-laboratory-gp1.brz`. Click each of the eight numbered buttons once, waiting **three seconds** between tests. The rising edge starts each test, so holding the button should not repeatedly start it. Then copy/export the **whole assembly**, including the six chips behind the panel, and return that `.brz`. Do not export only the screen bricks. Results accumulate and persist in the saved component data; no need to transcribe them.

| Test | What it records |
| --- | --- |
| 1. Function | Varying input A + 7, expected answer, body-call and Completed counters, returned value consumed directly at Completed and again one tick later, timer difference and abort state. First press expects 18, second 19, and so on. |
| 2. Count same tick | Five iterations with indices 0–4, expected sum 10 and five body executions; captures the total immediately at Completed and a tick later. bRunAcrossTicks is false. |
| 3. Count across ticks | The same five-iteration job with bRunAcrossTicks true, for comparison. |
| 4. Array loop | Iterates [1,2,3,4,5] using the native entry's Value; expected sum 15 and five body executions. |
| 5. Map loop | Iterates a:2, b:3, c:5; expected sum 10 and three body executions. It does not modify the map during iteration. |
| 6. Read / change | Writes a changing number to a scalar and a map. Records immediate reactive Var read, explicit Var Get result, delayed reactive read, immediate/delayed Map Get result, found state and container-change notifications. Different immediate results are measurements, not automatically test failures. |
| 7. Edge / change | Writes 0,1,1,0,1 with tick spacing, recording rising/falling/change events. Counters accumulate, so first-run seeding and repeat-run behavior can be distinguished. |
| 8. Queue snapshot | Sends payloads 10 and 20 back-to-back through a named event, then a five-tick queue. Each press should add two raw and two queued deliveries, and 30 to both sums. Also retains the queued payloads in an ArrayVar for inspection. |

Every recorded Var has an attached internal instruction marker `GP1:<result name>`. The decoder reads those labels even if grid/entity IDs change when re-exported. Native function/loop abort reason, iteration count, queue entries and the payload history array are also retained. The visible text is a convenience; the variable data is the primary record.

Timing uses the Stopwatch Time output sampled before work and on its completion path, before the deliberately delayed output read. The two samples are stored separately and their difference is calculated after a publication buffer; that reporting buffer is not included in the measured interval. A displayed 0 ms means no time advance at that timer's resolution; it does not prove zero engine work, and it is not a measurement of network/rendering latency. Sampling/publication order itself is part of this experiment.

Function and loop assembly is generated from the available schemas and port definitions. It has passed save/round-trip and wire-endpoint checks, **not an engine run**. If a test stays at Not run / -1, returns an abort, or a wire cannot connect, export it unchanged so the saved state can identify which path ran. Buttons are independent; one failed test does not need to block the other tests. If one test crashes the game, stop that test and report its number before running it again.

Build and inspect:

```sh
node tools/prefabs/build-gate-probe.cjs prefabs/gate-laboratory-gp1.brz
node tools/prefabs/read-gate-probe.cjs 'returned-test.brz'
```

The recorded experiments support choosing appropriate native gates and removing unnecessary waits. They do not establish that every expression/query is safe inside a Function, or that Functions can make prefab initialization instantaneous. Later tests can focus on any uncertain behavior this first batch reveals.

## Returned results and corrected test

The first returned test reported **nine unconnectable wires**, all variable-reference wires crossing into callable bodies. The affected body counters and loop sums are excluded from conclusions. Function arithmetic, ordinary scalar/map readback, edge/change counts and queue payload results remain useful. See [GATE-PROBE-RESULTS.md](GATE-PROBE-RESULTS.md). Use **GP2** for the follow-up test; it keeps callable references local and reports outward through Function Outputs/events.

GP2's returned save retained all wires and local variables, but rejected nine annotation components inside callable chips. The loops completed correctly. Its Function output slots were opposite the generator's display assumptions. **GP3** removes those annotations and corrects that display; only button 1 needs to be rerun for the focused follow-up. The decoder now also reads unannotated callable-local variables by scope/position. See the full results document above.

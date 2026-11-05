# GP1 returned results and GP2 correction

Source: user-exported **Results.brz**, 5 November 2026. Eight run counters were each 1. The user reported nine unconnectable wires on paste.

## Retained findings

| Measurement | Saved result | Interpretation |
| --- | --- | --- |
| Function arithmetic | Expected 18; immediate Completed read 18; delayed read 18; completed once; not aborted; native IterationsExecuted 1 | The generated definition/input/output interface worked for this arithmetic call, and its output was readable on Completed. |
| Function timer samples | Both 2.5415632016956806 seconds; reported difference 0 ms | No timer advance between the two samples, within its resolution. This does not prove zero execution cost. The Function's body counter was disconnected and is excluded. |
| Scalar reads | Expected/written 111; direct immediate, explicit immediate and delayed reads all 111 | These ordinary execution-chain reads needed no extra tick in this test. This does not establish timing for every query/spawner or every graph. |
| Map read and change | Immediate/delayed 111; found true; one container-change notification | Ordinary map readback and change notification worked in this sequence. |
| Edge/change detector | Two rising, one falling, three changes for 0,1,1,0,1 | The repeated value did not produce another change; behavior matched the test sequence. |
| Event/queue snapshot | Both raw and queued counts 2, sums 30; retained payload array [10,20] | The queue retained both back-to-back event payloads in this test. |

## Excluded measurements

All nine missing connections are external variable-reference wires feeding Increment gates inside callable chips: one Function body-counter reference and two references in each of four loop bodies. Entry/body execution wires remain, but their counter/accumulator actions cannot use the intended variables. Thus the zero body counters/sums do not demonstrate that functions or loops failed to execute. Native loop iteration counts were 5,5,5,3 with no abort, but useful body work and its timing need a corrected test.

No loadboard is changed based on these results yet. In particular, successful ordinary scalar/map reads do not validate removing all delayed publications from the existing model or all buffers from the production graph.

## GP2

`prefabs/gate-laboratory-gp2.brz` retains the eight-test layout and unaffected experiments. It removes every cross-chip variable-reference connection in the probe:

- The Function body counter lives inside its definition. A second Function Output returns that count to the ordinary reporting chip.
- Each loop has local sum/count variables with local references. Its body sends a `GP2.LoopN` event with the current item/index and local sum/count. The ordinary reporting chip updates its own counters using its own references.
- Both local variables and externally received totals are labeled/saved. This distinguishes native body execution, local variable mutation and outward event delivery. Immediate/delayed completion totals now also depend on event delivery order; the separately retained local measurements help interpret that difference.
- GP2 event names are separate from GP1. Keep only one GP2 copy loaded.

Replace/delete the GP1 test panel, paste GP2, click buttons 1–8 once each and wait three seconds between buttons. Export the entire assembly including chips. Report any unconnectable-wire warning before interpreting its measurements. Production loadboard can remain loaded.

Reproduce and inspect:

```sh
node tools/prefabs/build-gate-probe-v2.cjs prefabs/gate-laboratory-gp2.brz
node tools/prefabs/read-gate-probe.cjs 'returned-gp2.brz'
```

Offline checks verify all generated wire endpoints, six chip links, input-source modes, labeled saved results and absence of cross-chip VarRef links in GP2. They cannot substitute for the engine's wire validation or execution. GP1 and its original artifact remain available for comparison.

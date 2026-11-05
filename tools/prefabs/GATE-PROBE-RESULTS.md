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

## Returned GP2: nine annotations rejected, functional work retained

The user's next **results.brz** reported 312 bricks, 395 components, 415 wires and six entities. The generated file had 404 components and 415 wires. The component-type count difference is exactly **nine Component_Interact annotations**; these were attached to the one Function-local and eight loop-local variables. All nine Var components remain with the expected values, and the returned file retains all 415 wires. The annotation rejection does not invalidate the native loop/body results. Ordinary-chip labels and the annotations on the outer chip shells survived.

[gp2-observed.json](gate-reference/gp2-observed.json) stores the decoded numeric/typed observations and source hash without adding the user's entire uploaded prefab to the repository.

| Measurement | Returned native/variable data |
| --- | --- |
| Function body | Local counter 1; native IterationsExecuted 1; not aborted |
| Function actual slots | Output0 = 1 (body count), Output1 = 18 (sum) |
| Function input binding | Input0 = 11, Input1 = 7 on call; definition's A received 7 and B received 11 |
| Count loop, bRunAcrossTicks false | Local sum 10, local body count 5, native iterations 5; matching eventual outward totals |
| Count loop, bRunAcrossTicks true | Local sum 10, local body count 5, native iterations 5; matching eventual outward totals |
| Array loop | Local/event sum 15, five body calls, native iterations 5 |
| Map loop | Local/event sum 10, three body calls, native iterations 3 |
| Ordinary scalar/map reads | Expected and all immediate/delayed reads 111, map found true, one container change |
| Detectors and queue | Again: 2 rises / 1 fall / 3 changes; raw and queued counts 2, sums 30, history [10,20] |

The Function report had its two output labels effectively reversed because the generator assumed Sum was Output0 and Body count Output1. Both actual values are correct, but that assumption was wrong. Similarly, the definition input labels received the two inputs in the reverse of the assumed order; addition concealed that distinction. The observed layout demonstrates a mapping, not a general explanation of native port sorting. In particular, **do not assume PortOrder 1 means Function Call slot 0** for an arbitrary definition. Future definitions need verified pin mapping, especially noncommutative operations.

Immediate and +1-tick *external event totals* were 0 at loop Completed, while eventual event totals and local variables were correct. Thus Completed is not a promise that outward global-event side effects have already been processed. Local callable work, returned Function outputs and external event delivery are separate timing paths. All sampled loop intervals were 0 at the Stopwatch's resolution, including the small loop with bRunAcrossTicks true; that is not proof of zero execution cost or a guarantee about larger iteration counts.

## GP3 clean-up and limited follow-up

`prefabs/gate-laboratory-gp3.brz` omits Component_Interact annotations on variables inside callable chips. It keeps the outside chip labels, and the decoder recovers unannotated local variables by their chip scope and position. This preserves all 87 variable records without the nine components rejected in GP2.

The Function display now reads the observed Sum slot (Output1) and Body count slot (Output0) for this definition. The definition's arithmetic and pin layout are unchanged. No universal sorting rule is assumed. The other seven test graphs are unchanged apart from the GP3 event namespace and annotation cleanup.

For a follow-up, replace the old test panel with one GP3 copy, **click only button 1 once**, wait three seconds, and export the whole assembly. Expected visible Function result: 18, body calls 1, completed 1, aborted false. Report any paste warnings. The other seven GP2 measurements are retained; they do not need to be repeated for this cleanup.

```sh
node tools/prefabs/build-gate-probe-v3.cjs prefabs/gate-laboratory-gp3.brz
node tools/prefabs/read-gate-probe.cjs 'returned-gp3.brz'
```

Offline checks additionally reject Component_Interact inside callable chips and verify that the unannotated variables remain recoverable. GP3 still requires engine validation of its attachment/readout correction. Production loadboard remains unchanged.

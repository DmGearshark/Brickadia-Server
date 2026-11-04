# Wire-graph assertion: wallet comparison

The reported native error is:

```text
Assertion failed: !bWireGraphExecutionInProgress
Source/Brickadia/Wires/WireGraph.h:655
```

This establishes that an operation requiring an idle wire graph was reached while execution was in progress. The stripped shipping stack does not identify that operation. User testing places the failure at spawning an uninitialized full client, and also at spawning the minimal chip diagnostic. Queue Ticks, rotation, initialization and server requests are not required by that minimal payload.

Compared the embedded payload from the previously working `prefabs/wallet-command-name-demo-fixed.brz` with the chip baseline embedded in `prefabs/loadboard-client-isolation.brz`:

- Both have one `Entity_MicrochipDynamicBrickGrid`, persistent index 2.
- The entity records match: class, location (0,0,40), identity rotation, frozen/sleeping false, collapsed true, nonlegacy IO order and plane extent (14,14,2).
- Both use ordinary prefab mode: physics-grid, physics-freeze, global-freeze and microchip-prefab flags false.
- Both use GlacialIndifferencePlus as their external font descriptor.
- Wallet payload has an initializer, two variables, two setters and a formatter; baseline has one string variable and no wires. Remaining differences include geometry, bounds and component/wire inventories. No specific malformed chip flag was found.
- The original game-exported wallet wire-failure attachment contains the same embedded wallet payload hash as the saved working controller. This supports reusing the existing artifact unchanged rather than generating another candidate.

Next baseline: test that exact saved wallet artifact in the current game environment, with one wallet controller and the new load-board/test rigs absent. Invoke `/wallet` once. If it works, optionally restore one load-board server and invoke `/wallet` again. Stop on a crash and preserve the assertion. The comparison distinguishes current engine/world-state interaction from a failure confined to the new display payload; it does not itself fix either.

No production logic or prefab bytes were changed for this comparison. Further Buffer Ticks alone are not established as a solution: delayed pulses may still execute under the wire-graph execution scope.

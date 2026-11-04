# Separated chip placement test

The user confirmed the unchanged wallet spawns successfully both without and with the load-board server present. The server's presence alone therefore does not reproduce the failure. The current leading investigation returns to differences inside the spawned object; this does not establish a final engine-level cause.

A concrete placement difference: the portable screen's original chip center is (0,0,-14), near its lower casing at approximately (1,0,-12), whereas the wallet chip sits outside its simple body. Their bounds may overlap. The earlier withdrawn cargo probe also put its chip inside its solid cube. Overlap is a hypothesis to test, not a proven explanation of the `!bWireGraphExecutionInProgress` assertion.

`prefabs/loadboard-clear-chip-test.brz` embeds the **full original client logic**, with its physical chip relocated to (40,0,0), clear behind the screen. Bounding extents expand to contain it. Every other component's position/data, the chip's logic-grid entity record, and every wire endpoint remain identical.

## In-game test

Keep one existing load-board server present. Add one copy of this diagnostic.

1. Run `/lbclear` once. It spawns the separated-chip client above the diagnostic rig. Stop if it crashes.
2. Only if it spawns, run `/lbclearinit`. It initializes that client for the caller and requests listings from the server.

Do not invoke the old `/loadboard`, `/lbclient`, or `/lbchip` during this test. Report whether spawning succeeds and whether initialization displays the list; if a crash occurs, identify which of the two commands triggered it and preserve the assertion.

The client is deliberately not rotated automatically. The diagnostic spawner permits one client and expires it after 180 seconds; repeat using a fresh diagnostic copy with the old one removed to avoid duplicate command handlers. This is a candidate placement workaround, not a confirmed production fix.

## Validation

```sh
node tools/prefabs/build-loadboard-clear-chip-test.cjs 'Loadboard v5.brz' prefabs/loadboard-clear-chip-test.brz
```

Checks compare the original and relocated client's serialized component data, positions and all wire endpoints, allowing only the physical chip position and containing bounds to differ. A conservative bounding check confirms separation from the screen's geometry. The direct command rig does not use a map/queue dispatcher or rotation gate, and spawning cannot trigger initialization automatically.

The default production builder still generates bytes identical to the existing artifact; its configuration/logic has not been changed to an unconfirmed workaround. The normal graph/model regression checks pass. No actual engine collision or graph mutation behavior is emulated by these checks.

## Reported result and follow-up

User reports neither spawn nor initialization crashed and confirms the text appeared on the newly spawned diagnostic object. Their subsequent screenshot establishes that it is the load-board client receiving data, but packed catalogue/list/detail strings were not decoded. This led to the separate Occurrence 0 versus 1 parsing fix documented in LOADBOARD.md. Both placement and parsing changes are now included in the full system; normal-command and corrected-rendering validation remain pending.

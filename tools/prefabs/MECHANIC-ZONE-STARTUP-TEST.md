# Mechanic zone startup diagnostic

`prefabs/mechanic-shop-zone-startup-test.brz` is a temporary diagnostic version of the mechanic shop. It investigates the reported first-entry failure after paste/start. No cause has been confirmed in game yet.

The panel next to the PC stays visible even while unbound. It displays native zone occupant count, entered/left callback counters, queue length, reconciliation executions, binding requests, native owner setter completions, owner presence, owner-inside state, and busy/building state. Counters start at zero and count executions rather than distinct players. Owner writes count binding assignments, not unbinding clears.

Paste a fresh copy while outside the zone. Enter once. If the indicator stays red, capture the diagnostic panel **before leaving or entering again**. Then exit and enter again, capturing the working state. A screenshot is sufficient; a saved prefab is useful too. If the diagnostic version works on its very first entry, report that: adding observation gates may affect startup ordering, so that outcome alone does not establish a fix.

Interpretation:

- Occupants increases but Enter stays zero: zone occupancy is detected but the enter event was not observed.
- Enter increases and Queued increases but Reconcile remains zero: investigate request union/buffer propagation.
- Reconcile increases but Bind request stays zero: investigate processing state and queue/candidate validation.
- Bind request increases but Owner write stays zero: investigate the legacy bind pulse and microchip execution input.
- Owner write increases and Owner present is true but screen stays red: investigate the display/indicator path.

These readings narrow the failing stage; they do not by themselves prove the engine's underlying cause.

Generation:

```sh
node tools/prefabs/diagnose-mechanic-zone.cjs '<original mechanic zone source.brz>' prefabs/mechanic-shop-zone-startup-test.brz
node tools/prefabs/test-upgrade-shop.cjs prefabs/mechanic-shop-zone-startup-test.brz
```

The generator appends 18 diagnostic gates and one panel, retaining all baseline components and edges. It validates every serialized wire endpoint and runs the existing zone model checks. Purchase-model and saved leaderboard wiring checks also pass. No in-game validation has been performed. Production prefabs are unchanged.

## Follow-up: first diagnostic result

User observed first entry: Occupants 1, Enter 1, Reconcile 2, remaining readings zero, no binding. On exit: Enter 1, Exit 1, Reconcile 3, remaining readings zero. Second entry successfully bound: Enter 2, Exit 1, Reconcile 5, Bind request 1, Owner write 5, Owner present/Inside true, Processing false. This establishes event delivery and reconciliation on first entry, but does not establish whether the queue failed to receive the player or received and removed a null reference. Owner write is an execution count, not a distinct-owner count.

`prefabs/mechanic-shop-zone-startup-test-v2.brz` adds execution counters for entry Find, Push, duplicate branch, first-item read, and null-candidate removal. It also captures whether the entry character is non-null at the entry execution and displays Find's current found flag. Existing graph still unchanged. This revision has 32 diagnostic gates and one panel; all 939 serialized endpoints and the purchase/zone offline checks pass.

Use a fresh copy and capture **all rows while still inside after the first failed entry**. Push zero plus Duplicate nonzero implicates entry Find/branch evaluation. Push nonzero plus Null removed nonzero implicates character/reference timing. Push nonzero with First read zero implicates the processing/retention path. These are hypotheses to test, not confirmed causes.

## Buffered binding test

Screenshots from v2 show first-entry Push 1, First read 2, Null removed 1, Entry character valid true, and no bind request. The second entry has Push 2, Null removed still 1, and a successful binding. The failing stage is candidate extraction/validation; execution versus reactive data propagation is the working explanation, not a proven engine-level cause.

`prefabs/mechanic-shop-zone-startup-buffer-test.brz` waits one tick after the first queue read and candidate assignment, and after the final membership read. A preflight flag serializes those deferred checks. The final check requires both current queue membership and no transaction/rebuild in progress. It retains the v2 diagnostic panel. The production prefab file remains unchanged pending an in-game first-entry test.

Validation: all 964 serialized wire endpoints match the intended graph; existing zone behavior and purchase checks pass. The model additionally delays candidate variable publication by one tick and confirms first-entry binding succeeds. That model represents the suspected timing issue, not a complete emulation of Brickadia scheduling.

## Confirmed first-entry fix

User tested the buffered version in game and confirmed proper first-entry binding. Their screenshot shows Enter 1, Queued 1, Bind request 1, Owner write 1, First read 1, Null removed 0, Owner present/Inside true and Processing false. The buffered approach resolves the observed failure; the precise engine scheduling behavior remains inferred.

Regenerated `prefabs/mechanic-shop-zone-based.brz` with the same binding changes and without diagnostic instrumentation or the panel. Production has 62 zone gates and 910 wires. Zone model, delayed candidate publication, serialized endpoint, and purchase/key/value wiring checks pass. Clean version itself has not been separately tested in game.

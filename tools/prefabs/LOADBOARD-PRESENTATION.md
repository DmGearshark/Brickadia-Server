# Clean display, sounds and optimized compact logic

Builds on the in-game-confirmed spawn/event-driven queue repair at `57505ea396298069eab0db19e0daaa4f7e4a96c2`. Uses the user's **gate placing rough reference.brz** for the ten-unit gate spacing, backing panels and side labels.

## Visible display and sounds

Eight unwanted TextDisplay components were removed from the portable case, including its large backing brick and side/bottom trim. Only the original top header at local Z 16 retains **Loadboard**. The physical display bricks, fonts/styles on the remaining labels, geometry, collider settings, Fine setting, hidden chip and root transforms remain. Removing the components also removes their now-unused enabled wires; they cannot reappear on binding.

All four buttons (three portable controls plus the pickup control) receive the native default **BOSA_Buttons_Button_1_Press** and **BOSA_Buttons_Button_1_Release** references. Asset entries are added to both the main and embedded client tables, keeping their indices separate and preserving the existing font. This fixes the previous empty PressSound/ReleaseSound fields rather than relying on a null to mean a default sound.

| Cue | Asset | Trigger |
| --- | --- | --- |
| Accepted | OBA_UI_Checkpoint_Acquire_Tune_Cue | Caller/root/nonce-validated reply saying Load accepted |
| Abandoned | OBA_Beep_6, pitch 0.8 | Valid reply saying Load returned or Load abandoned |
| Collected/replaced cargo | OBA_UI_Goal_Tune_Cue | Pickup's player/station/nonce-validated Cargo issued reply |
| Delivered | OBA_CashRegister_Ding_2 | Successful payout/chat execution path |

These are spatial one-shot emitters on existing display/depot bricks, with repetition disabled. Acceptance/abandonment/collection remember their last played request nonce to suppress duplicate confirmed replies. The delivery sound follows the existing one-payment guard. Preview clicks, refresh replies, eligibility failures, failed spawning and rejected deliveries do not play confirmation cues. Native press/release sounds still provide normal button feedback; those automatic component sounds are distinct from confirmed-action cues.

Inactive catalogue rows retain their internal `Unused` sentinel for availability checks, but the portable display converts that sentinel to an empty string for both the load name and details. The selected-row chevrons are also suppressed when that row is empty.

Delivery audio is wireless across the world layout. The successful payment/chat path broadcasts `LB1.DeliveryCompleted`; an event receiver inside the delivery-location logic plays the local cash-register emitter. No sound wire connects the Server Load Board directly to the delivery location.

## Chip layout

Thirty-nine section records describe the current main/client layout in [loadboard-compact-sections.json](loadboard-compact-sections.json). Ordinary chips have compact flow/data columns on shaded backing tiles with side labels. Wide procedural gates occupy multiple ten-unit cells. Format Text gates reserve three cells as a conservative clearance allowance; their intrinsic asset name does not imply a one-cell footprint. Backing and label tiles use sizes and centers aligned to the five-unit coarse tile grid. Sections cover:

- Catalogue/settings; queued commands; player/old-board lookup; spawning/binding.
- Authority request queue, player fields/caches, cargo identity, offer state/rotation, browsing, acceptance, abandonment/re-listing, pickup authorization, stamping, delivery/payment, shared checks and reply formatting.
- Pickup state, zone ownership, binding/controls, reply queue/status, spawn handshake and confirmed collection sound.
- Cargo anchors and offset math; delivery events; portable binding/controls, requests/actions, row/reply data, timers/cleanup and sounds.

The nested Function's existing gates are arranged into input, parsing, eligibility and output blocks. No decorative TextDisplay/Interact/audio component is added inside its callable grid, avoiding the previously observed callable attachment restrictions. Its single input/output and all links are preserved.

The cargo chip now contains only its two prefab spawners. Each spawner uses its native `SpawnOffset` with `X = 0`, `Y = 0`, and `Z = 40`, placing cargo directly above the chip. The thirteen Get Own Transform, rotation, vector and offset-math gates and their wires are removed. Cargo type selection, the returned spawned entity, ownership stamping and the pickup handshake are preserved. The cargo entity frame and spawner brick positions remain unchanged. Other private-chip planes are fitted to their contents, while their entity locations/rotations remain unchanged. The visible world setup and portable display are not relocated.

The organized sections retain compact ten-unit cells for ordinary gates and extra room for wider gates. No transaction timing or gameplay path was changed; the event-driven queues and required spawn buffer remain intact.

## Logic optimization audit

The final graph runs common-subexpression elimination over pure expression gates. Gates are shared only when they are on the same chip, have the same type and stored settings, and receive the same source ports on every input. It repeats to a fixpoint, so sharing an identical first layer can expose an identical second layer. Detectors and time-reading expressions are excluded because they may carry state or depend on evaluation time. Native role nodes referenced by the model or layout manifest are also retained.

This shares 125 duplicate comparison, selection, boolean, formatting and math gates. Five unreferenced one-input Union gates are also bypassed because they are immediate execution pass-throughs. Compared with the previously published working prefab, the central assembly drops from 1,511 to 1,388 components and from 2,485 to 2,322 wires. Its embedded portable board drops from 222 to 215 components and from 344 to 337 wires. That is 130 fewer gates/components and 170 fewer wires across both graphs.

The approach follows the behavior-preserving common-subexpression optimization used by the public [Wirescript compiler](https://github.com/Meshiest/wirescript). Queues, tick buffers, detectors, variables, event boundaries, callable gates and transaction guards are deliberately left alone. Those gates protect native publication timing, request snapshots, duplicate suppression and simultaneous-player behavior; removing them would trade correctness for a smaller count.

## Editable catalogue and settings

The configuration chip has five individually labeled rows under **CATALOGUE & SETTINGS**:

1. **Vehicle Catalogue** — one string-to-string map.
2. **Load Catalogue** — the existing load-definition map.
3. **Payout Leaderboard Key** — `Scrap` by default.
4. **Minimum Load Rotation** — `600` seconds, or 10 minutes.
5. **Maximum Load Rotation** — `3600` seconds, or 60 minutes.

The two former per-vehicle Vars (`CarOwned` and `TruckOwned`) are replaced by one editable vehicle map. Its format is:

```text
Key:   Leaderboard ownership stat
Value: Display Name|Minimum Owned Value|Capability

CarOwned   = Car|1|1
TruckOwned = Truck|1|2
```

Capability `1` qualifies for normal freight. Capability `2` qualifies for normal and heavy freight; larger values continue the same greater-than-or-equal rule for future load classes. The saved leaderboard score must be at least the configured owned value. A new vehicle therefore requires one map row and no new gate or wire. For example, `VanOwned = Van|1|1` adds Van to normal-load eligibility and changes its displayed requirement to `Car / Truck / Van` automatically.

The server scans this map for the requesting player, derives the highest capability they own, and builds the requirement labels from every valid vehicle name. Gate count remains fixed as the map grows. The scan is serialized through the existing request queue and includes timing boundaries around native array, map and leaderboard reads. Its work grows linearly with the number of configured vehicles. Malformed entries are skipped. Changes are read on the next board request; there is no Apply button or generated cache to maintain.

The separate load map retains this format:

```text
Key:   Load index
Value: Cargo Name|Payout|Required Capability|Pickup ID|Destination ID|Pickup Name|Destination Name
```

Vehicle purchase prices do not belong to the load board and are not stored here. `Scrap` selects the leaderboard score paid on successful delivery; `600` and `3600` control offer rotation timing rather than prices.

## Validation

Checks reread the serialized main/client and verify every endpoint, one driver per input, microchip link, exact stored fields and absence of instantaneous cycles. Original wiring is retained except for the documented catalogue, cargo, display and equivalent-expression/pass-through rewrites. Footprint checks cover non-overlapping gate placement, including wide procedural gates. Cargo embeds remain byte-identical. All visible PC/world geometry and position-sensitive cargo data are compared against the source.

Graph tests cover successful and rejected actions, duplicate/stale replies, cue replay suppression, one delivery payout/sound, correct button assets, one visible top title, full ownership/abandonment/eligibility safeguards, first-entry zone binding/handoff, concurrent/staggered requests, command replacement, spawn placement, expiry and idle silence. The final serialized graph is also reimported using the new compact role map and rerun through gameplay and pickup/delivery integration. These are offline checks; audible levels, appearance and attachment acceptance still need an in-game check.

`loadboard-compact-layout.json` identifies the relocated native role nodes for future diagnosis; the older 0779 map remains for the previous versions. It contains circuit positions/types, not player state. The model records explicit confirmation emitter pulses; it does not simulate automatic native button audio or produce sound.

## Use / reproduction

Replace the previous central assembly with one updated `prefabs/loadboard-system.brz`, remove previously spawned boards, and run `/loadboard`.

```sh
git show 57505ea396298069eab0db19e0daaa4f7e4a96c2:prefabs/loadboard-system.brz > /tmp/loadboard-before-presentation.brz
node --max-old-space-size=512 tools/prefabs/polish-loadboard.cjs /tmp/loadboard-before-presentation.brz 'gate placing rough reference.brz' prefabs/loadboard-system.brz
```

The updater targets this known version/layout and the supplied reference. It preserves functional connections as it relocates existing gates, rather than regenerating an unrelated older display or replacing the working transaction logic.

## Native placement correction

The first presentation export rejected 83 bricks: 32 backing/label tiles and 51 gates. All 31 label tiles had an invalid half-width of 14; the remaining cargo backing tile had an off-grid X center of 72. Overlap checks using a wider Format Text footprint identify exactly 51 affected gates, matching the returned missing-gate count. The correction uses half-width 15 for labels and three reserved cells per Format Text gate. The exact mesh bounds have not been extracted; this is a conservative spacing allowance. Both embedded and main chip layouts receive the correction. A second native paste isolated two remaining rejections to the decorative cargo anchor backing and label at negative depth; those two nonfunctional bricks are now omitted. Added checks reject off-grid panel sizes/centers and overlapping wider formatting gates. The corrected file is rebuilt from the intact working source, restoring every functional gate and wire rather than reusing an incomplete game export. Native placement acceptance still requires an in-game check.

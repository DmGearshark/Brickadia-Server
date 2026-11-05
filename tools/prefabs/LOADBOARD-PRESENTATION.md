# Clean display, sounds and compact logic sections

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

## Chip layout

Thirty-nine section records describe the current main/client layout in [loadboard-compact-sections.json](loadboard-compact-sections.json). Ordinary chips have compact flow/data columns on shaded backing tiles with side labels. Wide procedural gates occupy multiple ten-unit cells, rather than overlapping adjacent gates. Sections cover:

- Catalogue/settings; queued commands; player/old-board lookup; spawning/binding.
- Authority request queue, player fields/caches, cargo identity, offer state/rotation, browsing, acceptance, abandonment/re-listing, pickup authorization, stamping, delivery/payment, shared checks and reply formatting.
- Pickup state, zone ownership, binding/controls, reply queue/status, spawn handshake and confirmed collection sound.
- Cargo anchors and offset math; delivery events; portable binding/controls, requests/actions, row/reply data, timers/cleanup and sounds.

The nested Function's existing gates are arranged into input, parsing, eligibility and output blocks. No decorative TextDisplay/Interact/audio component is added inside its callable grid, avoiding the previously observed callable attachment restrictions. Its single input/output and all links are preserved.

Cargo's two spawner gates and two Get Own Transform gates retain their exact positions, orientation and data. Its entity transform and plane data also remain unchanged. The outside world-position anchor remains untouched. Those positions participate in the working offset calculation and are not arbitrary layout slots. Other private-chip planes are fitted to their new contents, while their entity locations/rotations remain unchanged. The visible world setup and portable display are not relocated.

The authority gate/label-center span is about **525 × 1080** versus **1264 × 2736** before, roughly 84% smaller in area. Command and pickup spans also shrink. These figures describe arrangement, not a new runtime performance claim. No transaction timing or gameplay path was intentionally changed; the event-driven queues and required spawn buffer remain intact.

## Validation

Checks reread the serialized main/client and verify every endpoint, one driver per input, microchip link, exact stored fields and absence of instantaneous cycles. All original main wires remain; the only removed client wires belong to the eight removed decals. Footprint checks cover non-overlapping gate placement, including wide procedural gates. Cargo embeds remain byte-identical. All visible PC/world geometry and position-sensitive cargo data are compared against the source.

Graph tests cover successful and rejected actions, duplicate/stale replies, cue replay suppression, one delivery payout/sound, correct button assets, one visible top title, full ownership/abandonment/eligibility safeguards, first-entry zone binding/handoff, concurrent/staggered requests, command replacement, spawn placement, expiry and idle silence. The final serialized graph is also reimported using the new compact role map and rerun through gameplay and pickup/delivery integration. These are offline checks; audible levels, appearance and attachment acceptance still need an in-game check.

`loadboard-compact-layout.json` identifies the relocated native role nodes for future diagnosis; the older 0779 map remains for the previous versions. It contains circuit positions/types, not player state. The model records explicit confirmation emitter pulses; it does not simulate automatic native button audio or produce sound.

## Use / reproduction

Replace the previous central assembly with one updated `prefabs/loadboard-system.brz`, remove previously spawned boards, and run `/loadboard`.

```sh
git show 57505ea396298069eab0db19e0daaa4f7e4a96c2:prefabs/loadboard-system.brz > /tmp/loadboard-before-presentation.brz
node --max-old-space-size=512 tools/prefabs/polish-loadboard.cjs /tmp/loadboard-before-presentation.brz 'gate placing rough reference.brz' prefabs/loadboard-system.brz
```

The updater targets this known version/layout and the supplied reference. It preserves functional connections as it relocates existing gates, rather than regenerating an unrelated older display or replacing the working transaction logic.

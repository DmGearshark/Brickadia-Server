# Scrap Runners Roadmap

Last updated: 2026-11-18

This is the persistent source of truth for Scrap Runners work. Chat memory is not authoritative.

## Completion protocol

Statuses: `Next`, `In progress`, `Needs user verification`, `Blocked`, `Backlog`, `Done`.

- Implementation completion moves a task to `Needs user verification`, not directly to `Done`.
- Before crossing off any task, ask the user whether anything else needs checking or may have been missed.
- At that point, also raise any concern, edge case, or useful follow-up noticed during implementation.
- Only the user's confirmation moves a task to `Done`.
- Record the relevant prefab, downloadable output, and testing notes under the task.

## Current objective

Finish `FlatbedTruck1` as the first fully upgradable and customizable vehicle.

## Milestone 1 — First complete vehicle

### SR-001 — Finish and integrate the color customizer

Status: `In progress`

- Finish the existing color customizer.
- Connect its Color, Metal Material Toggle, and Material Intensity outputs to the vehicle.
- Ensure changes affect only the intended vehicle and player/session.
- Decide how colors are priced, unlocked, purchased, saved, and reapplied.
- Verify default/reset behavior and vehicle respawn behavior.
- Blue-body target array populated in `outputs/truck1-blue-body-array-populated.brz` with 31 visible body/cosmetic brick references: 28 fixed-body bricks plus two door panels and the hood panel.
- The body-array pass intentionally excludes hidden wheel/engine gates, the rigid bearing, and blue logic gates. It changes only the existing array value; color handoff wiring and loop execution remain separate work and still require in-game verification.
- First color-purchase integration candidate: `outputs/scrap-runners-truck1-color-terminal-v1.brz`.
  - Stores the spawner-provided owner PlayerState in the truck's general-purpose chip for reuse by later vehicle terminals.
  - Moves saved-color decoding, temporary preview selection, body-brick references, change detection, and application into the dedicated `Truck1Color Controller`; `Truck1Material` remains separate and unchanged.
  - Space purchases only when `Scrap >= 100` and the packed RGB value differs from the saved `Truck1Color`; the score is written before 100 Scrap is deducted.
  - Vehicle-zone exit targets the exact leaving entity and reloads only its `Truck1Color` getter. Engine, fuel, suspension, steering, wheel-spacing, and material leaderboard paths are structurally preserved.
  - Generator validation remaps and resolves all 33 stored brick handles after prefab grid renumbering, keeps the 31 intended body targets intact, preserves the Gearshark owner ID on every brick/entity, and expands the organized logic-chip planes so all gates remain accessible.
  - In-game testing found that its expression-only color ChangeDetector did not execute live preview; the vehicle updated only after purchase. This combined terminal-and-test-truck candidate is superseded by v2.
- Split live-preview correction candidates: `outputs/scrap-runners-color-terminal-v2.brz` and `outputs/scrap-runners-truck1-color-enabled-v2.brz`.
  - The terminal prefab contains the monitor, seat, zone, preview swatch, config chip, and terminal logic only. The bundled test truck and every vehicle grid/body reference were fully removed rather than merely moved outside the zone.
  - The Truck1 prefab contains the modified vehicle only, is recentered on the tagged vehicle root for clean prefab-spawner placement, and is intended to replace the existing Truck1 prefab entry inside the current vehicle spawner; it does not require a new spawner.
  - Live preview is driven by the completion pulses of all 15 Hue/Saturation/Brightness write gates, covering A/D taps, held repeats, and accepted hex input. A one-tick buffer lets all three parallel hex writes settle and coalesces their same-tick pulses before the preview event reads the selected color.
  - Static validation confirms the terminal has 0 stored truck BrickHandles and no vehicle receiver/stat logic; the truck retains and resolves all 33 stored BrickHandles, four wheel entities, owner PlayerState handling, color restore receiver, and all seven protected non-color leaderboard paths.
  - In-game placement exposed geometry collisions that static wire validation missed: three truck labels blocked each other/the `Interface with Vehicle` receiver (4 blocked bricks and 2 failed wires), while the terminal preview label blocked an existing edge detector (2 blocked bricks and 7 failed wires). No component type or cross-chip wire was unsupported.
- Placement-collision correction candidates: `outputs/scrap-runners-color-terminal-v3.brz` and `outputs/scrap-runners-truck1-color-enabled-v3.brz`.
  - Relocates/resizes only the four conflicting organizational labels. The critical preview receiver, edge detector, and all nine associated wires remain otherwise unchanged.
  - Validator now requires the truck preview event's execution and color wires, all seven placement-sensitive edge-detector wires, and non-overlapping bounds for the exact labels/gates involved in the v2 paste failure.
  - In-game verification on 2026-11-17: the user confirmed this version works as intended for the tested preview, purchase, and restoration flow.
  - Ownership validation remains deliberately deferred: this candidate assumes the seated terminal operator is the vehicle owner. Two-player isolation still needs a later ownership-aware pass before SR-001 is complete.
- Selectable-purchase terminal candidate: `outputs/scrap-runners-color-terminal-v4.brz`; continue using the already-confirmed `outputs/scrap-runners-truck1-color-enabled-v3.brz` because the vehicle-side logic did not change.
  - Adds `BUY` as the sixth W/S-selectable row below `PRICE 100`, separated from Material Intensity and above the usage instructions. Space attempts a purchase only while `BUY` is selected; other Space presses are intentionally ignored.
  - Adds outer configurable-chip pulse outputs `Successful Buy` and `Failed Buy`. Success pulses only after the saved-color write and Scrap debit complete. Failure combines only no vehicle in the zone, insufficient Scrap, and an already-saved color.
  - Selection now wraps over all six rows. A/D remains inactive on `BUY`, and the selected row uses the same fixed-width `> BUY <` presentation without shifting the other text.
  - Static validation covers the sixth-row wrap, selectable formatting, purchase guard, exact success/failure pulse sources, new-gate collision bounds, live-preview paths, and all existing truck/non-color regressions. In-game verification of the v4 terminal ports and revised monitor layout is still required.
- Session-and-vehicle display candidate: `outputs/scrap-runners-color-terminal-v5.brz` with `outputs/scrap-runners-truck1-color-enabled-v4.brz`.
  - Builds from the user's rearranged terminal and preserves all six configured sound emitters, including the two success sounds, failed-buy sound, selection sound, tap sound, and repeat sound. The failed-buy sound's editor note is hidden during play so it cannot create a nearby-interaction prompt.
  - The screen now shows the seated user's full ID, username, and Scrap; the supported vehicle's display name; its saved/current color hex; and the live preview/new color hex. The purchase row reads `Price: 🔩Scrap 100` above `BUY`.
  - Seat entry resolves the current PlayerState and refreshes its identity and Scrap. Vehicle entry reads `VehicleName` and `ColorLeaderboardKey` custom properties from the exact index-0 vehicle already targeted by preview/restoration. Purchases dynamically use that color key, then refresh displayed Scrap and saved color after the write/debit completes.
  - The updated Truck1 prefab adds only `VehicleName = FlatbedTruck1` and `ColorLeaderboardKey = Truck1Color` to its tagged root. Its 245 bricks, 159 wires, 33 stored brick handles, color controller, and every non-color vehicle system remain structurally unchanged from the working v3 truck.
  - Replace the current spawner's Truck1 prefab entry with truck v4; the original spawner logic itself needs no identification changes. Older trucks without the two properties display `NONE` and leave `BUY` disabled.
  - Static generation and strict placement validation pass with no invalid bricks, overlaps, components, or warnings. In-game verification is still required for screen fit, identity formatting, sounds, current/new color display, purchase outputs, and spawner replacement.
  - Displayed Scrap/current saved color refresh on seat changes, vehicle changes, and this terminal's purchase flow. Unrelated external changes made while the same user remains seated are not polled continuously.
  - In-game verification on 2026-11-17: the user confirmed the v5 session, vehicle, and purchase flow works. Its single-column presentation was functional but too cluttered, so the terminal UI is superseded by v6 while Truck1 v4 remains current.
- Two-column feedback terminal candidate: `outputs/scrap-runners-color-terminal-v6.brz`; continue using `outputs/scrap-runners-truck1-color-enabled-v4.brz` in the existing spawner.
  - Uses the user's `Updated Frame.brz` directly and preserves both positioned display panels, the expanded vehicle zone, all six configured sound emitters, and the latest failed-buy sound asset. The left panel shows process/session/vehicle/current-preview data and persistent `SYSTEM RESPONSE`; the right panel shows the five controls, price/BUY, and input help.
  - All six selectable rows color the complete selected element orange, including both fixed-width `> <` arrows, setting label, and value. An unaffordable BUY immediately reports `SYSTEM RESPONSE: CANNOT AFFORD` in red and performs exactly three finite 0.2-second red price/BUY blinks before returning to the normal orange selection.
  - Screen responses cover `READY`, `COLOR APPLIED`, `CANNOT AFFORD`, `COLOR ALREADY APPLIED`, and `NO VEHICLE`. A selected BUY now reaches internal vehicle validation so absent or unsupported vehicles produce the visible response and Failed Buy output instead of silently doing nothing.
  - Removes all three purchase status-message pop-ups sent directly to the player. The separate invalid-hex input warning remains because it is text-entry validation rather than transaction feedback. Successful Buy and Failed Buy microchip outputs and their local sounds remain intact.
  - Static tests validate the two live display wires, shared seat visibility, orange row markup, reason-specific response paths, finite blink chain, dynamic vehicle color key, zero purchase pop-ups, sound preservation, and owner/integrity constraints. Strict placement passes with no invalid bricks, overlaps, components, or warnings. In-game presentation and timing still require user verification.
- Human-readable internal-logic candidate: `outputs/scrap-runners-color-terminal-v7.brz`; continue using `outputs/scrap-runners-truck1-color-enabled-v4.brz` in the existing spawner.
  - Builds directly from the working v6 terminal and changes no functional topology: all 499 original bricks, 700 wires, two microchip links, component values, sounds, physical frame/zone/displays, and purchase/preview/session behavior are preserved.
  - Reorganizes the terminal/session plane, public configuration plane, and hidden color core into named, color-coded, left-to-right lanes modeled after the user's readable vehicle-stat board. The hidden core now exposes a repeated Hue/Saturation/Brightness/Material/Intensity matrix with separate tap-A, tap-D, hold-A, and hold-D columns, followed by dedicated HSB-to-RGB, hex validation, preview, and sound bands.
  - Adds 35 passive black section/subsection labels with no wires or child links. The public plane separates editable settings, the hidden controller, public outputs, and screen-formatting paths; its two formerly stale formatter hover notes now describe the actual left/session and right/settings inputs.
  - Restores the user's final selection preference: both `> <` arrows remain green while only the selected label/value between them turns orange. The failed affordability block remains red during its three finite blinks.
  - Exact topology/component regression tests, plane-fit/overlap checks, ownership checks, and strict placement validation pass with no invalid bricks, uncertain overlaps, component failures, or warnings. In-game screenshots are still required to tune spacing and confirm the reorganized planes are comfortable to follow at Brickadia's editor zoom.
  - User layout review rejected the v7 internal presentation: the oversized label slabs, excessive empty space, and long wire arcs made it at least as confusing as the original. Do not use its layout as the pattern for another full-terminal pass; its working behavior remains a reference only.
- Compact labeled terminal-logic candidate: `outputs/scrap-runners-color-terminal-v8.brz`; continue using `outputs/scrap-runners-truck1-color-enabled-v4.brz` in the existing spawner.
  - Rebuilds the terminal logic into compact, exact-fit labeled sections with touching, on-grid gate rows while preserving the working terminal behavior.
  - In-game layout review on 2026-11-17: the user confirmed the internal layout is clean and human-readable.
- Vehicle-appearance synchronization candidate: `outputs/scrap-runners-color-terminal-v9.brz` paired with `outputs/scrap-runners-truck1-color-enabled-v5.brz`.
  - The vehicle publishes its saved color and material on its root, allowing zone entry to initialize the terminal from the entering vehicle instead of immediately overwriting it with the terminal's default color.
  - Material selection is limited to Plastic and Metal. Both color and material preview live on the vehicle, and zone exit reloads both saved values; BUY intentionally remains a color-only purchase in this pass.
  - The fast repeat clocks are no longer free-running and are enabled only while A or D is held. Successful purchases display `SYSTEM RESPONSE: COLOR APPLIED -🔩100`, using the configurable color price rather than a hardcoded display value.
  - The terminal and Truck1 outputs pass their paired regression suite, resolve all 33 stored body-brick references, and pass strict placement validation with no invalid bricks, overlaps, components, or warnings.
  - In-game verification found that zone entry reset the picker to red instead of matching the truck. The one-shot H/S/B setters ran before the new score settled through two nested chips, and two added Floor gates contained non-finite saved defaults. This terminal is superseded by v10; Truck1 v5 remains compatible.
- Settled-sync and blinking-selector candidate: `outputs/scrap-runners-color-terminal-v10.brz` paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v5.brz`.
  - Restores the exact packed-RGB decoder topology already proven in v8, removes both malformed Floor gates, and waits one logic tick after reading the entering vehicle before committing Material/Hue/Saturation/Brightness.
  - The selected label/value remains orange, but the selector now has only one right-side `<` marker. It blinks every 0.25 seconds during an initialized seated session; its clock is saved disabled, stops when the session ends, and resets on both session entry and exit.
  - The separate unaffordable-purchase response retains its finite 0.2-second red blink and now also uses only the right-side marker.
  - Regression tests numerically evaluate the serialized packed-score-to-H/S/B graph across representative colors, reject non-finite component values, validate the one-tick barrier and session-gated blink, retain all v9 purchase/material/restore checks, and pass strict placement with no warnings.
  - In-game verification on 2026-11-17 found that the terminal retained its orange/Metal defaults and pushed those values into the entering truck instead of initializing from the truck. Plastic/Metal preview did not change the truck, and material intensity had no vehicle protocol at all. This candidate is superseded by v11/v6.
- Request/reply appearance candidate: `outputs/scrap-runners-color-terminal-v11.brz` paired with `outputs/scrap-runners-truck1-color-enabled-v6.brz`.
  - Replaces the timing-sensitive custom-property pull with a targeted `SR.Appearance.Request` to the exact `Vehicle`-tagged zone entity. Truck1 replies with its live rendered color, Plastic/Metal state, and raw 0–255 intensity; the terminal accepts only a matching vehicle identity and request nonce.
  - An `appearanceReady` lock is false on entry and exit. It becomes true only after the accepted reply is snapshotted, allowed to settle for one tick, and all Material/Hue/Saturation/Brightness/Intensity setters finish, so the terminal default can never preview back into the truck during initialization.
  - Corrects the truck body-loop boundary to use `LinearColor`, `EBrickMaterial`, and numeric intensity types. Terminal preview now sends intensity as event Data3, and Truck1 applies it with `Set Brick Property` property 3 alongside the existing color and material writes.
  - Every preview event explicitly requests a delayed body-array pass after its three state writes, rather than relying only on change detectors. Zone exit still reloads saved color/material and restores intensity to the truck body's original 5/10 baseline (128/255, displayed as 50%). BUY remains color-only and the existing `SYSTEM RESPONSE: COLOR APPLIED -🔩100` behavior is unchanged.
  - Deterministic generation, v9–v11 regression tests, exact live RGB packing, enum/intensity type checks, all 33 stored BrickHandle resolutions, preservation of all eight existing leaderboard gates and the physical truck, and strict placement validation pass with no invalid bricks, overlaps, components, or warnings.
  - In-game placement on 2026-11-17 rejected exactly the two new request/reply gates in each prefab. They were the only four procedural gates serialized with zero dimensions. This produced the reported terminal loss of 2 bricks/4 components/10 wires and truck loss of 2 bricks/4 invalid components/6 wires; the truck also rejected two editor-only labels in the nested body callable. This candidate is superseded by v12/v7.
- Placement-safe request/reply candidate: `outputs/scrap-runners-color-terminal-v12.brz` paired with `outputs/scrap-runners-truck1-color-enabled-v7.brz`.
  - Preserves the complete v11/v6 appearance protocol and behavior while serializing all four new procedural request/reply gates with explicit `[10, 5, 2]` half-extents. Their existing rows were already spaced for that footprint, so no functional gates or wires were relocated or removed.
  - Removes the editor-only interaction labels from those procedural gates and from the truck callable's MaterialOpacity input/property-3 setter. All seven functional body-callable gates remain, including the three typed Color/Material/Intensity inputs and brick properties 1/2/3.
  - The placement validator now treats stored procedural-gate dimensions as exact geometry and rejects zero or off-grid `5/5/2` half-extents, so the v11/v6 serialization defect cannot pass silently again.
  - Full inherited behavior/determinism tests pass. The terminal retains 602 bricks and 825 wires; Truck1 retains 273 bricks, 207 wires, all 33 stored body-brick references, all eight leaderboard gates, and its unchanged physical vehicle. Both outputs pass strict placement with no invalid bricks, overlaps, uncertain envelopes, or warnings.
  - In-game behavior testing on 2026-11-17 found that entry still left the picker at red. The entry setter committed nonce `n + 1`, but the following request read that same live expression after it had recalculated to `n + 2`; every returned reply therefore failed the nonce check. Testing also found that leaving after a Metal preview retained Metal: the saved-material decoder depended on an equality output changing, so rereading the same saved Plastic score did not execute its setter. This pair is superseded by v13/v8.
- Settled-request and explicit-material-restore candidate: `outputs/scrap-runners-color-terminal-v13.brz` paired with `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - The terminal now commits the next nonce, waits one logic tick for the nonce and vehicle array to settle, rereads the retained index-0 vehicle, and sends that exact vehicle plus the committed nonce. The request no longer reads the self-changing `nonce + 1` expression or a delayed zone-event output.
  - Every `Truck1Material` leaderboard read now explicitly branches on saved score `1`: true sets Metal enum `4`, false sets Plastic enum `0`. This runs on initial vehicle loading and zone-exit restoration even when the saved score itself did not change. BUY remains color-only.
  - The existing exit path still reloads saved color and explicitly restores material intensity to raw `128` (50%). Material and intensity changes continue through the same delayed body-array pass used by live preview.
  - Full v9–v13 behavior and deterministic-build tests pass, including negative fixtures reproducing both v12/v7 bugs. The terminal has 604 bricks/828 wires; Truck1 has 273 bricks/208 wires, all 33 stored body references, all eight leaderboard gates, and the unchanged physical vehicle. Both pass strict placement with no invalid bricks, overlaps, uncertain envelopes, or warnings.
  - In-game testing on 2026-11-17 found two remaining terminal defects. `CURRENT COLOR` correctly showed Truck1's saved color, but the independent request/reply initialization left `PREVIEW COLOR` at red. The seat's numeric `InputUp` axis was also wired directly into the BUY branch, so release/reset changes could execute a real purchase after the player left the seat. The v8 truck remains the current vehicle prefab because its explicit saved-material exit restoration is still required; only the v13 terminal is superseded.
- Leaderboard-authoritative initialization and seat-safe purchase candidate: `outputs/scrap-runners-color-terminal-v14.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - Removes the terminal-side `SR.Appearance.Request`/`SR.Appearance.Reply` handshake. Picker initialization now uses the exact dynamic color leaderboard getter already proven by the correct `CURRENT COLOR` display, then reads `Truck1Material` for the same seated PlayerState. One-tick barriers follow both asynchronous leaderboard reads.
  - Initialization is accepted only while a seated session and supported vehicle are active and appearance synchronization is still pending. Saved material score `1` maps to Metal enum `4`; every other score maps to Plastic enum `0`; material intensity initializes to the truck's raw `128`/50% baseline.
  - Color, material, and intensity state directly drive the hidden core decoder and setter chain, bypassing the nested microchip relay whose runtime ordering was not reliable enough for entry synchronization. Preview remains blocked until that complete chain has settled.
  - BUY now normalizes `InputUp` through `> 0.5`, uses an explicitly seeded rising-edge detector, and has no falling-edge/release execution path. The first guard requires the BUY row plus the retained seated session; the final branch immediately before `SetLeaderboardValue` independently requires both that session and the physical seat's `bIsOccupied` output, so a seat-exit reset cannot write color or reach the Scrap debit.
  - Full inherited v9-v13 regression tests pass on the committed baseline. Dedicated v14 tests reproduce the former direct-axis defect, enforce the new initialization and purchase topology, confirm the v8 truck is byte-identical, validate deterministic generation, and pass strict placement with no invalid bricks, overlaps, uncertain envelopes, component failures, or warnings. Terminal count is 603 bricks/820 wires; Truck1 remains 273 bricks/208 wires with all 33 stored body references.
  - In-game testing and the user's combined `Current State.brz` on 2026-11-17 confirmed that placement was structurally intact: all 603 terminal bricks/820 wires and all 273 Truck1 bricks/208 wires survived. The seated leaderboard getter and retained snapshot also held the correct `#FFA100` score, but RGB-to-HSV returned normalized Hue `0.0594` and the terminal wrote it directly into its degree-based Hue Var, producing nearly pure red instead of `21.384°`. The same unit defect existed in the accepted-hex path. Vehicle entry also could not initialize by design because the v14 guard required `sessionReady`. The v14 terminal is superseded; Truck1 v8 remains current.
- Live-entry snapshot and corrected-Hue candidate: `outputs/scrap-runners-color-terminal-v15.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - Restores the v8 truck's live `SR.Appearance.Request`/`SR.Appearance.Reply` path as the primary source on vehicle-zone entry, so initialization no longer requires anyone to occupy the terminal seat. The request vehicle and nonce are retained before sending; all five reply values are snapshotted before delayed validation.
  - Tick barriers separate array reads, request state, reply snapshots, and current-vehicle validation. A reply is accepted only for the retained current vehicle and nonce while the vehicle is supported, appearance is not ready, and synchronization is not busy.
  - A dedicated `syncBusy` lock prevents the entry reply and seated leaderboard fallback from racing. The v14 leaderboard path remains only as a fallback while initialization is still pending; once live entry synchronization succeeds, sitting down cannot overwrite it.
  - Both RGB-to-HSV paths multiply normalized Hue by `360` before writing the degree-based Hue Var: live/saved appearance initialization and accepted hex input. Saturation and Brightness retain their existing `×100` conversion.
  - Preserves v14's seeded rising-edge Space input and mandatory final `sessionReady && Seat.bIsOccupied` guard immediately before the saved-color write, so release/seat-exit resets still cannot purchase or debit Scrap.
  - Full inherited v9-v14 and dedicated v15 regressions pass. Generation is deterministic; strict placement reports no invalid bricks, overlaps, uncertain envelopes, component failures, or warnings. Terminal count is 656 bricks/908 wires. Truck1 v8 remains byte-identical at 273 bricks/208 wires with all 33 stored body references.
  - In-game testing on 2026-11-17 exposed a second conversion issue. The entering truck's live `#FFA100` was gamma-decoded to linear RGB before HSV conversion, producing `21.384°`; the terminal then reconstructed that value through its sRGB HSV renderer as approximately `#FF5A00`. Correct conventional sRGB HSV for `#FFA100` is `37.882°`. The screenshot also showed `CURRENT COLOR` still came from the seated leaderboard getter while `PREVIEW COLOR` came from the entering truck, so the two lines could disagree. The v15 terminal is superseded; Truck1 v8 remains current.
- Gamma-correct live baseline candidate: `outputs/scrap-runners-color-terminal-v16.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - Both vehicle/saved synchronization and accepted hex input explicitly split the source through `SplitColorSRGB`, divide the three byte channels by `255`, and assemble a raw numeric color before HSV conversion. Hue remains `×360` and Saturation/Brightness remain `×100`.
  - Reuses the retained entry `scoreState` as the terminal's baseline/current color Var. Accepted truck replies and the seated fallback initialize both that baseline and the live preview from the same score; preview edits do not change the baseline. The `CURRENT COLOR` display now reads this Var instead of the seated leaderboard getter, so CURRENT and PREVIEW match on entry.
  - After a successful saved-color write, the purchased packed preview updates the same baseline Var before the Scrap debit, keeping `CURRENT COLOR` accurate. The dynamic leaderboard getter remains available for persistence comparison and purchase validation but no longer controls the visible current-color line.
  - Preserves v15's staged live request/reply, nonce/current-vehicle validation, synchronization lock and fallback, plus v14's seeded rising-edge Space and final occupied-seat mutation guard. Truck1 v8 is byte-identical.
  - Full inherited v9-v15 and dedicated v16 regressions pass. Generation is deterministic; strict placement reports no invalid bricks, overlaps, uncertain envelopes, component failures, or warnings. Terminal count is 667 bricks/925 wires; Truck1 remains 273 bricks/208 wires with all 33 stored body references.
  - In-game testing and the uploaded runtime `current state.brz` on 2026-11-18 proved that placement and every upstream value were correct: Truck1 live color, reply Data3, reply staging, and retained baseline were all `#FF5A00`; the adapter correctly extracted `(255,90,0)` and normalized it to `(1,0.352941,0)`. The following `ColorConvert FromSpace=Srgb` gate then gamma-decoded that already-extracted value a second time, producing Hue `6.134°` and terminal output `#FF1A00`. The v16 regression falsely modeled that converter as direct numeric HSV and therefore missed the runtime double-gamma behavior. The v16 terminal is superseded; Truck1 v8 remains current.
- Double-gamma correction candidate: `outputs/scrap-runners-color-terminal-v17.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - Changes exactly the two adapter-following RGB-to-HSV converters from `FromSpace=Srgb (1)` to raw numeric RGB `FromSpace=Linear (0)` while retaining the proven `SplitColorSRGB → ÷255 → MakeColor` inputs. No gates or wires change; terminal topology remains 667 bricks/925 wires.
  - The change prevents a second gamma decode. Runtime-modeled regression reproduces v16's `#FF5A00 → Hue 6.134° → #FF1A00`, then confirms v17's `#FF5A00 → Hue 21.176° → #FF5A00` and `#FFA100 → Hue 37.882° → #FFA100` exact round trips on both vehicle synchronization and hex input.
  - Preserves v16's retained baseline/current display, live staged request/reply, synchronization lock, seated fallback, purchase baseline update, and occupied-seat BUY safeguards. Truck1 v8 remains byte-identical.
  - Exact component-data comparison requires the two `FromSpace` fields to be the only v16→v17 changes. Full inherited v9-v16 and dedicated v17 regressions pass; generation is deterministic and strict placement reports no invalid bricks, overlaps, uncertain envelopes, component failures, or warnings.
  - In-game testing on 2026-11-18 confirmed that vehicle entry now initializes the terminal to the truck's exact color instead of red. Testing then exposed that BUY still wrote only `Truck1Color`; Plastic/Metal remained preview-only, so the unchanged `Truck1Material = 0` score correctly restored Plastic on zone exit and respawn. The color fix remains current, but the terminal is superseded by v18 for saved material.
- Saved Plastic/Metal purchase candidate: `outputs/scrap-runners-color-terminal-v18.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v8.brz`.
  - Extends the existing guarded BUY transaction with a `Truck1Material` leaderboard write. The selected terminal material uses numeric Plastic `0` / Metal `4`; the new encoder saves the truck's established score convention Plastic `0` / Metal `1` using the same PlayerState as the color write.
  - Purchase eligibility is now `color changed OR material changed`, so changing only material can be bought while an entirely unchanged appearance remains rejected. After both writes, the retained color and material baselines advance before the single Scrap debit, preventing an immediate duplicate charge.
  - The irreversible path remains behind the final `sessionReady && Seat.bIsOccupied` guard and is ordered color write → material write → color baseline → material baseline → Scrap debit. Truck1 v8 already reloads `Truck1Material` on both zone exit and initial spawn, explicitly mapping score `1` to Metal enum `4` and all other values to Plastic enum `0`, so no truck or spawner change is required.
  - Full inherited v9-v17 and dedicated v18 regressions pass, including color-only/material-only/both/neither purchase truth cases, integer material encoding, shared PlayerState, exact transaction ordering, repeat-purchase prevention, unchanged Truck1 v8 bytes, deterministic generation, and strict placement with no invalid bricks, overlaps, uncertain envelopes, component failures, or warnings. Terminal count is 673 bricks/937 wires.
  - Status: `Needs user verification` only for the remaining simultaneous-vehicle test below; the single-vehicle color and Plastic/Metal flow has user approval.
  - Material intensity persistence is still intentionally out of scope: Truck1 restores raw `128` (50%) on exit and spawn because no saved intensity leaderboard key exists yet. Persisting intensity requires a new score plus terminal write and truck load/restore logic.
  - In-game testing on 2026-11-18 indicates the complete single-vehicle color and Plastic/Metal flow is working, including saved restoration. Static inspection of the pending multiplayer case shows that every entry inserts at vehicle-array index `0`, so the last-entered vehicle becomes the active sync/preview target and older vehicles shift back. Two likely handoff defects need live testing and probably correction: the formerly active vehicle is not restored when another vehicle enters because it has not left the zone, and any vehicle leaving resets `appearanceReady` without explicitly synchronizing the vehicle newly exposed at index `0`. BUY also still writes the seated player's scores rather than verifying the active vehicle's owner. Do not mark this done until two simultaneous vehicles—preferably with different owners—prove that demotion, preview, purchase, removal, restoration, and retargeting cannot affect the wrong vehicle or player.
- First-vehicle bay lock and owner authorization candidate: `outputs/scrap-runners-color-terminal-v19.brz`, now paired with `outputs/scrap-runners-truck1-color-enabled-v10.brz`.
  - Uses the deliberately simple multi-vehicle rule chosen for this terminal: the first vehicle entering an empty bay remains the only active vehicle until it leaves. Later vehicle entries and their exits are ignored completely. If the active vehicle leaves while an ignored vehicle remains in the zone, that ignored vehicle must exit and re-enter before it can become active.
  - Truck1 v9 added the existing retained `Owner PlayerState` to `SR.Appearance.Reply.Data6`, but the first runtime owner test exposed that the variable was mislabeled: the existing spawner supplies its claim button's `Character` directly on `UpdateCar.Data1`, not a PlayerState. Terminal v19 therefore compared a non-null Character with the seated user's real PlayerState and correctly displayed the confirmed-mismatch red state every time. Truck1 v9 is superseded.
  - Truck1 v10 inserts `Get PlayerState From Entity` at the source: `UpdateCar.Data1 Character → resolved PlayerState → retained Owner PlayerState`. The stable PlayerState then continues to the truck's existing leaderboard consumers and owner reply. The existing vehicle spawner logic still does not need to change; replace its Truck1 prefab with v10 and respawn the vehicle.
  - The terminal commits the owner only after the existing current-vehicle and request-nonce checks accept the reply. A null owner cannot start the terminal and is retried. A seated player must match that live owner before the terminal reads their identity/Scrap/appearance data, enables either screen, forwards controls, sends preview, blinks the selector, or starts BUY.
  - The physical state indicator is black while off, unsynchronized, or owner-unknown; green only for the authorized owner; and red for a confirmed different player in the seat. A wrong player receives no screen, controls, preview, leaderboard read, write, or Scrap debit.
  - BUY checks owner identity before purchase reads and again immediately before mutation. The final guard also requires the same PlayerState that began the transaction and an unchanged appearance/session nonce, preventing a seat or active-vehicle handoff during asynchronous reads from charging or writing the wrong player. The proven color → material → retained baselines → Scrap debit order remains unchanged.
  - Active entry and exit clear the old seated session. If an old appearance sync overlaps a new vehicle, releasing the sync lock retries the owner request instead of freezing black. The new touching/on-grid logic lanes include fixed `VEHICLE BAY LOCK`, `OWNER REPLY`, `OWNER AUTHORIZATION`, `SESSION + INDICATOR`, and `PURCHASE OWNER GUARDS` section cards.
  - Full inherited v13-v18, Truck1 v9-v10, owner-isolation, handoff-race, deterministic-build, and strict-placement regressions pass. The terminal has 727 bricks/1,027 wires; Truck1 v10 has 274 bricks/211 wires, all 33 stored body references, and unchanged physical vehicle geometry.
  - Status: `Needs user verification`. Test: owner gets green/full operation; wrong player gets red with no active screen or controls; no player/no vehicle stays black; a second vehicle cannot steal or clear the first vehicle's session; the active vehicle restores on exit; the ignored vehicle becomes eligible only after exiting/re-entering; color and Plastic/Metal still persist after exit and respawn.
  - Material intensity persistence remains out of scope and still restores the established raw `128` (50%) value.
- Stable-owner-ID and stale-bay recovery candidate: `outputs/scrap-runners-color-terminal-v20.brz`, paired with `outputs/scrap-runners-truck1-color-enabled-v11.brz`.
  - The uploaded `truck and terminal diag.brz` captured the terminal's active-vehicle array as a one-element `[null]` slot. Terminal v19 accepted a new entry only when index `0` was out of bounds, so deleting, replacing, or despawning the active truck inside the zone could leave a dead weak-object slot that permanently ignored every later vehicle and kept the terminal black.
  - Terminal v20 treats either an out-of-bounds slot or a null/dead slot as an empty bay, clears that stale array state, and then runs the normal first-vehicle entry path. A live non-null first vehicle remains an absolute lock; additional live vehicles are still ignored until it leaves.
  - Ownership now crosses the vehicle/terminal protocol as a stable user-ID string instead of relying on Character/PlayerState object identity. Truck1 v11 preserves v10's resolved Owner PlayerState and its existing leaderboard consumers, derives and retains `Owner User ID`, and publishes that string on `SR.Appearance.Reply.Data6`.
  - Terminal v20 compares the active vehicle owner ID with the seated user's ID during startup, before purchase reads, and again immediately before mutation. The existing PlayerState equality and appearance/session nonce checks remain in the final transaction guard, so a seat or vehicle handoff cannot charge a different player mid-purchase.
  - The indicator contract remains black for no live/known owner or no seated user, green for the confirmed owner, and red for a confirmed different user. Screens, controls, previews, leaderboard reads/writes, and Scrap debit remain authorization-only.
  - Full inherited v13-v19, Truck1 v9-v11, stale-slot truth-table, stable-ID protocol, transaction-continuity, deterministic-build, and strict-placement regressions pass. The terminal has 732 bricks/1,036 wires; Truck1 v11 has 278 bricks/217 wires and all 33 stored body references.
  - Status: `Needs user verification`. Replace both old prefabs: install Truck1 v11 in the existing spawner, place terminal v20 with the bay empty, claim/spawn the truck outside the zone, then drive it across the zone boundary. Verify owner green/full operation, wrong player red/no operation, vehicle exit/respawn persistence, and replacement/despawn-in-zone recovery. A truck already overlapping a newly placed zone must still exit and re-enter because Brickadia's zone-enter event is edge-triggered.
  - In-game verification on 2026-11-18: after replacing the paired terminal/truck prefabs and re-entering the zone, the user confirmed the terminal is functioning again. The stale-black startup failure is resolved for the tested owner/vehicle path. Wrong-player isolation and the two-simultaneous-vehicle case still need live multiplayer verification before this task can be marked done.
  - Material intensity persistence remains out of scope and still restores the established raw `128` (50%) value.
- Clean unselected-row marker candidate: `outputs/scrap-runners-color-terminal-v21.brz`, paired with the unchanged `outputs/scrap-runners-truck1-color-enabled-v11.brz`.
  - The visible `</>` beside unselected settings was not an intended icon. It was the terminal's rich-text closing tag leaking into rows whose orange opening tag was inactive.
  - Unselected Hue, Saturation, Brightness, Material, Intensity, and BUY rows now return a completely empty suffix. A selected row still closes its orange formatting during both blink phases, and only its single right-side `<` appears during the authorized 0.25-second visible phase. This prevents both the literal `</>` and orange styling from bleeding into later rows.
  - Adds six touching/on-grid selected-suffix routers without changing color/material synchronization, stable owner-ID authorization, stale-bay recovery, purchase ordering, sounds, or Truck1 v11. Full inherited v13-v20, marker truth-table, authorization-gated blink, deterministic-build, and strict-placement regressions pass. Terminal count is 738 bricks/1,048 wires.
  - In-game presentation decision on 2026-11-18: after comparing both versions, the user prefers the visible `</>` row endings. V21 remains a valid optional clean-marker variant but is not the chosen presentation. Continue with terminal v20 and Truck1 v11; the multiplayer ownership/second-vehicle checks from v20 remain pending.

- Consolidated Truck1 appearance-layout candidate: `outputs/scrap-runners-truck1-color-enabled-v12.brz`, paired with the preferred unchanged `outputs/scrap-runners-color-terminal-v20.brz`.
  - The green upgrade board now leaves `Truck1Color` and `Truck1Material` as the two visible leaderboard getters, feeding one adjacent `COLOR + MATERIAL CONTROLLER`. Saved color/material decoding, temporary preview, material intensity, body application, restore handling, and terminal request/reply logic are all contained in that controller.
  - The complete owner chain (`UpdateCar` Character → resolved/retained PlayerState → stable user ID) has been removed from the unrelated general vehicle chip and placed in one dedicated `OWNER / PLAYERSTATE` controller on the green board. Its PlayerState still feeds both leaderboard getters and its stable ID still feeds `SR.Appearance.Reply.Data6`.
  - This is an organization-only revision of Truck1 v11. Terminal v20 and its visible `</>` row endings are unchanged. The prefab has 281 bricks/220 wires, preserves all 33 stored body references, passes inherited v9-v11 behavior checks, deterministic generation, and strict placement with no overlaps or invalid bricks.
  - Status: `Needs user verification`. Replace Truck1 v11 in the existing spawner with v12, then verify the green-board layout, saved color/material on spawn, terminal live preview, Plastic/Metal plus intensity preview, purchase persistence, exit restore, owner authorization, and respawn persistence. Also tell me what else you want checked in-game.
- Logic-layout calibration proof: `outputs/five-and-gates-row.brz`.
  - Deliberately contains only one Gearshark-owned microchip with exactly five unwired AND gates at `X = -96, -48, 0, 48, 96`, identical `Y = 0`, identical `Z = 2`, and identical orientation.
  - No labels, decorative bricks, nested logic, or extra components are inside the chip. Strict placement and exact-row validation pass; spacing/orientation now require the user's in-game visual approval before any more complex layout work.

Acceptance checks:

- Color, metallic state, and material intensity all apply correctly.
- Previewing a color does not accidentally purchase or permanently apply it.
- One player's customization cannot alter another player's vehicle.
- Customization survives whatever persistence boundary the user chooses.

### SR-002 — Configure an engine from one array entry

Status: `In progress`

- Use one Quaternion array as the authoritative engine-profile source.
- The saved mechanic-shop value is the profile index used by the dedicated Array Get gate.
- Quaternion field mapping is X = Top Speed, Y = Torque, Z = Acceleration, W = Eco.
- Feed the Array Get result directly into Split Quaternion; separate forwarding Vars are not required.
- Define the exact units, valid ranges, and defaults for all four fields.
- Apply the selected configuration to every engine property that should change.
- Use tier/profile index `0` as stock, keep released indices stable, and append new profiles rather than reordering them.
- Check out-of-bounds/missing profile values and safely fall back to index `0`.
- Verify first-load propagation; add a one-tick buffer between asynchronous stat reads and dependent execution only if the initial read otherwise uses the previous value.

Current demonstrated profile: Top Speed `300`, Torque `5`, Acceleration `0.5`, Eco `1`.

Confirmed mechanic-shop engine catalogue order and prices:

- `0` Stock Shitter — free
- `1` RedNeck Engine — 2,500 Scrap
- `2` Backyard Engine — 5,000 Scrap
- `3` A Real Engine — 15,000 Scrap
- `4` The Slow Turtle Engine — 10,000 Scrap

These are catalogue/profile IDs and prices; the exact Quaternion statistics for profiles `1` through `4` still need to be defined on the truck.

### SR-003 — Fuel tank upgrade

Status: `Backlog`

- Define capacity tiers and prices.
- Confirmed profiles: `0` Starter/20,000 capacity/free; `1` Mid/25,000 capacity/5,000 Scrap; `2` Large/30,000 capacity/10,000 Scrap.
- Connect capacity to the gas tank and gauge.
- Verify refueling, fuel consumption, empty-tank behavior, and persistence.

### SR-004 — Suspension upgrade

Status: `Backlog`

- Define suspension tier values and prices.
- Confirmed value/price profiles: `500/1000`, `1000/2000`, `1500/2000`, `2000/2000`, `2500/2000`.
- Apply the chosen tier consistently to every relevant wheel.
- Check stability at minimum and maximum settings.

### SR-005 — Steering turn-speed upgrade

Status: `Backlog`

- Define steering-speed tiers and prices.
- Confirmed free profiles: `0.05`, `0.1`, `0.2`.
- Apply the setting consistently to steering components.
- Check responsiveness without oscillation or snapping.

### SR-006 — Steering-angle upgrade

Status: `Backlog`

- Define steering-angle tiers and prices.
- Confirmed free profiles: `30`, `35`, `40`, `45`, `50`, `55`, `60` degrees.
- Verify wheel clearance, turning radius, and behavior at speed.

### SR-007 — Wheel-spacing upgrade

Status: `Backlog`

Wheel Spacing is confirmed as an upgrade for the first vehicle. Confirmed value/price profiles: `0/free`, `2.5/500`, `5/1500`, `7.5/3000`, `10/10000`. Define safe wheel positions and clearance checks.

### SR-008 — Complete the shared vehicle feature checklist

Status: `Backlog`

Every finished vehicle should have:

- Speedometer enabled while someone occupies the driver's seat.
- Gas tank and gas gauge enabled while the engine is on.
- Door on/off switch.
- Headlight on/off switch.
- Engine on/off switch.
- Brake on/off switch that freezes the vehicle as intended.
- Hood on/off switch.

The first flatbed truck additionally needs:

- Two distinct cargo-latch buttons: one for Lock and one for Unlock.

### SR-009 — Connect FlatbedTruck1 to the existing vehicle upgrade system

Status: `Needs user verification`

- Reuse the established saved-score upgrade model and Scrap economy rather than creating a second persistence format.
- Legacy mechanic reference: `prefabs/mechanic-shop-zone-based.brz`.
- Reference documentation: `tools/prefabs/PARTS-SHOP-DISPLAY.md` and `tools/prefabs/MECHANIC-ZONE-STARTUP-TEST.md`.
- Existing catalog format: `VehicleID.Category.DisplayPosition = Name|LeaderboardKey|SavedValue|ScrapPrice`.
- Confirmed FlatbedTruck1 mechanic identifiers: vehicle/ownership key `Truck1Owned`; engine selection leaderboard key `Truck1Engine`.
- Confirmed engine catalog rows:
  - `Truck1Owned.Engine.0 = Stock Shitter|Truck1Engine|0|0`
  - `Truck1Owned.Engine.1 = RedNeck Engine|Truck1Engine|1|2500`
  - `Truck1Owned.Engine.2 = Backyard Engine|Truck1Engine|2|5000`
  - `Truck1Owned.Engine.3 = A Real Engine|Truck1Engine|3|15000`
  - `Truck1Owned.Engine.4 = The Slow Turtle Engine|Truck1Engine|4|10000`
- Populated standalone catalogue map: `outputs/truck1-mechanic-parts-catalog.brz`. It has 28 rows across Engine, FuelTank, Suspension, WheelSpacing, SteerAngle, and SteerTurnSpeed.
- Confirmed Truck1 leaderboard keys: `Truck1Engine`, `Truck1Fueltank`, `Truck1Suspension`, `Truck1Steerangle`, and `Truck1Steerturnspeed`. The new wheel-spacing key is `Truck1Wheelspacing` and must be created with that exact casing.
- The mechanic catalog stores menu order, display name, saved selection ID, and price. It does not store the physical engine values; the truck's engine-profile array resolves the saved ID to Top Speed, Torque, Acceleration, and Eco.
- The existing system handles selection, purchase, and saving the chosen upgrade value.
- Configure the truck to read its saved upgrade values from that system.
- Use each saved value as the correct configuration-array index and apply the selected settings to the truck.
- Match the truck's stat/category keys exactly to the existing upgrade catalog.
- Cover Engine, Fuel Tank, Suspension, Steering Turn Speed, Steering Angle, and Wheel Spacing.
- Extend the current shipped catalog, which presently covers only `CarOwned` Engine/FuelTank and `TruckOwned` Engine/WheelDistance, with the FlatbedTruck1 categories and options.
- Use the exact FlatbedTruck1 ownership ID used by the dealership rather than inventing a second identifier.
- Use safe stock defaults for missing or out-of-range saved values.
- Verify that changing one category updates only that category and only the correct player's truck.

Known verification note: the buffered first-entry zone-binding fix was confirmed in game, then promoted into the clean production mechanic. The clean production prefab itself was not separately re-tested after removing diagnostics, so include one fresh first-entry binding check during integration testing.

- New organized mechanic candidate: `outputs/scrap-runners-mechanic-shop-v1.brz`, paired with `outputs/scrap-runners-truck1-mechanic-enabled-v13.brz` in the existing vehicle spawner.
  - Builds on the supplied blank Mechanic Shop frame. The main board now has one `MECHANIC SHOP CONTROLLER`; inside it, the touching/on-grid logic remains divided into five major labeled groups: `VEHICLE + OWNER`, `INPUT + SELECTION`, `CATALOG CONFIG`, `PURCHASE CORE`, and `DISPLAY + SOUND`. Every functional gate is inside one named subsection and inside the single editable microchip plane.
  - Browsing is deliberately non-live. Category/part changes affect only the two terminal screens; only a successful BUY writes the selected leaderboard score, adjusts `Scrap`, and sends the targeted `SR.Mechanic.Reload` event to apply the saved profile to the locked truck.
  - The runtime catalog contains one vehicle, six categories, and 28 parts, with descriptions, comparison statistics, exact saved values, prices, and an editable trade-in rate clamped to `0..1`. The current trade-in rate is `0.75`.
  - Uses the same simple bay rule as the color terminal: the first live vehicle entering an empty zone remains locked until it leaves. Later vehicles are ignored and must leave/re-enter after the active vehicle departs. The seated user's stable ID must equal the truck owner's stable ID; wrong owner is red and cannot browse or purchase.
  - Purchase re-reads the installed score and Scrap, then revalidates the physical seat occupant, PlayerState, stable owner ID, vehicle, nonce, catalog vehicle/category/selection, and fresh installed score immediately before mutation. Commit order is upgrade score → Scrap adjustment → one-tick barrier → targeted vehicle reload.
  - Legacy, corrupt, missing, or out-of-range saved profiles cannot feed stale array output. The terminal treats an unlisted saved score as stock while retaining the raw score for continuity and allows a valid purchase to repair it; invalid scores receive no trade-in credit. Truck1 v13 independently routes all six Array Get out-of-bounds states through typed stock fallbacks.
  - Truck1 v13 corrects the exact `Truck1Wheelspacing` key, steering-angle/turn-speed arrays, mechanical PlayerState source, and post-purchase reload path while preserving the v12 appearance/owner controllers, physical truck geometry, four wheel entities, and all 33 stored body BrickHandles.
  - Initial in-game testing confirmed the purchase/vehicle flow works, then exposed two presentation/wiring corrections: the five outer subsystem chips were consolidated into the one controller above, and the frame's two cash-register emitters now both play only on success while the beep plays only on failure. Browsing no longer triggers a purchase cash sound.
  - Follow-up presentation correction restores the color terminal's proper browse feedback: Keypad on W/S row selection and Keyboard once per A/D tap. A/D is intentionally tap-only with no held repeat because each category and part list is short. Its edge detectors now read the raw physical direction before the post-edge readiness guard, so the data reload cannot turn one held key into repeated false-to-true transitions. Space uses the same raw-edge/post-authorization pattern so holding it cannot rearm a purchase when a transaction finishes. The selected row is entirely orange with no left arrow and a blinking right `<`; unselected rows retain the preferred visible `</>` ending. `SYSTEM RESPONSE` and long messages now use separate lines so the left panel cannot clip across the right-side statistics.
  - Dedicated regression suites pass for both prefabs. The consolidated terminal is deterministic at 556 bricks/810 wires with one child chip, five major group labels, 28 labeled subsections, zero WireValue mismatches, and strict placement. Truck1 v13 is deterministic at 317 bricks/272 wires with all 33 BrickHandles, six typed safe-profile selectors, and strict placement.
  - No live wheel-spacing or other mechanical preview is included in this version. Add category-specific preview later only if in-game testing shows it is worth the added restore/session complexity.
  - User verification required: replace Truck1 v12 in the existing spawner with v13, place the mechanic terminal with its bay empty, then verify owner/wrong-owner states, all six category purchases, PAY/FREE/RECEIVE trade-in cases, immediate application, exit/respawn persistence, invalid-score stock fallback, vehicle despawn inside the zone, and the documented two-vehicle first-lock behavior.
  - Migration concern to decide before a public release: pre-v13 steering-angle and steering-speed indices overlap some new indices but represented different values. If real player scores already exist, reset/migrate those two leaderboard keys rather than silently reinterpreting them.

### SR-010 — First-vehicle integration and regression pass

Status: `Backlog`

- Confirm all upgrades share one authoritative vehicle identity and cannot cross-control another vehicle.
- Confirm defaults, upgrade prices, ownership, saving/loading, despawn/respawn, and reset behavior.
- Confirm the vehicle remains usable with no upgrades purchased.
- Test two players and two vehicles simultaneously.
- Move to `Needs user verification` and complete the required user review before declaring the first vehicle 100% complete.

## Milestone 2 — First complete job route

Begin only after the first vehicle is confirmed 100% complete.

### SR-011 — Build one proper pickup location

Status: `Backlog`

- Complete visual build and interaction flow.
- Define job/cargo selection, spawn, ownership, and pickup confirmation.
- Prevent another player from taking or corrupting an active pickup.

### SR-012 — Build one proper delivery location

Status: `Backlog`

- Complete visual build and interaction flow.
- Validate the correct cargo, player/job, reward, and cleanup behavior.
- Prevent duplicate payouts and cross-player delivery interference.

### SR-013 — Validate one end-to-end pickup/delivery job

Status: `Backlog`

- Accept a job, collect cargo, deliver it, pay once, and clean up all state.
- Test cancellation, vehicle loss, disconnect, wrong cargo, and simultaneous players.

Load-planning checklist (implementation deliberately undecided):

- Cargo type.
- Required vehicle class.
- Pickup location.
- Destination.
- Pay per stud travelled.
- Stud distance, calculated automatically from the pickup and destination rather than entered on every load.
- Total payout shown to the player.
- Decide whether every cargo object represents one fixed load or whether loads also need an amount, size, or weight.
- Decide whether short trips need a base/minimum payment in addition to distance pay.
- Track whether a load is available, taken, collected, delivered, cancelled, or failed.
- Give each offered/accepted load a unique identity so the game cannot confuse simultaneous loads or pay one twice.
- Optional later concepts: time limit, urgency bonus, fragile/hazardous requirements, route rarity, and reputation requirements. None are required for the first route.

## Milestone 3 — Truck-stop loadboard monitor

### SR-014 — Add a permanent monitor loadboard

Status: `Backlog`

- Put a loadboard monitor in the truck stop.
- Keep the existing `/loadboard` command available.
- Make the command and monitor share the same authoritative data/functions so their contents update together and cannot drift apart.
- Preserve the current instant-update behavior without double-click rollback or visible delay.

## Milestone 4 — Vehicle rollout

### SR-015 — Turn the first completed vehicle into the standard template

Status: `Backlog`

- Document reusable vehicle interfaces, array schemas, upgrade hooks, switches, ownership rules, and tests.
- Use this template to add vehicles down the roster rather than rebuilding their systems independently.

### Current vehicle roster

Names and prices transcribed from the current in-world board. Verify naming before mass rollout.

| Vehicle | Price | Board note |
|---|---:|---|
| Car | Free | WIP |
| Car2 | 5,000 | |
| Car3 | 10,000 | |
| Car4 | 50,000 | |
| Car5 | 100,000 | |
| PickupTruck1 | 5,000 | WIP |
| PickupTruck2 | 7,500 | |
| PickupTruck3 | 10,000 | |
| FlatbedTruck1 | 5,000 | Confirmed first complete vehicle |
| FlatbedTruck2 | 7,500 | |
| FlatbedTruck3 | 10,000 | |
| Boxtruck1 | 10,000 | |
| Boxtruck2 | 25,000 | |
| Boxtruck3 | 100,000 | |
| DumpTruck1 | 7,500 | Number inferred |
| DumpTruck2 | 50,000 | Number inferred |
| DumpTruck3 | 75,000 | Number inferred |
| UsedSemitruck1 | 20,000 | Board appears to repeat this name for three entries |
| UsedSemitruck? | 21,000 | Confirm intended number/name |
| UsedSemitruck? | 22,000 | Confirm intended number/name |
| Semitruck1 | 250,000 | |
| Semitruck2 | 275,000 | |
| Semitruck3 | 300,000 | |
| Racecar1 | 100,000 | |
| Racecar2 | 110,000 | |
| Racecar3 | 120,000 | |
| Racecar4 | 300,000 | |
| Racecar5 | 350,000 | |
| Racecar6 | 400,000 | |

## Expansion backlog

### SR-016 — Add more pickup and delivery locations

Status: `Backlog`

Add locations after the first pickup/delivery pair establishes the reusable standard.

### SR-017 — Dedicated vehicle-selling zone and monitor

Status: `Backlog`

- Sell an owned vehicle through a dedicated monitor interaction.
- Lock the transaction to one player and one vehicle/session.
- Another player rolling a vehicle into the zone must not replace, invalidate, or receive credit for the active vehicle.
- Revalidate ownership and vehicle identity immediately before payment/destruction.
- Ensure failure, disconnect, or cancellation releases the lock safely and cannot duplicate money.

### SR-018 — Vehicle color testing and application workflow

Status: `Backlog`

Candidate approaches:

1. A colorizer zone that previews colors directly on an eligible vehicle.
2. A separate showroom/testing area, followed by purchasing and applying chosen colors elsewhere.
3. A showroom that prints a physical receipt containing the selected color/material configuration; an application monitor consumes and applies it to the player's real vehicle.

Whichever approach is chosen must isolate players/sessions, distinguish preview from ownership, prevent receipt duplication or theft, and define cancellation/reset behavior.

## Open decisions to resolve when relevant

1. Decide what vehicle customization/upgrades must persist across respawn, reconnect, and server restart.
2. Confirm the intended names of the three used semi-trucks.
3. Choose the eventual color-testing/application workflow; this is deliberately not blocking current work.

Persistence boundaries, pricing/unlocks, reset behavior, and multiplayer-isolation checks are proposed safeguards. Confirm their exact scope when their related task becomes active rather than treating every detail above as a locked design decision.

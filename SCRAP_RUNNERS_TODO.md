# Scrap Runners Roadmap

Last updated: 2026-11-17

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

Status: `Backlog`

- Reuse the vehicle upgrade system already built; do not create another upgrade shop.
- Production mechanic prefab: `prefabs/mechanic-shop-zone-based.brz`.
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

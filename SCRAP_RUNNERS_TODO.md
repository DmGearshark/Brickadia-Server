# Scrap Runners Roadmap

Last updated: 2026-11-15

This is the persistent source of truth for Scrap Runners work. Chat memory is not authoritative.

## Completion protocol

Statuses: `Next`, `In progress`, `Needs user verification`, `Blocked`, `Backlog`, `Done`.

- Implementation completion moves a task to `Needs user verification`, not directly to `Done`.
- Before crossing off any task, ask the user whether anything else needs checking or may have been missed.
- At that point, also raise any concern, edge case, or useful follow-up noticed during implementation.
- Only the user's confirmation moves a task to `Done`.
- Record the relevant prefab, downloadable output, and testing notes under the task.

## Current objective

Finish the first fully upgradable and customizable vehicle. Based on the current planning board, this is assumed to be `FlatbedTruck1` until the user confirms otherwise.

## Milestone 1 — First complete vehicle

### SR-001 — Finish and integrate the color customizer

Status: `Next`

- Finish the existing color customizer.
- Connect its Color, Metal Material Toggle, and Material Intensity outputs to the vehicle.
- Ensure changes affect only the intended vehicle and player/session.
- Decide how colors are priced, unlocked, purchased, saved, and reapplied.
- Verify default/reset behavior and vehicle respawn behavior.

Acceptance checks:

- Color, metallic state, and material intensity all apply correctly.
- Previewing a color does not accidentally purchase or permanently apply it.
- One player's customization cannot alter another player's vehicle.
- Customization survives whatever persistence boundary the user chooses.

### SR-002 — Configure an engine from one array entry

Status: `Next`

- Make one array the authoritative engine configuration source.
- Intended shape resembles `Array index 1 = 200 5 0.5`.
- Decide whether each entry is a space-delimited string, a flat numeric layout, or another Brickadia-compatible representation; ordinary nested arrays may not be available.
- Define the exact meaning, order, units, valid ranges, and defaults for each value.
- Apply the selected configuration to every engine property that should change.
- Reject or safely fall back from malformed/missing entries.

Open decision: what do `200`, `5`, and `0.5` each represent?

### SR-003 — Fuel tank upgrade

Status: `Backlog`

- Define capacity tiers and prices.
- Connect capacity to the gas tank and gauge.
- Verify refueling, fuel consumption, empty-tank behavior, and persistence.

### SR-004 — Suspension upgrade

Status: `Backlog`

- Define suspension tier values and prices.
- Apply the chosen tier consistently to every relevant wheel.
- Check stability at minimum and maximum settings.

### SR-005 — Steering turn-speed upgrade

Status: `Backlog`

- Define steering-speed tiers and prices.
- Apply the setting consistently to steering components.
- Check responsiveness without oscillation or snapping.

### SR-006 — Steering-angle upgrade

Status: `Backlog`

- Define steering-angle tiers and prices.
- Verify wheel clearance, turning radius, and behavior at speed.

### SR-007 — Wheel-spacing upgrade

Status: `Blocked`

This appears on the in-world planning board but was not included in the written upgrade list. Confirm whether it remains part of the first vehicle.

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

### SR-009 — Vehicle-upgrade selection and purchase interface

Status: `Backlog`

- Confirm whether the existing upgrade shop/interface will be reused or a vehicle-specific interface is needed.
- Display current tier, next tier, price, and the effect of the upgrade before purchase.
- Apply purchases to the correct owned vehicle and prevent duplicate charges.
- Cover Engine, Fuel Tank, Suspension, Steering Turn Speed, Steering Angle, and Wheel Spacing if that upgrade is confirmed.

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
| FlatbedTruck1 | 5,000 | Assumed first complete vehicle |
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

1. Confirm that `FlatbedTruck1` is the first vehicle to finish.
2. Define the three engine-array values, their units, and how one entry is represented in Brickadia's array.
3. Confirm whether wheel spacing is still an upgrade.
4. Decide what vehicle customization/upgrades must persist across respawn, reconnect, and server restart.
5. Confirm the intended names of the three used semi-trucks.
6. Choose the eventual color-testing/application workflow; this is deliberately not blocking current work.

Persistence boundaries, pricing/unlocks, reset behavior, and multiplayer-isolation checks are proposed safeguards. Confirm their exact scope when their related task becomes active rather than treating every detail above as a locked design decision.

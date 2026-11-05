# Optimized loadboard after native gate experiments

**Superseded by the [spawn/queue repair](LOADBOARD-SPAWN-REPAIR.md):** the original direct remember-to-spawner link was rejected in game as a feedback cycle. The current artifact restores its required buffer and removes idle queue polling. The measurements below describe the earlier model, which did not detect that engine rejection.

Updates the working placement build from commit `46642b013c32431fb13d95063315de88deca6c67`, incorporating the GP1–GP3 findings. The shipped artifact is still `prefabs/loadboard-system.brz`.

## Changes

- **Batched request decoding.** The authority retains the event payload queue, aligned argument arrays, lock and polling guard. It reads all eight queued fields before one shared query-publication wait, then snapshots them together. It no longer spends a separate buffered read cycle on every field.
- **Batched persisted-stat queries.** All nine leaderboard queries execute before a shared publication wait. Their values are then copied into request state together. Query waits remain; these operations are not assumed to behave like pure Function returns.
- **Reusable listing Function.** Five calls share one small nested Function definition that formats an offer's name, reward, requirement and route. Selection parses one selected record instead of building five copies of the selected-field parser. A single packed string input and single string output avoid assumptions about multi-pin ordering. Both input and output defaults are explicitly strings. The Function has no external variable references, annotations or side effects and introduces no per-call tick wait.
- **Shorter UI path.** Button authorization reads the queued character snapshot directly. Redundant waits after ordinary scalar updates, request serial increments and completed reply assignment are removed. The rich five-row client also omits four unused legacy field variables, their setters and three unused detail splits.
- **Shorter command path.** Two waits after ordinary scalar snapshots are removed. Character/transform queries, spawn/result handling and the existing three-tick pre-initialization settling interval are retained.

The nested Function shell sits at local `(880,0,2)` inside the authority chip, clear of its normal gate columns. Its inner grid contains only the entry/no-op flow and pure string/numeric expressions. No rejected annotation components or cross-callable VarRef connections are introduced. The definition is part of the static authority; the spawned client has no new Function chips.

## Preserved behavior and assembly

The source assembly's configuration and all pickup/delivery circuits/wires remain intact. Cargo embeds are byte-identical. The current portable display's geometry, materials, colliders, Fine collision quality, root entity and hidden chip transforms are preserved, including the user's small cosmetic edits. Only its private controller and initial dynamic text/enabled values are rebuilt.

World spawn position remains character location + horizontal forward × 60 + Z 16, with yaw + 180 and no pitch/roll. Caller-only controls, three-minute inactivity expiry, 15-second refresh, confirmation before abandonment, immediate return of the original abandoned offer, stale revision/nonce protection, one active contract, owned-vehicle eligibility, cargo identity/destination checks and duplicate-payment protection remain.

Existing listing kind/availability/revision/override/lifetime/stopwatch values and accepted-offer string snapshots are copied from the previous authority. Transient request queues and command screen references start fresh. Player leaderboard stats are not reset. Opening a new board refreshes the owner lookup for any existing contract/cargo, as before.

## Validation and measured limits

The actual serialized main/client graphs are reread and checked for every endpoint, single-driver wiring and exact microchip links. Checks compare all unchanged station/config/world bricks and wires, exact client geometry/style/physics settings and untouched cargo embeds. Gameplay scenarios cover eligibility, exclusive acceptance, one job, replacement/abandonment, frozen accepted reward/route/rule, stale and duplicate requests, delivery rejection, failed spawning and a single payment/chat receipt. Additional tests exercise 40 queued simultaneous acceptance requests, 160 listing-Function cases and heading-independent placement.

The baseline full client/pickup/delivery integration suite runs in both legacy and optimized modes, including first-entry zone ownership/handoff, owner-only controls, idle deletion policy and repeated `/loadboard` replacement. Query publication is tested with immediate and one-tick results. The optimized graph uses immediate ordinary Var publication, matching the GP2 read experiment, while unknown queries retain buffers. This model is deliberately a limited interpreter, not the game engine.

The reproducible [benchmark report](loadboard-optimization-benchmark.json) compares the same source display/config, normalized listings and a one-tick query-publication model:

| Path | Previous modeled ticks | Optimized modeled ticks |
| --- | ---: | ---: |
| Initialize client to first response | 37 | 17 |
| Scroll click to response | 39 | 15 |
| Accept click to response | 38 | 18 |
| Command to targeted client initialization | 26 | 22 |

Main assembly plus embedded client component count drops from **1,806 to 1,615** (191 fewer). Counts exclude the two unchanged cargo embeds. These modeled ticks are not measured in-game milliseconds; normal polling, asynchronous event delivery, network/replication and prefab initialization still take time. This exact optimized assembly needs an in-game paste/interaction check.

## Use and reproduction

Replace the previous central assembly with **one** updated copy, remove previously spawned loadboards and run `/loadboard`. Exercise scrolling, accept/confirmed abandon, pickup and delivery. The existing loadboard event protocol and saved-stat keys are unchanged.

Reproduce against the previous working artifact, not an already optimized file:

```sh
git show 46642b013c32431fb13d95063315de88deca6c67:prefabs/loadboard-system.brz > /tmp/loadboard-before-optimization.brz
node --max-old-space-size=512 tools/prefabs/optimize-loadboard.cjs /tmp/loadboard-before-optimization.brz prefabs/loadboard-system.brz
node --max-old-space-size=512 tools/prefabs/benchmark-loadboard.cjs /tmp/loadboard-before-optimization.brz tools/prefabs/loadboard-optimization-benchmark.json
```

The optimizer refuses unexpected module boundary wiring, missing current display roles, mismatched source-state layout and absent collision/Fine prerequisites. It targets this working loadboard version rather than claiming to rewrite arbitrary uploaded prefabs. The older v5 full-system builder remains an integration fixture; do not overwrite this current display by shipping a fresh v5 build.

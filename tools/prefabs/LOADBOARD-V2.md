# Five-row loadboard and returned offers

Built from the user’s **Update Needed..brz**. The command-spawned client copies its new case, five name rows, five adjacent information displays and bottom controls. Each row shows its own reward, vehicle requirement, pickup and destination. The center remains the selected offer. The existing configuration, station circuits, cargo embeds and unrelated wires are preserved.

Abandoning immediately invalidates the contract/cargo, then restores the same accepted offer to its original listing slot. It preserves the accepted reward, route and qualifying-vehicle rule even if the catalogue changed meanwhile. The listing gets a new revision and a fresh configurable lifetime; queued timer expiries and stale acceptance requests cannot overwrite/claim that revision. Other open boards refresh within their normal 15-second interval. A repeated abandonment cannot create another offer.

If the original slot has rotated since acceptance, returning the old offer replaces that slot’s current listing. Any job already accepted from that slot remains a separate contract and is unaffected. There is no abandoned-offer queue. Completion still leaves a listing taken until its ordinary rotation.

Full accepted catalogue records are cached on the authority, with numeric reward/route/rule/listing fields also saved as player stats. For older contracts or after a server replacement that loses the cache, a returned record is reconstructed from those saved numbers and current catalogue labels; original text labels cannot be recovered if the catalogue was edited after the cache was lost. Older contracts without a saved slot return to slot one.

The two noted command gates are moved inside their connected command chip, keeping their relative spacing. The cargo pad’s Get Own Transform remains outside as its physical world-position anchor. The three instruction-note components are removed. The portable logic chip remains at (40,0,0), clear of the case, retaining the placement previously confirmed in game.

Replace the previous central assembly with one copy of `prefabs/loadboard-system.brz`, remove old spawned screens and run `/loadboard`. Enable persistence for `LoadboardListing` and `LoadboardRule` alongside the existing loadboard stats, or use Persist All Player Stats.

Reproduce from the supplied upload:

```sh
node tools/prefabs/update-loadboard-v2.cjs 'Update Needed..brz' prefabs/loadboard-system.brz
```

The updater runs exact serialization/wire-preservation checks and graph execution tests covering immediate return, unchanged accepted reward/route/rule, abandoned-cargo rejection, other-player contract isolation, stale/duplicate requests, stale timers and all five client detail displays. The baseline integration suite also passes. These are offline checks; this revision still needs an in-game paste and interaction check.

`loadboard-v1-row-layout.json` records the previous server’s listing-state gate positions so the updater can retain the uploaded listing values and stopwatch state while replacing its authority circuit. The update refuses unexpected external authority wiring.

Portable requests identify the rich row format with station field `Board:2`; legacy board requests retain names-only replies, and station reply fields remain compatible.

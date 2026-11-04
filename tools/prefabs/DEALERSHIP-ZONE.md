# Zone-based dealership

`prefabs/vehicle-dealership-zone-based.brz` converts the user's `Make this Zone based.brz` setup to zone ownership using the zone projector already present in the upload. Its geometry, detection distance, visual layout, catalogue and purchase/sale logic are retained.

- Enter the zone to bind automatically.
- The first player in retains control. Additional occupants wait and cannot take over or operate that player's controls.
- Leave to unbind. A waiting occupant takes over automatically; an empty zone leaves the PC unbound with its existing idle-display behavior and red indicator.
- If the owner leaves during processing, their controls are disabled immediately. Their bound reference remains until the current transaction finishes, then the PC unbinds or hands off.
- There is no inactivity timeout while remaining inside the zone. The old clock/expiry path and the manual-bind interaction are removed; the old key's physical backing remains.

The controller listens to Character Entered/Left events from the existing Attached Zone's ZoneRef, tracks unique character references in a per-PC queue, and reconciles ownership after one tick. Zone changes while busy are reconsidered on the busy flag's falling edge. Duplicate entry, non-owner exit, re-entry during a transaction and stale/null occupants are handled. Three public control signals additionally require the owner to remain inside the zone. Manual binding cannot bypass zone ownership.

Rebuild and run checks:

```sh
node tools/prefabs/zone-bind-dealership.cjs '/path/to/Make this Zone based.brz' prefabs/vehicle-dealership-zone-based.brz
```

Offline tests execute the new zone controller, with the pre-existing shop binding pipeline treated as its interface. Tests cover ownership retention and handoff, busy deferral, immediate control blocking, re-entry, simultaneous arrivals, null occupants and remaining bound beyond the former timer period. They replay the zone controller using saved component data, verify all 582 wire endpoints against the intended graph, preserve catalogue maps and original geometry, and confirm removal of the old clock/manual button. The generated controller adds 41 gates and removes nine old timer gates. In-game zone event delivery and detection coverage still need validation.

# Loadboard authority organization

`prefabs/loadboard-system-complete-organized.brz` preserves the supplied
complete loadboard system and reorganizes only its 1,036-gate central authority
chip. Gates are placed on labeled backing panels for request intake, queues,
shared state, player cache/data, cargo identity, browse, accept, abandon,
pickup, cargo stamping, delivery, rotation, catalogue validation, listing
formatting, and replies.

The authority footprint changes from approximately 4,917 by 3,029 logic units
to 1,125 by 1,345. Thirty-four presentation bricks are added: one backing and
one label for each of 17 sections. The physical world, command chip,
configuration menus, pickup and delivery stations, embedded portable board,
cargo prefabs, component settings, wire endpoints, and microchip links are
retained.

The organizer verifies that all non-authority bricks remain byte-equivalent in
the in-memory scene, all original authority component data remains unchanged,
and the complete wire/link arrays remain identical before serialization. It
then rereads the result and checks brick, wire, link, external-asset, and
embedded-prefab preservation. The placement validator reports no invalid,
confirmed-overlap, or uncertain-overlap pairs.

Run with:

```sh
node tools/prefabs/organize-loadboard-authority.cjs input.brz output.brz
node tools/prefabs/test-organize-loadboard-authority.cjs input.brz
```

# Loadboard dead-gate cleanup

`prefabs/loadboard-system-complete-organized-pruned.brz` starts from the
user-returned organized system and removes six proven-unused gates.

- The main-grid `Get Own Transform` had no Location or Rotation consumers. Its
  only path was `Buffer Ticks -> Get Own Transform -> Buffer Ticks`, so the two
  buffers are now connected directly and retain the intended timing.
- Three terminal String Split gates had no consumers.
- One unused Select and the comparison that exclusively fed it were removed.

The cleanup iteratively removes only single-component pure expression gates
with no outgoing wires. It does not remove state-changing gates merely because
they lack a value output. In particular, all three `Map Get Keys` gates remain:
they populate their attached arrays through `ArrayVarRef`, and the following
length checks consume those arrays.

The result retains every other brick/component verbatim, every embedded
prefab, every external asset, and all microchip links. Brick count falls by six
and wire count falls by six. Strict placement validation passes.

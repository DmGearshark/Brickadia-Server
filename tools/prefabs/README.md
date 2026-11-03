# Prefab generator

## User's labeled display

To generate the selector inside the supplied nine-brick layout:

```sh
npm ci
node wire-reference.cjs references/display-reference.brz ../../prefabs/display-reference-wired.brz
```

This version uses the existing Scroll Up, Scroll Down, and Select buttons,
replaces Name 1–5 with the five live names, and feeds the selected-name display
from the latched string variable. It preserves the original nine bricks and
their appearance, external sound/font assets, component settings (except
placeholder text), and prefab paste metadata. Thirty logic bricks are placed
behind the display. The original thumbnail still shows the reference labels.

Validation rereads all geometry and original component data, checks all 38
wires and 42 components, and runs the same 10,125 expression checks. The in-game
acceptance checks below still apply; runtime behavior remains unverified.

Requires Node.js 22.15 or newer. From this directory:

```sh
npm ci
node scroll-selector.cjs ../../prefabs/scrolling-name-selector.brz
```

The generator creates an upright, static panel facing negative Y. The top and
bottom buttons scroll through 20 sample names. The highlighted middle row is
the current candidate. Select copies its text into a string variable that
feeds the display on the right. The initial middle name is Casey; the selected
display starts at `(none)`. State is shared by players using the panel.

Up/down press counts feed subtraction, then each row applies an offset and
floored modulo 20. Names are stored as fixed-width, eight-character strings;
substring and trim gates retrieve each row. Select uses a rising-edge execution
gate and a variable setter. Logic bricks are accessible behind the panel.

The generator checks port directions, serializes and rereads the archive,
checks component/wire counts, and evaluates its expression graph against
10,125 expected row results. These checks do not emulate Brickadia's runtime.

## In-game acceptance check (pending)

1. Import and paste `prefabs/scrolling-name-selector.brz`.
2. Approach the front: initially Avery, Blake, Casey, Dakota, Emery should show.
3. Click Down once: the middle row should become Dakota.
4. Click Up once: the middle row should return to Casey.
5. Click Select: the right display should show Casey.
6. Scroll further: the right display should stay Casey until Select is clicked.
7. Scroll through both ends: Taylor and Avery should wrap correctly.
8. Hold a scroll button: verify whether PressCount increments once per press.

Text face, font sizing, native press-count behavior, string wire conversion,
and the execution edge still require confirmation in the game. Report the
first step that differs, ideally with a screenshot of the panel and wiring.

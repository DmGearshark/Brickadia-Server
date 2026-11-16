'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const build = require('./build-configurable-color-customizer.cjs');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

function components(scene, type, grid) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type && (grid === undefined || brick.g === grid))
    .map(comp => ({ brick, comp })));
}

function incoming(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.z === brick.key && edge.zt === type && edge.q === port);
}

function outgoing(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.a === brick.key && edge.at === type && edge.p === port);
}

function test(input) {
  const result = build(input);
  assert(result.placement.strictOk);
  const scene = read(result.bytes);

  assert.equal(scene.links.length, 2, 'outer and nested microchip links');
  const outerLink = scene.links.find(link => {
    const brick = scene.bricks.find(candidate => candidate.key === link.key);
    return brick?.g === 1;
  });
  assert(outerLink, 'outer chip link');
  const mainGrid = outerLink.grid;
  const nestedLink = scene.links.find(link => {
    const brick = scene.bricks.find(candidate => candidate.key === link.key);
    return brick?.g === mainGrid;
  });
  assert(nestedLink, 'nested chip physically lives inside outer chip');
  const innerGrid = nestedLink.grid;

  assert.equal(components(scene, C.Microchip.NAME, mainGrid).length, 1, 'one hidden-logic chip on main grid');
  assert.equal(components(scene, C.Expr_String_FormatText.NAME, mainGrid).length, 7, 'five live rows, hex row, and master format are editable');
  assert.equal(components(scene, C.OneShotAudioReference.NAME, mainGrid).length, 3, 'three editable live-interaction sound references');
  assert.equal(components(scene, C.Var.NAME, mainGrid).length, 4, 'repeat interval plus three sound volume vars');
  assert.equal(components(scene, C.Expr_String_FormatText.NAME, innerGrid).length, 0, 'no format gates hidden');
  const annotatedTypes = [C.Var.NAME, C.OneShotAudioReference.NAME, C.Expr_String_FormatText.NAME];
  for (const brick of scene.bricks.filter(candidate => candidate.g === mainGrid
    && candidate.comps.some(comp => annotatedTypes.includes(comp.type)))) {
    assert(brick.comps.some(comp => comp.type === C.Interact.NAME), `editable control ${brick.key} has an Interact label`);
  }
  const interactionLabels = components(scene, C.Interact.NAME, mainGrid)
    .map(({ comp }) => comp.data.PromptCustomLabel);
  for (const expected of [
    'Held-repeat interval',
    'Select sound', 'Select sound volume',
    'Tap sound', 'Tap sound volume',
    'Repeat sound', 'Repeat sound volume',
    'Hue row format', 'Material row format', 'Intensity row format', 'Hex row format', 'Complete menu format',
    'Hidden color logic',
  ]) assert(interactionLabels.includes(expected), `Interact label: ${expected}`);

  const outerOutputs = components(scene, C.MicrochipOutput.NAME, mainGrid);
  assert.deepEqual(outerOutputs.map(({ comp }) => comp.data.PortLabel), [
    'Color', 'Material', 'Material Intensity',
  ]);
  assert.deepEqual(outerOutputs.map(({ comp }) => comp.data.PortOrder), [1, 2, 3]);
  assert.equal(outerOutputs[1].comp.data.CallableDefault.$variant, 'f64', 'Material output is numeric, not a bool toggle');

  const innerInputs = components(scene, C.MicrochipInput.NAME, innerGrid);
  assert.deepEqual(innerInputs.map(({ comp }) => comp.data.PortLabel), [
    'Character', 'Repeat Interval',
    'Select Sound', 'Select Volume',
    'Tap Sound', 'Tap Volume',
    'Repeat Sound', 'Repeat Volume',
  ]);
  assert.equal(components(scene, C.MicrochipOutput.NAME, innerGrid).length, 3);

  const formats = components(scene, C.Expr_String_FormatText.NAME, mainGrid).map(({ comp }) => comp.data.FormatString);
  assert(formats.some(format => format.includes('MATERIAL')));
  assert(formats.some(format => format.includes('CURRENT HEX')));
  assert(formats.some(format => format.includes('INTENSITY')));
  assert(formats.some(format => format.includes('W/S SELECT') && format.includes('C ENTER HEX')));
  assert(!formats.some(format => /APPLY|SPACE/i.test(format)), 'no dead Apply/Space text remains');

  // C -> seated PlayerState -> modal hex entry.
  const splitter = components(scene, C.InputSplitter.NAME, innerGrid);
  assert.equal(splitter.length, 1);
  const cWire = outgoing(scene, splitter[0].brick, C.InputSplitter.NAME, 'bPressedC');
  assert.equal(cWire.length, 1, 'C has one dedicated edge-detector path');
  assert.equal(outgoing(scene, splitter[0].brick, C.InputSplitter.NAME, 'InputUp').length, 0, 'Space has no dead Apply path');
  const cTarget = scene.bricks.find(brick => brick.key === cWire[0].z);
  assert(cTarget.comps.some(comp => comp.type === C.Expr_EdgeDetectorExec.NAME));

  const playerLookups = components(scene, C.Exec_PlayerState_GetFromEntity.NAME, innerGrid);
  const textBoxes = components(scene, C.Exec_PlayerState_ShowTextInputBox.NAME, innerGrid);
  assert.equal(playerLookups.length, 2, 'one lookup opens the dialog and one rechecks the current sitter');
  assert.equal(textBoxes.length, 1);
  assert.equal(textBoxes[0].comp.data.Title, 'ENTER HEX COLOR');
  assert(/6 RGB digits/.test(textBoxes[0].comp.data.Message));
  assert.equal(incoming(scene, textBoxes[0].brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'Exec').length, 1);
  assert.equal(incoming(scene, textBoxes[0].brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'PlayerState').length, 1);
  assert.equal(outgoing(scene, textBoxes[0].brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'OkClicked').length, 1, 'only OK applies');
  assert.equal(outgoing(scene, textBoxes[0].brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'Declined').length, 0, 'cancel is a no-op');

  const makeHex = components(scene, C.Expr_MakeColorHex.NAME, innerGrid);
  const colorConvert = components(scene, C.Expr_ColorConvert.NAME, innerGrid);
  const splitColor = components(scene, C.Expr_SplitColor.NAME, innerGrid);
  assert.equal(makeHex.length, 1);
  assert.equal(colorConvert.length, 1);
  assert.equal(splitColor.length, 1);
  assert.equal(colorConvert[0].comp.data.FromSpace, 0, 'hex color is Linear');
  assert.equal(colorConvert[0].comp.data.ToSpace, 3, 'hex color converts to HSV');
  assert.equal(incoming(scene, makeHex[0].brick, C.Expr_MakeColorHex.NAME, 'Hex').length, 1);
  assert.equal(incoming(scene, colorConvert[0].brick, C.Expr_ColorConvert.NAME, 'Input')[0].a, makeHex[0].brick.key);
  assert.equal(incoming(scene, splitColor[0].brick, C.Expr_SplitColor.NAME, 'Input')[0].a, colorConvert[0].brick.key);

  const allowedCharacters = components(scene, C.Expr_String_Contains.NAME, innerGrid)
    .filter(({ comp }) => comp.data.Input === '0123456789ABCDEF');
  assert.equal(allowedCharacters.length, 6, 'all six RGB digits are validated');
  const lengths = components(scene, C.Expr_String_Length.NAME, innerGrid);
  assert.equal(lengths.length, 1, 'normalized input has an exact-length check');
  assert.equal(components(scene, C.Exec_PlayerState_ShowStatusMessage.NAME, innerGrid).length, 1, 'invalid input reports an error');

  const colorToHex = components(scene, C.Expr_ColorToHex.NAME, innerGrid);
  assert.equal(colorToHex.length, 1, 'current color is converted back to hex');
  const hexFormat = components(scene, C.Expr_String_FormatText.NAME, mainGrid)
    .find(({ comp }) => comp.data.FormatString.includes('CURRENT HEX'));
  const masterFormat = components(scene, C.Expr_String_FormatText.NAME, mainGrid)
    .find(({ comp }) => comp.data.FormatString.includes('C ENTER HEX'));
  assert(hexFormat && masterFormat);
  assert.equal(incoming(scene, hexFormat.brick, C.Expr_String_FormatText.NAME, 'InputA').length, 1);
  assert.equal(incoming(scene, masterFormat.brick, C.Expr_String_FormatText.NAME, 'InputG')[0].a, hexFormat.brick.key);

  // Material is the exact EBrickMaterial range 0..5 and wraps in both directions.
  const materialNames = new Set();
  for (const { comp } of components(scene, C.Expr_Select.NAME, innerGrid)) {
    for (const value of [comp.data.InputA, comp.data.InputB]) {
      if (value?.$variant === 'str') materialNames.add(value.value);
    }
  }
  for (const name of ['PLASTIC', 'GLASS', 'TRANSLUCENT PLASTIC', 'GLOW', 'METAL', 'HOLOGRAM']) {
    assert(materialNames.has(name), `material name ${name}`);
  }
  const moduloSix = components(scene, C.Expr_MathModuloFloored.NAME, innerGrid)
    .filter(({ comp }) => comp.data.InputB?.value === 6);
  assert.equal(moduloSix.length, 2, 'material left/right wrap through all six materials');
  const moduloFive = components(scene, C.Expr_MathModuloFloored.NAME, innerGrid)
    .filter(({ comp }) => comp.data.InputB?.value === 5);
  assert.equal(moduloFive.length, 2, 'W/S navigation wraps through five live controls');

  const clocks = components(scene, C.Clock.NAME, innerGrid).map(({ comp }) => comp.data.IntervalSeconds).sort((a, b) => a - b);
  assert.deepEqual(clocks, [0.025, 0.025, 0.75, 0.75]);
  const repeatInput = innerInputs.find(({ comp }) => comp.data.PortLabel === 'Repeat Interval');
  assert(repeatInput);
  const repeatDrivenClocks = components(scene, C.Clock.NAME, innerGrid)
    .filter(({ brick }) => incoming(scene, brick, C.Clock.NAME, 'IntervalSeconds')
      .some(edge => edge.a === repeatInput.brick.key && edge.p === 'RER_Output'));
  assert.equal(repeatDrivenClocks.length, 2, 'both repeat clocks use editable repeat interval');

  const emitters = components(scene, C.OneShotAudioEmitter.NAME, innerGrid);
  assert.equal(emitters.length, 3);
  for (const { brick } of emitters) {
    assert.equal(incoming(scene, brick, C.OneShotAudioEmitter.NAME, 'AudioDescriptor').length, 1);
    assert.equal(incoming(scene, brick, C.OneShotAudioEmitter.NAME, 'VolumeMultiplier').length, 1);
  }

  const changer = components(scene, C.BrickPropertyChanger.NAME)[0];
  assert(changer);
  for (const port of ['Color', 'Material', 'MaterialAlpha']) {
    assert.equal(incoming(scene, changer.brick, C.BrickPropertyChanger.NAME, port).length, 1, `preview changer ${port}`);
  }
  const preview = components(scene, C.TextDisplay.NAME).find(({ comp }) => comp.data.Text === '■');
  assert(preview);
  assert.equal(incoming(scene, preview.brick, C.TextDisplay.NAME, 'Color').length, 1, 'red/green occupancy indicator Color');
  assert.equal(incoming(scene, preview.brick, C.TextDisplay.NAME, 'Material').length, 0, 'brick material enum is not incorrectly wired to text material enum');
  assert.equal(incoming(scene, preview.brick, C.TextDisplay.NAME, 'MaterialSlider').length, 0, 'occupancy indicator is not the physical preview');
  const occupancyEdge = incoming(scene, preview.brick, C.TextDisplay.NAME, 'Color')[0];
  const occupancySelect = scene.bricks.find(brick => brick.key === occupancyEdge.a);
  const occupancyData = occupancySelect.comps.find(comp => comp.type === C.Expr_Select.NAME)?.data;
  assert.deepEqual(occupancyData?.InputA?.value, { R: 1, G: 0, B: 0, A: 1 });
  assert.deepEqual(occupancyData?.InputB?.value, { R: 0, G: 1, B: 0, A: 1 });
  const occupancyDriver = incoming(scene, occupancySelect, C.Expr_Select.NAME, 'bSelectB')[0];
  assert.equal(occupancyDriver.p, 'bIsOccupied');
  assert.equal(occupancyDriver.at, C.Seat.NAME);

  const screen = components(scene, C.TextDisplay.NAME)
    .find(({ comp }) => /COLOR CUSTOMIZER/.test(comp.data.Text));
  assert(screen);
  assert.equal(incoming(scene, screen.brick, C.TextDisplay.NAME, 'bEnabled').length, 1, 'seat occupancy still gates the public screen');
  assert(screen.comp.data.Text.includes('CURRENT HEX'));
  assert(screen.comp.data.Text.includes('C ENTER HEX'));
  assert(!/APPLY|SPACE/i.test(screen.comp.data.Text), 'screen contains no dead Apply control');
  const enabledEdge = incoming(scene, screen.brick, C.TextDisplay.NAME, 'bEnabled')[0];
  const enabledRerouter = scene.bricks.find(brick => brick.key === enabledEdge.a);
  const enabledSource = incoming(scene, enabledRerouter, enabledEdge.at, 'RER_Input')[0];
  assert.equal(enabledSource.at, C.Seat.NAME);
  assert.equal(enabledSource.p, 'bIsOccupied');

  const rounds = components(scene, C.Expr_Round.NAME, innerGrid);
  assert.equal(rounds.length, 4, 'three rounded row displays plus exact byte rounding');
  const intensityRound = rounds.find(({ brick }) => {
    const edge = incoming(scene, brick, C.Expr_Round.NAME, 'Input')[0];
    const source = scene.bricks.find(candidate => candidate.key === edge?.a)
      ?.comps.find(comp => comp.type === C.Expr_MathMultiply.NAME);
    return source?.data.InputB?.value === 25.5;
  });
  assert(intensityRound, 'material intensity rounding gate');
  const scaledEdge = incoming(scene, intensityRound.brick, C.Expr_Round.NAME, 'Input')[0];
  const scaleBrick = scene.bricks.find(brick => brick.key === scaledEdge.a);
  const scale = scaleBrick.comps.find(comp => comp.type === C.Expr_MathMultiply.NAME);
  assert.equal(scale.data.InputB.value, 25.5, 'level maps to byte using ×25.5');
  assert.deepEqual(Array.from({ length: 11 }, (_, level) => Math.round(level * 25.5)), [
    0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255,
  ]);

  assert(scene.bricks.every(brick => brick.data.owner_index === 0), 'all bricks are public-owned');
  assert(!scene.bricks.some(brick => brick.comps.some(comp => /Leaderboard/i.test(comp.type))), 'no player-stat dependency');
  assert(!scene.bricks.some(brick => brick.comps.some(comp => /(?:truck|car|vehicle)/i.test(JSON.stringify(comp.data)))), 'no vehicle-specific configuration');

  const tempPath = path.join(os.tmpdir(), `color-customizer-idempotence-${process.pid}.brz`);
  fs.writeFileSync(tempPath, result.bytes);
  try {
    const rebuilt = build(tempPath);
    assert(Buffer.from(result.bytes).equals(Buffer.from(rebuilt.bytes)), 'rebuilding an upgraded two-chip prefab is byte-identical');
  } finally {
    fs.unlinkSync(tempPath);
  }

  return { result, scene, mainGrid, innerGrid };
}

module.exports = test;

if (require.main === module) {
  const input = process.argv[2];
  assert(input, 'Usage: node test-configurable-color-customizer.cjs input.brz');
  const checked = test(input);
  console.log(JSON.stringify({
    ok: true,
    mainGrid: checked.mainGrid,
    innerGrid: checked.innerGrid,
    bricks: checked.scene.bricks.length,
    wires: checked.scene.edges.length,
    strictPlacement: checked.result.placement.strictOk,
  }, null, 2));
}

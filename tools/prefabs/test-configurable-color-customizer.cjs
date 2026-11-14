'use strict';

const fs = require('fs');
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
  assert.equal(components(scene, C.Expr_String_FormatText.NAME, mainGrid).length, 7, 'all seven editable format gates on main grid');
  assert.equal(components(scene, C.OneShotAudioReference.NAME, mainGrid).length, 4, 'four editable sound references');
  assert.equal(components(scene, C.Var.NAME, mainGrid).length, 5, 'repeat interval plus four sound volume vars');
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
    'Apply sound', 'Apply sound volume',
    'Select sound', 'Select sound volume',
    'Tap sound', 'Tap sound volume',
    'Repeat sound', 'Repeat sound volume',
    'Hue row format', 'Metal row format', 'Intensity row format', 'Complete menu format',
    'Hidden color logic',
  ]) assert(interactionLabels.includes(expected), `Interact label: ${expected}`);

  const outerOutputs = components(scene, C.MicrochipOutput.NAME, mainGrid);
  assert.deepEqual(outerOutputs.map(({ comp }) => comp.data.PortLabel), [
    'Color', 'Metal Material Toggle', 'Material Intensity',
  ]);
  assert.deepEqual(outerOutputs.map(({ comp }) => comp.data.PortOrder), [1, 2, 3]);

  const innerInputs = components(scene, C.MicrochipInput.NAME, innerGrid);
  assert.deepEqual(innerInputs.map(({ comp }) => comp.data.PortLabel), [
    'Character', 'Repeat Interval',
    'Apply Sound', 'Apply Volume',
    'Select Sound', 'Select Volume',
    'Tap Sound', 'Tap Volume',
    'Repeat Sound', 'Repeat Volume',
  ]);
  assert.equal(components(scene, C.MicrochipOutput.NAME, innerGrid).length, 3);

  const formats = components(scene, C.Expr_String_FormatText.NAME, mainGrid).map(({ comp }) => comp.data.FormatString);
  assert(formats.some(format => format.includes('METAL')));
  assert(formats.some(format => format.includes('INTENSITY')));
  assert(formats.some(format => format.includes('W/S SELECT')));

  const clocks = components(scene, C.Clock.NAME, innerGrid).map(({ comp }) => comp.data.IntervalSeconds).sort((a, b) => a - b);
  assert.deepEqual(clocks, [0.025, 0.025, 0.75, 0.75]);
  const repeatInput = innerInputs.find(({ comp }) => comp.data.PortLabel === 'Repeat Interval');
  assert(repeatInput);
  const repeatDrivenClocks = components(scene, C.Clock.NAME, innerGrid)
    .filter(({ brick }) => incoming(scene, brick, C.Clock.NAME, 'IntervalSeconds')
      .some(edge => edge.a === repeatInput.brick.key && edge.p === 'RER_Output'));
  assert.equal(repeatDrivenClocks.length, 2, 'both repeat clocks use editable repeat interval');

  const emitters = components(scene, C.OneShotAudioEmitter.NAME, innerGrid);
  assert.equal(emitters.length, 4);
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
  for (const port of ['Color', 'Material', 'MaterialSlider']) {
    assert.equal(incoming(scene, preview.brick, C.TextDisplay.NAME, port).length, 1, `preview display ${port}`);
  }

  const rounds = components(scene, C.Expr_Round.NAME, innerGrid);
  assert.equal(rounds.length, 1, 'one exact byte-rounding gate');
  const scaledEdge = incoming(scene, rounds[0].brick, C.Expr_Round.NAME, 'Input')[0];
  const scaleBrick = scene.bricks.find(brick => brick.key === scaledEdge.a);
  const scale = scaleBrick.comps.find(comp => comp.type === C.Expr_MathMultiply.NAME);
  assert.equal(scale.data.InputB.value, 25.5, 'level maps to byte using ×25.5');
  assert.deepEqual(Array.from({ length: 11 }, (_, level) => Math.round(level * 25.5)), [
    0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255,
  ]);

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

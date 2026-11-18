'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');
const build = require('./build-scrap-runners-color-terminal-v7.cjs');

const DEFAULT_INPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz');
const DEFAULT_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v7.brz');
const clone = value => structuredClone(value);

function componentSignature(brick) {
  return brick.comps.map(item => item.type).sort().join('|');
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return [5, 5, 2];
}

function overlaps(first, second) {
  const a = halfSize(first);
  const b = halfSize(second);
  return [0, 1, 2].every(axis => Math.abs(first.data.position[axis] - second.data.position[axis]) < a[axis] + b[axis]);
}

function assertOwner(before, after) {
  const source = before.r.owners();
  const index = source.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Source owner');
  const id = brdb.guidToUuid(source.UserIds[index]).toLowerCase();
  const output = after.r.owners();
  const outputIndex = output.UserIds.map(brdb.guidToUuid).map(value => value.toLowerCase()).indexOf(id);
  assert(outputIndex >= 0, 'Source owner ID preserved');
  assert.equal(output.UserNames[outputIndex], source.UserNames[index]);
  assert.equal(output.DisplayNames[outputIndex], source.DisplayNames[index]);
  for (const grid of after.r.gridIds()) for (const chunk of after.r.brickChunkIndex(grid)) {
    const soa = after.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(ownerIndex => ownerIndex === outputIndex), `Grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(ownerIndex => ownerIndex === outputIndex), `Grid ${grid} original owner`);
  }
}

function assertIntegrity(scene) {
  const keys = new Set(scene.bricks.map(brick => brick.key));
  const targets = new Set();
  for (const edge of scene.edges) {
    assert(keys.has(edge.a), `Dangling source ${edge.a}`);
    assert(keys.has(edge.z), `Dangling target ${edge.z}`);
    const target = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(target), `Duplicate driver ${target}`);
    targets.add(target);
  }
  for (const link of scene.links) assert(keys.has(link.key), `Dangling link ${link.key}`);
  for (const joint of scene.joints || []) assert(keys.has(joint.key), `Dangling joint ${joint.key}`);
}

function sortedJson(values) {
  return values.map(value => JSON.stringify(value)).sort();
}

function canonicalEntities(scene, movableGrids) {
  return [...scene.r.entities()].map(entity => {
    const result = clone(entity);
    if (movableGrids.has(entity.persistentIndex)) {
      delete result.data.PlaneCenter;
      delete result.data.PlaneExtent;
    }
    return result;
  });
}

function test({ input = DEFAULT_INPUT, output = DEFAULT_OUTPUT } = {}) {
  const source = read(fs.readFileSync(input));
  const terminal = read(fs.readFileSync(output));
  const context = build(input, output);
  const movableGrids = new Set(Object.values(context.grids));
  assertOwner(source, terminal);
  assertIntegrity(terminal);
  assert.deepEqual(terminal.r.externalAssets(), source.r.externalAssets(), 'External assets changed');
  assert.deepEqual(terminal.r.prefabJson(), source.r.prefabJson(), 'Prefab metadata changed');

  const outputByGrid = new Map(terminal.r.gridIds().map(grid => [grid,
    terminal.bricks.filter(brick => brick.g === grid)]));
  const sourceToOutput = new Map();
  const outputToSource = new Map();
  for (const sourceBrick of source.bricks) {
    const expectedPosition = context.plannedPositions.get(sourceBrick.key) || sourceBrick.data.position;
    const candidates = (outputByGrid.get(sourceBrick.g) || []).filter(brick =>
      brick.data.position.join(',') === expectedPosition.join(',')
      && brick.data.asset === sourceBrick.data.asset
      && componentSignature(brick) === componentSignature(sourceBrick));
    assert.equal(candidates.length, 1,
      `Map source brick ${sourceBrick.key} at grid ${sourceBrick.g} / ${expectedPosition.join(',')}`);
    const outputBrick = candidates[0];
    assert(!outputToSource.has(outputBrick.key), `Output brick mapped twice: ${outputBrick.key}`);
    sourceToOutput.set(sourceBrick.key, outputBrick.key);
    outputToSource.set(outputBrick.key, sourceBrick.key);

    const expectedData = clone(sourceBrick.data);
    const actualData = clone(outputBrick.data);
    if (movableGrids.has(sourceBrick.g)) {
      delete expectedData.position;
      delete expectedData.color;
      delete actualData.position;
      delete actualData.color;
    }
    assert.deepEqual(actualData, expectedData, `Unexpected brick-data change: ${sourceBrick.key}`);

    const expectedComponents = clone(sourceBrick.comps);
    if (context.markerKeys.has(sourceBrick.key)) {
      const select = expectedComponents.find(item => item.type === C.Expr_Select.NAME);
      if (select.data.InputB.value === '<color="ff8700">> ') select.data.InputB.value = '> <color="ff8700">';
      else if (select.data.InputB.value === ' <</>') select.data.InputB.value = '</> <';
      else assert.fail(`Unexpected marker source on ${sourceBrick.key}`);
    }
    if (context.annotationKeys.has(sourceBrick.key)) {
      const expectedInteract = expectedComponents.find(item => item.type === C.Interact.NAME);
      const actualInteract = outputBrick.comps.find(item => item.type === C.Interact.NAME);
      expectedInteract.data.Message = actualInteract.data.Message;
    }
    assert.deepEqual(outputBrick.comps, expectedComponents, `Unexpected component change: ${sourceBrick.key}`);
  }
  assert.equal(sourceToOutput.size, source.bricks.length, 'Every source brick mapped');

  const canonicalSourceEdges = sortedJson(source.edges.map(edge => [edge.a, edge.at, edge.p, edge.z, edge.zt, edge.q]));
  const canonicalOutputEdges = sortedJson(terminal.edges.map(edge => {
    assert(outputToSource.has(edge.a), `Added label or unknown brick drives a wire: ${edge.a}`);
    assert(outputToSource.has(edge.z), `Added label or unknown brick receives a wire: ${edge.z}`);
    return [outputToSource.get(edge.a), edge.at, edge.p, outputToSource.get(edge.z), edge.zt, edge.q];
  }));
  assert.deepEqual(canonicalOutputEdges, canonicalSourceEdges, 'Wire topology changed');

  const canonicalSourceLinks = sortedJson(source.links.map(link => [link.key, link.grid]));
  const canonicalOutputLinks = sortedJson(terminal.links.map(link => {
    assert(outputToSource.has(link.key), `Unknown linked brick ${link.key}`);
    return [outputToSource.get(link.key), link.grid];
  }));
  assert.deepEqual(canonicalOutputLinks, canonicalSourceLinks, 'Microchip links changed');

  const canonicalSourceJoints = sortedJson((source.joints || []).map(joint =>
    [joint.key, joint.entity, joint.offset, joint.rotation]));
  const canonicalOutputJoints = sortedJson((terminal.joints || []).map(joint => {
    assert(outputToSource.has(joint.key), `Unknown joint brick ${joint.key}`);
    return [outputToSource.get(joint.key), joint.entity, joint.offset, joint.rotation];
  }));
  assert.deepEqual(canonicalOutputJoints, canonicalSourceJoints, 'Joints changed');

  const added = terminal.bricks.filter(brick => !outputToSource.has(brick.key));
  assert.equal(added.length, context.labels.length, 'Only expected passive labels were added');
  const expectedLabelTexts = context.labels.map(label => label.text).sort();
  const actualLabelTexts = added.map(brick => {
    assert(movableGrids.has(brick.g), 'Label belongs only inside a logic plane');
    assert.equal(brick.comps.length, 1, 'Passive label has one component');
    assert.equal(brick.comps[0].type, C.TextDisplay.NAME, 'Passive label component');
    assert.deepEqual(brick.data.color, [18, 18, 22], 'Passive label uses black panel');
    assert(!terminal.edges.some(edge => edge.a === brick.key || edge.z === brick.key), 'Passive label is unwired');
    assert(!terminal.links.some(link => link.key === brick.key), 'Passive label has no child chip');
    return brick.comps[0].data.Text;
  }).sort();
  assert.deepEqual(actualLabelTexts, expectedLabelTexts, 'Label set changed');

  assert.deepEqual(canonicalEntities(terminal, movableGrids), canonicalEntities(source, movableGrids),
    'Non-plane entity data changed');
  for (const [role, grid] of Object.entries(context.grids)) {
    const entity = [...terminal.r.entities()].find(candidate => candidate.persistentIndex === grid);
    assert(entity, `${role} entity`);
    assert.deepEqual(entity.data.PlaneCenter, context.planes[role].center, `${role} plane center`);
    assert.deepEqual(entity.data.PlaneExtent, context.planes[role].extent, `${role} plane extent`);
    const bricks = terminal.bricks.filter(brick => brick.g === grid);
    for (const brick of bricks) {
      const size = halfSize(brick);
      for (const [axis, coordinate] of [['X', 0], ['Y', 1], ['Z', 2]]) {
        const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
        assert(distance + size[coordinate] <= entity.data.PlaneExtent[axis],
          `${role} brick outside ${axis} plane`);
      }
    }
    for (let first = 0; first < bricks.length; first++) for (let second = first + 1; second < bricks.length; second++)
      assert(!overlaps(bricks[first], bricks[second]),
        `${role} overlap: ${bricks[first].key} / ${bricks[second].key}`);
  }

  const prefixMarkers = terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Expr_Select.NAME && item.data.InputB?.value === '> <color="ff8700">');
  const suffixMarkers = terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Expr_Select.NAME && item.data.InputB?.value === '</> <');
  assert.equal(prefixMarkers.length, 6, 'Six green-left-arrow/orange-content prefixes');
  assert.equal(suffixMarkers.length, 6, 'Six orange-close/green-right-arrow suffixes');
  assert.equal(context.annotationKeys.size, 2, 'Exactly two stale formatter notes corrected');
  const interactionMessages = terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Interact.NAME).map(item => item.data.Message);
  assert(interactionMessages.includes('Controls the complete left/session screen. Inputs: A ID, B user, C Scrap, D vehicle, E saved/current color hex, F preview color hex, and G System Response.'));
  assert(interactionMessages.includes('Controls the complete right/color-settings screen. Inputs A-E are Hue, Saturation, Brightness, Material, and Intensity rows; F is Price plus BUY.'));
  assert.equal(terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Exec_PlayerState_ShowStatusMessage.NAME).length, 1,
  'Only the invalid-hex player message remains');

  const values = terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Var.NAME || item.type === C.Exec_Var_Set.NAME)
    .map(item => item.data.Value?.value);
  for (const expected of [
    'SYSTEM RESPONSE: READY',
    '<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED</>',
    '<color="ff3030">SYSTEM RESPONSE: NO VEHICLE</>',
    '<color="ff3030">SYSTEM RESPONSE: CANNOT AFFORD</>',
    '<color="ff3030">SYSTEM RESPONSE: COLOR ALREADY APPLIED</>',
  ]) assert(values.includes(expected), `Response retained: ${expected}`);
  assert.equal(terminal.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.BufferSeconds.NAME && item.data.SecondsToWait === Math.fround(0.2)).length, 5,
  'Finite three-blink timing retained');

  const sourceEmitters = source.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === C.OneShotAudioEmitter.NAME).map(item => item.data));
  const outputEmitters = terminal.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === C.OneShotAudioEmitter.NAME).map(item => item.data));
  assert.deepEqual(outputEmitters, sourceEmitters, 'All sound emitters preserved');
  assert.equal(context.sectionByKey.size,
    source.bricks.filter(brick => movableGrids.has(brick.g)).length,
  'Every original internal brick belongs to a named section');

  console.log(JSON.stringify({
    output,
    bricks: terminal.bricks.length,
    wires: terminal.edges.length,
    labels: added.length,
    preservedSourceBricks: sourceToOutput.size,
    topology: 'exact',
    arrows: 'green with orange selected content',
    checks: 'passed',
  }, null, 2));
  return { source, terminal, context };
}

if (require.main === module) test({
  input: process.argv[2] || DEFAULT_INPUT,
  output: process.argv[3] || DEFAULT_OUTPUT,
});

module.exports = test;

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');
const nativeBounds = require('./native-brick-half-extents.json');
const build = require('./build-scrap-runners-color-terminal-v8.cjs');

const DEFAULT_INPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz');
const DEFAULT_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v8.brz');
const clone = value => structuredClone(value);
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function componentSignature(brick) {
  return brick.comps.map(saved => saved.type).sort().join('|');
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return nativeBounds.assets[brick.data.asset] || [5, 5, 2];
}

function sortedJson(values) {
  return values.map(value => JSON.stringify(value)).sort();
}

function assertOwner(source, output) {
  const sourceOwners = source.r.owners();
  const sourceIndex = sourceOwners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceIndex >= 0, 'Source has a non-PUBLIC owner');
  const sourceId = brdb.guidToUuid(sourceOwners.UserIds[sourceIndex]).toLowerCase();
  const outputOwners = output.r.owners();
  const outputIndex = outputOwners.UserIds.map(brdb.guidToUuid)
    .map(value => value.toLowerCase()).indexOf(sourceId);
  assert(outputIndex >= 0, 'Source owner ID is present in output');
  assert.equal(outputOwners.UserNames[outputIndex], sourceOwners.UserNames[sourceIndex]);
  assert.equal(outputOwners.DisplayNames[outputIndex], sourceOwners.DisplayNames[sourceIndex]);

  for (const grid of output.r.gridIds()) for (const chunk of output.r.brickChunkIndex(grid)) {
    const soa = output.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputIndex), `Grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputIndex), `Grid ${grid} original owner`);
  }
  for (const entity of output.r.entities()) {
    assert.equal(entity.ownerIndex, outputIndex, `Entity ${entity.persistentIndex} current owner`);
    assert.equal(entity.originalOwnerIndex, outputIndex, `Entity ${entity.persistentIndex} original owner`);
  }
  return outputIndex;
}

function assertWireIntegrity(scene) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const definitions = new Map(Object.values(C).map(definition => [definition.NAME, definition]));
  const targets = new Set();
  for (const edge of scene.edges) {
    const source = byKey.get(edge.a);
    const target = byKey.get(edge.z);
    assert(source, `Dangling source brick ${edge.a}`);
    assert(target, `Dangling target brick ${edge.z}`);
    assert(component(source, edge.at), `Source component ${edge.at} on ${edge.a}`);
    assert(component(target, edge.zt), `Target component ${edge.zt} on ${edge.z}`);
    const sourceDefinition = definitions.get(edge.at);
    const targetDefinition = definitions.get(edge.zt);
    assert(sourceDefinition && Object.values(sourceDefinition.PORTS).includes(edge.p),
      `Valid source port ${edge.at}.${edge.p}`);
    assert(targetDefinition && Object.values(targetDefinition.PORTS).includes(edge.q),
      `Valid target port ${edge.zt}.${edge.q}`);
    const targetPort = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(targetPort), `Duplicate driver ${targetPort}`);
    targets.add(targetPort);
  }
  for (const link of scene.links) assert(byKey.has(link.key), `Dangling microchip link ${link.key}`);
  for (const joint of scene.joints || []) assert(byKey.has(joint.key), `Dangling joint ${joint.key}`);
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
  const removedLabelKeys = new Set(context.removedLabelKeys);
  assert.equal(movableGrids.size, 3, 'Exactly three redesigned logic grids');
  assert.equal(removedLabelKeys.size, 8, 'Exactly eight obsolete passive labels removed');
  assert(context.placements instanceof Map, 'Builder exposes functional placements');
  assert(Array.isArray(context.cards), 'Builder exposes card layout');
  assert.equal(context.cards.length, 29, 'Nine terminal, seven config, and thirteen core cards');

  const cardCounts = Map.groupBy(context.cards, card => card.grid);
  assert.equal(cardCounts.get(context.grids.terminal)?.length, 9, 'Nine terminal cards');
  assert.equal(cardCounts.get(context.grids.config)?.length, 7, 'Seven editable/config cards');
  assert.equal(cardCounts.get(context.grids.core)?.length, 13, 'Thirteen hidden-core cards');

  const sourceLabels = source.bricks.filter(brick => movableGrids.has(brick.g)
    && component(brick, C.TextDisplay.NAME));
  assert.deepEqual(new Set(sourceLabels.map(brick => brick.key)), removedLabelKeys,
    'Every and only original internal text label is replaced');
  for (const label of sourceLabels) {
    assert(!source.edges.some(edge => edge.a === label.key || edge.z === label.key),
      `Removed label ${label.key} is unwired`);
    assert(!source.links.some(link => link.key === label.key),
      `Removed label ${label.key} is not a child chip`);
  }

  assertOwner(source, terminal);
  assertWireIntegrity(terminal);
  assert.deepEqual(terminal.r.externalAssets(), source.r.externalAssets(), 'External assets unchanged');
  assert.deepEqual(terminal.r.prefabJson(), source.r.prefabJson(), 'Prefab metadata unchanged');

  const outputByGrid = new Map(terminal.r.gridIds().map(grid => [
    grid, terminal.bricks.filter(brick => brick.g === grid),
  ]));
  const sourceToOutput = new Map();
  const outputToSource = new Map();
  for (const sourceBrick of source.bricks) {
    if (removedLabelKeys.has(sourceBrick.key)) continue;
    const expectedPosition = context.placements.get(sourceBrick.key) || sourceBrick.data.position;
    const candidates = (outputByGrid.get(sourceBrick.g) || []).filter(brick =>
      brick.data.position.join(',') === expectedPosition.join(',')
      && brick.data.asset === sourceBrick.data.asset
      && componentSignature(brick) === componentSignature(sourceBrick));
    assert.equal(candidates.length, 1,
      `Map source brick ${sourceBrick.key} at ${sourceBrick.g}/${expectedPosition.join(',')}`);
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
    assert.deepEqual(actualData, expectedData, `Only internal position/color may change: ${sourceBrick.key}`);
    assert.deepEqual(outputBrick.comps, sourceBrick.comps,
      `Functional component payload preserved: ${sourceBrick.key}`);
  }
  assert.equal(sourceToOutput.size, source.bricks.length - removedLabelKeys.size,
    'Every retained source brick mapped exactly once');

  const canonicalSourceEdges = sortedJson(source.edges.map(edge =>
    [edge.a, edge.at, edge.p, edge.z, edge.zt, edge.q]));
  const canonicalOutputEdges = sortedJson(terminal.edges.map(edge => {
    assert(outputToSource.has(edge.a), `Header cannot drive wire ${edge.a}`);
    assert(outputToSource.has(edge.z), `Header cannot receive wire ${edge.z}`);
    return [outputToSource.get(edge.a), edge.at, edge.p,
      outputToSource.get(edge.z), edge.zt, edge.q];
  }));
  assert.deepEqual(canonicalOutputEdges, canonicalSourceEdges, 'Exact wire topology preserved');

  const canonicalSourceLinks = sortedJson(source.links.map(link => [link.key, link.grid]));
  const canonicalOutputLinks = sortedJson(terminal.links.map(link => {
    assert(outputToSource.has(link.key), `Unknown linked brick ${link.key}`);
    return [outputToSource.get(link.key), link.grid];
  }));
  assert.deepEqual(canonicalOutputLinks, canonicalSourceLinks, 'Microchip links preserved');

  const canonicalSourceJoints = sortedJson((source.joints || []).map(joint =>
    [joint.key, joint.entity, joint.offset, joint.rotation]));
  const canonicalOutputJoints = sortedJson((terminal.joints || []).map(joint => {
    assert(outputToSource.has(joint.key), `Unknown joint brick ${joint.key}`);
    return [outputToSource.get(joint.key), joint.entity, joint.offset, joint.rotation];
  }));
  assert.deepEqual(canonicalOutputJoints, canonicalSourceJoints, 'Joints preserved');

  const addedHeaders = terminal.bricks.filter(brick => !outputToSource.has(brick.key));
  assert.equal(addedHeaders.length, context.cards.length, 'Only one passive header per card was added');
  assert.equal(terminal.bricks.length,
    source.bricks.length - removedLabelKeys.size + context.cards.length,
  'Expected final brick count');

  const sourceGridBricks = new Map([...movableGrids].map(grid => [
    grid, source.bricks.filter(brick => brick.g === grid),
  ]));
  const coveredFunctionalKeys = new Set();
  const resolvedHeaders = new Set();
  for (const card of context.cards) {
    assert(Number.isInteger(card.x) && mod(card.x, 10) === 0, `${card.name} starts on grid edge`);
    assert(Number.isInteger(card.headerBottom) && mod(card.headerBottom, 10) === 0,
      `${card.name} header boundary is on grid`);
    assert.equal(card.width, Math.max(...card.rowWidths), `${card.name} exact widest-row width`);
    assert.equal(card.rows.length, card.rowWidths.length, `${card.name} row metadata`);

    const expectedHeaderPosition = [card.x + card.width / 2, card.headerBottom + 10, 2];
    const headerCandidates = addedHeaders.filter(brick => brick.g === card.grid
      && brick.data.position.join(',') === expectedHeaderPosition.join(',')
      && component(brick, C.TextDisplay.NAME)?.data.Text === card.title);
    assert.equal(headerCandidates.length, 1, `${card.name} exact header`);
    const header = headerCandidates[0];
    resolvedHeaders.add(header.key);
    const display = component(header, C.TextDisplay.NAME);
    assert.equal(header.data.asset, 'PB_DefaultMicroBrick', `${card.name} microbrick header`);
    assert.deepEqual(header.data.size, [card.width / 2, 10, 2], `${card.name} exact-fit header size`);
    assert.deepEqual(header.data.color, [0, 0, 0], `${card.name} black header`);
    assert.equal(header.data.material, 'BMC_Glow', `${card.name} glow header`);
    assert.deepEqual(display.data.Anchor, { X: 0.5, Y: 0.5 }, `${card.name} centered text`);
    assert.deepEqual(display.data.Offset, { X: 0, Y: 0, Z: 0 }, `${card.name} zero text offset`);
    assert(display.data.LineHeight >= 2.5 && display.data.LineHeight <= 5,
      `${card.name} readable header line height`);
    assert.equal(display.data.WidthScale, 1, `${card.name} normal text width scale`);
    assert(!terminal.edges.some(edge => edge.a === header.key || edge.z === header.key),
      `${card.name} header is passive`);
    assert(!terminal.links.some(link => link.key === header.key), `${card.name} header is not linked`);

    const ordinalBricks = sourceGridBricks.get(card.grid);
    card.rows.forEach((ordinals, rowIndex) => {
      const row = ordinals.map(ordinal => {
        const sourceBrick = ordinalBricks[ordinal];
        assert(sourceBrick, `${card.name} ordinal ${ordinal}`);
        assert(!component(sourceBrick, C.TextDisplay.NAME), `${card.name} contains only functional bricks`);
        assert(!coveredFunctionalKeys.has(sourceBrick.key), `${sourceBrick.key} appears in one card only`);
        coveredFunctionalKeys.add(sourceBrick.key);
        const outputKey = sourceToOutput.get(sourceBrick.key);
        assert(outputKey, `${sourceBrick.key} retained`);
        return terminal.bricks.find(brick => brick.key === outputKey);
      });
      const expectedY = card.headerBottom - 5 - rowIndex * 20;
      assert(row.every(brick => brick.data.position[1] === expectedY), `${card.name} row ${rowIndex} Y`);
      let expectedEdge = card.x;
      for (const brick of row) {
        const half = halfSize(brick);
        assert.equal(brick.data.position[0], expectedEdge + half[0],
          `${card.name} row ${rowIndex} touching placement`);
        assert.equal(brick.data.position[2], 2, `${card.name} row ${rowIndex} Z`);
        expectedEdge += half[0] * 2;
      }
      assert.equal(expectedEdge - card.x, card.rowWidths[rowIndex],
        `${card.name} row ${rowIndex} measured width`);
      if (row.every(brick => halfSize(brick)[0] === 5)) {
        assert(row.every(brick => mod(brick.data.position[0], 10) === 5
          && mod(brick.data.position[1], 10) === 5),
        `${card.name} standard gate centers use the microchip cell grid`);
      }
      if (rowIndex === 0) {
        assert.equal(header.data.position[1] - header.data.size[1],
          row[0].data.position[1] + halfSize(row[0])[1],
        `${card.name} header directly touches first row`);
      }
    });
  }
  assert.equal(resolvedHeaders.size, addedHeaders.length, 'Every added header belongs to one card');
  const sourceFunctional = source.bricks.filter(brick => movableGrids.has(brick.g)
    && !component(brick, C.TextDisplay.NAME));
  assert.equal(coveredFunctionalKeys.size, sourceFunctional.length,
    'Every functional inner brick belongs to exactly one card row');

  const prefixMarkers = terminal.bricks.flatMap(brick => brick.comps)
    .filter(saved => saved.type === C.Expr_Select.NAME
      && saved.data.InputB?.value === '<color="ff8700">> ');
  const suffixMarkers = terminal.bricks.flatMap(brick => brick.comps)
    .filter(saved => saved.type === C.Expr_Select.NAME && saved.data.InputB?.value === ' <</>');
  assert.equal(prefixMarkers.length, 6, 'Six fully orange selected-row prefixes');
  assert.equal(suffixMarkers.length, 6, 'Six fully orange selected-row suffixes');
  assert.equal(terminal.bricks.flatMap(brick => brick.comps)
    .filter(saved => saved.type === C.Expr_Select.NAME
      && ['> <color="ff8700">', '</> <'].includes(saved.data.InputB?.value)).length, 0,
  'No green-arrow marker rewrite remains');

  const externalAssets = terminal.r.externalAssets();
  for (const brick of terminal.bricks) for (const display of brick.comps
    .filter(saved => saved.type === C.TextDisplay.NAME)) {
    assert(Number.isInteger(display.data.Font)
      && display.data.Font >= 0 && display.data.Font < externalAssets.length,
    `TextDisplay font index resolves on ${brick.key}`);
  }

  assert.deepEqual(canonicalEntities(terminal, movableGrids), canonicalEntities(source, movableGrids),
    'Only redesigned plane bounds changed on entities');
  for (const [role, grid] of Object.entries(context.grids)) {
    const entity = [...terminal.r.entities()].find(candidate => candidate.persistentIndex === grid);
    assert(entity, `${role} microchip entity`);
    assert.deepEqual(entity.data.PlaneCenter, context.planes[role].center, `${role} plane center`);
    assert.deepEqual(entity.data.PlaneExtent, context.planes[role].extent, `${role} plane extent`);
    for (const brick of terminal.bricks.filter(candidate => candidate.g === grid)) {
      const half = halfSize(brick);
      for (const [axis, coordinate] of [['X', 0], ['Y', 1]]) {
        const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
        assert(distance + half[coordinate] <= entity.data.PlaneExtent[axis],
          `${role} brick ${brick.key} stays inside ${axis} plane`);
      }
    }
  }

  const placement = validate(fs.readFileSync(output));
  assert(placement.strictOk, JSON.stringify(placement, null, 2));

  console.log(JSON.stringify({
    output,
    bricks: terminal.bricks.length,
    wires: terminal.edges.length,
    cards: context.cards.length,
    headers: addedHeaders.length,
    removedLabels: removedLabelKeys.size,
    preservedFunctionalBricks: sourceToOutput.size,
    topology: 'exact',
    arrows: 'orange',
    strictPlacement: placement.strictOk,
    checks: 'passed',
  }, null, 2));
  return { source, terminal, context, placement };
}

if (require.main === module) test({
  input: process.argv[2] || DEFAULT_INPUT,
  output: process.argv[3] || DEFAULT_OUTPUT,
});

module.exports = test;

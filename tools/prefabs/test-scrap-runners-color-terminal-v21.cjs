'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV20 = require('./test-scrap-runners-color-terminal-v20.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V20 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v20.brz');
const DEFAULT_V21 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v21.brz');
const DEFAULT_TRUCK_V11 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v11.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v21.cjs');

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function valueOf(value) {
  return value && typeof value === 'object' && '$variant' in value ? value.value : value;
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  return { scene, bricks, all, one, incoming, outgoing, label,
    source: edge => bricks.get(edge.a), target: edge => bricks.get(edge.z) };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
}

function selectionMarkerContract(scene) {
  const t = api(scene);
  const markerSelectors = Array.from({ length: 6 }, (_, index) =>
    t.label(`Row ${index} selected close and blinking right marker`));
  assert(markerSelectors.every(brick => component(brick, C.Expr_Select.NAME)),
    'six labeled inner marker selectors exist');
  const coreGrid = markerSelectors[0].g;
  assert(markerSelectors.every((brick, index) => brick.g === coreGrid
    && brick.data.position[0] === 15 + index * 10
    && brick.data.position[1] === -305 && brick.data.position[2] === 2),
  'inner marker selectors form a touching on-grid row');

  for (const [index, marker] of markerSelectors.entries()) {
    const markerComp = component(marker, C.Expr_Select.NAME);
    assert.equal(valueOf(markerComp.data.InputA), '  </>',
      `row ${index} selected blink-off state closes orange with equal width`);
    assert.equal(valueOf(markerComp.data.InputB), ' <</>',
      `row ${index} selected blink-on state shows only right < and closes orange`);
    const blinkCondition = t.source(t.one(t.incoming(marker,
      C.Expr_Select.NAME, 'bSelectB'), `row ${index} blink condition`));
    assert(component(blinkCondition, C.Expr_LogicalAND.NAME),
      `row ${index} still requires selected AND blink`);

    const outer = t.target(t.one(t.outgoing(marker,
      C.Expr_Select.NAME, 'Output'), `row ${index} outer suffix selector`));
    const outerComp = component(outer, C.Expr_Select.NAME);
    assert.equal(valueOf(outerComp.data.InputA), '',
      `row ${index} unselected suffix is completely empty`);
    assert.equal(valueOf(outerComp.data.InputB), '',
      `row ${index} selected suffix uses the wired inner selector`);
    assertEdge(t, marker, C.Expr_Select.NAME, 'Output', outer,
      C.Expr_Select.NAME, 'InputB', `row ${index} inner marker feeds selected suffix`);

    const selection = t.source(t.one(t.incoming(outer,
      C.Expr_Select.NAME, 'bSelectB'), `row ${index} outer selection condition`));
    assert(component(selection, C.Expr_CompareEqual.NAME),
      `row ${index} outer selector uses original selection comparison`);
    assert(t.incoming(blinkCondition, C.Expr_LogicalAND.NAME, 'bInputA')
      .some(edge => edge.a === selection.key),
    `row ${index} selection also remains in the blink AND`);

    const formatterEdge = t.one(t.outgoing(outer, C.Expr_Select.NAME, 'Output')
      .filter(edge => edge.zt === C.Expr_String_FormatText.NAME),
    `row ${index} formatter suffix edge`);
    const formatter = t.target(formatterEdge);
    assert.equal(valueOf(component(formatter,
      C.Expr_String_FormatText.NAME).data[formatterEdge.q]), '',
    `row ${index} serialized formatter fallback cannot show an orphan closing tag`);
  }

  const oldSuffixes = t.all(C.Expr_Select.NAME, data =>
    valueOf(data.InputA) === '  </>' && valueOf(data.InputB) === ' <</>');
  assert.equal(oldSuffixes.length, 6,
    'the only close/marker pairs are the six selected-only inner selectors');
  const formatterFallbacks = t.all(C.Expr_String_FormatText.NAME).flatMap(({ comp }) =>
    ['InputA', 'InputB', 'InputC', 'InputD', 'InputE', 'InputF', 'InputG']
      .map(field => valueOf(comp.data[field])));
  assert(!formatterFallbacks.includes('  </>'),
    'no formatter fallback can render the orphan closing tag while unselected');

  // Explicit display truth table.
  const suffix = (selected, blink) => {
    if (!selected) return '';
    return selected && blink ? ' <</>' : '  </>';
  };
  assert.equal(suffix(false, false), '');
  assert.equal(suffix(false, true), '');
  assert.equal(suffix(true, false), '  </>');
  assert.equal(suffix(true, true), ' <</>');

  const blinkClock = t.one(t.all(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9),
  '0.25-second selection blink clock').brick;
  assert.equal(component(blinkClock, C.Clock.NAME).data.bEnabled, false,
    'blink clock remains saved off');
  const authorized = t.label('Terminal authorized');
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkClock,
    C.Clock.NAME, 'bEnabled', 'only authorized session enables marker blink');
  return { t, markerSelectors, coreGrid, blinkClock, authorized };
}

function test({
  previous = DEFAULT_V20,
  terminalOutput = DEFAULT_V21,
  truckOutput = DEFAULT_TRUCK_V11,
  builder = DEFAULT_BUILDER,
} = {}) {
  testV20({ terminalOutput: previous, truckOutput });
  const previousBytes = fs.readFileSync(previous);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const v20 = read(previousBytes);
  const v21 = read(terminalBytes);
  assert(validate(terminalBytes).strictOk, 'v21 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged paired Truck1 v11 passes strict placement');
  assert.equal(v21.bricks.length, v20.bricks.length + 6,
    'v21 adds exactly six selected-only suffix routers');
  assert.equal(v21.edges.length, v20.edges.length + 12,
    'v21 replaces six conditions with eighteen tri-state suffix wires');
  const oldKeys = new Set(v20.bricks.map(brick => brick.key));
  assert.equal(v21.bricks.filter(brick => !oldKeys.has(brick.key)).length, 6,
    'exactly six marker-routing gates are added');
  const edgeKey = edge => JSON.stringify(edge);
  const oldEdges = new Set(v20.edges.map(edgeKey));
  const newEdges = new Set(v21.edges.map(edgeKey));
  assert.equal(v20.edges.filter(edge => !newEdges.has(edgeKey(edge))).length, 6,
    'six old selected-and-blink direct suffix wires are removed');
  assert.equal(v21.edges.filter(edge => !oldEdges.has(edgeKey(edge))).length, 18,
    'eighteen tri-state suffix-routing wires are added');
  const markers = selectionMarkerContract(v21);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v21 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), terminalBytes,
    'checked v21 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: v21.bricks.length,
    terminalWires: v21.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckSha256: sha256(truckBytes),
    unselected: 'no marker and no visible </> closing tag',
    selected: 'orange text; only right < blinks every 0.25 seconds',
    inheritedV20Regressions: 'passed',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal: v21, markers, result };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V20,
  terminalOutput: process.argv[3] || DEFAULT_V21,
  truckOutput: process.argv[4] || DEFAULT_TRUCK_V11,
  builder: process.argv[5] || DEFAULT_BUILDER,
});

module.exports = test;

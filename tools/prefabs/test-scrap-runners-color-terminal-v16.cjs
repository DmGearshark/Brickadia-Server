'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV15 = require('./test-scrap-runners-color-terminal-v15.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V15_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v15.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V16_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v16.brz');
const DEFAULT_V16_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v16.cjs');

const valueOf = value => value && typeof value === 'object' && '$variant' in value
  ? value.value : value;

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
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
  const row = (type, predicate = () => true, label = type) => one(all(type, predicate), label);
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const source = edge => bricks.get(edge.a);
  const target = edge => bricks.get(edge.z);
  return { scene, bricks, rows, all, one, row, incoming, outgoing, source, target };
}

function isExecPort(t, brick, type, port) {
  const saved = component(brick, type);
  if (saved?.data?.[port]?.$variant === 'WireGraphExec') return true;
  if (type === C.BufferTicks.NAME && ['Input', 'Output'].includes(port)) return true;
  if (/^(?:Exec|Pulse|Expired|OnRisingEdge|OnFallingEdge|bPulseOnChange)/.test(port)) return true;
  if (/^RER_/.test(port)) return ['CallableDefault', 'CallableMirror', 'CallableResult']
    .some(field => saved?.data?.[field]?.$variant === 'WireGraphExec');
  return false;
}

function reachableFromPort(t, start, type, port, goal, exec) {
  const accepts = edge => {
    const sourceExec = isExecPort(t, start, edge.at, edge.p);
    const targetExec = isExecPort(t, t.target(edge), edge.zt, edge.q);
    return exec ? sourceExec && targetExec : !sourceExec && !targetExec;
  };
  const queue = t.outgoing(start, type, port).filter(accepts).map(edge => edge.z);
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < 10000; steps++) {
    const key = queue.shift();
    if (key === goal.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || seen.has(edge.z)) continue;
      const sourceExec = isExecPort(t, brick, edge.at, edge.p);
      const targetExec = isExecPort(t, t.target(edge), edge.zt, edge.q);
      if (exec ? !(sourceExec && targetExec) : (sourceExec || targetExec)) continue;
      seen.add(edge.z); queue.push(edge.z);
    }
  }
  return seen.has(goal.key);
}

const dataReachableFromPort = (t, start, type, port, goal) =>
  reachableFromPort(t, start, type, port, goal, false);
const execReachableFromPort = (t, start, type, port, goal) =>
  reachableFromPort(t, start, type, port, goal, true);

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  const source = t.source(edge);
  return { edge, brick: source, comp: component(source, edge.at) };
}

function srgbToLinear(encoded) {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max ? delta / max : 0, max];
}

function hsvToRgb([degrees, saturation, value]) {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((degrees / 60) % 2) - 1));
  const m = value - chroma;
  let prime;
  if (degrees < 60) prime = [chroma, x, 0];
  else if (degrees < 120) prime = [x, chroma, 0];
  else if (degrees < 180) prime = [0, chroma, x];
  else if (degrees < 240) prime = [0, x, chroma];
  else if (degrees < 300) prime = [x, 0, chroma];
  else prime = [chroma, 0, x];
  return prime.map(channel => channel + m);
}

function assertV15LinearHsvBug(v15) {
  const t = api(v15);
  const coreGrid = t.row(C.InputSplitter.NAME, () => true, 'v15 color core').brick.g;
  const old = t.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === coreGrid && data.FromSpace === 0 && data.ToSpace === 3);
  assert.equal(old.length, 2, 'v15 reproduces two direct Linear-to-HSV paths');

  const bytes = [0xff, 0xa1, 0x00];
  const linear = bytes.map(byte => srgbToLinear(byte / 255));
  const wrongHsv = rgbToHsv(linear);
  const wrongBytes = hsvToRgb(wrongHsv).map(channel => Math.round(channel * 255));
  assert(Math.abs(wrongHsv[0] - 21.38400864875661) < 1e-9,
    `v15 negative fixture Hue: ${wrongHsv[0]}`);
  assert.equal(wrongBytes[0], 255);
  assert([90, 91].includes(wrongBytes[1]),
    `v15 negative fixture maps #FFA100 near #FF5B00, got green ${wrongBytes[1]}`);
  assert.equal(wrongBytes[2], 0);
  assert.notDeepEqual(wrongBytes, bytes,
    'v15 linear-HSV/sRGB-output path fails to roundtrip #FFA100');
}

function assertSrgbHsvRoundtrip(v16) {
  const t = api(v16);
  const coreGrid = t.row(C.InputSplitter.NAME, () => true, 'v16 color core').brick.g;
  assert.equal(t.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === coreGrid && data.FromSpace === 0 && data.ToSpace === 3).length,
  0, 'v16 removes every direct Linear-to-HSV conversion');
  const converters = t.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === coreGrid && data.FromSpace === 1 && data.ToSpace === 3);
  assert.equal(converters.length, 2,
    'v16 has exactly two sRGB-to-HSV paths: vehicle sync and accepted hex');

  const paths = converters.map(({ brick: converter }, pathIndex) => {
    const raw = sourceOf(t, converter, C.Expr_ColorConvert.NAME,
      'Input', `path ${pathIndex + 1} normalized sRGB color`).brick;
    assert(component(raw, C.Expr_MakeColor.NAME),
      `path ${pathIndex + 1} builds a raw normalized sRGB tuple`);
    let srgbSplit;
    for (const port of ['R', 'G', 'B']) {
      const divide = sourceOf(t, raw, C.Expr_MakeColor.NAME,
        port, `path ${pathIndex + 1} ${port} / 255`).brick;
      const divideData = component(divide, C.Expr_MathDivide.NAME)?.data;
      assert(divideData, `path ${pathIndex + 1} ${port} uses MathDivide`);
      assert.equal(valueOf(divideData.InputB), 255,
        `path ${pathIndex + 1} ${port} normalizes its sRGB byte`);
      const byte = sourceOf(t, divide, C.Expr_MathDivide.NAME,
        'InputA', `path ${pathIndex + 1} ${port} sRGB byte`);
      assert.equal(byte.comp?.type, C.Expr_SplitColorSRGB.NAME);
      assert.equal(byte.edge.p, port);
      if (srgbSplit) assert.equal(byte.brick.key, srgbSplit.key,
        `path ${pathIndex + 1} shares one SplitColorSRGB`);
      srgbSplit = byte.brick;
    }
    assert.equal(t.incoming(srgbSplit, C.Expr_SplitColorSRGB.NAME, 'Input').length, 1,
      `path ${pathIndex + 1} receives one LinearColor source`);

    const split = t.target(t.one(t.outgoing(converter,
      C.Expr_ColorConvert.NAME, 'Output').filter(edge =>
      edge.zt === C.Expr_SplitColor.NAME && edge.q === 'Input'),
    `path ${pathIndex + 1} HSV split`));
    const scales = {};
    for (const [port, factor] of [['R', 360], ['G', 100], ['B', 100]]) {
      const edge = t.one(t.outgoing(split, C.Expr_SplitColor.NAME, port)
        .filter(candidate => candidate.zt === C.Expr_MathMultiply.NAME
          && candidate.q === 'InputA'
          && valueOf(component(t.target(candidate), C.Expr_MathMultiply.NAME)
            .data.InputB) === factor), `path ${pathIndex + 1} ${port} x${factor}`);
      scales[port] = t.target(edge);
      assert(t.outgoing(scales[port], C.Expr_MathMultiply.NAME, 'Output')
        .some(candidate => candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Value'),
      `path ${pathIndex + 1} scaled ${port} writes its canonical HSV Var`);
    }
    return { converter, srgbSplit, raw, scales };
  });

  const samples = [0xffa100, 0xff5a00, 0xff0000, 0x00ff00, 0x0000ff];
  for (const score of samples) {
    const bytes = [(score >> 16) & 255, (score >> 8) & 255, score & 255];
    const normalized = bytes.map(byte => byte / 255);
    const hsv = rgbToHsv(normalized);
    const roundtrip = hsvToRgb(hsv).map(channel => Math.round(channel * 255));
    assert.deepEqual(roundtrip, bytes,
      `sRGB HSV roundtrip preserves #${score.toString(16).padStart(6, '0').toUpperCase()}`);
  }
  const orangeHue = rgbToHsv([1, 0xa1 / 255, 0])[0];
  assert(Math.abs(orangeHue - 37.88235294117647) < 1e-9,
    `#FFA100 conventional sRGB Hue is 37.882 degrees, got ${orangeHue}`);
  return paths;
}

function assertBaselineAuthority(v16) {
  const t = api(v16);
  const entered = t.row(C.EntityZoneEvent_Entered.NAME, () => true,
    'vehicle zone entry').brick;
  const terminalGrid = entered.g;
  const reply = t.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'live appearance reply').brick;
  const stagedScoreSetter = t.target(t.one(t.outgoing(reply,
    C.Event_CustomGlobal.NAME, 'DataOut3').filter(edge =>
    edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
  'immediate reply score staging'));
  const stagedScore = sourceOf(t, stagedScoreSetter, C.Exec_Var_Set.NAME,
    'VarRef', 'staged reply score Var').brick;

  const stateWriters = t.outgoing(stagedScore, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value')
    .map(edge => t.target(edge));
  const scoreStateWriter = t.one(stateWriters.filter(setter => {
    const state = sourceOf(t, setter, C.Exec_Var_Set.NAME,
      'VarRef', 'reply score state candidate').brick;
    return t.outgoing(state, C.Var.NAME, 'Value')
      .some(edge => edge.zt === C.Expr_MathMax.NAME && edge.q === 'InputA');
  }), 'accepted reply writes retained baseline/preview score');
  const scoreState = sourceOf(t, scoreStateWriter, C.Exec_Var_Set.NAME,
    'VarRef', 'retained baseline score Var').brick;

  const currentGetter = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === ''
      && t.outgoing(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut')
        .some(edge => edge.zt === C.BufferTicks.NAME)),
  'seated saved-color fallback getter').brick;
  const fallbackScoreWriter = t.one(t.outgoing(currentGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'
      && sourceOf(t, t.target(edge), C.Exec_Var_Set.NAME,
        'VarRef', 'fallback score Var').brick.key === scoreState.key),
  'fallback writes the same retained baseline score');
  assert(execReachableFromPort(t, currentGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', t.target(fallbackScoreWriter)),
  'saved-color fallback executes its baseline score writer');

  const currentFormatter = t.row(C.Expr_String_FormatText.NAME,
    data => /CURRENT COLOR: \{E\}/.test(data.FormatString || ''),
    'left screen formatter').brick;
  const currentSelect = sourceOf(t, currentFormatter, C.Expr_String_FormatText.NAME,
    'InputE', 'CURRENT COLOR visibility selector').brick;
  assert.equal(component(currentSelect, C.Expr_Select.NAME)?.data.InputA?.value, 'N/A');
  assert(dataReachableFromPort(t, scoreState, C.Var.NAME,
    'Value', currentSelect), 'CURRENT COLOR display decodes the retained vehicle baseline');
  assert(!dataReachableFromPort(t, currentGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', currentSelect),
  'CURRENT COLOR display no longer reads the seated-player getter directly');

  const colorWrite = t.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    () => true, 'saved color write').brick;
  const purchaseScore = sourceOf(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value', 'purchased packed score');
  const purchaseBaselineWriter = t.one(t.outgoing(scoreState,
    C.Var.NAME, 'VarRef').filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge)).filter(setter => {
      const value = sourceOf(t, setter, C.Exec_Var_Set.NAME,
        'Value', 'baseline writer purchase value');
      return value.brick.key === purchaseScore.brick.key && value.edge.p === purchaseScore.edge.p
        && execReachableFromPort(t, colorWrite,
          C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut', setter);
    }), 'successful purchase updates retained baseline');
  const debit = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'Scrap debit').brick;
  assert(execReachableFromPort(t, purchaseBaselineWriter,
    C.Exec_Var_Set.NAME, 'ExecOut', debit),
  'Scrap debit remains downstream of color write and baseline update');

  const coreGrid = t.row(C.InputSplitter.NAME, () => true, 'color core').brick.g;
  assert(t.outgoing(scoreState, C.Var.NAME, 'Value').some(edge =>
    edge.zt === C.Expr_MathMax.NAME && t.target(edge).g === coreGrid),
  'the same reply/fallback score initializes PREVIEW through the color core');
  return { entered, reply, stagedScore, scoreState, currentGetter,
    currentFormatter, currentSelect, colorWrite, purchaseBaselineWriter, debit };
}

function assertHandshakeAndBusy(v16, baseline) {
  const t = api(v16);
  const request = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request', 'appearance request').brick;
  assert(execReachableFromPort(t, baseline.entered,
    C.EntityZoneEvent_Entered.NAME, 'Exec', request),
  'zone entry still requests live vehicle appearance without a seated session');

  const preview = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'preview sender').brick;
  const readyGuard = sourceOf(t, preview, C.Exec_SendCustomEventGlobal.NAME,
    'ExecIn', 'preview ready guard');
  assert.equal(readyGuard.comp?.type, C.Exec_Branch.NAME);
  const ready = sourceOf(t, readyGuard.brick, C.Exec_Branch.NAME,
    'bCond', 'appearance-ready state').brick;

  const replyStart = t.target(t.one(t.outgoing(baseline.reply,
    C.Event_CustomGlobal.NAME, 'ExecOut'), 'reply staging start'));
  let stage = replyStart;
  for (let index = 1; index < 5; index++) stage = t.target(t.one(t.outgoing(stage,
    C.Exec_Var_Set.NAME, 'ExecOut').filter(edge => edge.zt === C.Exec_Var_Set.NAME),
  `reply stage ${index + 1}`));
  const replyBarrier = t.target(t.one(t.outgoing(stage,
    C.Exec_Var_Set.NAME, 'ExecOut').filter(edge => edge.zt === C.BufferTicks.NAME),
  'reply staging barrier'));
  assert.equal(valueOf(component(replyBarrier, C.BufferTicks.NAME).data.TicksToWait), 1);

  const replyGuards = t.all(C.Exec_Branch.NAME, (_data, brick) =>
    execReachableFromPort(t, replyBarrier, C.BufferTicks.NAME, 'Output', brick));
  const accepted = t.one(replyGuards.filter(({ brick }) =>
    t.outgoing(brick, C.Exec_Branch.NAME, 'ExecOutA').some(edge =>
      component(t.target(edge), C.Exec_Var_Set.NAME)?.data.Value?.value === true)),
  'settled reply validation and busy lock');
  const busyOn = t.target(t.one(t.outgoing(accepted.brick,
    C.Exec_Branch.NAME, 'ExecOutA'), 'reply sync busy setter'));
  const busy = sourceOf(t, busyOn, C.Exec_Var_Set.NAME,
    'VarRef', 'shared synchronization busy Var').brick;
  const condition = sourceOf(t, accepted.brick, C.Exec_Branch.NAME,
    'bCond', 'reply accepted condition').brick;
  assert(dataReachableFromPort(t, ready, C.Var.NAME, 'Value', condition));
  assert(dataReachableFromPort(t, busy, C.Var.NAME, 'Value', condition));

  const material = t.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === baseline.entered.g && data.Key === 'Truck1Material',
    'fallback material getter').brick;
  const materialBarrier = t.target(t.one(t.outgoing(material,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    edge.zt === C.BufferTicks.NAME), 'fallback material barrier'));
  const fallbackGuard = t.target(t.one(t.outgoing(materialBarrier,
    C.BufferTicks.NAME, 'Output').filter(edge => edge.zt === C.Exec_Branch.NAME),
  'fallback guard'));
  const fallbackCondition = sourceOf(t, fallbackGuard, C.Exec_Branch.NAME,
    'bCond', 'fallback accepted condition').brick;
  assert(dataReachableFromPort(t, ready, C.Var.NAME, 'Value', fallbackCondition));
  assert(dataReachableFromPort(t, busy, C.Var.NAME, 'Value', fallbackCondition));
  return { request, preview, ready, busy, replyBarrier, accepted: accepted.brick, fallbackGuard };
}

function assertBuySafety(v16, baseline) {
  const t = api(v16);
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'terminal InputSplitter').brick;
  const inputUp = t.one(t.outgoing(splitter, C.InputSplitter.NAME, 'InputUp'),
    'normalized Space input');
  assert.equal(inputUp.zt, C.Expr_CompareGreater.NAME);
  assert.equal(valueOf(component(t.target(inputUp), C.Expr_CompareGreater.NAME).data.InputB), 0.5);
  const detector = t.target(t.one(t.outgoing(t.target(inputUp),
    C.Expr_CompareGreater.NAME, 'bOutput'), 'Space edge detector'));
  const detectorData = component(detector, C.Expr_EdgeDetectorExec.NAME)?.data;
  assert(detectorData);
  assert.equal(valueOf(detectorData.Input), 0);
  assert.equal(valueOf(detectorData.InputLast), 0);
  assert.equal(detectorData.bSeeded, true);
  assert.equal(t.outgoing(detector, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge').length, 0,
    'release/seat reset has no BUY path');

  const mutationGuard = sourceOf(t, baseline.colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec', 'final mutation guard').brick;
  const mutationCondition = sourceOf(t, mutationGuard, C.Exec_Branch.NAME,
    'bCond', 'final session/seat check').brick;
  const seat = t.row(C.Seat.NAME, () => true, 'terminal seat').brick;
  assert(dataReachableFromPort(t, seat, C.Seat.NAME,
    'bIsOccupied', mutationCondition), 'saved-color write rechecks physical seat occupancy');
}

function test({
  previousTerminal = DEFAULT_V15_TERMINAL,
  previousTruck = DEFAULT_V8_TRUCK,
  terminalOutput = DEFAULT_V16_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V16_BUILDER,
} = {}) {
  testV15();
  const oldTerminalBytes = fs.readFileSync(previousTerminal);
  const oldTruckBytes = fs.readFileSync(previousTruck);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const oldTerminal = read(oldTerminalBytes);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);

  assert(validate(terminalBytes).strictOk, 'v16 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged v8 truck passes strict placement');
  assert.deepEqual(truckBytes, oldTruckBytes, 'v16 keeps exact Truck1 v8 bytes');
  assertV15LinearHsvBug(oldTerminal);
  const colorPaths = assertSrgbHsvRoundtrip(terminal);
  const baseline = assertBaselineAuthority(terminal);
  const handshake = assertHandshakeAndBusy(terminal, baseline);
  assertBuySafety(terminal, baseline);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build(); const second = build();
  const firstBytes = first.terminal?.bytes || first.terminalBytes || first.bytes;
  const secondBytes = second.terminal?.bytes || second.terminalBytes || second.bytes;
  assert(firstBytes && secondBytes, 'v16 builder returns terminal bytes');
  assert.deepEqual(firstBytes, secondBytes, 'v16 generation is deterministic');
  assert.deepEqual(Buffer.from(firstBytes), Buffer.from(terminalBytes),
    'checked v16 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckSha256: sha256(truckBytes),
    colorRoundtrip: 'LinearColor -> SplitColorSRGB -> /255 -> sRGB HSV',
    hsvPaths: colorPaths.length,
    currentDisplay: 'retained entering-vehicle baseline',
    handshakeBusyGuard: Boolean(handshake.busy),
    buySafety: 'seeded rising edge plus occupied-seat mutation guard',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  previousTerminal: process.argv[2] || DEFAULT_V15_TERMINAL,
  previousTruck: process.argv[3] || DEFAULT_V8_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V16_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V16_BUILDER,
});

module.exports = test;

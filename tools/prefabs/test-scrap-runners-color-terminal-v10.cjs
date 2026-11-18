'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV9 = require('./test-scrap-runners-color-terminal-v9.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V9_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v9.brz');
const DEFAULT_V4_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v4.brz');
const DEFAULT_V10_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v10.brz');
const DEFAULT_V5_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v5.brz');

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

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  return { edge, brick: t.source(edge), comp: component(t.source(edge), edge.at) };
}

function assertFiniteScalars(value, location = 'root', seen = new Set()) {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${location} must be finite, got ${value}`);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) =>
    assertFiniteScalars(item, `${location}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value))
    assertFiniteScalars(item, `${location}.${key}`, seen);
}

function rgbToHsv({ R, G, B, A = 1 }) {
  const maximum = Math.max(R, G, B);
  const minimum = Math.min(R, G, B);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === R) hue = 60 * (((G - B) / delta) % 6);
    else if (maximum === G) hue = 60 * (((B - R) / delta) + 2);
    else hue = 60 * (((R - G) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return { R: hue, G: maximum === 0 ? 0 : delta / maximum, B: maximum, A };
}

// Evaluate the actual serialized score-to-H/S/B expression graph. Values carry
// their saved numeric kind so the proven v8 i64 Divide behavior is modeled as
// truncating integer division rather than JavaScript floating-point division.
function makeEvaluator(t, scoreInput, score) {
  const cache = new Map();
  const supported = new Set([
    C.MicrochipInput.NAME,
    C.Expr_MathMax.NAME,
    C.Expr_MathMin.NAME,
    C.Expr_MathDivide.NAME,
    C.Expr_MathModulo.NAME,
    C.Expr_MakeColorSRGB.NAME,
    C.Expr_ColorConvert.NAME,
    C.Expr_SplitColor.NAME,
    C.Expr_MathMultiply.NAME,
  ]);
  const scalar = raw => {
    if (raw && typeof raw === 'object' && '$variant' in raw)
      return { value: raw.value, kind: raw.$variant };
    return { value: raw, kind: typeof raw === 'number' ? 'f64' : 'value' };
  };
  function output(brick, port) {
    const key = `${brick.key}|${port}`;
    if (cache.has(key)) return cache.get(key);
    const saved = brick.comps.find(comp => supported.has(comp.type));
    assert(saved, `Unsupported evaluator brick ${brick.key}`);
    const input = name => {
      const edges = t.incoming(brick, saved.type, name);
      assert(edges.length <= 1, `${brick.key}.${name} has at most one driver`);
      return edges.length ? output(t.source(edges[0]), edges[0].p) : scalar(saved.data[name]);
    };
    let result;
    if (brick.key === scoreInput.key && saved.type === C.MicrochipInput.NAME
      && port === 'RER_Output') result = { value: score, kind: 'i64' };
    else if (saved.type === C.Expr_MathMax.NAME) {
      const a = input('InputA'); const b = input('InputB');
      result = { value: Math.max(a.value, b.value),
        kind: a.kind === 'i64' && b.kind === 'i64' ? 'i64' : 'f64' };
    } else if (saved.type === C.Expr_MathMin.NAME) {
      const a = input('InputA'); const b = input('InputB');
      result = { value: Math.min(a.value, b.value),
        kind: a.kind === 'i64' && b.kind === 'i64' ? 'i64' : 'f64' };
    } else if (saved.type === C.Expr_MathDivide.NAME) {
      const a = input('InputA'); const b = input('InputB');
      const bothInteger = a.kind === 'i64' && b.kind === 'i64';
      result = { value: bothInteger ? Math.trunc(a.value / b.value) : a.value / b.value,
        kind: bothInteger ? 'i64' : 'f64' };
    } else if (saved.type === C.Expr_MathModulo.NAME) {
      const a = input('InputA'); const b = input('InputB');
      result = { value: ((a.value % b.value) + b.value) % b.value,
        kind: a.kind === 'i64' && b.kind === 'i64' ? 'i64' : 'f64' };
    } else if (saved.type === C.Expr_MakeColorSRGB.NAME) {
      const channels = Object.fromEntries(['R', 'G', 'B', 'A']
        .map(channel => [channel, input(channel).value / 255]));
      result = { value: channels, kind: 'LinearColor' };
    } else if (saved.type === C.Expr_ColorConvert.NAME) {
      assert.equal(saved.data.FromSpace, 0, 'sync converter starts in RGB');
      assert.equal(saved.data.ToSpace, 3, 'sync converter ends in HSV');
      result = { value: rgbToHsv(input('Input').value), kind: 'LinearColor' };
    } else if (saved.type === C.Expr_SplitColor.NAME) {
      result = { value: input('Input').value[port], kind: 'f64' };
    } else if (saved.type === C.Expr_MathMultiply.NAME) {
      const a = input('InputA'); const b = input('InputB');
      result = { value: a.value * b.value, kind: 'f64' };
    } else throw new Error(`Unsupported evaluator output ${saved.type}.${port}`);
    if (typeof result.value === 'number')
      assert(Number.isFinite(result.value), `${brick.key}.${port} evaluated finite`);
    cache.set(key, result);
    return result;
  }
  return (brick, port) => output(brick, port).value;
}

function test({
  terminalInput = DEFAULT_V9_TERMINAL,
  truckInput = DEFAULT_V4_TRUCK,
  terminalOutput = DEFAULT_V10_TERMINAL,
  truckOutput = DEFAULT_V5_TRUCK,
} = {}) {
  // Re-run the complete v9 contract against v10. This preserves ownership,
  // container metadata, visible geometry, sounds, entry/exit behavior, clocks,
  // two-material preview, color-only BUY, dynamic price text, and truck handles.
  testV9({ terminalInput, truckInput, terminalOutput, truckOutput, selectionMarkers: 'v10' });

  const bytes = fs.readFileSync(terminalOutput);
  const scene = read(bytes);
  const t = api(scene);
  assert(validate(bytes).strictOk, 'v10 terminal passes strict placement');
  assertFiniteScalars(scene.bricks, 'terminal.bricks');
  assertFiniteScalars(scene.edges, 'terminal.edges');

  const splitter = t.row(C.InputSplitter.NAME, () => true, 'color-customizer InputSplitter');
  const coreGrid = splitter.brick.g;
  const scoreInput = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Vehicle Color Score',
    'core Vehicle Color Score input').brick;

  // Locate the decoder by its direct channel topology, not by broad graph
  // reachability. This distinguishes it from the normal live HSV renderer.
  const scoreColors = t.all(C.Expr_MakeColorSRGB.NAME, (_data, brick) => brick.g === coreGrid)
    .filter(({ brick }) => {
      const edges = Object.fromEntries(['R', 'G', 'B'].map(port =>
        [port, t.incoming(brick, C.Expr_MakeColorSRGB.NAME, port)]));
      if (!Object.values(edges).every(list => list.length === 1)) return false;
      const r = t.source(edges.R[0]);
      const g = t.source(edges.G[0]);
      const b = t.source(edges.B[0]);
      if (!component(r, C.Expr_MathDivide.NAME)
        || !component(g, C.Expr_MathModulo.NAME)
        || !component(b, C.Expr_MathModulo.NAME)) return false;
      const greenInput = t.incoming(g, C.Expr_MathModulo.NAME, 'InputA');
      return greenInput.length === 1
        && !!component(t.source(greenInput[0]), C.Expr_MathDivide.NAME);
    });
  assert.equal(scoreColors.length, 1, 'one packed-score RGB decoder');
  const scoreColor = scoreColors[0].brick;

  const red = sourceOf(t, scoreColor, C.Expr_MakeColorSRGB.NAME, 'R', 'score red source');
  assert.equal(red.comp?.type, C.Expr_MathDivide.NAME, 'R is score / 65536 directly');
  assert.equal(valueOf(red.comp.data.InputB), 65536, 'R divisor');

  const green = sourceOf(t, scoreColor, C.Expr_MakeColorSRGB.NAME, 'G', 'score green source');
  assert.equal(green.comp?.type, C.Expr_MathModulo.NAME, 'G ends in modulo directly');
  assert.equal(valueOf(green.comp.data.InputB), 256, 'G modulo');
  const greenBase = sourceOf(t, green.brick, C.Expr_MathModulo.NAME, 'InputA',
    'score green quotient');
  assert.equal(greenBase.comp?.type, C.Expr_MathDivide.NAME, 'G is (score / 256) % 256');
  assert.equal(valueOf(greenBase.comp.data.InputB), 256, 'G divisor');

  const blue = sourceOf(t, scoreColor, C.Expr_MakeColorSRGB.NAME, 'B', 'score blue source');
  assert.equal(blue.comp?.type, C.Expr_MathModulo.NAME, 'B is score % 256 directly');
  assert.equal(valueOf(blue.comp.data.InputB), 256, 'B modulo');

  // R, G-base, and B must read the exact same clamped score source. Walk that
  // source directly back through min/max to the core score input.
  const redScore = sourceOf(t, red.brick, C.Expr_MathDivide.NAME, 'InputA', 'R score');
  const greenScore = sourceOf(t, greenBase.brick, C.Expr_MathDivide.NAME, 'InputA', 'G score');
  const blueScore = sourceOf(t, blue.brick, C.Expr_MathModulo.NAME, 'InputA', 'B score');
  assert.deepEqual([greenScore.edge.a, greenScore.edge.at, greenScore.edge.p],
    [redScore.edge.a, redScore.edge.at, redScore.edge.p], 'G uses the same normalized score as R');
  assert.deepEqual([blueScore.edge.a, blueScore.edge.at, blueScore.edge.p],
    [redScore.edge.a, redScore.edge.at, redScore.edge.p], 'B uses the same normalized score as R');
  assert.equal(redScore.comp?.type, C.Expr_MathMin.NAME, 'score has an upper clamp');
  assert.equal(valueOf(redScore.comp.data.InputB), 0xffffff, 'score upper clamp is 24-bit RGB');
  const lowerClamp = sourceOf(t, redScore.brick, C.Expr_MathMin.NAME, 'InputA',
    'score lower clamp');
  assert.equal(lowerClamp.comp?.type, C.Expr_MathMax.NAME, 'score has a lower clamp');
  assert.equal(valueOf(lowerClamp.comp.data.InputB), 0, 'score lower clamp is zero');
  const rawScore = sourceOf(t, lowerClamp.brick, C.Expr_MathMax.NAME, 'InputA',
    'raw core score');
  assert.equal(rawScore.brick.key, scoreInput.key, 'decoder starts at core Vehicle Color Score');
  assert.equal(rawScore.edge.p, 'RER_Output');

  // Model the exact proven v8 integer topology with constants read from the
  // prefab, then pin representative colors including Truck1's green and the
  // terminal's orange. This detects swapped channels and non-truncating edits.
  const divisors = {
    red: valueOf(red.comp.data.InputB),
    green: valueOf(greenBase.comp.data.InputB),
    greenModulo: valueOf(green.comp.data.InputB),
    blueModulo: valueOf(blue.comp.data.InputB),
  };
  const decode = score => [
    Math.trunc(score / divisors.red),
    Math.trunc(score / divisors.green) % divisors.greenModulo,
    score % divisors.blueModulo,
  ];
  const rgbSamples = new Map([
    [0x000000, [0, 0, 0]],
    [0x4bf400, [75, 244, 0]],
    [0xff8700, [255, 135, 0]],
    [0x123456, [18, 52, 86]],
    [0xffffff, [255, 255, 255]],
  ]);
  for (const [score, expected] of rgbSamples)
    assert.deepEqual(decode(score), expected,
      `packed RGB sample #${score.toString(16).padStart(6, '0')}`);

  // Continue through the actual serialized ColorConvert/Split/Multiply gates
  // and evaluate the exact Value sources wired into the sync setters.
  const converterEdge = t.one(t.outgoing(scoreColor, C.Expr_MakeColorSRGB.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_ColorConvert.NAME && edge.q === 'Input'),
  'score RGB-to-HSV converter');
  const converter = t.target(converterEdge);
  const splitEdge = t.one(t.outgoing(converter, C.Expr_ColorConvert.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_SplitColor.NAME && edge.q === 'Input'),
  'score HSV split');
  const hsvSplit = t.target(splitEdge);
  const percent = port => {
    const edge = t.one(t.outgoing(hsvSplit, C.Expr_SplitColor.NAME, port)
      .filter(candidate => candidate.zt === C.Expr_MathMultiply.NAME
        && candidate.q === 'InputA'
        && valueOf(component(t.target(candidate), C.Expr_MathMultiply.NAME).data.InputB) === 100),
    `HSV ${port} percent conversion`);
    return t.target(edge);
  };
  const saturationPercent = percent('G');
  const brightnessPercent = percent('B');
  const setterValue = (source, sourceType, sourcePort, label) => {
    const edge = t.one(t.outgoing(source, sourceType, sourcePort)
      .filter(candidate => candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Value'), label);
    return { setter: t.target(edge), source, port: sourcePort };
  };
  const hsvSetterValues = [
    setterValue(hsvSplit, C.Expr_SplitColor.NAME, 'R', 'Hue sync setter Value'),
    setterValue(saturationPercent, C.Expr_MathMultiply.NAME, 'Output',
      'Saturation sync setter Value'),
    setterValue(brightnessPercent, C.Expr_MathMultiply.NAME, 'Output',
      'Brightness sync setter Value'),
  ];
  const hsvSamples = new Map([
    ['FF8700', [0xff8700, [31.764705882352942, 100, 100]]],
    ['GREEN', [0x00ff00, [120, 100, 100]]],
    ['BLUE', [0x0000ff, [240, 100, 100]]],
    ['GRAY', [0x808080, [0, 0, 50.19607843137255]]],
    ['123456', [0x123456, [210, 79.06976744186046, 33.72549019607843]]],
  ]);
  const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`);
  for (const [label, [score, expected]] of hsvSamples) {
    const evaluate = makeEvaluator(t, scoreInput, score);
    const actual = hsvSetterValues.map(item => evaluate(item.source, item.port));
    actual.forEach((value, index) => close(value, expected[index], `${label} HSV[${index}]`));
  }

  // The property getters update their values on the same execution that starts
  // synchronization. One tick is required for the multi-chip decoder values to
  // settle before the H/S/B setter transaction executes.
  const syncOutput = t.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Appearance Sync'
      && brick.g !== coreGrid, 'terminal Appearance Sync output');
  const syncSource = sourceOf(t, syncOutput.brick, C.MicrochipOutput.NAME,
    'RER_Input', 'buffered Appearance Sync source');
  assert.equal(syncSource.comp?.type, C.BufferTicks.NAME,
    'Appearance Sync is delayed through BufferTicks');
  assert.equal(valueOf(syncSource.comp.data.TicksToWait), 1,
    'Appearance Sync waits exactly one tick');
  const bufferInput = sourceOf(t, syncSource.brick, C.BufferTicks.NAME,
    'Input', 'Appearance Sync buffer input');
  assert.equal(bufferInput.comp?.type, C.Exec_Branch.NAME,
    'successful appearance guard starts the sync buffer');
  assert.equal(bufferInput.edge.p, 'ExecOutA',
    'only the successful property guard starts synchronization');

  // Six selectable rows keep their selected label/value orange without any
  // left '>' glyph. Their only visible marker is one right-side '<', and that
  // suffix is shared-gated by selection plus the active 0.25-second phase.
  const selectStrings = t.all(C.Expr_Select.NAME).flatMap(({ comp }) =>
    ['InputA', 'InputB'].map(field => valueOf(comp.data[field])).filter(value =>
      typeof value === 'string'));
  assert(!selectStrings.some(value => value.includes('> ')),
    'No selector literal retains a left > marker');
  const prefixes = t.all(C.Expr_Select.NAME, data =>
    valueOf(data.InputA) === '' && valueOf(data.InputB) === '<color="ff8700">');
  const suffixes = t.all(C.Expr_Select.NAME, data =>
    valueOf(data.InputA) === '  </>' && valueOf(data.InputB) === ' <</>');
  assert.equal(prefixes.length, 6, 'Six color-open-only selected row prefixes');
  assert.equal(suffixes.length, 6, 'Six single-right-marker blinking suffixes');
  const purchaseFallback = t.row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === 'PRICE: 🔩{A}\r\n{B}', 'purchase fallback formatter');
  assert.equal(valueOf(purchaseFallback.comp.data.InputB), 'BUY',
    'Inactive purchase fallback has no marker');
  const physicalScreen = t.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'physical screen fallback');
  assert(/\r\nBUY\r\n/.test(physicalScreen.comp.data.Text),
    'Physical inactive screen fallback shows plain BUY');
  assert(!physicalScreen.comp.data.Text.includes('> BUY <'),
    'Physical inactive screen fallback has no stale two-sided marker');

  const blinkPorts = [
    ...t.all(C.MicrochipOutput.NAME, data => data.PortLabel === 'Selection Blink'),
    ...t.all(C.MicrochipInput.NAME, data => data.PortLabel === 'Selection Blink'),
  ];
  assert.equal(blinkPorts.length, 3, 'Selection Blink crosses terminal/config/core layers');
  for (const port of blinkPorts) {
    const fields = port.comp.type === C.MicrochipOutput.NAME
      ? ['CallableDefault', 'CallableResult'] : ['CallableDefault', 'CallableMirror'];
    for (const field of fields) assert.equal(port.comp.data[field]?.$variant, 'Bool',
      `Selection Blink ${field} is a Bool`);
  }
  const coreBlink = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Selection Blink',
    'core Selection Blink input');
  for (const [index, suffix] of suffixes.entries()) {
    const markerGate = sourceOf(t, suffix.brick, C.Expr_Select.NAME, 'bSelectB',
      `row ${index} blinking suffix condition`);
    assert.equal(markerGate.comp?.type, C.Expr_LogicalAND.NAME,
      `row ${index} marker uses selected AND blink`);
    const inputs = [
      ...t.incoming(markerGate.brick, C.Expr_LogicalAND.NAME, 'bInputA'),
      ...t.incoming(markerGate.brick, C.Expr_LogicalAND.NAME, 'bInputB'),
    ];
    assert.equal(inputs.length, 2, `row ${index} marker has two conditions`);
    assert(inputs.some(edge => edge.at === C.Expr_CompareEqual.NAME),
      `row ${index} retains its selection compare`);
    assert(inputs.some(edge => edge.a === coreBlink.brick.key
      && edge.at === C.MicrochipInput.NAME), `row ${index} uses shared active blink`);
  }

  const blinkClock = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9, '0.25-second selection blink clock');
  assert.equal(blinkClock.comp.data.bEnabled, false, 'Selection clock is saved disabled');
  const clockEnable = sourceOf(t, blinkClock.brick, C.Clock.NAME, 'bEnabled',
    'selection clock active-session enable');
  assert.equal(clockEnable.comp?.type, C.Var.NAME, 'Selection clock is driven by session Var');
  assert.equal(clockEnable.comp.data.Value?.$variant, 'Bool', 'Session Var is boolean');

  const blinkOutput = t.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Selection Blink', 'terminal Selection Blink output');
  const activeVisible = sourceOf(t, blinkOutput.brick, C.MicrochipOutput.NAME,
    'RER_Input', 'active visible blink source');
  assert.equal(activeVisible.comp?.type, C.Expr_LogicalAND.NAME,
    'Blink output explicitly requires active session');
  assert(t.incoming(activeVisible.brick, C.Expr_LogicalAND.NAME)
    .some(edge => edge.a === clockEnable.brick.key && edge.at === C.Var.NAME),
  'Clock and visibility use the same ready-session Var');

  const toggleSetterEdge = t.one(t.outgoing(blinkClock.brick, C.Clock.NAME, 'Pulse')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Exec'),
  'clock toggles blink state');
  const toggleSetter = t.target(toggleSetterEdge);
  const blinkVarEdge = t.one(t.incoming(toggleSetter, C.Exec_Var_Set.NAME, 'VarRef'),
    'blink state VarRef');
  const blinkVar = t.source(blinkVarEdge);
  assert.equal(component(blinkVar, C.Var.NAME)?.data.Value?.value, false,
    'Blink state starts/reset hidden');
  const inverted = sourceOf(t, toggleSetter, C.Exec_Var_Set.NAME, 'Value', 'toggle inverted value');
  assert.equal(inverted.comp?.type, C.Expr_LogicalNOT.NAME, 'Clock pulse writes inverted phase');
  assert(t.incoming(inverted.brick, C.Expr_LogicalNOT.NAME, 'bInput')
    .some(edge => edge.a === blinkVar.key), 'Blink state feeds its inverter');

  const sessionEdge = t.row(C.Expr_EdgeDetectorExec.NAME, (_data, brick) =>
    t.incoming(brick, C.Expr_EdgeDetectorExec.NAME, 'Input')
      .some(edge => edge.a === clockEnable.brick.key), 'session blink reset edge detector');
  const rise = t.one(t.outgoing(sessionEdge.brick, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge'),
    'session rise reset');
  const fall = t.one(t.outgoing(sessionEdge.brick, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge'),
    'session exit reset');
  assert.equal(rise.z, fall.z, 'Session rise and exit share one blink reset union');
  const resetUnion = t.target(rise);
  assert.equal(component(resetUnion, C.Exec_Union.NAME)?.type, C.Exec_Union.NAME,
    'Session edges merge through reset union');
  const resetEdge = t.one(t.outgoing(resetUnion, C.Exec_Union.NAME, 'ExecOut')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'blink reset setter');
  const resetSetter = t.target(resetEdge);
  assert(t.incoming(resetSetter, C.Exec_Var_Set.NAME, 'VarRef')
    .some(edge => edge.a === blinkVar.key), 'Session reset targets blink state');
  assert.equal(component(resetSetter, C.Exec_Var_Set.NAME).data.Value?.value, false,
    'Session start/exit reset hides marker');

  const redAffordability = t.row(C.Expr_String_FormatText.NAME,
    data => /<color="ff3030">PRICE:/.test(data.FormatString || ''),
    'red affordability formatter');
  assert(redAffordability.comp.data.FormatString.includes('\r\nBUY <'),
    'Red affordability phase uses only the right marker');
  assert(!redAffordability.comp.data.FormatString.includes('> BUY <'),
    'Red affordability phase has no left marker');
  assert.equal(t.all(C.BufferSeconds.NAME,
    data => Math.abs(data.SecondsToWait - Math.fround(0.2)) < 1e-8).length, 5,
  'Existing finite 0.2-second affordability blink remains intact');

  console.log(JSON.stringify({
    terminalOutput,
    terminalBricks: scene.bricks.length,
    terminalWires: scene.edges.length,
    decoder: 'R=score/65536, G=(score/256)%256, B=score%256',
    decoderSamples: rgbSamples.size,
    serializedHsvSamples: hsvSamples.size,
    appearanceSyncDelayTicks: 1,
    selectionMarker: 'orange label + blinking right < only',
    selectionBlinkSeconds: 0.25,
    affordabilityBlinkPreserved: true,
    finiteScalars: true,
    strictPlacement: true,
    v9Regressions: 'passed',
    checks: 'passed',
  }, null, 2));
  return { scene, scoreColor, syncBuffer: syncSource.brick };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_V9_TERMINAL,
  truckInput: process.argv[3] || DEFAULT_V4_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V10_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V5_TRUCK,
});

module.exports = test;

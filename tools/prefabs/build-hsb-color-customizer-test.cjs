'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const validate = require('./validate-placement.cjs');
const { B, C, N, S } = require('./loadboard-lib.cjs');

function one(values, label) {
  assert.equal(values.length, 1, `Expected one ${label}, found ${values.length}`);
  return values[0];
}

function build(input) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const seatBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.Seat.NAME)), 'seat');
  const screenBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && comp.data.Text === 'Screen')), 'menu screen');
  const squareBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && comp.data.Text === '■')), 'preview square');
  const changerBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.BrickPropertyChanger.NAME)), 'preview property changer');
  const seatData = seatBrick.comps.find(comp => comp.type === C.Seat.NAME).data;
  seatData.PromptCustomLabel = 'Open Color Customizer';
  seatData.bAllowNearbyInteraction = true;

  const newGrid = Math.max(1, ...[...scene.r.entities()].map(entity => entity.persistentIndex)) + 1;
  const colors = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`Color${index}`, { R: 45, G: 115, B: 175, A: 255 }]));
  scene.extraEntities = [{
    typeName: 'Entity_MicrochipDynamicBrickGrid',
    className: 'BP_MicrochipBrickGridDynamicActor_C',
    persistentIndex: newGrid,
    ownerIndex: 0,
    originalOwnerIndex: 0,
    location: { X: 0, Y: 0, Z: 0 },
    rotation: { X: 0, Y: 0, Z: 0, W: 1 },
    frozen: true,
    sleeping: false,
    linearVelocity: { X: 0, Y: 0, Z: 0 },
    angularVelocity: { X: 0, Y: 0, Z: 0 },
    colors,
    remainingLifeSpan: 0,
    data: {
      bCollapsed: true,
      bLegacyIOSlotOrder: true,
      PlaneCenter: { X: 216, Y: 216, Z: 2 },
      PlaneExtent: { X: 360, Y: 360, Z: 8 },
    },
  }];
  scene.extraGridIds = new Set([newGrid]);

  const chip = {
    key: 'hsb:physical-chip',
    g: 1,
    data: {
      asset: C.Microchip.BRICK,
      material: 'BMC_Plastic',
      position: [7005, -75110, 10940],
      size: [0, 0, 0],
      direction: 4,
      rotation: 0,
      collision: { player: true, weapon: true, interaction: true, tool: true, physics: true },
      visibility: true,
      material_intensity: 0,
      color: [45, 115, 175],
      owner_index: 0,
    },
    comps: [{ type: C.Microchip.NAME, data: {} }],
  };
  scene.bricks.push(chip);
  scene.links.push({ key: chip.key, grid: newGrid });

  const nodes = [];
  let sequence = 0;
  function node(kind, data = {}) {
    const definition = C[kind];
    assert(definition, kind);
    const index = sequence++;
    const brick = {
      key: `hsb:${index}:${kind}`,
      g: newGrid,
      data: {
        asset: definition.BRICK,
        material: 'BMC_Plastic',
        position: [(index % 10) * 48, Math.floor(index / 10) * 48, 2],
        size: [0, 0, 0],
        direction: 4,
        rotation: 0,
        collision: { player: true, weapon: true, interaction: true, tool: true, physics: true },
        visibility: true,
        material_intensity: 0,
        color: [45, 115, 175],
        owner_index: 0,
      },
      comps: [{ type: definition.NAME, data }],
    };
    scene.bricks.push(brick);
    const result = { key: brick.key, type: definition.NAME };
    nodes.push(result);
    return result;
  }
  function ref(brick, type) { return { key: brick.key, type }; }
  function componentDefinition(type) { return Object.values(C).find(definition => definition.NAME === type); }
  function wire(source, sourcePort, target, targetPort) {
    const sourceDefinition = componentDefinition(source.type);
    const targetDefinition = componentDefinition(target.type);
    assert(sourceDefinition?.PORTS[sourcePort] || Object.values(sourceDefinition?.PORTS || {}).includes(sourcePort), `${source.type}.${sourcePort}`);
    assert(targetDefinition?.PORTS[targetPort] || Object.values(targetDefinition?.PORTS || {}).includes(targetPort), `${target.type}.${targetPort}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === target.type && edge.q === targetPort), `Duplicate ${target.type}.${targetPort}`);
    scene.edges.push({ a: source.key, at: source.type, p: sourcePort, z: target.key, zt: target.type, q: targetPort });
  }
  function edge(splitter, port, comparison, threshold) {
    const compare = node(`Expr_Compare${comparison}`, { InputB: N(threshold) });
    wire(splitter, port, compare, 'InputA');
    const detector = node('Expr_EdgeDetectorExec', { Input: 0, InputLast: 0, bSeeded: true });
    wire(compare, 'bOutput', detector, 'Input');
    detector.comparison = compare;
    return detector;
  }
  function setValue(variable, value, valuePort, trigger, triggerPort) {
    const setter = node('Exec_Var_Set', { Value: N(0), bChangeType: false });
    wire(variable, 'VarRef', setter, 'VarRef');
    wire(value, valuePort, setter, 'Value');
    wire(trigger, triggerPort, setter, 'Exec');
    return setter;
  }
  function setConstant(variable, value, trigger, triggerPort) {
    const setter = node('Exec_Var_Set', { Value: B(value), bChangeType: false });
    wire(variable, 'VarRef', setter, 'VarRef');
    wire(trigger, triggerPort, setter, 'Exec');
    return setter;
  }
  function math(kind, source, sourcePort, constant) {
    const gate = node(`Expr_Math${kind}`, { InputB: N(constant) });
    wire(source, sourcePort, gate, 'InputA');
    return gate;
  }
  function branch(condition, trigger, triggerPort = 'OnRisingEdge') {
    const gate = node('Exec_Branch', { bCond: false });
    wire(condition, 'bOutput', gate, 'bCond');
    wire(trigger, triggerPort, gate, 'Exec');
    return gate;
  }
  function select(condition, inputA, inputB) {
    const gate = node('Expr_Select', {
      InputA: Array.isArray(inputA) ? N(0) : N(inputA),
      InputB: Array.isArray(inputB) ? N(0) : N(inputB),
      bSelectB: false,
    });
    if (Array.isArray(inputA)) wire(inputA[0], inputA[1], gate, 'InputA');
    if (Array.isArray(inputB)) wire(inputB[0], inputB[1], gate, 'InputB');
    wire(condition, 'bOutput', gate, 'bSelectB');
    return gate;
  }

  const seat = ref(seatBrick, C.Seat.NAME);
  const splitter = node('InputSplitter');
  wire(seat, 'SittingCharacter', splitter, 'Character');
  const selection = node('Var', { Value: N(0) });
  const hue = node('Var', { Value: N(0) });
  const saturation = node('Var', { Value: N(100) });
  const brightness = node('Var', { Value: N(100) });

  const up = edge(splitter, 'InputForward', 'Greater', 0.5);
  const down = edge(splitter, 'InputForward', 'Less', -0.5);
  const left = edge(splitter, 'InputRight', 'Less', -0.5);
  const right = edge(splitter, 'InputRight', 'Greater', 0.5);
  const space = edge(splitter, 'InputUp', 'Greater', 0.5);

  const previousRaw = math('Add', selection, 'Value', 3);
  const previous = node('Expr_MathModuloFloored', { InputB: N(4) });
  wire(previousRaw, 'Output', previous, 'InputA');
  setValue(selection, previous, 'Output', up, 'OnRisingEdge');
  const nextRaw = math('Add', selection, 'Value', 1);
  const next = node('Expr_MathModuloFloored', { InputB: N(4) });
  wire(nextRaw, 'Output', next, 'InputA');
  setValue(selection, next, 'Output', down, 'OnRisingEdge');

  const selected = Array.from({ length: 4 }, (_, index) => {
    const compare = node('Expr_CompareEqual', { InputB: N(index) });
    wire(selection, 'Value', compare, 'InputA');
    return compare;
  });

  function adjust(variable, selectedIndex, movement, movementPort, direction, increment, wrap) {
    const routed = branch(selected[selectedIndex], movement, movementPort);
    const amount = direction === 'right' ? increment : (wrap ? wrap - increment : -increment);
    const changed = math('Add', variable, 'Value', amount);
    let final = changed;
    if (wrap) {
      final = node('Expr_MathModuloFloored', { InputB: N(wrap) });
      wire(changed, 'Output', final, 'InputA');
    } else {
      final = node('Expr_MathClamp', { Input: N(0), Min: N(0), Max: N(100) });
      wire(changed, 'Output', final, 'Input');
    }
    setValue(variable, final, 'Output', routed, 'ExecOutA');
  }
  function repeatAfterHold(control) {
    const timer = node('Stopwatch', { Limit: 0.5, Time: 0, bRunning: false });
    wire(control, 'OnRisingEdge', timer, 'Restart');
    wire(control, 'OnFallingEdge', timer, 'Pause');
    const repeating = node('Var', { Value: B(false) });
    setConstant(repeating, true, timer, 'Expired');
    setConstant(repeating, false, control, 'OnFallingEdge');
    const clock = node('Clock', { IntervalSeconds: N(0.1), bEnabled: false });
    wire(repeating, 'Value', clock, 'bEnabled');
    return clock;
  }
  const leftRepeat = repeatAfterHold(left);
  const rightRepeat = repeatAfterHold(right);
  for (const [movement, movementPort, direction] of [
    [left, 'OnRisingEdge', 'left'], [right, 'OnRisingEdge', 'right'],
    [leftRepeat, 'Pulse', 'left'], [rightRepeat, 'Pulse', 'right'],
  ]) {
    adjust(hue, 0, movement, movementPort, direction, 1, 360);
    adjust(saturation, 1, movement, movementPort, direction, 1, 0);
    adjust(brightness, 2, movement, movementPort, direction, 1, 0);
  }

  // HSV/HSB to RGB conversion.
  const sNorm = math('Divide', saturation, 'Value', 100);
  const vNorm = math('Divide', brightness, 'Value', 100);
  const chroma = node('Expr_MathMultiply');
  wire(vNorm, 'Output', chroma, 'InputA');
  wire(sNorm, 'Output', chroma, 'InputB');
  const hPrime = math('Divide', hue, 'Value', 60);
  const hModulo = node('Expr_MathModuloFloored', { InputB: N(2) });
  wire(hPrime, 'Output', hModulo, 'InputA');
  const hMinusOne = math('Subtract', hModulo, 'Output', 1);
  const hAbs = node('Expr_MathAbs', { Input: N(0) });
  wire(hMinusOne, 'Output', hAbs, 'Input');
  const inverse = node('Expr_MathSubtract', { InputA: N(1), InputB: N(0) });
  wire(hAbs, 'Output', inverse, 'InputB');
  const xValue = node('Expr_MathMultiply');
  wire(chroma, 'Output', xValue, 'InputA');
  wire(inverse, 'Output', xValue, 'InputB');
  const minimum = node('Expr_MathSubtract');
  wire(vNorm, 'Output', minimum, 'InputA');
  wire(chroma, 'Output', minimum, 'InputB');
  const sector = node('Expr_Floor', { Input: N(0) });
  wire(hPrime, 'Output', sector, 'Input');
  const sectors = Array.from({ length: 6 }, (_, index) => {
    const compare = node('Expr_CompareEqual', { InputB: N(index) });
    wire(sector, 'Output', compare, 'InputA');
    return compare;
  });
  const zero = 0;
  const Csignal = [chroma, 'Output'];
  const Xsignal = [xValue, 'Output'];
  function sectorValue(values) {
    let current = values[0];
    for (let index = 1; index < 6; index++) current = [select(sectors[index], current, values[index]), 'Output'];
    return current;
  }
  const primes = [
    sectorValue([Csignal, Xsignal, zero, zero, Xsignal, Csignal]),
    sectorValue([Xsignal, Csignal, Csignal, Xsignal, zero, zero]),
    sectorValue([zero, zero, Xsignal, Csignal, Csignal, Xsignal]),
  ];
  const channels = primes.map(prime => {
    const shifted = node('Expr_MathAdd');
    assert(Array.isArray(prime), 'RGB sector output must be a gate signal');
    wire(prime[0], prime[1], shifted, 'InputA');
    wire(minimum, 'Output', shifted, 'InputB');
    const scaled = math('Multiply', shifted, 'Output', 255);
    return scaled;
  });

  const square = ref(squareBrick, C.TextDisplay.NAME);
  const changer = ref(changerBrick, C.BrickPropertyChanger.NAME);
  ['R', 'G', 'B'].forEach((channel, index) => {
    wire(channels[index], 'Output', square, `Color.${channel}`);
    wire(channels[index], 'Output', changer, `Color.${channel}`);
  });

  const markers = selected.map(compare => {
    const marker = node('Expr_Select', { InputA: S('  '), InputB: S('> '), bSelectB: false });
    wire(compare, 'bOutput', marker, 'bSelectB');
    return marker;
  });
  const closingMarkers = selected.map(compare => {
    const marker = node('Expr_Select', { InputA: S(''), InputB: S(' <'), bSelectB: false });
    wire(compare, 'bOutput', marker, 'bSelectB');
    return marker;
  });
  function menuRow(index, template, value) {
    const row = node('Expr_String_FormatText', { FormatString: template });
    wire(markers[index], 'Output', row, 'InputA');
    if (value) wire(value[0], value[1], row, 'InputB');
    wire(closingMarkers[index], 'Output', row, value ? 'InputC' : 'InputB');
    return row;
  }
  const rows = [
    menuRow(0, '{A}HUE           {B}°{C}', [hue, 'Value']),
    menuRow(1, '{A}SATURATION    {B}%{C}', [saturation, 'Value']),
    menuRow(2, '{A}BRIGHTNESS    {B}%{C}', [brightness, 'Value']),
    menuRow(3, '{A}APPLY{B}'),
  ];
  const format = node('Expr_String_FormatText', {
    FormatString: 'COLOR CUSTOMIZER\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD 0.5s: REPEAT\r\nSPACE APPLY',
  });
  rows.forEach((row, index) => wire(row, 'Output', format, `Input${String.fromCharCode(65 + index)}`));
  const screen = ref(screenBrick, C.TextDisplay.NAME);
  wire(format, 'Output', screen, 'Text');
  const screenData = screenBrick.comps.find(comp => comp.type === C.TextDisplay.NAME).data;
  Object.assign(screenData, {
    Text: 'COLOR CUSTOMIZER',
    Color: { R: 235, G: 240, B: 255, A: 255 },
    bOverrideColor: true,
    LineHeight: 1.05,
    WidthScale: 0.78,
    Anchor: { X: 0.5, Y: 0.5 },
  });
  const squareData = squareBrick.comps.find(comp => comp.type === C.TextDisplay.NAME).data;
  squareData.OutlineWidth = 2;
  squareData.WidthScale = 2;
  squareData.LineHeight = 2.5;

  const apply = branch(selected[3], space);
  const assets = structuredClone(scene.r.externalAssets());
  let soundIndex = assets.findIndex(asset => asset.type === 'BrickOneShotAudioDescriptor' && asset.name === 'OBA_CashRegister_Ding_2');
  if (soundIndex < 0) {
    soundIndex = assets.length;
    assets.push({ type: 'BrickOneShotAudioDescriptor', name: 'OBA_CashRegister_Ding_2' });
  }
  const sound = node('OneShotAudioEmitter', {
    AudioDescriptor: soundIndex,
    VolumeMultiplier: 0.5,
    PitchMultiplier: 1,
    InnerRadius: 30,
    MaxDistance: 250,
    bSpatialization: true,
    bEnableRepeat: false,
    RepeatCount: 1,
    RepeatTime: 1,
    RepeatVariance: 0,
  });
  wire(apply, 'ExecOutA', sound, 'Play');

  const name = 'HSB Color Customizer Test';
  const description = 'Seat-controlled HSB color editor. W/S selects Hue, Saturation, Brightness, or Apply; A/D adjusts; Space confirms. Both preview displays update live.';
  const generated = write(scene, { assets, name, description }).bytes;
  const bytes = repack(generated, donor, { name, description });
  const placement = validate(bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  return {
    bytes,
    scene,
    placement,
    summary: {
      bricks: scene.bricks.length,
      gates: nodes.length,
      wires: scene.edges.length,
      chipAdded: true,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-hsb-color-customizer-test.cjs input.brz output.brz');
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({ output, bytes: result.bytes.length, ...result.summary, strictPlacement: result.placement.strictOk }, null, 2));
}

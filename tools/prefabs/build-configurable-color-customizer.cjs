'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const validate = require('./validate-placement.cjs');
const { B, C, N, S } = require('./loadboard-lib.cjs');

const COLLISION = { player: true, weapon: true, interaction: true, tool: true, physics: true };

function one(values, label) {
  assert.equal(values.length, 1, `Expected one ${label}, found ${values.length}`);
  return values[0];
}

function build(input) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const assets = structuredClone(scene.r.externalAssets());

  const mainChipLink = one(scene.links, 'existing main microchip link');
  const mainGrid = mainChipLink.grid;
  const seatBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.Seat.NAME)), 'seat');
  const screenBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && /COLOR CUSTOMIZER/.test(comp.data.Text))), 'customizer screen');
  const squareBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && comp.data.Text === '■')), 'color preview square');
  const changerBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.BrickPropertyChanger.NAME)), 'preview property changer');

  // Replace only the prior generated logic. User-authored presentation geometry,
  // the seat, displays, preview brick, dynamic joint, and frame remain intact.
  const removed = new Set(scene.bricks.filter(brick => brick.g === mainGrid).map(brick => brick.key));
  scene.bricks = scene.bricks.filter(brick => !removed.has(brick.key));
  scene.edges = scene.edges.filter(edge => !removed.has(edge.a) && !removed.has(edge.z));
  scene.links = scene.links.filter(link => !removed.has(link.key));

  const mainEntity = one([...scene.r.entities()].filter(entity => entity.persistentIndex === mainGrid), 'main chip entity');
  scene.entityOverrides = new Map([[mainGrid, {
    ...mainEntity,
    data: {
      ...structuredClone(mainEntity.data),
      bCollapsed: true,
      bLegacyIOSlotOrder: true,
      PlaneCenter: { X: 0, Y: 0, Z: 2 },
      PlaneExtent: { X: 360, Y: 300, Z: 8 },
    },
  }]]);

  const innerGrid = Math.max(...[...scene.r.entities()].map(entity => entity.persistentIndex)) + 1;
  const palette = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `Color${index}`,
    { R: index === 0 ? 42 : 55, G: index === 0 ? 68 : 105, B: index === 0 ? 110 : 165, A: 255 },
  ]));
  scene.extraEntities = [{
    typeName: 'Entity_MicrochipDynamicBrickGrid',
    className: 'BP_MicrochipBrickGridDynamicActor_C',
    persistentIndex: innerGrid,
    ownerIndex: 0,
    originalOwnerIndex: 0,
    location: { X: 0, Y: 0, Z: 0 },
    rotation: { X: 0, Y: 0, Z: 0, W: 1 },
    frozen: true,
    sleeping: false,
    linearVelocity: { X: 0, Y: 0, Z: 0 },
    angularVelocity: { X: 0, Y: 0, Z: 0 },
    colors: palette,
    remainingLifeSpan: 0,
    data: {
      bCollapsed: true,
      bLegacyIOSlotOrder: true,
      PlaneCenter: { X: 264, Y: 456, Z: 2 },
      PlaneExtent: { X: 340, Y: 520, Z: 8 },
    },
  }];
  scene.extraGridIds = new Set([innerGrid]);

  const nodes = [];
  let serial = 0;
  let innerSerial = 0;
  function componentDefinition(type) {
    return Object.values(C).find(definition => definition.NAME === type);
  }
  function addBrick(key, grid, asset, position, color, comps) {
    const brick = {
      key,
      g: grid,
      data: {
        asset,
        material: 'BMC_Plastic',
        position,
        size: [0, 0, 0],
        direction: 4,
        rotation: 0,
        collision: structuredClone(COLLISION),
        visibility: true,
        material_intensity: 0,
        color,
        owner_index: 0,
      },
      comps,
    };
    scene.bricks.push(brick);
    return brick;
  }
  function node(kind, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, kind);
    const grid = options.grid ?? innerGrid;
    let position = options.position;
    if (!position) {
      const index = innerSerial++;
      position = [(index % 12) * 48, Math.floor(index / 12) * 48, 2];
    }
    const brick = addBrick(
      `customizer-v2:${serial++}:${kind}`,
      grid,
      definition.BRICK,
      position,
      options.color ?? (grid === mainGrid ? [185, 105, 45] : [45, 105, 165]),
      [{ type: definition.NAME, data }],
    );
    const result = { key: brick.key, type: definition.NAME, brick };
    nodes.push(result);
    return result;
  }
  function ref(brick, type) { return { key: brick.key, type }; }
  function wire(source, sourcePort, target, targetPort) {
    const sourceDefinition = componentDefinition(source.type);
    const targetDefinition = componentDefinition(target.type);
    assert(sourceDefinition?.PORTS[sourcePort] || Object.values(sourceDefinition?.PORTS || {}).includes(sourcePort), `${source.type}.${sourcePort}`);
    assert(targetDefinition?.PORTS[targetPort] || Object.values(targetDefinition?.PORTS || {}).includes(targetPort), `${target.type}.${targetPort}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === target.type && edge.q === targetPort), `Duplicate ${target.type}.${targetPort}`);
    scene.edges.push({ a: source.key, at: source.type, p: sourcePort, z: target.key, zt: target.type, q: targetPort });
  }
  function math(kind, source, sourcePort, constant) {
    const gate = node(`Expr_Math${kind}`, { InputB: N(constant) });
    wire(source, sourcePort, gate, 'InputA');
    return gate;
  }
  function select(condition, inputA, inputB) {
    const gate = node('Expr_Select', {
      InputA: Array.isArray(inputA) ? N(0) : (typeof inputA === 'string' ? S(inputA) : N(inputA)),
      InputB: Array.isArray(inputB) ? N(0) : (typeof inputB === 'string' ? S(inputB) : N(inputB)),
      bSelectB: false,
    });
    if (Array.isArray(inputA)) wire(inputA[0], inputA[1], gate, 'InputA');
    if (Array.isArray(inputB)) wire(inputB[0], inputB[1], gate, 'InputB');
    wire(condition, 'bOutput', gate, 'bSelectB');
    return gate;
  }
  function branch(condition, trigger, triggerPort = 'OnRisingEdge') {
    const gate = node('Exec_Branch', { bCond: false });
    wire(condition, 'bOutput', gate, 'bCond');
    wire(trigger, triggerPort, gate, 'Exec');
    return gate;
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
  function execUnion(sources) {
    assert(sources.length, 'Exec union needs a source');
    let current = sources[0];
    for (const source of sources.slice(1)) {
      const union = node('Exec_Union');
      wire(current[0], current[1], union, 'ExecA');
      wire(source[0], source[1], union, 'ExecB');
      current = [union, 'ExecOut'];
    }
    return current;
  }
  function edge(splitter, port, comparison, threshold) {
    const compare = node(`Expr_Compare${comparison}`, { InputB: N(threshold) });
    wire(splitter, port, compare, 'InputA');
    const detector = node('Expr_EdgeDetectorExec', { Input: 0, InputLast: 0, bSeeded: true });
    wire(compare, 'bOutput', detector, 'Input');
    detector.comparison = compare;
    return detector;
  }

  // Editable outer chip ----------------------------------------------------
  const nestedChipBrick = addBrick(
    'customizer-v2:nested-chip', mainGrid, C.Microchip.BRICK, [0, 0, 2], [35, 55, 90],
    [{ type: C.Microchip.NAME, data: {} }],
  );
  scene.links.push({ key: nestedChipBrick.key, grid: innerGrid });

  const outer = { grid: mainGrid };
  outer.repeatInterval = node('Var', { Value: N(0.025) }, { grid: mainGrid, position: [-240, -192, 2], color: [70, 170, 95] });
  const soundSpecs = [
    ['Apply', 'OBA_CashRegister_Ding_2', 0.5],
    ['Select', 'OBA_Keypad', 0.32],
    ['Tap', 'OBA_Keyboard', 0.26],
    ['Repeat', 'OBA_Keyboard', 0.11],
  ];
  function assetIndex(name) {
    let index = assets.findIndex(asset => asset.type === 'BrickOneShotAudioDescriptor' && asset.name === name);
    if (index < 0) {
      index = assets.length;
      assets.push({ type: 'BrickOneShotAudioDescriptor', name });
    }
    return index;
  }
  outer.sounds = soundSpecs.map(([label, name, volume], index) => ({
    label,
    reference: node('OneShotAudioReference', { Asset: assetIndex(name) }, {
      grid: mainGrid, position: [-144 + index * 96, -192, 2], color: [145, 75, 175],
    }),
    volume: node('Var', { Value: N(volume) }, {
      grid: mainGrid, position: [-144 + index * 96, -264, 2], color: [95, 150, 185],
    }),
  }));

  function outerFormat(template, position) {
    return node('Expr_String_FormatText', { FormatString: template }, {
      grid: mainGrid, position, color: [205, 120, 40],
    });
  }
  outer.rows = [
    outerFormat('{A}HUE           {B}°{C}', [-240, 144, 2]),
    outerFormat('{A}SATURATION    {B}%{C}', [-144, 144, 2]),
    outerFormat('{A}BRIGHTNESS    {B}%{C}', [-48, 144, 2]),
    outerFormat('{A}METAL         {B}{C}', [48, 144, 2]),
    outerFormat('{A}INTENSITY     {B}%{C}', [144, 144, 2]),
    outerFormat('{A}APPLY{B}', [240, 144, 2]),
  ];
  outer.master = outerFormat(
    'COLOR CUSTOMIZER\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n{E}\r\n{F}\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nSPACE APPLY',
    [0, 240, 2],
  );
  outer.rows.forEach((row, index) => wire(row, 'Output', outer.master, `Input${String.fromCharCode(65 + index)}`));

  outer.outputs = [
    node('MicrochipOutput', { PortLabel: 'Color', PortOrder: 1 }, { grid: mainGrid, position: [240, 48, 2], color: [55, 145, 215] }),
    node('MicrochipOutput', { PortLabel: 'Metal Material Toggle', PortOrder: 2, CallableDefault: B(true), CallableResult: B(true) }, {
      grid: mainGrid, position: [240, 0, 2], color: [55, 145, 215],
    }),
    node('MicrochipOutput', { PortLabel: 'Material Intensity', PortOrder: 3, CallableDefault: N(255), CallableResult: N(255) }, {
      grid: mainGrid, position: [240, -48, 2], color: [55, 145, 215] }),
  ];

  // Hidden inner chip interface -------------------------------------------
  let inputOrder = 1;
  function innerInput(label, defaultValue) {
    const data = { PortLabel: label, PortOrder: inputOrder++ };
    if (defaultValue !== undefined) {
      data.CallableDefault = defaultValue;
      data.CallableMirror = defaultValue;
    }
    return node('MicrochipInput', data, { color: [85, 145, 205] });
  }
  const characterInput = innerInput('Character');
  const repeatIntervalInput = innerInput('Repeat Interval', N(0.025));
  wire(outer.repeatInterval, 'Value', repeatIntervalInput, 'RER_Input');
  const soundInputs = outer.sounds.map(sound => {
    const reference = innerInput(`${sound.label} Sound`);
    const volumeValue = sound.volume.brick.comps[0].data.Value.value;
    const volume = innerInput(`${sound.label} Volume`, N(volumeValue));
    wire(sound.reference, 'Value', reference, 'RER_Input');
    wire(sound.volume, 'Value', volume, 'RER_Input');
    return { ...sound, input: reference, volumeInput: volume };
  });

  const innerOutputs = [
    node('MicrochipOutput', { PortLabel: 'Color', PortOrder: 1 }, { color: [55, 145, 215] }),
    node('MicrochipOutput', { PortLabel: 'Metal Material Toggle', PortOrder: 2, CallableDefault: B(true), CallableResult: B(true) }, { color: [55, 145, 215] }),
    node('MicrochipOutput', { PortLabel: 'Material Intensity', PortOrder: 3, CallableDefault: N(255), CallableResult: N(255) }, { color: [55, 145, 215] }),
  ];

  // Hidden interaction/state logic ----------------------------------------
  const seat = ref(seatBrick, C.Seat.NAME);
  wire(seat, 'SittingCharacter', characterInput, 'RER_Input');
  const splitter = node('InputSplitter');
  wire(characterInput, 'RER_Output', splitter, 'Character');
  const selection = node('Var', { Value: N(0) });
  const hue = node('Var', { Value: N(0) });
  const saturation = node('Var', { Value: N(100) });
  const brightness = node('Var', { Value: N(100) });
  const metal = node('Var', { Value: B(true) });
  const intensityLevel = node('Var', { Value: N(10) });

  const up = edge(splitter, 'InputForward', 'Greater', 0.5);
  const down = edge(splitter, 'InputForward', 'Less', -0.5);
  const left = edge(splitter, 'InputRight', 'Less', -0.5);
  const right = edge(splitter, 'InputRight', 'Greater', 0.5);
  const space = edge(splitter, 'InputUp', 'Greater', 0.5);

  const previousRaw = math('Add', selection, 'Value', 5);
  const previous = node('Expr_MathModuloFloored', { InputB: N(6) });
  wire(previousRaw, 'Output', previous, 'InputA');
  setValue(selection, previous, 'Output', up, 'OnRisingEdge');
  const nextRaw = math('Add', selection, 'Value', 1);
  const next = node('Expr_MathModuloFloored', { InputB: N(6) });
  wire(nextRaw, 'Output', next, 'InputA');
  setValue(selection, next, 'Output', down, 'OnRisingEdge');

  const selected = Array.from({ length: 6 }, (_, index) => {
    const compare = node('Expr_CompareEqual', { InputB: N(index) });
    wire(selection, 'Value', compare, 'InputA');
    return compare;
  });

  function adjust(variable, selectedIndex, movement, movementPort, direction, increment, wrap, maximum = 100) {
    const routed = branch(selected[selectedIndex], movement, movementPort);
    const amount = direction === 'right' ? increment : (wrap ? wrap - increment : -increment);
    const changed = math('Add', variable, 'Value', amount);
    let final = changed;
    if (wrap) {
      final = node('Expr_MathModuloFloored', { InputB: N(wrap) });
      wire(changed, 'Output', final, 'InputA');
    } else {
      final = node('Expr_MathClamp', { Input: N(0), Min: N(0), Max: N(maximum) });
      wire(changed, 'Output', final, 'Input');
    }
    return setValue(variable, final, 'Output', routed, 'ExecOutA');
  }
  function repeatAfterHold(control) {
    const holdClock = node('Clock', { IntervalSeconds: 0.75, bEnabled: false });
    wire(control.comparison, 'bOutput', holdClock, 'bEnabled');
    const repeating = node('Var', { Value: B(false) });
    setConstant(repeating, true, holdClock, 'Pulse');
    setConstant(repeating, false, control, 'OnFallingEdge');
    const clock = node('Clock', { IntervalSeconds: 0.025, bEnabled: true });
    wire(repeatIntervalInput, 'RER_Output', clock, 'IntervalSeconds');
    const gate = node('Exec_Branch', { bCond: false });
    wire(repeating, 'Value', gate, 'bCond');
    wire(clock, 'Pulse', gate, 'Exec');
    return gate;
  }
  const leftRepeat = repeatAfterHold(left);
  const rightRepeat = repeatAfterHold(right);
  const tapAdjustments = [];
  const repeatAdjustments = [];
  for (const [movement, movementPort, direction] of [
    [left, 'OnRisingEdge', 'left'], [right, 'OnRisingEdge', 'right'],
    [leftRepeat, 'ExecOutA', 'left'], [rightRepeat, 'ExecOutA', 'right'],
  ]) {
    const outputs = [
      adjust(hue, 0, movement, movementPort, direction, 1, 360),
      adjust(saturation, 1, movement, movementPort, direction, 1, 0),
      adjust(brightness, 2, movement, movementPort, direction, 1, 0),
      adjust(intensityLevel, 4, movement, movementPort, direction, 1, 0, 10),
    ];
    (movementPort === 'OnRisingEdge' ? tapAdjustments : repeatAdjustments).push(...outputs);
  }

  // Metal is a discrete toggle and intentionally does not auto-repeat.
  const invertedMetal = node('Expr_LogicalNOT', { bInput: false });
  wire(metal, 'Value', invertedMetal, 'bInput');
  for (const movement of [left, right]) {
    const routed = branch(selected[3], movement);
    const setter = node('Exec_Var_Set', { Value: B(false), bChangeType: false });
    wire(metal, 'VarRef', setter, 'VarRef');
    wire(invertedMetal, 'bOutput', setter, 'Value');
    wire(routed, 'ExecOutA', setter, 'Exec');
    tapAdjustments.push(setter);
  }

  // HSB/HSV -> sRGB color.
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
  const signalC = [chroma, 'Output'];
  const signalX = [xValue, 'Output'];
  function sectorValue(values) {
    let current = values[0];
    for (let index = 1; index < 6; index++) current = [select(sectors[index], current, values[index]), 'Output'];
    return current;
  }
  const primes = [
    sectorValue([signalC, signalX, 0, 0, signalX, signalC]),
    sectorValue([signalX, signalC, signalC, signalX, 0, 0]),
    sectorValue([0, 0, signalX, signalC, signalC, signalX]),
  ];
  const channels = primes.map(prime => {
    const shifted = node('Expr_MathAdd');
    wire(prime[0], prime[1], shifted, 'InputA');
    wire(minimum, 'Output', shifted, 'InputB');
    return math('Multiply', shifted, 'Output', 255);
  });
  const makeColor = node('Expr_MakeColorSRGB', { A: 255 });
  ['R', 'G', 'B'].forEach((channel, index) => wire(channels[index], 'Output', makeColor, channel));
  wire(makeColor, 'Output', innerOutputs[0], 'RER_Input');
  wire(metal, 'Value', innerOutputs[1], 'RER_Input');

  // MaterialAlpha is a u8. Exact 10% checkpoints use round(level * 25.5):
  // 0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255.
  const alphaScaled = math('Multiply', intensityLevel, 'Value', 25.5);
  const materialAlpha = node('Expr_Round', { Input: N(0) });
  wire(alphaScaled, 'Output', materialAlpha, 'Input');
  wire(materialAlpha, 'Output', innerOutputs[2], 'RER_Input');
  const intensityPercent = math('Multiply', intensityLevel, 'Value', 10);
  const materialSelect = node('Expr_Select', { InputA: N(0), InputB: N(4), bSelectB: false });
  wire(metal, 'Value', materialSelect, 'bSelectB');

  // Editable row formatters receive state from the hidden chip.
  const leftMarkers = selected.map(compare => select(compare, '  ', '> '));
  const rightMarkers = selected.map(compare => select(compare, '', ' <'));
  const metalText = node('Expr_Select', { InputA: S('OFF'), InputB: S('ON'), bSelectB: false });
  wire(metal, 'Value', metalText, 'bSelectB');
  const rowValues = [
    [hue, 'Value'], [saturation, 'Value'], [brightness, 'Value'],
    [metalText, 'Output'], [intensityPercent, 'Output'], null,
  ];
  outer.rows.forEach((row, index) => {
    wire(leftMarkers[index], 'Output', row, 'InputA');
    if (rowValues[index]) wire(rowValues[index][0], rowValues[index][1], row, 'InputB');
    wire(rightMarkers[index], 'Output', row, rowValues[index] ? 'InputC' : 'InputB');
  });

  const screen = ref(screenBrick, C.TextDisplay.NAME);
  wire(outer.master, 'Output', screen, 'Text');
  const screenData = screenBrick.comps.find(comp => comp.type === C.TextDisplay.NAME).data;
  Object.assign(screenData, {
    Text: 'COLOR CUSTOMIZER\r\n\r\n> HUE           0° <\r\n  SATURATION    100%\r\n  BRIGHTNESS    100%\r\n  METAL         ON\r\n  INTENSITY     100%\r\n  APPLY\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nSPACE APPLY',
    LineHeight: 0.95,
    WidthScale: 0.75,
  });

  // Live preview and the three public outputs.
  wire(innerOutputs[0], 'RER_Output', outer.outputs[0], 'RER_Input');
  wire(innerOutputs[1], 'RER_Output', outer.outputs[1], 'RER_Input');
  wire(innerOutputs[2], 'RER_Output', outer.outputs[2], 'RER_Input');
  const square = ref(squareBrick, C.TextDisplay.NAME);
  const changer = ref(changerBrick, C.BrickPropertyChanger.NAME);
  wire(innerOutputs[0], 'RER_Output', square, 'Color');
  wire(innerOutputs[0], 'RER_Output', changer, 'Color');
  wire(materialSelect, 'Output', square, 'Material');
  wire(materialSelect, 'Output', changer, 'Material');
  wire(intensityLevel, 'Value', square, 'MaterialSlider');
  wire(innerOutputs[2], 'RER_Output', changer, 'MaterialAlpha');

  // Hidden audio execution; sound asset and volume controls stay editable.
  const apply = branch(selected[5], space);
  function addSound(index, sources, pitch) {
    const spec = soundSpecs[index];
    const emitter = node('OneShotAudioEmitter', {
      AudioDescriptor: assetIndex(spec[1]),
      VolumeMultiplier: spec[2],
      PitchMultiplier: pitch,
      InnerRadius: 30,
      MaxDistance: 250,
      bSpatialization: true,
      bEnableRepeat: false,
      RepeatCount: 1,
      RepeatTime: 1,
      RepeatVariance: 0,
    });
    wire(soundInputs[index].input, 'RER_Output', emitter, 'AudioDescriptor');
    wire(soundInputs[index].volumeInput, 'RER_Output', emitter, 'VolumeMultiplier');
    const source = execUnion(sources);
    wire(source[0], source[1], emitter, 'Play');
  }
  addSound(0, [[apply, 'ExecOutA']], 1);
  addSound(1, [[up, 'OnRisingEdge'], [down, 'OnRisingEdge']], 1.12);
  addSound(2, tapAdjustments.map(gate => [gate, 'ExecOut']), 1.08);
  addSound(3, repeatAdjustments.map(gate => [gate, 'ExecOut']), 1.45);

  const name = 'Configurable HSB Color Customizer';
  const description = 'Nested-chip color customizer. Outer chip exposes editable format strings, repeat interval, sound references/volumes, and Color, Metal Toggle, and Material Intensity outputs. Hidden chip contains interaction and conversion logic.';
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
      mainGrid,
      innerGrid,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-configurable-color-customizer.cjs input.brz output.brz');
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    bytes: result.bytes.length,
    ...result.summary,
    strictPlacement: result.placement.strictOk,
  }, null, 2));
}

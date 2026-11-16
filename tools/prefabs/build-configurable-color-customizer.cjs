'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const { brdb } = require('brs-js');
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
  const owners = scene.r.owners();
  const ownerIndex = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  const owner = ownerIndex < 0 ? undefined : {
    id: brdb.guidToUuid(owners.UserIds[ownerIndex]),
    name: owners.UserNames[ownerIndex],
    display_name: owners.DisplayNames[ownerIndex],
  };

  const linkedGridIds = new Set(scene.links.map(link => link.grid));
  const mainChipLink = one(scene.links.filter(link => {
    const chip = scene.bricks.find(brick => brick.key === link.key);
    return chip && !linkedGridIds.has(chip.g);
  }), 'existing outer microchip link');
  const mainGrid = mainChipLink.grid;
  const seatBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.Seat.NAME)), 'seat');
  const screenBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && /COLOR[ _]CUSTOMIZER/i.test(comp.data.Text))), 'customizer screen');
  const squareBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.TextDisplay.NAME
    && comp.data.Text === '■')), 'color preview square');
  const changerBrick = one(scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.BrickPropertyChanger.NAME)), 'preview property changer');

  // Preserve user-editable controls when upgrading an already-configurable
  // customizer. Rows whose meaning changed (Material and the master layout) are
  // intentionally replaced below.
  const existingControls = new Map();
  for (const brick of scene.bricks.filter(candidate => candidate.g === mainGrid)) {
    const label = brick.comps.find(comp => comp.type === C.Interact.NAME)?.data.PromptCustomLabel;
    if (label) existingControls.set(label, brick);
  }
  function priorData(label, type) {
    return existingControls.get(label)?.comps.find(comp => comp.type === type)?.data;
  }

  // Replace only the prior generated logic. User-authored presentation geometry,
  // the seat, displays, preview brick, dynamic joint, and frame remain intact.
  // A v2 input already has a nested hidden chip, so recursively clear every
  // logic grid below the outer chip and reuse its first hidden-grid entity.
  const replacedGrids = new Set([mainGrid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const link of scene.links) {
      const chip = scene.bricks.find(brick => brick.key === link.key);
      if (chip && replacedGrids.has(chip.g) && !replacedGrids.has(link.grid)) {
        replacedGrids.add(link.grid);
        changed = true;
      }
    }
  }
  const priorInnerGrids = [...replacedGrids].filter(grid => grid !== mainGrid);
  const removed = new Set(scene.bricks.filter(brick => replacedGrids.has(brick.g)).map(brick => brick.key));
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

  const innerGrid = priorInnerGrids[0]
    ?? Math.max(...[...scene.r.entities()].map(entity => entity.persistentIndex)) + 1;
  const palette = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `Color${index}`,
    { R: index === 0 ? 42 : 55, G: index === 0 ? 68 : 105, B: index === 0 ? 110 : 165, A: 255 },
  ]));
  const innerEntity = [...scene.r.entities()].find(entity => entity.persistentIndex === innerGrid);
  const innerEntityData = {
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
      PlaneCenter: { X: 264, Y: 1152, Z: 2 },
      PlaneExtent: { X: 340, Y: 1248, Z: 8 },
    },
  };
  if (innerEntity) {
    scene.entityOverrides.set(innerGrid, { ...innerEntity, ...innerEntityData, persistentIndex: innerGrid });
    scene.extraEntities = [];
    scene.extraGridIds = new Set();
  } else {
    scene.extraEntities = [innerEntityData];
    scene.extraGridIds = new Set([innerGrid]);
  }

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
  function annotate(target, label, message) {
    const brick = target.brick ?? target;
    brick.comps.push({
      type: C.Interact.NAME,
      data: {
        InteractSound: 1,
        Message: message,
        ConsoleTag: '',
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
        PromptCustomLabel: label,
      },
    });
    return target;
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
  function logicalAnd(signals) {
    assert(signals.length, 'Logical AND needs at least one signal');
    let current = signals[0];
    for (const signal of signals.slice(1)) {
      const both = node('Expr_LogicalAND', { bInputA: false, bInputB: false });
      wire(current[0], current[1], both, 'bInputA');
      wire(signal[0], signal[1], both, 'bInputB');
      current = [both, 'bOutput'];
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
  annotate(nestedChipBrick, 'Hidden color logic', 'Contains movement, timing, hex validation, HSB conversion, material, intensity, and sound-execution logic. Normally leave this chip alone.');
  scene.links.push({ key: nestedChipBrick.key, grid: innerGrid });

  const outer = { grid: mainGrid };
  const priorRepeat = priorData('Held-repeat interval', C.Var.NAME)?.Value ?? N(0.025);
  outer.repeatInterval = node('Var', { Value: structuredClone(priorRepeat) }, { grid: mainGrid, position: [-240, -192, 2], color: [70, 170, 95] });
  annotate(outer.repeatInterval, 'Held-repeat interval', 'Seconds between adjustments after A or D has been held for 0.75 seconds. 0.025 = 40 adjustments per second. Lower is faster; higher is slower.');
  const soundSpecs = [
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
    reference: annotate(node('OneShotAudioReference', {
      Asset: priorData(`${label} sound`, C.OneShotAudioReference.NAME)?.Asset ?? assetIndex(name),
    }, {
      grid: mainGrid, position: [-144 + index * 96, -192, 2], color: [145, 75, 175],
    }), `${label} sound`, `${label} interaction sound asset. Change this reference to replace the sound without editing the hidden chip.`),
    volume: annotate(node('Var', {
      Value: structuredClone(priorData(`${label} sound volume`, C.Var.NAME)?.Value ?? N(volume)),
    }, {
      grid: mainGrid, position: [-144 + index * 96, -264, 2], color: [95, 150, 185],
    }), `${label} sound volume`, `Volume multiplier for the ${label.toLowerCase()} interaction sound. 0 is silent; 1 is normal volume.`),
  }));

  function outerFormat(template, position) {
    return node('Expr_String_FormatText', { FormatString: template }, {
      grid: mainGrid, position, color: [205, 120, 40],
    });
  }
  function priorFormat(label, fallback) {
    return priorData(label, C.Expr_String_FormatText.NAME)?.FormatString ?? fallback;
  }
  function groupedPriorFormat(label, fallback, group, word, spacing) {
    const format = priorFormat(label, fallback);
    if (format.includes(`${group} ${word}`)) return format;
    return format.replace(new RegExp(`${word}\\s*`), `${group} ${word}${spacing}`);
  }
  function alignedPriorFormat(label, fallback, word, spacing) {
    return priorFormat(label, fallback)
      .replace(new RegExp(`${word}\\s*(?=\\{B\\})`), `${word}${spacing}`);
  }
  const rowPositions = [-336, -240, -144, -48, 48, 144, 240, 336].map(x => [x, 144, 2]);
  outer.rows = [
    outerFormat(priorFormat('Red row format', '{A}RGB RED        {B}{C}'), rowPositions[0]),
    outerFormat(priorFormat('Green row format', '{A}RGB GREEN      {B}{C}'), rowPositions[1]),
    outerFormat(priorFormat('Blue row format', '{A}RGB BLUE       {B}{C}'), rowPositions[2]),
    outerFormat(groupedPriorFormat('Hue row format', '{A}HSV HUE        {B}°{C}', 'HSV', 'HUE', '        '), rowPositions[3]),
    outerFormat(groupedPriorFormat('Saturation row format', '{A}HSV SATURATION {B}%{C}', 'HSV', 'SATURATION', ' '), rowPositions[4]),
    outerFormat(priorFormat('Value row format', '{A}HSV VALUE      {B}%{C}'), rowPositions[5]),
    outerFormat(alignedPriorFormat('Material row format', '{A}MATERIAL       {B}{C}', 'MATERIAL', '       '), rowPositions[6]),
    outerFormat(alignedPriorFormat('Intensity row format', '{A}INTENSITY      {B}%{C}', 'INTENSITY', '      '), rowPositions[7]),
  ];
  const rowHelp = [
    ['Red row format', 'Controls the RGB Red row text. A and C are selection markers; B is the 0–255 channel value.'],
    ['Green row format', 'Controls the RGB Green row text. A and C are selection markers; B is the 0–255 channel value.'],
    ['Blue row format', 'Controls the RGB Blue row text. A and C are selection markers; B is the 0–255 channel value.'],
    ['Hue row format', 'Controls the Hue row text. A is the left selection marker, B is the hue value, and C is the right marker.'],
    ['Saturation row format', 'Controls the Saturation row text. A and C are selection markers; B is the percentage value.'],
    ['Value row format', 'Controls the HSV Value row text. A and C are selection markers; B is the percentage value.'],
    ['Material row format', 'Controls the Material row text. A and C are selection markers; B displays Plastic, Glass, Translucent Plastic, Glow, Metal, or Hologram.'],
    ['Intensity row format', 'Controls the Material Intensity row text. A and C are selection markers; B is 0–100 in ten-percent steps.'],
  ];
  outer.rows.forEach((row, index) => annotate(row, rowHelp[index][0], rowHelp[index][1]));
  outer.hex = outerFormat(priorFormat('Hex row format', 'CURRENT HEX    #{A}'), [-336, 72, 2]);
  annotate(outer.hex, 'Hex row format', 'Controls the current RGB hex display. Input A is the six-digit code without a leading #.');
  const priorMasterFormat = priorData('Complete menu format', C.Expr_String_FormatText.NAME)?.FormatString;
  const priorG = priorMasterFormat?.indexOf('{G}') ?? -1;
  const preservedHeader = priorG >= 0
    ? priorMasterFormat.slice(0, priorG).replace(/[\r\n]+$/, '')
    : 'COLOR CUSTOMIZER';
  const defaultMasterFormat = `${preservedHeader}\r\n\r\n{G}\r\n\r\n{A}\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nC HEX   Q RGB   E HSV`;
  outer.master = outerFormat(
    defaultMasterFormat,
    [0, 240, 2],
  );
  annotate(outer.master, 'Complete menu format', 'Controls the complete display layout and instructions. Input A is the combined eight-row control list; G is the current-hex row.');
  let combinedRows = [outer.rows[0], 'Output'];
  for (const row of outer.rows.slice(1)) {
    const joined = node('Expr_String_Concatenate', { Separator: '\r\n' });
    wire(combinedRows[0], combinedRows[1], joined, 'InputA');
    wire(row, 'Output', joined, 'InputB');
    combinedRows = [joined, 'Output'];
  }
  wire(combinedRows[0], combinedRows[1], outer.master, 'InputA');
  wire(outer.hex, 'Output', outer.master, 'InputG');

  outer.outputs = [
    node('MicrochipOutput', { PortLabel: 'Color', PortOrder: 1 }, { grid: mainGrid, position: [240, 48, 2], color: [55, 145, 215] }),
    node('MicrochipOutput', { PortLabel: 'Material', PortOrder: 2, CallableDefault: N(0), CallableResult: N(0) }, {
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
    node('MicrochipOutput', { PortLabel: 'Material', PortOrder: 2, CallableDefault: N(0), CallableResult: N(0) }, { color: [55, 145, 215] }),
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
  const material = node('Var', { Value: N(0) });
  const intensityLevel = node('Var', { Value: N(5) });

  const up = edge(splitter, 'InputForward', 'Greater', 0.5);
  const down = edge(splitter, 'InputForward', 'Less', -0.5);
  const left = edge(splitter, 'InputRight', 'Less', -0.5);
  const right = edge(splitter, 'InputRight', 'Greater', 0.5);
  const enterHex = node('Expr_EdgeDetectorExec', { Input: B(false), InputLast: B(false), bSeeded: true });
  wire(splitter, 'bPressedC', enterHex, 'Input');
  const enterRgb = node('Expr_EdgeDetectorExec', { Input: B(false), InputLast: B(false), bSeeded: true });
  wire(splitter, 'bPressedQ', enterRgb, 'Input');
  const enterHsv = node('Expr_EdgeDetectorExec', { Input: B(false), InputLast: B(false), bSeeded: true });
  wire(splitter, 'bPressedE', enterHsv, 'Input');

  const previousRaw = math('Add', selection, 'Value', 7);
  const previous = node('Expr_MathModuloFloored', { InputB: N(8) });
  wire(previousRaw, 'Output', previous, 'InputA');
  setValue(selection, previous, 'Output', up, 'OnRisingEdge');
  const nextRaw = math('Add', selection, 'Value', 1);
  const next = node('Expr_MathModuloFloored', { InputB: N(8) });
  wire(nextRaw, 'Output', next, 'InputA');
  setValue(selection, next, 'Output', down, 'OnRisingEdge');

  const selected = Array.from({ length: 8 }, (_, index) => {
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
  const movementSpecs = [
    [left, 'OnRisingEdge', 'left'], [right, 'OnRisingEdge', 'right'],
    [leftRepeat, 'ExecOutA', 'left'], [rightRepeat, 'ExecOutA', 'right'],
  ];
  for (const [movement, movementPort, direction] of movementSpecs) {
    const outputs = [
      adjust(hue, 3, movement, movementPort, direction, 1, 360),
      adjust(saturation, 4, movement, movementPort, direction, 1, 0),
      adjust(brightness, 5, movement, movementPort, direction, 1, 0),
      adjust(intensityLevel, 7, movement, movementPort, direction, 1, 0, 10),
    ];
    (movementPort === 'OnRisingEdge' ? tapAdjustments : repeatAdjustments).push(...outputs);
  }

  // Material is a discrete six-value selector and intentionally does not repeat.
  for (const [movement, amount] of [[left, 5], [right, 1]]) {
    const routed = branch(selected[6], movement);
    const changed = math('Add', material, 'Value', amount);
    const wrapped = node('Expr_MathModuloFloored', { InputB: N(6) });
    wire(changed, 'Output', wrapped, 'InputA');
    const setter = setValue(material, wrapped, 'Output', routed, 'ExecOutA');
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
  wire(material, 'Value', innerOutputs[1], 'RER_Input');

  // RGB controls edit the rendered sRGB byte channels, then immediately
  // convert the result back into the canonical HSV variables. Snapshot the
  // full converted HSV triplet before changing any canonical variable so the
  // later setters cannot observe a partially-updated color.
  const splitRgb = node('Expr_SplitColorSRGB');
  wire(makeColor, 'Output', splitRgb, 'Input');
  const rgbSnapshot = [
    node('Var', { Value: N(0) }),
    node('Var', { Value: N(100) }),
    node('Var', { Value: N(100) }),
  ];
  function adjustRgbChannel(channelIndex, selectedIndex, movement, movementPort, direction) {
    const routed = branch(selected[selectedIndex], movement, movementPort);
    const ports = ['R', 'G', 'B'];
    const changed = math('Add', splitRgb, ports[channelIndex], direction === 'right' ? 1 : -1);
    const clamped = node('Expr_MathClamp', { Input: N(0), Min: N(0), Max: N(255) });
    wire(changed, 'Output', clamped, 'Input');
    const edited = node('Expr_MakeColorSRGB', { A: 255 });
    ports.forEach((port, index) => wire(index === channelIndex ? clamped : splitRgb,
      index === channelIndex ? 'Output' : port, edited, port));
    const converted = node('Expr_ColorConvert', { FromSpace: 0, ToSpace: 3 });
    wire(edited, 'Output', converted, 'Input');
    const hsv = node('Expr_SplitColor');
    wire(converted, 'Output', hsv, 'Input');
    const convertedS = math('Multiply', hsv, 'G', 100);
    const convertedV = math('Multiply', hsv, 'B', 100);

    const saveH = setValue(rgbSnapshot[0], hsv, 'R', routed, 'ExecOutA');
    const saveS = setValue(rgbSnapshot[1], convertedS, 'Output', saveH, 'ExecOut');
    const saveV = setValue(rgbSnapshot[2], convertedV, 'Output', saveS, 'ExecOut');
    const applyH = setValue(hue, rgbSnapshot[0], 'Value', saveV, 'ExecOut');
    const applyS = setValue(saturation, rgbSnapshot[1], 'Value', applyH, 'ExecOut');
    return setValue(brightness, rgbSnapshot[2], 'Value', applyS, 'ExecOut');
  }
  for (const [movement, movementPort, direction] of movementSpecs) {
    const outputs = [0, 1, 2].map(channel => adjustRgbChannel(
      channel, channel, movement, movementPort, direction,
    ));
    (movementPort === 'OnRisingEdge' ? tapAdjustments : repeatAdjustments).push(...outputs);
  }

  // C opens a player-local six-digit RGB entry box. Re-resolve the current
  // sitter on confirmation so a stale dialog cannot change the shared station
  // after its player has left the seat.
  const openPlayer = node('Exec_PlayerState_GetFromEntity');
  wire(characterInput, 'RER_Output', openPlayer, 'Entity');
  wire(enterHex, 'OnRisingEdge', openPlayer, 'Exec');
  const textInput = node('Exec_PlayerState_ShowTextInputBox', {
    Text: '',
    Title: 'ENTER HEX COLOR',
    Message: 'Enter exactly 6 RGB digits (RRGGBB or #RRGGBB).',
  });
  wire(openPlayer, 'PlayerState', textInput, 'PlayerState');
  wire(openPlayer, 'ExecOut', textInput, 'Exec');

  const currentPlayer = node('Exec_PlayerState_GetFromEntity');
  wire(characterInput, 'RER_Output', currentPlayer, 'Entity');
  wire(textInput, 'OkClicked', currentPlayer, 'Exec');
  const samePlayer = node('Expr_CompareEqual');
  wire(currentPlayer, 'PlayerState', samePlayer, 'InputA');
  wire(textInput, 'ClickedBy', samePlayer, 'InputB');
  const authorized = node('Exec_Branch', { bCond: false });
  wire(samePlayer, 'bOutput', authorized, 'bCond');
  wire(currentPlayer, 'ExecOut', authorized, 'Exec');

  const trimmedHex = node('Expr_String_Trim', { Input: '' });
  wire(textInput, 'Text', trimmedHex, 'Input');
  const upperHex = node('Expr_String_ToUpper', { Input: '' });
  wire(trimmedHex, 'Output', upperHex, 'Input');
  const hasHash = node('Expr_String_StartsWith', { Input: '', Prefix: '#', bCaseSensitive: true });
  wire(upperHex, 'Output', hasHash, 'Input');
  const withoutHash = node('Expr_String_Substring', { Input: '', Start: 1, Length: 1024 });
  wire(upperHex, 'Output', withoutHash, 'Input');
  const normalizedHex = node('Expr_Select', { InputA: S(''), InputB: S(''), bSelectB: false });
  wire(upperHex, 'Output', normalizedHex, 'InputA');
  wire(withoutHash, 'Output', normalizedHex, 'InputB');
  wire(hasHash, 'Output', normalizedHex, 'bSelectB');

  const hexLength = node('Expr_String_Length', { Input: '' });
  wire(normalizedHex, 'Output', hexLength, 'Input');
  const validLength = node('Expr_CompareEqual', { InputB: N(6) });
  wire(hexLength, 'Output', validLength, 'InputA');
  let validHex = [validLength, 'bOutput'];
  for (let index = 0; index < 6; index++) {
    const character = node('Expr_String_Substring', { Input: '', Start: index, Length: 1 });
    wire(normalizedHex, 'Output', character, 'Input');
    const allowed = node('Expr_String_Contains', {
      Input: '0123456789ABCDEF', Search: '', bCaseSensitive: true,
    });
    wire(character, 'Output', allowed, 'Search');
    const both = node('Expr_LogicalAND', { bInputA: false, bInputB: false });
    wire(validHex[0], validHex[1], both, 'bInputA');
    wire(allowed, 'Output', both, 'bInputB');
    validHex = [both, 'bOutput'];
  }
  const acceptHex = node('Exec_Branch', { bCond: false });
  wire(validHex[0], validHex[1], acceptHex, 'bCond');
  wire(authorized, 'ExecOutA', acceptHex, 'Exec');

  const parsedHex = node('Expr_MakeColorHex', { Hex: '' });
  wire(normalizedHex, 'Output', parsedHex, 'Hex');
  const toHsv = node('Expr_ColorConvert', { FromSpace: 0, ToSpace: 3 });
  wire(parsedHex, 'Output', toHsv, 'Input');
  const splitHsv = node('Expr_SplitColor');
  wire(toHsv, 'Output', splitHsv, 'Input');
  const parsedSaturation = math('Multiply', splitHsv, 'G', 100);
  const parsedBrightness = math('Multiply', splitHsv, 'B', 100);
  setValue(hue, splitHsv, 'R', acceptHex, 'ExecOutA');
  setValue(saturation, parsedSaturation, 'Output', acceptHex, 'ExecOutA');
  setValue(brightness, parsedBrightness, 'Output', acceptHex, 'ExecOutA');

  const invalidHex = node('Exec_PlayerState_ShowStatusMessage', {
    Message: 'Invalid hex. Enter exactly 6 digits using 0-9 and A-F.',
  });
  wire(textInput, 'ClickedBy', invalidHex, 'PlayerState');
  wire(acceptHex, 'ExecOutB', invalidHex, 'Exec');

  function authorizedTextDialog(trigger, title, message) {
    const lookup = node('Exec_PlayerState_GetFromEntity');
    wire(characterInput, 'RER_Output', lookup, 'Entity');
    wire(trigger, 'OnRisingEdge', lookup, 'Exec');
    const box = node('Exec_PlayerState_ShowTextInputBox', { Text: '', Title: title, Message: message });
    wire(lookup, 'PlayerState', box, 'PlayerState');
    wire(lookup, 'ExecOut', box, 'Exec');

    const recheck = node('Exec_PlayerState_GetFromEntity');
    wire(characterInput, 'RER_Output', recheck, 'Entity');
    wire(box, 'OkClicked', recheck, 'Exec');
    const same = node('Expr_CompareEqual');
    wire(recheck, 'PlayerState', same, 'InputA');
    wire(box, 'ClickedBy', same, 'InputB');
    const authorizedBranch = node('Exec_Branch', { bCond: false });
    wire(same, 'bOutput', authorizedBranch, 'bCond');
    wire(recheck, 'ExecOut', authorizedBranch, 'Exec');
    return { box, authorized: authorizedBranch };
  }

  function parseTriple(box, bounds, wholeNumbers) {
    const first = node('Expr_String_Split', {
      Delimiter: ',', Occurrence: 1, bCaseSensitive: true,
    });
    wire(box, 'Text', first, 'Input');
    const second = node('Expr_String_Split', {
      Delimiter: ',', Occurrence: 1, bCaseSensitive: true,
    });
    wire(first, 'Right', second, 'Input');
    const extra = node('Expr_String_Split', {
      Delimiter: ',', Occurrence: 1, bCaseSensitive: true,
    });
    wire(second, 'Right', extra, 'Input');
    const noExtra = node('Expr_LogicalNOT', { bInput: false });
    wire(extra, 'bFound', noExtra, 'bInput');

    const rawFields = [[first, 'Left'], [second, 'Left'], [extra, 'Left']];
    const parsed = rawFields.map(([source, port]) => {
      const trimmed = node('Expr_String_Trim', { Input: '' });
      wire(source, port, trimmed, 'Input');
      const number = node('Expr_String_ParseNumber', { Input: '' });
      wire(trimmed, 'Output', number, 'Input');
      return number;
    });
    const checks = [
      [first, 'bFound'], [second, 'bFound'], [noExtra, 'bOutput'],
    ];
    parsed.forEach((number, index) => {
      checks.push([number, 'bSuccess']);
      const minimumCheck = node('Expr_CompareGreaterOrEqual', { InputB: N(bounds[index][0]) });
      wire(number, 'Value', minimumCheck, 'InputA');
      checks.push([minimumCheck, 'bOutput']);
      const maximumCheck = node('Expr_CompareLessOrEqual', { InputB: N(bounds[index][1]) });
      wire(number, 'Value', maximumCheck, 'InputA');
      checks.push([maximumCheck, 'bOutput']);
      if (wholeNumbers) {
        const floor = node('Expr_Floor', { Input: N(0) });
        wire(number, 'Value', floor, 'Input');
        const whole = node('Expr_CompareEqual');
        wire(number, 'Value', whole, 'InputA');
        wire(floor, 'Output', whole, 'InputB');
        checks.push([whole, 'bOutput']);
      }
    });
    return { parsed, valid: logicalAnd(checks) };
  }

  function validatedBranch(dialog, parsed) {
    const accept = node('Exec_Branch', { bCond: false });
    wire(parsed.valid[0], parsed.valid[1], accept, 'bCond');
    wire(dialog.authorized, 'ExecOutA', accept, 'Exec');
    return accept;
  }

  // Q accepts an exact R,G,B byte triplet and synchronizes the canonical HSV
  // state. The same current-sitter check used by Hex prevents stale dialogs.
  const rgbDialog = authorizedTextDialog(
    enterRgb,
    'ENTER RGB COLOR',
    'Enter R, G, B as whole numbers from 0 to 255. Example: 255, 0, 0',
  );
  const rgbParsed = parseTriple(rgbDialog.box, [[0, 255], [0, 255], [0, 255]], true);
  const acceptRgb = validatedBranch(rgbDialog, rgbParsed);
  const enteredRgb = node('Expr_MakeColorSRGB', { A: 255 });
  ['R', 'G', 'B'].forEach((port, index) => wire(rgbParsed.parsed[index], 'Value', enteredRgb, port));
  const enteredRgbToHsv = node('Expr_ColorConvert', { FromSpace: 0, ToSpace: 3 });
  wire(enteredRgb, 'Output', enteredRgbToHsv, 'Input');
  const enteredHsv = node('Expr_SplitColor');
  wire(enteredRgbToHsv, 'Output', enteredHsv, 'Input');
  const enteredSaturation = math('Multiply', enteredHsv, 'G', 100);
  const enteredValue = math('Multiply', enteredHsv, 'B', 100);
  const rgbSetH = setValue(hue, enteredHsv, 'R', acceptRgb, 'ExecOutA');
  const rgbSetS = setValue(saturation, enteredSaturation, 'Output', rgbSetH, 'ExecOut');
  setValue(brightness, enteredValue, 'Output', rgbSetS, 'ExecOut');
  const invalidRgb = node('Exec_PlayerState_ShowStatusMessage', {
    Message: 'Invalid RGB. Enter exactly three whole numbers from 0 to 255.',
  });
  wire(rgbDialog.box, 'ClickedBy', invalidRgb, 'PlayerState');
  wire(acceptRgb, 'ExecOutB', invalidRgb, 'Exec');

  // E accepts H,S,V directly. Hue 360 is accepted as the conventional alias
  // for 0 degrees; saturation and value accept any numeric percentage 0..100.
  const hsvDialog = authorizedTextDialog(
    enterHsv,
    'ENTER HSV COLOR',
    'Enter H, S, V: Hue 0-360; Saturation and Value 0-100. Example: 0, 100, 100',
  );
  const hsvParsed = parseTriple(hsvDialog.box, [[0, 360], [0, 100], [0, 100]], false);
  const acceptHsv = validatedBranch(hsvDialog, hsvParsed);
  const enteredHue = node('Expr_MathModuloFloored', { InputB: N(360) });
  wire(hsvParsed.parsed[0], 'Value', enteredHue, 'InputA');
  const hsvSetH = setValue(hue, enteredHue, 'Output', acceptHsv, 'ExecOutA');
  const hsvSetS = setValue(saturation, hsvParsed.parsed[1], 'Value', hsvSetH, 'ExecOut');
  setValue(brightness, hsvParsed.parsed[2], 'Value', hsvSetS, 'ExecOut');
  const invalidHsv = node('Exec_PlayerState_ShowStatusMessage', {
    Message: 'Invalid HSV. Use H 0-360 and S/V 0-100.',
  });
  wire(hsvDialog.box, 'ClickedBy', invalidHsv, 'PlayerState');
  wire(acceptHsv, 'ExecOutB', invalidHsv, 'Exec');

  // Always show the canonical current RGB value. ColorToHex may include a
  // leading # and/or alpha, so normalize it to the first six RGB digits.
  const colorHex = node('Expr_ColorToHex');
  wire(makeColor, 'Output', colorHex, 'Input');
  const colorHexUpper = node('Expr_String_ToUpper', { Input: '' });
  wire(colorHex, 'Hex', colorHexUpper, 'Input');
  const colorHasHash = node('Expr_String_StartsWith', { Input: '', Prefix: '#', bCaseSensitive: true });
  wire(colorHexUpper, 'Output', colorHasHash, 'Input');
  const colorWithoutHash = node('Expr_String_Substring', { Input: '', Start: 1, Length: 1024 });
  wire(colorHexUpper, 'Output', colorWithoutHash, 'Input');
  const normalizedColorHex = node('Expr_Select', { InputA: S(''), InputB: S(''), bSelectB: false });
  wire(colorHexUpper, 'Output', normalizedColorHex, 'InputA');
  wire(colorWithoutHash, 'Output', normalizedColorHex, 'InputB');
  wire(colorHasHash, 'Output', normalizedColorHex, 'bSelectB');
  const rgbHex = node('Expr_String_Substring', { Input: '', Start: 0, Length: 6 });
  wire(normalizedColorHex, 'Output', rgbHex, 'Input');
  wire(rgbHex, 'Output', outer.hex, 'InputA');

  // MaterialAlpha is a u8. Exact 10% checkpoints use round(level * 25.5):
  // 0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255.
  const alphaScaled = math('Multiply', intensityLevel, 'Value', 25.5);
  const materialAlpha = node('Expr_Round', { Input: N(0) });
  wire(alphaScaled, 'Output', materialAlpha, 'Input');
  wire(materialAlpha, 'Output', innerOutputs[2], 'RER_Input');
  const intensityPercent = math('Multiply', intensityLevel, 'Value', 10);
  // Editable row formatters receive state from the hidden chip.
  const leftMarkers = selected.map(compare => select(compare, '  ', '> '));
  const rightMarkers = selected.map(compare => select(compare, '', ' <'));
  const materialMatches = Array.from({ length: 6 }, (_, index) => {
    const compare = node('Expr_CompareEqual', { InputB: N(index) });
    wire(material, 'Value', compare, 'InputA');
    return compare;
  });
  const materialNames = ['PLASTIC', 'GLASS', 'TRANSLUCENT PLASTIC', 'GLOW', 'METAL', 'HOLOGRAM'];
  let materialNameGate = select(materialMatches[1], materialNames[0], materialNames[1]);
  for (let index = 2; index < materialNames.length; index++) {
    materialNameGate = select(materialMatches[index], [materialNameGate, 'Output'], materialNames[index]);
  }
  const materialText = [materialNameGate, 'Output'];
  const roundedHue = node('Expr_Round', { Input: N(0) });
  const roundedSaturation = node('Expr_Round', { Input: N(0) });
  const roundedBrightness = node('Expr_Round', { Input: N(0) });
  const roundedRed = node('Expr_Round', { Input: N(0) });
  const roundedGreen = node('Expr_Round', { Input: N(0) });
  const roundedBlue = node('Expr_Round', { Input: N(0) });
  wire(hue, 'Value', roundedHue, 'Input');
  wire(saturation, 'Value', roundedSaturation, 'Input');
  wire(brightness, 'Value', roundedBrightness, 'Input');
  wire(splitRgb, 'R', roundedRed, 'Input');
  wire(splitRgb, 'G', roundedGreen, 'Input');
  wire(splitRgb, 'B', roundedBlue, 'Input');
  const rowValues = [
    [roundedRed, 'Output'], [roundedGreen, 'Output'], [roundedBlue, 'Output'],
    [roundedHue, 'Output'], [roundedSaturation, 'Output'], [roundedBrightness, 'Output'],
    materialText, [intensityPercent, 'Output'],
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
    Text: `${preservedHeader}\r\n\r\nCURRENT HEX    #FF0000\r\n\r\n> RGB RED        255 <\r\n  RGB GREEN      0\r\n  RGB BLUE       0\r\n  HSV HUE        0°\r\n  HSV SATURATION 100%\r\n  HSV VALUE      100%\r\n  MATERIAL       PLASTIC\r\n  INTENSITY      50%\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nC HEX   Q RGB   E HSV`,
    LineHeight: 0.88,
    WidthScale: 0.75,
  });

  // Live preview and the three public outputs.
  wire(innerOutputs[0], 'RER_Output', outer.outputs[0], 'RER_Input');
  wire(innerOutputs[1], 'RER_Output', outer.outputs[1], 'RER_Input');
  wire(innerOutputs[2], 'RER_Output', outer.outputs[2], 'RER_Input');
  const changer = ref(changerBrick, C.BrickPropertyChanger.NAME);
  wire(innerOutputs[0], 'RER_Output', changer, 'Color');
  wire(innerOutputs[1], 'RER_Output', changer, 'Material');
  wire(innerOutputs[2], 'RER_Output', changer, 'MaterialAlpha');

  // Preserve the public terminal's occupied-seat indicator: red while free,
  // green while somebody is using the station. It is not the material preview.
  const occupancyColor = node('Expr_Select', {
    InputA: { $variant: 'LinearColor', value: { R: 1, G: 0, B: 0, A: 1 } },
    InputB: { $variant: 'LinearColor', value: { R: 0, G: 1, B: 0, A: 1 } },
    bSelectB: false,
  }, { grid: mainGrid, position: [336, 48, 2], color: [55, 145, 215] });
  wire(seat, 'bIsOccupied', occupancyColor, 'bSelectB');
  wire(occupancyColor, 'Output', ref(squareBrick, C.TextDisplay.NAME), 'Color');

  // Hidden audio execution; sound asset and volume controls stay editable.
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
  addSound(0, [[up, 'OnRisingEdge'], [down, 'OnRisingEdge']], 1.12);
  addSound(1, tapAdjustments.map(gate => [gate, 'ExecOut']), 1.08);
  addSound(2, repeatAdjustments.map(gate => [gate, 'ExecOut']), 1.45);

  const maxInnerY = Math.floor(Math.max(0, innerSerial - 1) / 12) * 48;
  const innerPlane = scene.entityOverrides.get(innerGrid) ?? innerEntityData;
  innerPlane.data.PlaneCenter = { X: 264, Y: maxInnerY / 2, Z: 2 };
  innerPlane.data.PlaneExtent = { X: 340, Y: maxInnerY / 2 + 72, Z: 8 };

  const name = 'Public Hex + RGB + HSV Color Customizer';
  const description = 'Standalone public-use color station. W/S selects eight RGB, HSV, material, and intensity rows; A/D taps or repeats. C, Q, and E open validated Hex, RGB, and HSV entry. Outer chip exposes editable text/sounds and Color, Material, and Material Intensity outputs.';
  const generated = write(scene, { assets, name, description, owner }).bytes;
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

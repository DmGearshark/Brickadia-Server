'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, B, S } = require('./loadboard-lib.cjs');
const nativeBounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v9.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v10.brz'));

const clone = value => structuredClone(value);
const valueOf = value => value && typeof value === 'object' && '$variant' in value
  ? value.value : value;
const X = () => ({ $variant: 'WireGraphExec', value: {} });

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Source owner is present');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function api(scene) {
  let sequence = 0;
  const component = (brick, type) => brick?.comps.find(saved => saved.type === type);
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows().filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(all(type, predicate), label);
  const brick = key => {
    const result = scene.bricks.find(candidate => candidate.key === key);
    assert(result, `Missing brick ${key}`);
    return result;
  };
  const incoming = (target, type, port) => scene.edges.filter(edge => edge.z === target.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (source, type, port) => scene.edges.filter(edge => edge.a === source.key
    && edge.at === type && (!port || edge.p === port));
  function add(source, sourceType, sourcePort, target, targetType, targetPort) {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({ a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort });
  }
  function removeInput(target, type, port) {
    const found = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return found;
  }
  function removeBrick(target) {
    scene.edges = scene.edges.filter(edge => edge.a !== target.key && edge.z !== target.key);
    scene.links = scene.links.filter(link => link.key !== target.key);
    scene.joints = (scene.joints || []).filter(joint => joint.key !== target.key);
    scene.bricks = scene.bricks.filter(candidate => candidate !== target);
  }
  const base = clone(scene.bricks.find(brick => brick.data.asset.startsWith('B_1x1_Gate_')).data);
  function gate(kind, grid, position, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate ${kind}`);
    const brickData = clone(base);
    Object.assign(brickData, {
      asset: definition.BRICK, position, direction: 4, rotation: 0, size: [0, 0, 0],
      color: options.color || [70, 145, 205], material_intensity: 5,
    });
    const comps = [{ type: definition.NAME, data: clone(data) }];
    if (options.label) comps.push({ type: C.Interact.NAME, data: {
      InteractSound: 0, Message: options.message || options.label, ConsoleTag: '',
      bAllowNearbyInteraction: true, bHiddenInteraction: false,
      PromptCustomLabel: options.label,
    } });
    const result = { key: `v10:${grid}:${options.name || kind}:${sequence++}`, g: grid,
      data: brickData, comps };
    scene.bricks.push(result);
    return result;
  }
  return { component, all, one, row, brick, incoming, outgoing, add, removeInput, removeBrick,
    gate };
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  const result = nativeBounds.assets[brick.data.asset];
  assert(result, `Missing bounds for ${brick.data.asset}`);
  return result;
}

function fitPlane(scene, grid, margin = 10) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity, `Missing microchip ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const min = [0, 1].map(axis => Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis])));
  const max = [0, 1].map(axis => Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis])));
  const override = clone(entity);
  override.data = clone(entity.data);
  override.data.bCollapsed = true;
  override.data.PlaneCenter = { X: (min[0] + max[0]) / 2, Y: (min[1] + max[1]) / 2, Z: 0 };
  override.data.PlaneExtent = { X: (max[0] - min[0]) / 2 + margin,
    Y: (max[1] - min[1]) / 2 + margin, Z: 0 };
  scene.entityOverrides.set(grid, override);
}

function addHeader(scene, g, template, grid, x, y, width, text, color, name) {
  const brick = clone(template);
  brick.key = `v10:${grid}:header:${name}`;
  brick.g = grid;
  Object.assign(brick.data, {
    asset: 'PB_DefaultMicroBrick', size: [width / 2, 10, 2],
    position: [x + width / 2, y + 10, 2], direction: 4, rotation: 0,
    color: [0, 0, 0], material: 'BMC_Glow', material_intensity: 0,
  });
  brick.comps = [clone(g.component(template, C.TextDisplay.NAME))];
  Object.assign(g.component(brick, C.TextDisplay.NAME).data, {
    Text: text, Rotation: 90, Kerning: 0, LineHeight: 3.5, WidthScale: 1,
    LineOffset: 0, Anchor: { X: 0.5, Y: 0.5 }, Offset: { X: 0, Y: 0, Z: 0 },
    Color: { R: Math.min(255, color[0] + 45), G: Math.min(255, color[1] + 45),
      B: Math.min(255, color[2] + 45), A: 255 },
    Face: 4, Material: 2, Outline: 2, bEnabled: true,
    bOverrideColor: true, bOverrideOutlineColor: true,
    bSharpCorners: true, bSharpOutlines: true,
  });
  scene.bricks.push(brick);
  return brick;
}

function build(input = INPUT) {
  const sourceBytes = fs.readFileSync(input);
  const scene = read(sourceBytes);
  scene.entityOverrides = new Map();
  const g = api(scene);

  // Resolve the hidden color core through the uniquely labeled v9 sync input.
  const scoreInput = g.row(C.MicrochipInput.NAME,
    (data, brick) => data.PortLabel === 'Vehicle Color Score'
      && g.outgoing(brick, C.MicrochipInput.NAME, 'RER_Output')
        .some(edge => edge.zt === C.Expr_MathMax.NAME),
    'core Vehicle Color Score input').brick;
  const coreGrid = scoreInput.g;
  const scoreMaxEdge = g.one(g.outgoing(scoreInput, C.MicrochipInput.NAME, 'RER_Output')
    .filter(edge => edge.zt === C.Expr_MathMax.NAME), 'score clamp minimum');
  const scoreMax = g.brick(scoreMaxEdge.z);
  const scoreMinEdge = g.one(g.outgoing(scoreMax, C.Expr_MathMax.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_MathMin.NAME), 'score clamp maximum');
  const scoreMin = g.brick(scoreMinEdge.z);

  const scoreConsumers = g.outgoing(scoreMin, C.Expr_MathMin.NAME, 'Output');
  const redDivideEdge = g.one(scoreConsumers.filter(edge => edge.zt === C.Expr_MathDivide.NAME
    && valueOf(g.component(g.brick(edge.z), C.Expr_MathDivide.NAME).data.InputB) === 65536),
  'red score divide');
  const greenDivideEdge = g.one(scoreConsumers.filter(edge => edge.zt === C.Expr_MathDivide.NAME
    && valueOf(g.component(g.brick(edge.z), C.Expr_MathDivide.NAME).data.InputB) === 256),
  'green score divide');
  const blueModuloEdge = g.one(scoreConsumers.filter(edge => edge.zt === C.Expr_MathModulo.NAME
    && valueOf(g.component(g.brick(edge.z), C.Expr_MathModulo.NAME).data.InputB) === 256),
  'blue score modulo');
  const redDivide = g.brick(redDivideEdge.z);
  const greenDivide = g.brick(greenDivideEdge.z);
  const blueModulo = g.brick(blueModuloEdge.z);

  // v9 inserted Expr_Floor gates whose plain scalar Input serialized as NaN,
  // then crossed their f64 outputs back into an i64 modulo. Restore the exact
  // proven v8 integer decoder: score/65536, (score/256)%256, score%256.
  const redFloorEdge = g.one(g.outgoing(redDivide, C.Expr_MathDivide.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_Floor.NAME), 'malformed red floor');
  const greenFloorEdge = g.one(g.outgoing(greenDivide, C.Expr_MathDivide.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_Floor.NAME), 'malformed green floor');
  const redFloor = g.brick(redFloorEdge.z);
  const greenFloor = g.brick(greenFloorEdge.z);
  const redTargetEdge = g.one(g.outgoing(redFloor, C.Expr_Floor.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_MakeColorSRGB.NAME && edge.q === 'R'),
  'red color target');
  const greenTargetEdge = g.one(g.outgoing(greenFloor, C.Expr_Floor.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_MathModulo.NAME && edge.q === 'InputA'),
  'green modulo target');
  const makeColor = g.brick(redTargetEdge.z);
  const greenModulo = g.brick(greenTargetEdge.z);
  assert.equal(valueOf(g.component(greenModulo, C.Expr_MathModulo.NAME).data.InputB), 256);
  g.removeBrick(redFloor);
  g.removeBrick(greenFloor);
  g.add(redDivide, C.Expr_MathDivide.NAME, 'Output', makeColor, C.Expr_MakeColorSRGB.NAME, 'R');
  g.add(greenDivide, C.Expr_MathDivide.NAME, 'Output', greenModulo,
    C.Expr_MathModulo.NAME, 'InputA');

  // Do not execute the state setters in the same instant that the two custom
  // property getters change their values. One tick lets the score traverse the
  // three chip layers and packed RGB/HSV expression chain first.
  const syncOutput = g.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Appearance Sync', 'terminal Appearance Sync output').brick;
  const syncInputEdge = g.one(g.removeInput(syncOutput, C.MicrochipOutput.NAME, 'RER_Input'),
    'Appearance Sync driver');
  assert.equal(syncInputEdge.at, C.Exec_Branch.NAME);
  assert.equal(syncInputEdge.p, 'ExecOutA');
  const guard = g.brick(syncInputEdge.a);
  const bufferSource = g.all(C.BufferTicks.NAME)[0]?.brick;
  assert(bufferSource, 'BufferTicks template exists');
  const syncBuffer = clone(bufferSource);
  syncBuffer.key = `v10:${syncOutput.g}:appearance_sync_settle`;
  syncBuffer.g = syncOutput.g;
  Object.assign(syncBuffer.data, {
    asset: C.BufferTicks.BRICK,
    position: [guard.data.position[0] + 10, guard.data.position[1], guard.data.position[2]],
    direction: 4,
    rotation: 0,
    size: [0, 0, 0],
    color: [70, 185, 225],
    material_intensity: 5,
  });
  syncBuffer.comps = [{
    type: C.BufferTicks.NAME,
    data: {
      TicksToWait: 1,
      ZeroTicksToWait: -1,
      CurrentTicks: 0,
      Input: X(),
      Output: X(),
      Buffered: X(),
      bHasQueued: false,
      bIsOffTimer: false,
    },
  }];
  scene.bricks.push(syncBuffer);
  g.add(guard, C.Exec_Branch.NAME, 'ExecOutA', syncBuffer, C.BufferTicks.NAME, 'Input');
  g.add(syncBuffer, C.BufferTicks.NAME, 'Output', syncOutput,
    C.MicrochipOutput.NAME, 'RER_Input');

  // Preserve the selected label/value as solid orange without a left glyph.
  // Only the right '<' marker blinks; its hidden form keeps equal text width
  // and always closes the orange span.
  const prefixMarkers = g.all(C.Expr_Select.NAME,
    data => valueOf(data.InputB) === '<color="ff8700">> ');
  const suffixMarkers = g.all(C.Expr_Select.NAME,
    data => valueOf(data.InputB) === ' <</>');
  assert.equal(prefixMarkers.length, 6, 'six selectable-row prefix formatters');
  assert.equal(suffixMarkers.length, 6, 'six selectable-row suffix formatters');
  for (const { comp } of prefixMarkers) {
    comp.data.InputA = S('');
    comp.data.InputB = S('<color="ff8700">');
  }
  for (const { comp } of suffixMarkers) {
    comp.data.InputA = S('  </>');
    comp.data.InputB = S(' <</>');
  }
  for (const { brick } of prefixMarkers) for (const edge of g.outgoing(brick,
    C.Expr_Select.NAME, 'Output')) {
    const target = g.brick(edge.z);
    if (edge.zt === C.Expr_String_FormatText.NAME)
      g.component(target, C.Expr_String_FormatText.NAME).data[edge.q] = S('');
  }
  for (const { brick } of suffixMarkers) for (const edge of g.outgoing(brick,
    C.Expr_Select.NAME, 'Output')) {
    const target = g.brick(edge.z);
    if (edge.zt === C.Expr_String_FormatText.NAME)
      g.component(target, C.Expr_String_FormatText.NAME).data[edge.q] = S('  </>');
  }
  const purchaseFormatter = g.row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === 'PRICE: 🔩{A}\r\n{B}', 'purchase formatter').brick;
  g.component(purchaseFormatter, C.Expr_String_FormatText.NAME).data.InputB = S('BUY');
  const settingsFormatter = g.row(C.Expr_String_FormatText.NAME,
    data => /^COLOR SETTINGS/.test(data.FormatString || ''), 'settings formatter').brick;
  g.component(settingsFormatter, C.Expr_String_FormatText.NAME).data.InputF =
    S('PRICE: 🔩100\r\nBUY');
  const visibleScreen = g.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || '') && /> BUY </.test(data.Text || ''),
    'visible screen fallback').brick;
  const visibleScreenData = g.component(visibleScreen, C.TextDisplay.NAME).data;
  visibleScreenData.Text = visibleScreenData.Text.replace('> BUY <', 'BUY');

  const activeSession = g.row(C.Var.NAME, (data, brick) =>
    data.Value?.$variant === 'Bool' && data.Value.value === false
      && g.outgoing(brick, C.Var.NAME, 'Value')
        .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB').length >= 3
      && g.outgoing(brick, C.Var.NAME, 'Value')
        .filter(edge => edge.zt === C.Exec_Branch.NAME && edge.q === 'bCond').length >= 2,
  'ready-session Var').brick;
  const terminalGrid = activeSession.g;
  const configScoreInput = g.row(C.MicrochipInput.NAME,
    (data, brick) => data.PortLabel === 'Vehicle Color Score' && brick.g !== coreGrid,
    'config Vehicle Color Score input').brick;
  const configGrid = configScoreInput.g;

  const blinkVar = g.gate('Var', terminalGrid, [145, -315, 2], { Value: B(false) }, {
    name: 'selection_blink_state', color: [235, 150, 45],
    label: 'Selection marker blink state',
    message: 'Internal state: false hides the selected row right marker; true shows it.',
  });
  const blinkNot = g.gate('Expr_LogicalNOT', terminalGrid, [155, -315, 2], { bInput: false }, {
    name: 'selection_blink_toggle', color: [235, 150, 45],
    label: 'Invert blink state', message: 'Produces the next on/off marker phase.',
  });
  const blinkClock = g.gate('Clock', terminalGrid, [165, -315, 2], {
    bEnabled: false, bPulseOn: false, OnTimeSeconds: 1, OffTimeSeconds: 1,
    IntervalSeconds: 0.25,
  }, { name: 'selection_blink_clock', color: [235, 150, 45],
    label: 'Selection blink clock',
    message: 'Pulses every 0.25 seconds only while the terminal session is ready.',
  });
  const toggleBlink = g.gate('Exec_Var_Set', terminalGrid, [175, -315, 2], {
    bChangeType: false, Value: B(false),
  }, { name: 'selection_blink_set', color: [235, 150, 45],
    label: 'Toggle selection marker', message: 'Writes the inverted phase on every clock pulse.',
  });
  const sessionEdge = g.gate('Expr_EdgeDetectorExec', terminalGrid, [185, -315, 2], {
    Input: 0, InputLast: 0, bSeeded: true,
  }, { name: 'selection_blink_session_edge', color: [75, 190, 225],
    label: 'Session start/exit detector',
    message: 'Resets the marker whenever a ready session begins or ends.',
  });
  const resetUnion = g.gate('Exec_Union', terminalGrid, [195, -315, 2], {}, {
    name: 'selection_blink_reset_union', color: [75, 190, 225],
    label: 'Blink reset start/exit', message: 'Combines session rising and falling edges.',
  });
  const resetBlink = g.gate('Exec_Var_Set', terminalGrid, [205, -315, 2], {
    bChangeType: false, Value: B(false),
  }, { name: 'selection_blink_reset', color: [75, 190, 225],
    label: 'Reset selection marker', message: 'Forces blink state off on session start and exit.',
  });
  const activeBlink = g.gate('Expr_LogicalAND', terminalGrid, [215, -315, 2], {}, {
    name: 'selection_blink_visible', color: [235, 150, 45],
    label: 'Active visible blink',
    message: 'Marker visibility requires both session-ready and blink-state.',
  });
  const terminalBlinkOutput = g.gate('MicrochipOutput', terminalGrid, [225, -315, 2], {
    PortLabel: 'Selection Blink', PortOrder: 4,
    CallableDefault: B(false), CallableResult: B(false),
  }, { name: 'selection_blink_out', color: [235, 150, 45],
    label: 'Selection Blink output', message: 'Routes the active marker phase into the display core.',
  });
  g.add(blinkVar, C.Var.NAME, 'Value', blinkNot, C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(activeSession, C.Var.NAME, 'Value', blinkClock, C.Clock.NAME, 'bEnabled');
  g.add(blinkClock, C.Clock.NAME, 'Pulse', toggleBlink, C.Exec_Var_Set.NAME, 'Exec');
  g.add(blinkVar, C.Var.NAME, 'VarRef', toggleBlink, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(blinkNot, C.Expr_LogicalNOT.NAME, 'bOutput', toggleBlink, C.Exec_Var_Set.NAME, 'Value');
  g.add(activeSession, C.Var.NAME, 'Value', sessionEdge, C.Expr_EdgeDetectorExec.NAME, 'Input');
  g.add(sessionEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', resetUnion,
    C.Exec_Union.NAME, 'ExecA');
  g.add(sessionEdge, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge', resetUnion,
    C.Exec_Union.NAME, 'ExecB');
  g.add(resetUnion, C.Exec_Union.NAME, 'ExecOut', resetBlink, C.Exec_Var_Set.NAME, 'Exec');
  g.add(blinkVar, C.Var.NAME, 'VarRef', resetBlink, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(activeSession, C.Var.NAME, 'Value', activeBlink, C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(blinkVar, C.Var.NAME, 'Value', activeBlink, C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(activeBlink, C.Expr_LogicalAND.NAME, 'bOutput', terminalBlinkOutput,
    C.MicrochipOutput.NAME, 'RER_Input');

  const configBlinkInput = g.gate('MicrochipInput', configGrid, [155, -25, 2], {
    PortLabel: 'Selection Blink', PortOrder: 4,
    CallableDefault: B(false), CallableMirror: B(false),
  }, { name: 'config_selection_blink', color: [235, 150, 45],
    label: 'Selection Blink input', message: 'Passes the active marker phase to the nested core.',
  });
  const coreBlinkInput = g.gate('MicrochipInput', coreGrid, [5, -295, 2], {
    PortLabel: 'Selection Blink', PortOrder: 12,
    CallableDefault: B(false), CallableMirror: B(false),
  }, { name: 'core_selection_blink', color: [235, 150, 45],
    label: 'Selection Blink input', message: 'Shared phase for all six right-side row markers.',
  });
  g.add(terminalBlinkOutput, C.MicrochipOutput.NAME, 'RER_Output', configBlinkInput,
    C.MicrochipInput.NAME, 'RER_Input');
  g.add(configBlinkInput, C.MicrochipInput.NAME, 'RER_Output', coreBlinkInput,
    C.MicrochipInput.NAME, 'RER_Input');

  suffixMarkers.forEach(({ brick: suffix }, index) => {
    const selectedEdge = g.one(g.removeInput(suffix, C.Expr_Select.NAME, 'bSelectB'),
      `row ${index} prior selection marker`);
    assert.equal(selectedEdge.at, C.Expr_CompareEqual.NAME);
    const selectedAndBlink = g.gate('Expr_LogicalAND', coreGrid,
      [15 + index * 10, -295, 2], {}, {
        name: `row_${index}_selected_blink`, color: [235, 150, 45],
        label: `Row ${index} right marker`,
        message: 'Shows this row right marker only while selected and the active blink phase is on.',
      });
    g.add(g.brick(selectedEdge.a), selectedEdge.at, selectedEdge.p, selectedAndBlink,
      C.Expr_LogicalAND.NAME, 'bInputA');
    g.add(coreBlinkInput, C.MicrochipInput.NAME, 'RER_Output', selectedAndBlink,
      C.Expr_LogicalAND.NAME, 'bInputB');
    g.add(selectedAndBlink, C.Expr_LogicalAND.NAME, 'bOutput', suffix,
      C.Expr_Select.NAME, 'bSelectB');
  });

  // The pre-existing affordability overlay remains its finite 0.2-second red
  // block blink; only remove its obsolete left arrow.
  const redAffordability = g.row(C.Expr_String_FormatText.NAME,
    data => /<color="ff3030">PRICE:/.test(data.FormatString || '')
      && /> BUY </.test(data.FormatString || ''), 'red affordability formatter').brick;
  const redFormat = g.component(redAffordability, C.Expr_String_FormatText.NAME);
  redFormat.data.FormatString = redFormat.data.FormatString.replace('> BUY <', 'BUY <');

  const headerTemplate = g.row(C.TextDisplay.NAME,
    data => data.Text === 'VEHICLE APPEARANCE SYNC', 'labeled-card header template').brick;
  addHeader(scene, g, headerTemplate, terminalGrid, 140, -310, 90,
    'SELECTION MARKER BLINK', [235, 150, 45], 'selection_blink');
  addHeader(scene, g, headerTemplate, coreGrid, 0, -290, 80,
    'RIGHT MARKER BLINK ROUTING', [235, 150, 45], 'marker_routing');
  for (const grid of [terminalGrid, configGrid, coreGrid]) fitPlane(scene, grid);

  // Concrete corruption guard: no numeric field in the emitted prefab may be
  // NaN or infinite, including nested saved component data.
  function assertFinite(value, where) {
    if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite number at ${where}`);
    else if (Array.isArray(value)) value.forEach((child, index) => assertFinite(child, `${where}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value))
      assertFinite(child, `${where}.${key}`);
  }
  scene.bricks.forEach((brick, index) => assertFinite(brick, `brick[${index}]`));

  const owner = ownerFrom(scene);
  const name = 'Scrap Runners - Color Terminal v10 Vehicle Appearance Sync';
  const description = 'Color Terminal v9 with the proven packed-score RGB decoder restored, appearance synchronization delayed one tick, and an active-session-only 0.25-second right selection marker blink with no left arrow.';
  const generated = write(scene, { name, description, owner }).bytes;
  const bytes = repack(generated, sourceBytes, { name, description });
  return {
    bytes,
    scene,
    coreGrid,
    removed: [redFloor, greenFloor],
    added: { syncBuffer },
    topology: { scoreMax, scoreMin, redDivide, greenDivide, greenModulo, blueModulo, makeColor },
  };
}

module.exports = build;

if (require.main === module) {
  const result = build();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    input: INPUT,
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    removedMalformedFloors: result.removed.length,
    bufferedSyncTicks: 1,
    selectionBlinkSeconds: 0.25,
    selectionMarker: 'right-side < only',
  }, null, 2));
}

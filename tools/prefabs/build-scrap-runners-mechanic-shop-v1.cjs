'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { Build, C, N, S, B, O, R, source, copy } = require('./loadboard-lib.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const bounds = require('./native-brick-half-extents.json');
const { VEHICLES, CATEGORIES, PARTS, validate } = require('./mechanic-shop-catalog-v1.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, 'sources/scrap-runners-mechanic-shop-frame.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-mechanic-shop-v1.brz'));

const clone = structuredClone;
const COLOR = Object.freeze({
  session: [55, 150, 205], input: [70, 175, 220], config: [45, 160, 95],
  core: [215, 135, 55], display: [105, 185, 115], black: [0, 0, 0],
});
const WV = (variant, value) => ({ $variant: variant, value });
const LC = (R, G, B, A = 1) => WV('LinearColor', { R, G, B, A });

function blankWireValue(variant) {
  if (variant === 'str') return S('');
  if (variant === 'weak_object') return O(null);
  if (variant === 'Bool') return B(false);
  if (variant === 'i64') return WV('i64', 0);
  if (variant === 'LinearColor') return LC(0, 0, 0, 1);
  return N(0);
}

function mapTypeVariant(type) {
  if (type === 'str') return 'str';
  if (type === 'weak_object') return 'weak_object';
  if (type === 'Bool' || type === 'bool') return 'Bool';
  if (type === 'i64') return 'i64';
  return 'f64';
}

function installTypedBindings(circuit) {
  const rawBind = circuit.bind.bind(circuit);
  const polymorphic = new Map([
    [C.Exec_Var_Set.NAME, new Set(['Value'])],
    [C.Expr_CompareEqual.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_CompareNotEqual.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_CompareGreater.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_CompareGreaterOrEqual.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_CompareLess.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_CompareLessOrEqual.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_Select.NAME, new Set(['InputA', 'InputB'])],
    [C.Expr_String_FormatText.NAME,
      new Set(['InputA', 'InputB', 'InputC', 'InputD', 'InputE', 'InputF', 'InputG'])],
    [C.Exec_SendCustomEventGlobal.NAME,
      new Set(['DataIn1', 'DataIn2', 'DataIn3', 'DataIn4', 'DataIn5', 'DataIn6',
        'DataIn7', 'DataIn8'])],
    [C.QueueTicks.NAME,
      new Set(['DataIn1', 'DataIn2', 'DataIn3', 'DataIn4', 'DataIn5', 'DataIn6',
        'DataIn7', 'DataIn8'])],
    [C.Exec_MapVar_Get.NAME, new Set(['Key'])],
  ]);

  const inferred = (node, port) => {
    const direct = node.data?.[port];
    if (direct?.$variant) return direct.$variant;
    if (node.type === C.Expr_String_FormatText.NAME && port === 'Output') return 'str';
    if (node.type === C.Expr_String_Split.NAME && (port === 'Left' || port === 'Right'))
      return 'str';
    if (node.type === C.Expr_String_ParseNumber.NAME && port === 'Value') return 'f64';
    if (node.type === C.Exec_PlayerState_GetUserId.NAME && port === 'UserId') return 'str';
    if (node.type === C.Exec_PlayerState_GetDisplayName.NAME && port === 'DisplayName')
      return 'str';
    if (node.type === C.Exec_PlayerState_GetFromEntity.NAME && port === 'PlayerState')
      return 'weak_object';
    if ((node.type === C.EntityZoneEvent_Entered.NAME
      || node.type === C.EntityZoneEvent_Left.NAME) && port === 'Entity') return 'weak_object';
    if (node.type === C.Seat.NAME && port === 'SittingCharacter') return 'weak_object';
    if (node.type === C.Seat.NAME && port === 'bIsOccupied') return 'Bool';
    if (node.type === C.Exec_MapVar_Get.NAME && port === 'Value')
      return node.data.Value?.$variant || 'f64';
    if (node.type === C.Expr_Select.NAME && port === 'Output')
      return node.data.InputA?.$variant || node.data.InputB?.$variant || 'f64';
    if (node.type === C.QueueTicks.NAME && /^DataOut[1-8]$/.test(port))
      return node.data[port]?.$variant || 'f64';
    if (node.type === C.InputSplitter.NAME) return 'f64';
    if (node.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && port === 'Value')
      return 'f64';
    if (/BrickComponentType_Expr_(Math|Floor)/.test(node.type) && port === 'Output')
      return 'f64';
    if (/BrickComponentType_Expr_(Compare|Logical)/.test(node.type) && /^b/.test(port))
      return 'Bool';
    return undefined;
  };

  circuit.bind = (node, port, reference) => {
    if (Array.isArray(reference) && reference[0]?.type) {
      const [sourceNode, sourcePort] = reference;
      if (node.type === C.Exec_MapVar_Get.NAME && port === 'MapVarRef') {
        const map = sourceNode.data.Value;
        if (!node.data.Key?.$variant)
          node.data.Key = blankWireValue(mapTypeVariant(map.$keyType));
        if (!node.data.Value?.$variant)
          node.data.Value = blankWireValue(mapTypeVariant(map.$valueType));
      }
      if (node.type === C.Exec_Var_Set.NAME && port === 'VarRef') {
        const variant = sourceNode.data.Value?.$variant;
        // Circuit.set() coerces literal values before binding VarRef. Preserve
        // that real value; only create a typed placeholder for a later wired
        // Value input. Replacing it here would silently turn every true,
        // response string, index, and retained object into its blank default.
        if (variant && !node.data.Value?.$variant)
          node.data.Value = blankWireValue(variant);
      }
      const targetPorts = polymorphic.get(node.type);
      if (targetPorts?.has(port)) {
        const variant = inferred(sourceNode, sourcePort);
        if (variant) node.data[port] = blankWireValue(variant);
        if (node.type === C.QueueTicks.NAME && /^DataIn[1-8]$/.test(port)) {
          const outputPort = port.replace('In', 'Out');
          node.data[outputPort] = blankWireValue(variant || 'f64');
        }
      }
    }
    return rawBind(node, port, reference);
  };
}

function owner(reader) {
  const owners = reader.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'frame owner');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function halfWidth(kind) {
  const asset = C[kind].BRICK;
  if (asset.startsWith('PB_Gate_')) return 10;
  const size = bounds.assets[asset];
  assert(size, `native bounds for ${asset}`);
  return size[0];
}

function addHeader(build, grid, template, spec) {
  const data = clone(template);
  Object.assign(data, {
    Text: spec.title,
    Rotation: 90,
    Kerning: 0,
    LineHeight: spec.lineHeight || 4,
    WidthScale: 1,
    LineOffset: 0,
    Anchor: { X: 0.5, Y: 0.5 },
    Offset: { X: 0, Y: 0, Z: 0 },
    Color: { R: spec.color[0], G: spec.color[1], B: spec.color[2], A: 255 },
    Face: 4,
    Material: 2,
    bEnabled: true,
    bOverrideColor: true,
    bOverrideOutlineColor: true,
    bSharpCorners: true,
    bSharpOutlines: true,
  });
  build.w.addBrick({
    asset: 'PB_DefaultMicroBrick', size: [spec.width / 2, 10, 2],
    position: [spec.x + spec.width / 2, spec.y + 10, 2],
    color: COLOR.black, material: 'BMC_Glow', material_intensity: 0,
    owner_index: 0, components: [{ type: C.TextDisplay.NAME, data }],
  }, grid);
}

function layoutCircuit(build, circuit, template, specs) {
  installTypedBindings(circuit);
  const state = new Map();
  for (const spec of specs) {
    addHeader(build, circuit.grid, template, spec);
    state.set(spec.name, { ...spec, edge: spec.x, row: 0 });
  }
  let active = specs[0].name;
  const raw = circuit.n.bind(circuit);
  circuit.use = name => {
    assert(state.has(name), `layout section ${name}`);
    active = name;
    return circuit;
  };
  circuit.row = () => {
    const section = state.get(active);
    section.edge = section.x;
    section.row++;
  };
  circuit.n = (kind, data = {}, position, grid = circuit.grid) => {
    if (!position && grid === circuit.grid) {
      const section = state.get(active);
      const width = halfWidth(kind) * 2;
      if (section.edge > section.x && section.edge + width > section.x + section.width) {
        section.edge = section.x;
        section.row++;
      }
      position = [section.edge + width / 2, section.y - 5 - section.row * 10, 2];
      section.edge += width;
    }
    return raw(kind, data, position, grid);
  };
  return circuit;
}

function addButton(build, grid, template, position, text, prompt, id) {
  const textData = clone(template);
  Object.assign(textData, {
    Text: text, Rotation: 90, LineHeight: 3, WidthScale: 1,
    Anchor: { X: 0.5, Y: 0.5 }, Offset: { X: 0, Y: 0, Z: 0 }, Face: 4,
    Color: { R: 90, G: 255, B: 130, A: 255 }, Material: 2, bEnabled: true,
  });
  const node = {
    id, type: C.Button.NAME,
    data: {
      PressSound: 0, ReleaseSound: 1, bAllowNearbyInteraction: true,
      bHiddenInteraction: false, PromptCustomLabel: prompt,
    },
  };
  return build.add(node, {
    asset: 'PB_DefaultMicroBrick', size: [15, 8, 2], position,
    color: [35, 130, 70], material: 'BMC_Glow', material_intensity: 1,
    owner_index: 0,
    components: [
      { type: C.Button.NAME, data: node.data },
      { type: C.TextDisplay.NAME, data: textData },
    ],
  }, grid);
}

function addLabeledMicrochip(build, template, {
  position, color, text, prompt, planeCenter, planeExtent,
}) {
  const display = clone(template);
  Object.assign(display, {
    Text: text,
    Rotation: -45,
    Kerning: 0,
    LineHeight: 1.1,
    WidthScale: 1,
    Anchor: { X: 0.5, Y: 0.5 },
    Offset: { X: 0, Y: 0, Z: 0 },
    Color: { R: color[0], G: color[1], B: color[2], A: 255 },
    Face: 4,
    Material: 2,
    bEnabled: true,
    bOverrideColor: true,
    bSharpCorners: true,
    bSharpOutlines: true,
  });
  const shell = build.w.addBrick({
    asset: C.Microchip.BRICK,
    position,
    color,
    material_intensity: 5,
    owner_index: 0,
    components: [
      { type: C.Microchip.NAME, data: {} },
      { type: C.TextDisplay.NAME, data: display },
      {
        type: C.Interact.NAME,
        data: {
          InteractSound: 0,
          Message: prompt,
          ConsoleTag: '',
          bAllowNearbyInteraction: true,
          bHiddenInteraction: false,
          PromptCustomLabel: prompt,
        },
      },
    ],
  });
  const grid = build.w.addBrickGrid({
    type: 'Entity_MicrochipDynamicBrickGrid',
    location: { X: 0, Y: 0, Z: 40 },
    data: {
      bCollapsed: true,
      bLegacyIOSlotOrder: false,
      PlaneCenter: planeCenter,
      PlaneExtent: planeExtent,
    },
  });
  build.w.registerMicrochipLink(shell, grid);
  return { brick: shell, grid };
}

function split(circuit, input, count, delimiter = '|') {
  return circuit.split(input, count, delimiter);
}

function pairLink(build, pair, target, port = 'Exec') {
  build.wire(pair[0], pair[1], target, port);
  return target;
}

function chain(build, sourcePair, target, targetPort = 'Exec', outputPort = 'ExecOut') {
  build.wire(sourcePair[0], sourcePair[1], target, targetPort);
  return [target, outputPort];
}

function union(build, circuit, pairs) {
  assert(pairs.length);
  let result = pairs[0];
  for (const next of pairs.slice(1)) {
    const gate = circuit.n('Exec_Union');
    build.wire(result[0], result[1], gate, 'ExecA');
    build.wire(next[0], next[1], gate, 'ExecB');
    result = [gate, 'ExecOut'];
  }
  return result;
}

function build(input = INPUT) {
  validate();
  const donor = fs.readFileSync(input);
  const frame = source(input);
  const assets = clone(frame.assets);
  const ensureAsset = (type, name) => {
    let index = assets.findIndex(asset => asset.type === type && asset.name === name);
    if (index < 0) {
      index = assets.length;
      assets.push({ type, name });
    }
    return index;
  };
  const selectSoundAsset = ensureAsset('BrickOneShotAudioDescriptor', 'OBA_Keypad');
  const tapSoundAsset = ensureAsset('BrickOneShotAudioDescriptor', 'OBA_Keyboard');
  const build = new Build('Scrap Runners - Mechanic Shop v1', assets);
  build.w.addOwner(owner(frame.r));

  const frameItems = clone(frame.bricks);
  for (const item of frameItems) for (const saved of item.comps) {
    if (saved.type === C.Seat.NAME) saved.data.PromptCustomLabel = 'Open Mechanic Shop';
    if (saved.type === C.AttachedZone.NAME) {
      saved.data.bDetectPlayers = false;
      saved.data.bDetectPlayers1 = false;
      saved.data.bDetectPlayers2 = false;
      saved.data.bDetectPlayers3 = false;
      saved.data.bDetectEntities = true;
      saved.data.TagFilter = 'Vehicle';
    }
    if (saved.type === C.TextDisplay.NAME && /^COLOR SETTINGS/.test(saved.data.Text))
      saved.data.Text = 'UPGRADE CONFIGURATION';
    if (saved.type === C.TextDisplay.NAME && /^PROCESS: COLOR_CUSTOMIZER/.test(saved.data.Text))
      saved.data.Text = 'PROCESS: MECHANIC_SHOP\r\nSTATUS: STANDBY';
  }
  const frameNodes = copy(build, frameItems, 'mechanic_frame');
  const findFrame = (type, predicate = () => true, label = type) => {
    const rows = frameNodes.filter(node => node.type === type && predicate(node.data, node));
    assert.equal(rows.length, 1, `${label}: ${rows.length}`);
    return rows[0];
  };
  const seat = findFrame(C.Seat.NAME, () => true, 'seat');
  const zone = findFrame(C.AttachedZone.NAME, () => true, 'vehicle zone');
  const screens = frameNodes.filter(node => node.type === C.TextDisplay.NAME
    && (/^UPGRADE CONFIGURATION/.test(node.data.Text)
      || /^PROCESS: MECHANIC_SHOP/.test(node.data.Text)));
  assert.equal(screens.length, 2, 'two terminal screens');
  const rightScreen = screens.find(node => /^UPGRADE/.test(node.data.Text));
  const leftScreen = screens.find(node => /^PROCESS/.test(node.data.Text));
  const indicator = findFrame(C.TextDisplay.NAME, data => data.Text === '■', 'indicator');
  const displayEnable = findFrame(C.Rerouter.NAME, () => true, 'screen enable rerouter');
  const sounds = frameNodes.filter(node => node.type === C.OneShotAudioEmitter.NAME);
  assert.equal(sounds.length, 3, 'three sound emitters');
  const soundGroups = new Map();
  for (const sound of sounds) {
    const rows = soundGroups.get(sound.data.AudioDescriptor) || [];
    rows.push(sound);
    soundGroups.set(sound.data.AudioDescriptor, rows);
  }
  const successSounds = [...soundGroups.values()].find(rows => rows.length === 2);
  const failureSounds = [...soundGroups.values()].find(rows => rows.length === 1);
  assert(successSounds, 'two cash-register success emitters');
  assert(failureSounds, 'one failed-purchase beep emitter');
  assert.deepEqual(successSounds.map(sound => sound.data.PitchMultiplier).sort(), [0.5, 0.75],
    'success uses both configured cash-register pitches');
  const failureSound = failureSounds[0];
  assert.equal(failureSound.data.PitchMultiplier, 0.75, 'failure uses configured beep pitch');

  const titleTemplate = clone(frameItems.flatMap(item => item.comps)
    .find(saved => saved.type === C.TextDisplay.NAME && saved.data.Text === 'Mechanic Shop').data);
  const controller = addLabeledMicrochip(build, titleTemplate, {
    position: [115, -25, -25], color: COLOR.config,
    text: 'MECHANIC SHOP\r\nCONTROLLER', prompt: 'Mechanic Shop Controller',
    planeCenter: { X: 500, Y: -240, Z: 0 },
    planeExtent: { X: 510, Y: 290, Z: 2 },
  });
  const chips = {
    session: controller, input: controller, config: controller,
    core: controller, display: controller,
  };
  const session = layoutCircuit(build, build.circuit(chips.session.grid, 'mechanic_session'),
    titleTemplate, [
      { name: 'bay', title: 'VEHICLE BAY LOCK', x: 0, y: 0, width: 110, color: COLOR.session },
      { name: 'protocol', title: 'MECHANIC PROTOCOL', x: 120, y: 0, width: 120, color: COLOR.session },
      { name: 'seat', title: 'SEAT + OWNER AUTH', x: 0, y: -100, width: 140, color: COLOR.session },
      { name: 'state', title: 'SESSION STATE', x: 150, y: -100, width: 100, color: COLOR.session },
    ]);
  const inputCircuit = layoutCircuit(build, build.circuit(chips.input.grid, 'mechanic_input'),
    titleTemplate, [
      { name: 'split', title: 'SEAT INPUT', x: 270, y: 0, width: 100, color: COLOR.input },
      { name: 'select', title: 'ROW SELECTION', x: 380, y: 0, width: 120, color: COLOR.input },
      { name: 'change', title: 'CATEGORY + PART', x: 270, y: -100, width: 140, color: COLOR.input },
      { name: 'tap', title: 'A/D TAP', x: 420, y: -100, width: 130, color: COLOR.input },
      { name: 'sounds', title: 'BROWSE SOUNDS', x: 270, y: -150, width: 280, color: COLOR.input },
    ]);
  const config = layoutCircuit(build, build.circuit(chips.config.grid, 'mechanic_config'),
    titleTemplate, [
      { name: 'vehicles', title: 'VEHICLES MAP\r\nID = NAME | CLASS | OWNERSHIP | CATEGORY COUNT | REVISION', x: 570, y: 0, width: 240, color: COLOR.config },
      { name: 'categories', title: 'CATEGORIES MAP\r\nTRUCK.ORDER = ID | NAME | SCORE KEY | PART COUNT | 4 STAT SPECS', x: 570, y: -60, width: 240, color: COLOR.config },
      { name: 'parts', title: 'PARTS MAP\r\nTRUCK.CATEGORY.INDEX = NAME | SAVED | PRICE | DESCRIPTION | 4 STATS', x: 570, y: -120, width: 240, color: COLOR.config },
      { name: 'settings', title: 'TRADE-IN RATE 0-1 + RELOAD', x: 820, y: 0, width: 130, color: COLOR.config },
      { name: 'help', title: 'CONFIG NOTES\r\nOWNERSHIP IS RESERVED; RELOAD CHECKS THE ACTIVE RECORD PATH', x: 820, y: -80, width: 180, color: COLOR.config },
    ]);
  const core = layoutCircuit(build, build.circuit(chips.core.grid, 'mechanic_core'),
    titleTemplate, [
      { name: 'vehicle', title: 'VEHICLE CATALOG', x: 0, y: -230, width: 120, color: COLOR.core },
      { name: 'category', title: 'CATEGORY LOAD', x: 130, y: -230, width: 130, color: COLOR.core },
      { name: 'scan', title: 'INSTALLED PART LOOKUP', x: 270, y: -230, width: 140, color: COLOR.core },
      { name: 'part', title: 'PART SELECTION', x: 0, y: -360, width: 140, color: COLOR.core },
      { name: 'quote', title: 'PRICE + TRADE-IN', x: 150, y: -360, width: 130, color: COLOR.core },
      { name: 'purchase', title: 'PURCHASE FINAL GUARDS', x: 290, y: -360, width: 150, color: COLOR.core },
      { name: 'commit', title: 'SAVE + VEHICLE RELOAD', x: 0, y: -510, width: 180, color: COLOR.core },
      { name: 'response', title: 'SYSTEM RESPONSE', x: 190, y: -510, width: 170, color: COLOR.core },
    ]);
  const display = layoutCircuit(build, build.circuit(chips.display.grid, 'mechanic_display'),
    titleTemplate, [
      { name: 'left', title: 'SESSION SCREEN', x: 470, y: -230, width: 160, color: COLOR.display },
      { name: 'rows', title: 'SELECTION ROWS', x: 640, y: -230, width: 140, color: COLOR.display },
      { name: 'blink', title: 'SELECTION BLINK', x: 790, y: -230, width: 70, color: COLOR.display },
      { name: 'stats', title: 'DESCRIPTION + COMPARISONS', x: 470, y: -350, width: 210, color: COLOR.display },
      { name: 'right', title: 'UPGRADE SCREEN', x: 690, y: -350, width: 170, color: COLOR.display },
      { name: 'indicator', title: 'INDICATOR + SOUNDS', x: 470, y: -490, width: 160, color: COLOR.display },
    ]);

  for (const spec of [
    { title: 'VEHICLE + OWNER', x: 0, y: 20, width: 250, color: COLOR.session },
    { title: 'INPUT + SELECTION', x: 270, y: 20, width: 280, color: COLOR.input },
    { title: 'CATALOG CONFIG', x: 570, y: 20, width: 430, color: COLOR.config },
    { title: 'PURCHASE CORE', x: 0, y: -210, width: 450, color: COLOR.core },
    { title: 'DISPLAY + SOUND', x: 470, y: -210, width: 390, color: COLOR.display },
  ]) addHeader(build, controller.grid, titleTemplate, spec);

  // ---- Shared session state -------------------------------------------------
  session.use('state');
  const activeVehicle = session.v(O(null));
  const vehicleNonce = session.v(0);
  const vehicleType = session.v('');
  const profileRevision = session.v(0);
  const ownerId = session.v('');
  const protocolReady = session.v(false);
  const playerState = session.v(O(null));
  const seatedUserId = session.v('');
  const seatedUserName = session.v('NONE');
  const scrap = session.v(0);
  const busy = session.v(false);
  const dataReady = session.v(false);
  const catalogReady = session.v(false);
  const response = session.v('NO VEHICLE IN BAY');

  const ownerMatches = session.cmp('Equal', R(seatedUserId), R(ownerId));
  const vehiclePresent = session.cmp('NotEqual', R(activeVehicle), O(null));
  const ownerAuthorized = session.and(R(protocolReady), R(seat, 'bIsOccupied'), ownerMatches,
    vehiclePresent);
  const authorized = session.and(ownerAuthorized, R(catalogReady));
  const wrongOwner = session.and(R(protocolReady), R(seat, 'bIsOccupied'),
    session.not(ownerMatches), vehiclePresent);
  const notBusy = session.not(R(busy));
  const controlsReady = session.and(authorized, R(dataReady), notBusy);

  // ---- Vehicle bay lock and request/reply ----------------------------------
  session.use('bay');
  const entered = session.n('EntityZoneEvent_Entered', { TagFilter: 'Vehicle' });
  const left = session.n('EntityZoneEvent_Left', { TagFilter: 'Vehicle' });
  build.wire(zone, 'ZoneRef', entered, 'Zone');
  build.wire(zone, 'ZoneRef', left, 'Zone');
  const bayEmpty = session.cmp('Equal', R(activeVehicle), O(null));
  const acceptEntry = session.n('Exec_Branch', { bCond: bayEmpty });
  build.wire(entered, 'Exec', acceptEntry, 'Exec');
  let entryTail = chain(build, [acceptEntry, 'ExecOutA'], session.set(protocolReady, false));
  entryTail = chain(build, entryTail, session.set(dataReady, false));
  entryTail = chain(build, entryTail, session.set(catalogReady, false));
  entryTail = chain(build, entryTail, session.set(ownerId, ''));
  entryTail = chain(build, entryTail, session.set(vehicleType, ''));
  entryTail = chain(build, entryTail, session.set(activeVehicle, R(entered, 'Entity')));
  const bumpEntryNonce = session.n('Exec_Var_Increment', { VarRef: R(vehicleNonce, 'VarRef'), Value: 1 });
  entryTail = chain(build, entryTail, bumpEntryNonce);
  entryTail = chain(build, entryTail, session.set(response, 'CONNECTING TO VEHICLE'));

  const activeLeaves = session.cmp('Equal', R(left, 'Entity'), R(activeVehicle));
  const acceptExit = session.n('Exec_Branch', { bCond: activeLeaves });
  build.wire(left, 'Exec', acceptExit, 'Exec');
  let exitTail = chain(build, [acceptExit, 'ExecOutA'], session.set(protocolReady, false));
  exitTail = chain(build, exitTail, session.set(dataReady, false));
  exitTail = chain(build, exitTail, session.set(catalogReady, false));
  exitTail = chain(build, exitTail, session.set(ownerId, ''));
  exitTail = chain(build, exitTail, session.set(vehicleType, ''));
  exitTail = chain(build, exitTail, session.set(activeVehicle, O(null)));
  const bumpExitNonce = session.n('Exec_Var_Increment', { VarRef: R(vehicleNonce, 'VarRef'), Value: 1 });
  exitTail = chain(build, exitTail, bumpExitNonce);
  exitTail = chain(build, exitTail, session.set(response, 'NO VEHICLE IN BAY'));

  session.use('protocol');
  const request = session.send('SR.Mechanic.Request', [R(activeVehicle), R(vehicleNonce), N(1)],
    R(activeVehicle));
  const requestWait = session.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(entryTail[0], entryTail[1], requestWait, 'Input');
  const requestPending = session.and(vehiclePresent, session.not(R(protocolReady)));
  const requestRetry = session.n('Clock', { bEnabled: requestPending, IntervalSeconds: 0.75 });
  const requestPulse = union(build, session,
    [[requestWait, 'Output'], [requestRetry, 'Pulse']]);
  build.wire(requestPulse[0], requestPulse[1], request, 'ExecIn');
  const reply = session.event('SR.Mechanic.Reply', [O(null), N(0), S(''), N(0), N(0), S('')]);
  const replyQueue = session.n('QueueTicks', {
    TicksToWait: 1,
    DataIn1: R(reply, 'DataOut1'), DataIn2: R(reply, 'DataOut2'),
    DataIn3: R(reply, 'DataOut3'), DataIn4: R(reply, 'DataOut4'),
    DataIn5: R(reply, 'DataOut5'), DataIn6: R(reply, 'DataOut6'),
  });
  build.wire(reply, 'ExecOut', replyQueue, 'ExecIn');
  const replyVehicleMatches = session.cmp('Equal', R(replyQueue, 'DataOut1'), R(activeVehicle));
  const replyNonceMatches = session.cmp('Equal', R(replyQueue, 'DataOut2'), R(vehicleNonce));
  const replyProtocolMatches = session.cmp('Equal', R(replyQueue, 'DataOut5'), 1);
  const replyOwnerPresent = session.cmp('NotEqual', R(replyQueue, 'DataOut6'), '');
  const validReply = session.and(replyVehicleMatches, replyNonceMatches,
    replyProtocolMatches, replyOwnerPresent);
  const replyBranch = session.n('Exec_Branch', { bCond: validReply });
  build.wire(replyQueue, 'ExecOut', replyBranch, 'Exec');
  let replyTail = chain(build, [replyBranch, 'ExecOutA'],
    session.set(vehicleType, R(replyQueue, 'DataOut3')));
  replyTail = chain(build, replyTail, session.set(profileRevision, R(replyQueue, 'DataOut4')));
  replyTail = chain(build, replyTail, session.set(ownerId, R(replyQueue, 'DataOut6')));
  replyTail = chain(build, replyTail, session.set(protocolReady, true));
  replyTail = chain(build, replyTail, session.set(response, 'VEHICLE CONNECTED'));

  // ---- Seat occupant identity ----------------------------------------------
  session.use('seat');
  const seatEdge = session.n('Expr_EdgeDetectorExec', { Input: R(seat, 'bIsOccupied') });
  const getPlayer = session.n('Exec_PlayerState_GetFromEntity', {
    Entity: R(seat, 'SittingCharacter'),
  });
  build.wire(seatEdge, 'OnRisingEdge', getPlayer, 'Exec');
  let seatTail = chain(build, [getPlayer, 'ExecOut'],
    session.set(playerState, R(getPlayer, 'PlayerState')));
  const getUserId = session.n('Exec_PlayerState_GetUserId', { PlayerState: R(playerState) });
  seatTail = chain(build, seatTail, getUserId);
  seatTail = chain(build, seatTail, session.set(seatedUserId, R(getUserId, 'UserId')));
  const getName = session.n('Exec_PlayerState_GetDisplayName', { PlayerState: R(playerState) });
  seatTail = chain(build, seatTail, getName);
  seatTail = chain(build, seatTail, session.set(seatedUserName, R(getName, 'DisplayName')));
  const getInitialScrap = session.n('Exec_Gamemode_GetLeaderboardValue', {
    Key: 'Scrap', PlayerState: R(playerState),
  });
  seatTail = chain(build, seatTail, getInitialScrap);
  seatTail = chain(build, seatTail, session.set(scrap, R(getInitialScrap, 'Value')));
  const clearPlayer = session.set(playerState, O(null));
  build.wire(seatEdge, 'OnFallingEdge', clearPlayer, 'Exec');
  let leaveSeatTail = chain(build, [clearPlayer, 'ExecOut'], session.set(seatedUserId, ''));
  leaveSeatTail = chain(build, leaveSeatTail, session.set(seatedUserName, 'NONE'));
  leaveSeatTail = chain(build, leaveSeatTail, session.set(dataReady, false));
  leaveSeatTail = chain(build, leaveSeatTail, session.set(catalogReady, false));

  const ownerAuthorizedEdge = session.n('Expr_EdgeDetectorExec', { Input: ownerAuthorized });

  // ---- Editable catalog -----------------------------------------------------
  config.use('vehicles');
  const vehiclesMap = config.map('str', 'str', VEHICLES);
  config.use('categories');
  const categoriesMap = config.map('str', 'str', CATEGORIES);
  config.use('parts');
  const partsMap = config.map('str', 'str', PARTS);
  config.use('settings');
  const tradeInRate = config.v(0.75);
  const applyButton = addButton(build, chips.config.grid, titleTemplate,
    [885, -35, 2], 'RELOAD\r\nCATALOG', 'Reload the active mechanic catalog path', 'apply_catalog');
  const applyEdge = config.n('Expr_EdgeDetectorExec', { Input: R(applyButton, 'bHeld') });

  // ---- Vehicle/category catalog loading ------------------------------------
  core.use('vehicle');
  const categoryIndex = core.v(0);
  const selectedIndex = core.v(0);
  const installedIndex = core.v(0);
  const installedSaved = core.v(0);
  const installedInvalid = core.v(false);
  const scanCursor = core.v(0);
  const selectedRow = core.v(0);
  const vehicleGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(vehiclesMap, 'MapVarRef'), Key: R(vehicleType),
  });
  const vehicleFields = split(core, R(vehicleGet, 'Value'), 5);
  const vehicleDisplay = vehicleFields[0];
  const vehicleClass = vehicleFields[1];
  const vehicleCategoryCount = core.num(vehicleFields[3]);
  const catalogProfileRevision = core.num(vehicleFields[4]);
  const profileMatches = core.cmp('Equal', catalogProfileRevision, R(profileRevision));
  const supportedVehicle = core.and(R(vehicleGet, 'bFound'), profileMatches);
  const vehicleBranch = core.n('Exec_Branch', { bCond: supportedVehicle });
  const applyAllowed = core.n('Exec_Branch', { bCond: notBusy });
  build.wire(applyEdge, 'OnRisingEdge', applyAllowed, 'Exec');
  const clearCatalogForApply = core.set(catalogReady, false);
  build.wire(applyAllowed, 'ExecOutA', clearCatalogForApply, 'Exec');
  const vehicleLoad = union(build, core, [
    [ownerAuthorizedEdge, 'OnRisingEdge'], [clearCatalogForApply, 'ExecOut'],
  ]);
  build.wire(vehicleLoad[0], vehicleLoad[1], vehicleGet, 'Exec');
  const vehicleWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(vehicleGet, 'ExecOut', vehicleWait, 'Input');
  build.wire(vehicleWait, 'Output', vehicleBranch, 'Exec');
  const clearUnsupportedCatalog = core.set(catalogReady, false);
  build.wire(vehicleBranch, 'ExecOutB', clearUnsupportedCatalog, 'Exec');
  const unsupportedResponse = core.set(response, 'VEHICLE NOT\r\nSUPPORTED');
  build.wire(clearUnsupportedCatalog, 'ExecOut', unsupportedResponse, 'Exec');
  const commitCatalogReady = core.set(catalogReady, true);
  build.wire(vehicleBranch, 'ExecOutA', commitCatalogReady, 'Exec');
  const resetCategory = core.set(categoryIndex, 0);
  build.wire(commitCatalogReady, 'ExecOut', resetCategory, 'Exec');

  core.use('category');
  const categoryKey = core.fmt('{A}.{B}', R(vehicleType), R(categoryIndex));
  const categoryGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(categoriesMap, 'MapVarRef'), Key: categoryKey,
  });
  const categoryFields = split(core, R(categoryGet, 'Value'), 8);
  const categoryId = categoryFields[0];
  const categoryDisplay = categoryFields[1];
  const categoryLeaderboardKey = categoryFields[2];
  const categoryPartCount = core.num(categoryFields[3]);
  const categoryLoadPrimary = core.n('Exec_Union');
  const categoryLoadInput = core.n('Exec_Union');
  build.wire(resetCategory, 'ExecOut', categoryLoadPrimary, 'ExecA');
  build.wire(categoryLoadPrimary, 'ExecOut', categoryLoadInput, 'ExecA');
  const categoryLookupSettle = core.n('BufferTicks', {
    TicksToWait: 1, ZeroTicksToWait: 0,
  });
  build.wire(categoryLoadInput, 'ExecOut', categoryLookupSettle, 'Input');
  let categoryTail = chain(build, [categoryLookupSettle, 'Output'],
    core.set(dataReady, false));
  categoryTail = chain(build, categoryTail, categoryGet);
  const categoryWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(categoryTail[0], categoryTail[1], categoryWait, 'Input');
  const categoryFound = core.n('Exec_Branch', { bCond: R(categoryGet, 'bFound') });
  build.wire(categoryWait, 'Output', categoryFound, 'Exec');
  const categoryError = core.set(response, 'CATALOG ERROR:\r\nCATEGORY NOT FOUND');
  build.wire(categoryFound, 'ExecOutB', categoryError, 'Exec');
  const installedScoreGet = core.n('Exec_Gamemode_GetLeaderboardValue', {
    Key: categoryLeaderboardKey, PlayerState: R(playerState),
  });
  build.wire(categoryFound, 'ExecOutA', installedScoreGet, 'Exec');

  // ---- Reverse lookup of the installed saved value -------------------------
  core.use('scan');
  const resetScan = core.set(scanCursor, 0);
  build.wire(installedScoreGet, 'ExecOut', resetScan, 'Exec');
  const scanKey = core.fmt('{A}.{B}.{C}', R(vehicleType), categoryId, R(scanCursor));
  const scanGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(partsMap, 'MapVarRef'), Key: scanKey,
  });
  const scanExec = core.n('Exec_Union');
  const scanResetSettle = core.n('BufferTicks', {
    TicksToWait: 1, ZeroTicksToWait: 0,
  });
  build.wire(resetScan, 'ExecOut', scanResetSettle, 'Input');
  build.wire(scanResetSettle, 'Output', scanExec, 'ExecA');
  build.wire(scanExec, 'ExecOut', scanGet, 'Exec');
  const scanFields = split(core, R(scanGet, 'Value'), 8);
  const scanSaved = core.num(scanFields[1]);
  const scanMatches = core.and(R(scanGet, 'bFound'),
    core.cmp('Equal', scanSaved, R(installedScoreGet, 'Value')));
  const scanBranch = core.n('Exec_Branch', { bCond: scanMatches });
  const scanWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(scanGet, 'ExecOut', scanWait, 'Input');
  build.wire(scanWait, 'Output', scanBranch, 'Exec');
  let foundTail = chain(build, [scanBranch, 'ExecOutA'],
    core.set(installedInvalid, false));
  foundTail = chain(build, foundTail, core.set(installedIndex, R(scanCursor)));
  foundTail = chain(build, foundTail, core.set(selectedIndex, R(scanCursor)));
  foundTail = chain(build, foundTail,
    core.set(installedSaved, R(installedScoreGet, 'Value')));
  const incrementScan = core.n('Exec_Var_Increment', {
    VarRef: R(scanCursor, 'VarRef'), Value: 1,
  });
  build.wire(scanBranch, 'ExecOutB', incrementScan, 'Exec');
  const scanInRange = core.cmp('Less', R(scanCursor), categoryPartCount);
  const continueScan = core.n('Exec_Branch', { bCond: scanInRange });
  build.wire(incrementScan, 'ExecOut', continueScan, 'Exec');
  const scanLoopWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(continueScan, 'ExecOutA', scanLoopWait, 'Input');
  build.wire(scanLoopWait, 'Output', scanExec, 'ExecB');
  // Legacy/corrupt saved scores must not dead-lock the terminal. The truck
  // renders index 0 for the same condition; keep the raw saved value for the
  // final transaction continuity check, but browse from stock so purchasing
  // stock (or any valid part) can repair the leaderboard score.
  let fallbackTail = chain(build, [continueScan, 'ExecOutB'],
    core.set(installedInvalid, true));
  fallbackTail = chain(build, fallbackTail, core.set(installedIndex, 0));
  fallbackTail = chain(build, fallbackTail, core.set(selectedIndex, 0));
  fallbackTail = chain(build, fallbackTail,
    core.set(installedSaved, R(installedScoreGet, 'Value')));

  // ---- Installed/selected part records -------------------------------------
  core.use('part');
  const installedKey = core.fmt('{A}.{B}.{C}', R(vehicleType), categoryId,
    R(installedIndex));
  const selectedKey = core.fmt('{A}.{B}.{C}', R(vehicleType), categoryId,
    R(selectedIndex));
  const installedPartGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(partsMap, 'MapVarRef'), Key: installedKey,
  });
  const installedRecord = core.v('');
  const selectedPartGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(partsMap, 'MapVarRef'), Key: selectedKey,
  });
  const selectedPartExec = core.n('Exec_Union');
  const selectedPartSettle = core.n('BufferTicks', {
    TicksToWait: 1, ZeroTicksToWait: 0,
  });
  build.wire(selectedPartExec, 'ExecOut', selectedPartSettle, 'Input');
  build.wire(selectedPartSettle, 'Output', selectedPartGet, 'Exec');
  const installedPartExec = core.n('Exec_Union');
  build.wire(foundTail[0], foundTail[1], installedPartExec, 'ExecA');
  build.wire(fallbackTail[0], fallbackTail[1], installedPartExec, 'ExecB');
  const installedPartSettle = core.n('BufferTicks', {
    TicksToWait: 1, ZeroTicksToWait: 0,
  });
  build.wire(installedPartExec, 'ExecOut', installedPartSettle, 'Input');
  build.wire(installedPartSettle, 'Output', installedPartGet, 'Exec');
  foundTail = [installedPartGet, 'ExecOut'];
  foundTail = chain(build, foundTail,
    core.set(installedRecord, R(installedPartGet, 'Value')));
  foundTail = chain(build, foundTail, selectedPartExec, 'ExecA');
  foundTail = [selectedPartGet, 'ExecOut'];
  const partLoadWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(foundTail[0], foundTail[1], partLoadWait, 'Input');
  const bothPartsFound = core.and(R(installedPartGet, 'bFound'), R(selectedPartGet, 'bFound'));
  const partsBranch = core.n('Exec_Branch', { bCond: bothPartsFound });
  build.wire(partLoadWait, 'Output', partsBranch, 'Exec');
  const readyResponseText = core.sel(R(installedInvalid), 'READY',
    'SAVED PART INVALID\r\nSTOCK ACTIVE');
  let readyTail = chain(build, [partsBranch, 'ExecOutA'], core.set(dataReady, true));
  readyTail = chain(build, readyTail, core.set(response, readyResponseText));
  const partError = core.set(response, 'CATALOG ERROR:\r\nPART NOT FOUND');
  build.wire(partsBranch, 'ExecOutB', partError, 'Exec');
  const installedFields = split(core, R(installedRecord), 8);
  const selectedFields = split(core, R(selectedPartGet, 'Value'), 8);
  const installedName = installedFields[0];
  const selectedName = selectedFields[0];
  const selectedSaved = core.num(selectedFields[1]);
  const installedPrice = core.num(installedFields[2]);
  const selectedPrice = core.num(selectedFields[2]);
  const selectedDescription = selectedFields[3];

  // ---- Quote ---------------------------------------------------------------
  core.use('quote');
  const safeTradeInRate = core.n('Expr_MathClamp', {
    Input: R(tradeInRate), Min: 0, Max: 1,
  });
  const tradeInEligiblePrice = core.sel(R(installedInvalid), installedPrice, 0);
  const rawTradeIn = core.math('Multiply', tradeInEligiblePrice,
    R(safeTradeInRate, 'Output'));
  const floorTrade = core.n('Expr_Floor', { Input: rawTradeIn });
  const tradeIn = R(floorTrade, 'Output');
  const net = core.math('Subtract', selectedPrice, tradeIn);
  const receive = R(core.n('Expr_MathNegate', { Input: net }), 'Output');
  const alreadyInstalled = core.cmp('Equal', selectedSaved, R(installedSaved));
  const positiveNet = core.cmp('Greater', net, 0);
  const negativeNet = core.cmp('Less', net, 0);

  // ---- Input routing -------------------------------------------------------
  inputCircuit.use('split');
  const splitter = inputCircuit.n('InputSplitter', { Character: R(seat, 'SittingCharacter') });
  const forwardUp = inputCircuit.cmp('Greater', R(splitter, 'InputForward'), 0.5);
  const forwardDown = inputCircuit.cmp('Less', R(splitter, 'InputForward'), -0.5);
  const rightHeld = inputCircuit.cmp('Greater', R(splitter, 'InputRight'), 0.5);
  const leftHeld = inputCircuit.cmp('Less', R(splitter, 'InputRight'), -0.5);
  const upHeld = inputCircuit.and(forwardUp, authorized, notBusy);
  const downHeld = inputCircuit.and(forwardDown, authorized, notBusy);
  const activateHeld = inputCircuit.and(
    inputCircuit.cmp('Greater', R(splitter, 'InputUp'), 0.5), controlsReady);
  const upEdge = inputCircuit.n('Expr_EdgeDetectorExec', { Input: upHeld });
  const downEdge = inputCircuit.n('Expr_EdgeDetectorExec', { Input: downHeld });
  inputCircuit.use('tap');
  const rightEdge = inputCircuit.n('Expr_EdgeDetectorExec', { Input: rightHeld });
  const leftEdge = inputCircuit.n('Expr_EdgeDetectorExec', { Input: leftHeld });
  inputCircuit.use('split');
  const activateEdge = inputCircuit.n('Expr_EdgeDetectorExec', { Input: activateHeld });

  const rightPulse = [rightEdge, 'OnRisingEdge'];
  const leftPulse = [leftEdge, 'OnRisingEdge'];

  inputCircuit.use('select');
  const previousRow = inputCircuit.math('Add', R(selectedRow), 2);
  const previousWrapped = inputCircuit.math('Modulo', previousRow, 3);
  const setPreviousRow = inputCircuit.set(selectedRow, previousWrapped);
  build.wire(upEdge, 'OnRisingEdge', setPreviousRow, 'Exec');
  const nextRow = inputCircuit.math('Add', R(selectedRow), 1);
  const nextWrapped = inputCircuit.math('Modulo', nextRow, 3);
  const setNextRow = inputCircuit.set(selectedRow, nextWrapped);
  build.wire(downEdge, 'OnRisingEdge', setNextRow, 'Exec');

  inputCircuit.use('change');
  const categorySelected = inputCircuit.and(
    inputCircuit.cmp('Equal', R(selectedRow), 0), controlsReady);
  const partSelected = inputCircuit.and(
    inputCircuit.cmp('Equal', R(selectedRow), 1), controlsReady);
  const lastCategoryIndex = inputCircuit.math('Subtract', vehicleCategoryCount, 1);
  const lastPartIndex = inputCircuit.math('Subtract', categoryPartCount, 1);
  const rightCategoryAllowed = inputCircuit.and(categorySelected,
    inputCircuit.cmp('Less', R(categoryIndex), lastCategoryIndex));
  const leftCategoryAllowed = inputCircuit.and(categorySelected,
    inputCircuit.cmp('Greater', R(categoryIndex), 0));
  const rightPartAllowed = inputCircuit.and(partSelected,
    inputCircuit.cmp('Less', R(selectedIndex), lastPartIndex));
  const leftPartAllowed = inputCircuit.and(partSelected,
    inputCircuit.cmp('Greater', R(selectedIndex), 0));

  inputCircuit.use('sounds');
  const browseSoundData = (AudioDescriptor, VolumeMultiplier, PitchMultiplier) => ({
    AudioDescriptor, VolumeMultiplier, PitchMultiplier,
    InnerRadius: 30, MaxDistance: 250, bSpatialization: true,
    bEnableRepeat: false, RepeatTime: 1, RepeatVariance: 0, RepeatCount: 1,
  });
  const selectBrowseSound = inputCircuit.n('OneShotAudioEmitter',
    browseSoundData(selectSoundAsset, 0.32, 1.12));
  const tapBrowseSound = inputCircuit.n('OneShotAudioEmitter',
    browseSoundData(tapSoundAsset, 0.26, 1.08));
  const selectionSoundPulse = union(build, inputCircuit,
    [[setPreviousRow, 'ExecOut'], [setNextRow, 'ExecOut']]);
  build.wire(selectionSoundPulse[0], selectionSoundPulse[1], selectBrowseSound, 'Play');

  inputCircuit.use('change');
  const rightCategory = inputCircuit.n('Exec_Branch', { bCond: rightCategoryAllowed });
  const rightPart = inputCircuit.n('Exec_Branch', { bCond: rightPartAllowed });
  build.wire(rightPulse[0], rightPulse[1], rightCategory, 'Exec');
  build.wire(rightCategory, 'ExecOutB', rightPart, 'Exec');
  const leftCategory = inputCircuit.n('Exec_Branch', { bCond: leftCategoryAllowed });
  const leftPart = inputCircuit.n('Exec_Branch', { bCond: leftPartAllowed });
  build.wire(leftPulse[0], leftPulse[1], leftCategory, 'Exec');
  build.wire(leftCategory, 'ExecOutB', leftPart, 'Exec');

  const nextCategory = inputCircuit.math('Add', R(categoryIndex), 1);
  const previousCategory = inputCircuit.math('Subtract', R(categoryIndex), 1);
  const setNextCategory = inputCircuit.set(categoryIndex, nextCategory);
  const setPreviousCategory = inputCircuit.set(categoryIndex, previousCategory);
  build.wire(rightCategory, 'ExecOutA', setNextCategory, 'Exec');
  build.wire(leftCategory, 'ExecOutA', setPreviousCategory, 'Exec');
  const categoryChanged = union(build, inputCircuit,
    [[setNextCategory, 'ExecOut'], [setPreviousCategory, 'ExecOut']]);
  build.wire(categoryChanged[0], categoryChanged[1], categoryLoadInput, 'ExecB');

  const nextPart = inputCircuit.math('Add', R(selectedIndex), 1);
  const previousPart = inputCircuit.math('Subtract', R(selectedIndex), 1);
  const setNextPart = inputCircuit.set(selectedIndex, nextPart);
  const setPreviousPart = inputCircuit.set(selectedIndex, previousPart);
  build.wire(rightPart, 'ExecOutA', setNextPart, 'Exec');
  build.wire(leftPart, 'ExecOutA', setPreviousPart, 'Exec');
  inputCircuit.use('sounds');
  const tapSoundPulse = union(build, inputCircuit, [
    [setNextCategory, 'ExecOut'], [setPreviousCategory, 'ExecOut'],
    [setNextPart, 'ExecOut'], [setPreviousPart, 'ExecOut'],
  ]);
  build.wire(tapSoundPulse[0], tapSoundPulse[1], tapBrowseSound, 'Play');
  inputCircuit.use('change');
  const partChanged = union(build, inputCircuit,
    [[setNextPart, 'ExecOut'], [setPreviousPart, 'ExecOut']]);
  let partChangeTail = chain(build, partChanged, core.set(dataReady, false));
  partChangeTail = chain(build, partChangeTail, selectedPartExec, 'ExecB');
  partChangeTail = [selectedPartGet, 'ExecOut'];
  const changedPartWait = inputCircuit.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(partChangeTail[0], partChangeTail[1], changedPartWait, 'Input');
  const changedPartFound = inputCircuit.n('Exec_Branch', { bCond: R(selectedPartGet, 'bFound') });
  build.wire(changedPartWait, 'Output', changedPartFound, 'Exec');
  let changedReady = chain(build, [changedPartFound, 'ExecOutA'], core.set(dataReady, true));
  changedReady = chain(build, changedReady, core.set(response, readyResponseText));
  const changedPartError = core.set(response, 'CATALOG ERROR:\r\nPART NOT FOUND');
  build.wire(changedPartFound, 'ExecOutB', changedPartError, 'Exec');
  // ---- Purchase: fresh reads, final guards, score/Scrap write ---------------
  core.use('purchase');
  const buyRow = core.cmp('Equal', R(selectedRow), 2);
  const buyStartAllowed = core.and(authorized, R(dataReady), notBusy, buyRow);
  const buyStart = core.n('Exec_Branch', { bCond: buyStartAllowed });
  build.wire(activateEdge, 'OnRisingEdge', buyStart, 'Exec');
  const installedBranch = core.n('Exec_Branch', { bCond: alreadyInstalled });
  build.wire(buyStart, 'ExecOutA', installedBranch, 'Exec');
  const alreadyResponse = core.set(response, 'PART ALREADY INSTALLED');
  build.wire(installedBranch, 'ExecOutA', alreadyResponse, 'Exec');

  const txnVehicle = core.v(O(null));
  const txnNonce = core.v(0);
  const txnPlayerState = core.v(O(null));
  const txnOwner = core.v('');
  const txnVehicleType = core.v('');
  const txnCategory = core.v('');
  const txnKey = core.v('');
  const txnSaved = core.v(0);
  const txnInstalled = core.v(0);
  const txnNet = core.v(0);
  let txnTail = chain(build, [installedBranch, 'ExecOutB'], core.set(busy, true));
  txnTail = chain(build, txnTail, core.set(txnVehicle, R(activeVehicle)));
  txnTail = chain(build, txnTail, core.set(txnNonce, R(vehicleNonce)));
  txnTail = chain(build, txnTail, core.set(txnPlayerState, R(playerState)));
  txnTail = chain(build, txnTail, core.set(txnOwner, R(ownerId)));
  txnTail = chain(build, txnTail, core.set(txnVehicleType, R(vehicleType)));
  txnTail = chain(build, txnTail, core.set(txnCategory, categoryId));
  txnTail = chain(build, txnTail, core.set(txnKey, categoryLeaderboardKey));
  txnTail = chain(build, txnTail, core.set(txnSaved, selectedSaved));
  txnTail = chain(build, txnTail, core.set(txnInstalled, R(installedSaved)));
  txnTail = chain(build, txnTail, core.set(txnNet, net));
  const freshInstalled = core.n('Exec_Gamemode_GetLeaderboardValue', {
    Key: R(txnKey), PlayerState: R(txnPlayerState),
  });
  txnTail = chain(build, txnTail, freshInstalled);
  const freshScrap = core.n('Exec_Gamemode_GetLeaderboardValue', {
    Key: 'Scrap', PlayerState: R(txnPlayerState),
  });
  txnTail = chain(build, txnTail, freshScrap);
  const finalPlayer = core.n('Exec_PlayerState_GetFromEntity', {
    Entity: R(seat, 'SittingCharacter'),
  });
  txnTail = chain(build, txnTail, finalPlayer);
  const finalUserId = core.n('Exec_PlayerState_GetUserId', {
    PlayerState: R(finalPlayer, 'PlayerState'),
  });
  txnTail = chain(build, txnTail, finalUserId);
  const purchaseWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(txnTail[0], txnTail[1], purchaseWait, 'Input');
  const finalStructuralGuard = core.and(
    authorized,
    core.cmp('Equal', R(activeVehicle), R(txnVehicle)),
    core.cmp('Equal', R(vehicleNonce), R(txnNonce)),
    core.cmp('Equal', R(finalPlayer, 'PlayerState'), R(txnPlayerState)),
    core.cmp('Equal', R(finalUserId, 'UserId'), R(txnOwner)),
    core.cmp('Equal', R(ownerId), R(txnOwner)),
    core.cmp('Equal', R(vehicleType), R(txnVehicleType)),
    core.cmp('Equal', categoryId, R(txnCategory)),
    core.cmp('Equal', selectedSaved, R(txnSaved)),
    core.cmp('Equal', R(freshInstalled, 'Value'), R(txnInstalled)));
  const finalGuardBranch = core.n('Exec_Branch', { bCond: finalStructuralGuard });
  build.wire(purchaseWait, 'Output', finalGuardBranch, 'Exec');
  const cancelledResponse = core.set(response, 'TRANSACTION CANCELLED');
  build.wire(finalGuardBranch, 'ExecOutB', cancelledResponse, 'Exec');
  const unlockCancelled = core.set(busy, false);
  build.wire(cancelledResponse, 'ExecOut', unlockCancelled, 'Exec');
  const canAfford = core.or(core.cmp('LessOrEqual', R(txnNet), 0),
    core.cmp('GreaterOrEqual', R(freshScrap, 'Value'), R(txnNet)));
  const fundsBranch = core.n('Exec_Branch', { bCond: canAfford });
  build.wire(finalGuardBranch, 'ExecOutA', fundsBranch, 'Exec');
  const missingFunds = core.math('Subtract', R(txnNet), R(freshScrap, 'Value'));
  const insufficientText = core.fmt('INSUFFICIENT SCRAP\r\nNEED 🔩{A}', missingFunds);
  const insufficientResponse = core.set(response, insufficientText);
  build.wire(fundsBranch, 'ExecOutB', insufficientResponse, 'Exec');
  const unlockInsufficient = core.set(busy, false);
  build.wire(insufficientResponse, 'ExecOut', unlockInsufficient, 'Exec');
  const failurePulse = union(build, core,
    [[alreadyResponse, 'ExecOut'], [cancelledResponse, 'ExecOut'],
      [insufficientResponse, 'ExecOut']]);
  build.wire(failurePulse[0], failurePulse[1], failureSound, 'Play');

  core.use('commit');
  const writeUpgrade = core.n('Exec_Gamemode_SetLeaderboardValue', {
    Key: R(txnKey), Value: R(txnSaved), PlayerState: R(txnPlayerState),
  });
  build.wire(fundsBranch, 'ExecOutA', writeUpgrade, 'Exec');
  const scrapDelta = R(core.n('Expr_MathNegate', { Input: R(txnNet) }), 'Output');
  const adjustScrap = core.n('Exec_Gamemode_IncrementLeaderboardValue', {
    Key: 'Scrap', Value: scrapDelta, PlayerState: R(txnPlayerState),
  });
  build.wire(writeUpgrade, 'ExecOut', adjustScrap, 'Exec');
  const reloadWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(adjustScrap, 'ExecOut', reloadWait, 'Input');
  const reload = core.send('SR.Mechanic.Reload', [
    R(txnVehicle), R(txnNonce), R(txnVehicleType), R(txnCategory), R(txnSaved),
    R(txnOwner), N(0), N(1),
  ], R(txnVehicle));
  build.wire(reloadWait, 'Output', reload, 'ExecIn');
  const updatedScrap = core.math('Subtract', R(freshScrap, 'Value'), R(txnNet));
  let commitTail = chain(build, [reload, 'ExecOut'], core.set(scrap, updatedScrap));
  commitTail = chain(build, commitTail, core.set(installedSaved, R(txnSaved)));
  commitTail = chain(build, commitTail, core.set(installedIndex, R(selectedIndex)));
  commitTail = chain(build, commitTail, core.set(installedInvalid, false));
  const postInstalledGet = core.n('Exec_MapVar_Get', {
    MapVarRef: R(partsMap, 'MapVarRef'), Key: installedKey,
  });
  commitTail = chain(build, commitTail, postInstalledGet);
  commitTail = chain(build, commitTail,
    core.set(installedRecord, R(postInstalledGet, 'Value')));
  const refreshInstalledWait = core.n('BufferTicks', { TicksToWait: 1, ZeroTicksToWait: 0 });
  build.wire(commitTail[0], commitTail[1], refreshInstalledWait, 'Input');
  commitTail = [refreshInstalledWait, 'Output'];
  core.use('response');
  const paidText = core.fmt('PART INSTALLED -🔩{A}', R(txnNet));
  const receivedText = core.fmt('PART INSTALLED +🔩{A}',
    R(core.n('Expr_MathNegate', { Input: R(txnNet) }), 'Output'));
  const txnPositive = core.cmp('Greater', R(txnNet), 0);
  const txnNegative = core.cmp('Less', R(txnNet), 0);
  const nonPositiveText = core.sel(txnNegative,
    'PART INSTALLED\r\nNO SCRAP COST', receivedText);
  const successText = core.sel(txnPositive, nonPositiveText, paidText);
  commitTail = chain(build, commitTail, core.set(response, successText));
  for (const successSound of successSounds)
    build.wire(commitTail[0], commitTail[1], successSound, 'Play');
  commitTail = chain(build, commitTail, core.set(busy, false));

  // ---- Display formatting ---------------------------------------------------
  display.use('blink');
  const selectionBlink = display.v(false);
  const nextBlink = display.not(R(selectionBlink));
  const blinkClock = display.n('Clock', {
    bEnabled: controlsReady, bPulseOn: false,
    OnTimeSeconds: 1, OffTimeSeconds: 1, IntervalSeconds: 0.25,
  });
  const toggleBlink = display.set(selectionBlink, nextBlink);
  build.wire(blinkClock, 'Pulse', toggleBlink, 'Exec');
  const readyEdge = display.n('Expr_EdgeDetectorExec', {
    Input: controlsReady, bSeeded: true,
  });
  const resetBlinkPulse = union(build, display,
    [[readyEdge, 'OnRisingEdge'], [readyEdge, 'OnFallingEdge']]);
  const resetBlink = display.set(selectionBlink, false);
  build.wire(resetBlinkPulse[0], resetBlinkPulse[1], resetBlink, 'Exec');
  const activeBlink = display.and(controlsReady, R(selectionBlink));

  display.use('rows');
  const row0 = display.cmp('Equal', R(selectedRow), 0);
  const row1 = display.cmp('Equal', R(selectedRow), 1);
  const row2 = display.cmp('Equal', R(selectedRow), 2);
  const orangePrefix = '<color="ff8700">';
  const categoryPrefix = display.sel(row0, '', orangePrefix);
  const selectedPrefix = display.sel(row1, '', orangePrefix);
  const buyPrefix = display.sel(row2, '', orangePrefix);
  const rowSuffix = selected => display.sel(display.and(selected, activeBlink),
    '  </>', ' <</>');
  const categorySuffix = rowSuffix(row0);
  const selectedSuffix = rowSuffix(row1);
  const buySuffix = rowSuffix(row2);
  const categoryLine = display.fmt('{A}CATEGORY: {B}{C}',
    categoryPrefix, categoryDisplay, categorySuffix);
  const selectedLine = display.fmt('{A}SELECTED: {B}{C}',
    selectedPrefix, selectedName, selectedSuffix);
  const installedLine = display.fmt('INSTALLED: {A}', installedName);
  const buyLabel = display.sel(alreadyInstalled, 'BUY', 'INSTALLED');
  const buyLine = display.fmt('{A}{B}{C}', buyPrefix, buyLabel, buySuffix);

  display.use('stats');
  function comparisonLine(index) {
    const spec = split(display, categoryFields[4 + index], 4, '^');
    const label = spec[0];
    const unit = spec[1];
    const direction = spec[3];
    const installedText = installedFields[4 + index];
    const selectedText = selectedFields[4 + index];
    const installedNumber = display.num(installedText);
    const selectedNumber = display.num(selectedText);
    const greater = display.cmp('Greater', selectedNumber, installedNumber);
    const less = display.cmp('Less', selectedNumber, installedNumber);
    const higher = display.cmp('Equal', direction, 'H');
    const lower = display.cmp('Equal', direction, 'L');
    const beneficial = display.or(display.and(higher, greater), display.and(lower, less));
    const detrimental = display.or(display.and(higher, less), display.and(lower, greater));
    const badOrNeutral = display.sel(detrimental,
      '<color="ffb347">', '<color="ff5a5a">');
    const color = display.sel(beneficial, badOrNeutral, '<color="6dff6d">');
    const line = display.fmt('{A}: {B}{C} → {D}{E}{F}</>',
      label, installedText, unit, color, selectedText, unit);
    const used = display.cmp('NotEqual', label, '-');
    return display.sel(used, '', line);
  }
  const statLines = [0, 1, 2, 3].map(comparisonLine);

  display.use('right');
  const rawPartPriceLine = display.fmt('PART PRICE: 🔩{A}', selectedPrice);
  const partPriceLine = display.sel(alreadyInstalled, rawPartPriceLine,
    'PART PRICE: INSTALLED');
  const rawTradeLine = display.fmt('TRADE-IN: +🔩{A}', tradeIn);
  const tradeLine = display.sel(alreadyInstalled, rawTradeLine, 'TRADE-IN: —');
  const payLine = display.fmt('TOTAL: PAY 🔩{A}', net);
  const receiveLine = display.fmt('YOU RECEIVE: 🔩{A}', receive);
  const nonPositiveLine = display.sel(negativeNet, 'TOTAL: NO SCRAP COST', receiveLine);
  const rawTotalLine = display.sel(positiveNet, nonPositiveLine, payLine);
  const totalLine = display.sel(alreadyInstalled, rawTotalLine,
    'TOTAL: CURRENTLY INSTALLED');
  const rightTop = display.fmt(
    'UPGRADE CONFIGURATION\r\n\r\n{A}\r\n{B}\r\n{C}\r\n\r\n{D}',
    categoryLine, installedLine, selectedLine, selectedDescription);
  const statBlock = display.fmt('{A}\r\n{B}\r\n{C}\r\n{D}', ...statLines);
  const quoteBlock = display.fmt('{A}\r\n{B}\r\n{C}\r\n{D}',
    partPriceLine, tradeLine, totalLine, buyLine);
  const rightText = display.fmt(
    '{A}\r\n\r\n{B}\r\n\r\n{C}\r\n\r\nW/S SELECT\r\nA/D TAP: 1\r\nSPACE ACTIVATE',
    rightTop, statBlock, quoteBlock);
  build.wire(rightText[0], rightText[1], rightScreen, 'Text');

  display.use('left');
  const status = display.sel(authorized, display.sel(wrongOwner, 'STANDBY', 'ACCESS DENIED'),
    'RUNNING');
  const userBlock = display.fmt('USER: {A}\r\nID: {B}\r\nSCRAP: 🔩{C}',
    R(seatedUserName), R(seatedUserId), R(scrap));
  const vehicleBlock = display.fmt('VEHICLE: {A}\r\nCLASS: {B}',
    vehicleDisplay, vehicleClass);
  const leftText = display.fmt(
    'PROCESS: MECHANIC_SHOP\r\nSTATUS: {A}\r\n\r\n{B}\r\n\r\n{C}\r\n\r\nSYSTEM RESPONSE:\r\n{D}',
    status, userBlock, vehicleBlock, R(response));
  build.wire(leftText[0], leftText[1], leftScreen, 'Text');

  display.use('indicator');
  build.wire(authorized[0], authorized[1], displayEnable, 'RER_Input');
  build.wire(ownerAuthorized[0], ownerAuthorized[1], leftScreen, 'bEnabled');
  build.wire(displayEnable, 'RER_Output', rightScreen, 'bEnabled');
  const wrongColor = display.sel(wrongOwner, LC(0, 0, 0), LC(1, 0, 0));
  const indicatorColor = display.sel(authorized, wrongColor, LC(0, 1, 0));
  build.wire(indicatorColor[0], indicatorColor[1], indicator, 'Color');

  const raw = build.finish({ x: 180, y: 180, z: 100 },
    'Vehicle-zone and owner-authorized mechanic shop. Browsing is screen-only; successful purchases save the exact configured score, adjust Scrap with a 75% trade-in, and reload the locked vehicle.');
  const bytes = repack(raw, donor, {
    name: 'Scrap Runners - Mechanic Shop v1',
    description: 'Clean single-controller mechanic terminal using the supplied Gearshark frame, non-live selection, data-driven Truck1 catalog, owner authorization, trade-ins, comparisons, color-terminal-style browsing sounds and row selection, corrected purchase sounds, and targeted post-purchase reload.',
  });
  return {
    bytes,
    build,
    catalog: { VEHICLES, CATEGORIES, PARTS },
    nodes: {
      seat, zone, leftScreen, rightScreen, indicator, activeVehicle, vehicleNonce,
      vehicleType, profileRevision, ownerId, protocolReady, playerState, seatedUserId,
      seatedUserName, scrap, busy, dataReady, response, vehiclesMap, categoriesMap,
      partsMap, tradeInRate, categoryIndex, selectedIndex, installedIndex,
      installedSaved, installedInvalid, selectedRow, request, reply, reload,
      writeUpgrade, adjustScrap, categoryGet, categoryLookupSettle, resetScan,
      scanGet, scanResetSettle, installedPartGet, installedPartSettle,
      selectedPartGet, selectedPartSettle,
    },
  };
}

module.exports = build;
if (require.main === module) {
  const result = build();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    nodes: result.build.nodes.length,
    wires: result.build.edges.length,
    vehicles: VEHICLES.length,
    categories: CATEGORIES.length,
    parts: PARTS.length,
    livePreview: false,
  }, null, 2));
}

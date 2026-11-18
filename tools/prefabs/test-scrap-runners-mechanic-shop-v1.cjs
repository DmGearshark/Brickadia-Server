'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');
const catalog = require('./mechanic-shop-catalog-v1.cjs');

const DEFAULT_INPUT = path.join(__dirname,
  'sources/scrap-runners-mechanic-shop-frame.brz');
const DEFAULT_OUTPUT = path.join(__dirname,
  '../../outputs/scrap-runners-mechanic-shop-v1.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-mechanic-shop-v1.cjs');

const clone = structuredClone;

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function valueFamily(value) {
  if (value && typeof value === 'object' && '$variant' in value) {
    if (value.$variant === 'i64' || value.$variant === 'f64') return 'number';
    if (value.$variant === 'str') return 'string';
    if (value.$variant === 'Bool') return 'bool';
    return value.$variant;
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'bool';
  return undefined;
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(row =>
    row.comp.type === type && predicate(row.comp.data, row.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  return {
    scene, bricks, rows, all, one, incoming, outgoing,
    source: edge => bricks.get(edge.a),
    target: edge => bricks.get(edge.z),
  };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
}

function isExecPort(t, brick, type, port) {
  const saved = component(brick, type);
  if (saved?.data?.[port]?.$variant === 'WireGraphExec') return true;
  if (type === C.BufferTicks.NAME && (port === 'Input' || port === 'Output')) return true;
  if (type === C.QueueTicks.NAME && (port === 'ExecIn' || port === 'ExecOut')) return true;
  if (type === C.Clock.NAME && port === 'Pulse') return true;
  if (type === C.Expr_EdgeDetectorExec.NAME
    && (port === 'OnRisingEdge' || port === 'OnFallingEdge')) return true;
  if (type === C.Event_CustomGlobal.NAME && port === 'ExecOut') return true;
  if ((type === C.EntityZoneEvent_Entered.NAME || type === C.EntityZoneEvent_Left.NAME)
    && port === 'Exec') return true;
  if (type === C.OneShotAudioEmitter.NAME && port === 'Play') return true;
  if (/^BrickComponentType_Exec_/.test(type) && /^Exec/.test(port)) return true;
  if (/^RER_/.test(port)) return ['CallableDefault', 'CallableMirror', 'CallableResult']
    .some(field => saved?.data?.[field]?.$variant === 'WireGraphExec');
  return false;
}

function execReachableFromPort(t, start, type, port, goal) {
  const queue = t.outgoing(start, type, port).filter(edge =>
    isExecPort(t, start, edge.at, edge.p)
      && isExecPort(t, t.target(edge), edge.zt, edge.q)).map(edge => edge.z);
  const seen = new Set(queue);
  while (queue.length) {
    const key = queue.shift();
    if (key === goal.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || seen.has(edge.z)) continue;
      if (!isExecPort(t, brick, edge.at, edge.p)
        || !isExecPort(t, t.target(edge), edge.zt, edge.q)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return false;
}

function dataDependsOn(t, target, source, targetPort) {
  const queue = t.scene.edges.filter(edge => edge.z === target.key
    && (!targetPort || edge.q === targetPort)
    && !isExecPort(t, t.source(edge), edge.at, edge.p)
    && !isExecPort(t, target, edge.zt, edge.q)).map(edge => edge.a);
  const seen = new Set(queue);
  while (queue.length) {
    const key = queue.shift();
    if (key === source.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.z !== key || seen.has(edge.a)) continue;
      if (isExecPort(t, t.source(edge), edge.at, edge.p)
        || isExecPort(t, brick, edge.zt, edge.q)) continue;
      seen.add(edge.a);
      queue.push(edge.a);
    }
  }
  return false;
}

function buildOne(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}

function buildIncoming(build, node, port, label) {
  return buildOne(build.edges.filter(edge => edge.z === node && edge.q === port), label);
}

function buildOutgoing(build, node, port, label) {
  return buildOne(build.edges.filter(edge => edge.a === node && edge.p === port), label);
}

function isBuildExecPort(node, port) {
  if (node.type === C.BufferTicks.NAME && (port === 'Input' || port === 'Output')) return true;
  if (node.type === C.QueueTicks.NAME && (port === 'ExecIn' || port === 'ExecOut')) return true;
  if (node.type === C.Clock.NAME && port === 'Pulse') return true;
  if (node.type === C.Expr_EdgeDetectorExec.NAME
    && (port === 'OnRisingEdge' || port === 'OnFallingEdge')) return true;
  if (node.type === C.Event_CustomGlobal.NAME && port === 'ExecOut') return true;
  if ((node.type === C.EntityZoneEvent_Entered.NAME
      || node.type === C.EntityZoneEvent_Left.NAME) && port === 'Exec') return true;
  if (node.type === C.OneShotAudioEmitter.NAME && port === 'Play') return true;
  return /^BrickComponentType_Exec_/.test(node.type) && /^Exec/.test(port);
}

function buildExecReachableFromPort(build, start, port, goal) {
  const queue = build.edges.filter(edge => edge.a === start && edge.p === port
    && isBuildExecPort(edge.a, edge.p) && isBuildExecPort(edge.z, edge.q))
    .map(edge => edge.z);
  const seen = new Set(queue);
  while (queue.length) {
    const node = queue.shift();
    if (node === goal) return true;
    for (const edge of build.edges) {
      if (edge.a !== node || seen.has(edge.z)) continue;
      if (!isBuildExecPort(edge.a, edge.p) || !isBuildExecPort(edge.z, edge.q)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return false;
}

function buildDataDependsOn(build, target, source, targetPort) {
  const queue = build.edges.filter(edge => edge.z === target
    && (!targetPort || edge.q === targetPort)
    && !isBuildExecPort(edge.a, edge.p) && !isBuildExecPort(edge.z, edge.q))
    .map(edge => edge.a);
  const seen = new Set(queue);
  while (queue.length) {
    const node = queue.shift();
    if (node === source) return true;
    for (const edge of build.edges) {
      if (edge.z !== node || seen.has(edge.a)) continue;
      if (isBuildExecPort(edge.a, edge.p) || isBuildExecPort(edge.z, edge.q)) continue;
      seen.add(edge.a);
      queue.push(edge.a);
    }
  }
  return false;
}

function settersFor(build, variable) {
  return build.edges.filter(edge => edge.a === variable && edge.p === 'VarRef'
    && edge.z.type === C.Exec_Var_Set.NAME).map(edge => edge.z);
}

function setterValueSource(build, setter, label) {
  return buildIncoming(build, setter, 'Value', label).a;
}

function assertWireIntegrity(scene) {
  const t = api(scene);
  const definitions = new Map(Object.values(C).map(definition =>
    [definition.NAME, definition]));
  const targets = new Set();
  for (const edge of scene.edges) {
    const source = t.bricks.get(edge.a);
    const target = t.bricks.get(edge.z);
    assert(source, `wire source exists: ${edge.a}`);
    assert(target, `wire target exists: ${edge.z}`);
    assert(component(source, edge.at), `source component exists: ${edge.at}`);
    assert(component(target, edge.zt), `target component exists: ${edge.zt}`);
    assert(Object.values(definitions.get(edge.at)?.PORTS || {}).includes(edge.p),
      `valid source port ${edge.at}.${edge.p}`);
    assert(Object.values(definitions.get(edge.zt)?.PORTS || {}).includes(edge.q),
      `valid target port ${edge.zt}.${edge.q}`);
    const targetPort = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(targetPort), `one driver for ${targetPort}`);
    targets.add(targetPort);
  }
  for (const link of scene.links)
    assert(t.bricks.has(link.key), `microchip link brick exists: ${link.key}`);
  for (const joint of scene.joints || [])
    assert(t.bricks.has(joint.key), `joint brick exists: ${joint.key}`);
}

function assertWireValueTypes(scene) {
  const t = api(scene);
  const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
  const field = (type, port) => {
    const structName = brdb.COMPONENT_TYPE_STRUCTS.get(type);
    return structName && schema.structs.get(structName)?.get(port);
  };
  const incomingOne = (brick, type, port) =>
    scene.edges.find(edge => edge.z === brick.key && edge.zt === type && edge.q === port);
  const cache = new Map();
  const stack = new Set();
  const sourceFamily = (brick, type, port) => {
    const key = `${brick.key}|${type}|${port}`;
    if (cache.has(key)) return cache.get(key);
    if (stack.has(key)) return undefined;
    stack.add(key);
    const saved = component(brick, type);
    let family = valueFamily(saved?.data?.[port]);
    if (type === C.Expr_String_FormatText.NAME && port === 'Output') family = 'string';
    else if (type === C.Expr_String_Split.NAME && (port === 'Left' || port === 'Right'))
      family = 'string';
    else if (type === C.Expr_String_ParseNumber.NAME && port === 'Value') family = 'number';
    else if (/BrickComponentType_Expr_(?:Compare|Logical)/.test(type)
      && port.startsWith('b')) family = 'bool';
    else if (/BrickComponentType_Expr_(?:Math|Floor)/.test(type) && port === 'Output')
      family = 'number';
    else if (type === C.Expr_Select.NAME && port === 'Output') {
      for (const input of ['InputA', 'InputB']) {
        const edge = incomingOne(brick, type, input);
        family = edge ? sourceFamily(t.source(edge), edge.at, edge.p)
          : valueFamily(saved.data[input]);
        if (family) break;
      }
    } else if (type === C.Exec_MapVar_Get.NAME && port === 'Value') {
      const edge = incomingOne(brick, type, 'MapVarRef');
      if (edge) {
        const map = component(t.source(edge), edge.at).data.Value;
        family = valueFamily({ $variant: map.$valueType, value: null });
      }
    } else if (type === C.QueueTicks.NAME && /^DataOut[1-8]$/.test(port)) {
      family = valueFamily(saved.data[port]);
    } else if (type === C.Exec_PlayerState_GetFromEntity.NAME && port === 'PlayerState')
      family = 'weak_object';
    else if (type === C.Exec_PlayerState_GetUserId.NAME && port === 'UserId')
      family = 'string';
    else if (type === C.Exec_PlayerState_GetDisplayName.NAME && port === 'DisplayName')
      family = 'string';
    else if (type === C.Exec_Gamemode_GetLeaderboardValue.NAME && port === 'Value')
      family = 'number';
    else if ((type === C.EntityZoneEvent_Entered.NAME || type === C.EntityZoneEvent_Left.NAME)
      && port === 'Entity') family = 'weak_object';
    else if (type === C.Seat.NAME && port === 'SittingCharacter') family = 'weak_object';
    else if (type === C.Seat.NAME && port === 'bIsOccupied') family = 'bool';
    else if (type === C.InputSplitter.NAME && port.startsWith('Input')) family = 'number';
    stack.delete(key);
    cache.set(key, family);
    return family;
  };

  const mismatches = [];
  const unknown = [];
  for (const edge of scene.edges) {
    if (field(edge.zt, edge.q)?.type !== 'WireValue') continue;
    const source = t.source(edge);
    const target = t.target(edge);
    if (isExecPort(t, source, edge.at, edge.p)
      || isExecPort(t, target, edge.zt, edge.q)) continue;
    const sourceType = sourceFamily(source, edge.at, edge.p);
    const targetType = valueFamily(component(target, edge.zt).data[edge.q]);
    if (!sourceType || !targetType) {
      unknown.push(`${edge.a}.${edge.p} -> ${edge.z}.${edge.q}`);
      continue;
    }
    if (sourceType && targetType && sourceType !== targetType)
      mismatches.push(`${edge.z}.${edge.q}: ${sourceType} -> ${targetType}`);
  }
  assert.deepEqual(unknown, [], 'every data WireValue edge has a known type family');
  assert.deepEqual(mismatches, [], 'all wired polymorphic ports have compatible variants');

  for (const row of t.all(C.Exec_MapVar_Get.NAME)) {
    const ref = t.one(t.incoming(row.brick, C.Exec_MapVar_Get.NAME, 'MapVarRef'),
      'map get reference');
    const map = component(t.source(ref), ref.at).data.Value;
    const expectedKey = map.$keyType === 'str' ? 'string' :
      map.$keyType === 'Bool' ? 'bool' : 'number';
    const expectedValue = map.$valueType === 'str' ? 'string' :
      map.$valueType === 'Bool' ? 'bool' : 'number';
    assert.equal(valueFamily(row.comp.data.Key), expectedKey, 'map key output type');
    assert.equal(valueFamily(row.comp.data.Value), expectedValue, 'map value output type');
  }
  for (const row of t.all(C.QueueTicks.NAME)) for (let index = 1; index <= 8; index++)
    assert.equal(valueFamily(row.comp.data[`DataOut${index}`]),
      valueFamily(row.comp.data[`DataIn${index}`]), `queue Data${index} type is retained`);
  for (const row of t.all(C.Exec_Var_Set.NAME)) {
    const ref = t.one(t.incoming(row.brick, C.Exec_Var_Set.NAME, 'VarRef'),
      'variable setter reference');
    const variable = component(t.source(ref), ref.at);
    assert.equal(valueFamily(row.comp.data.Value), valueFamily(variable.data.Value),
      `setter matches variable type at ${row.brick.key}`);
  }
}

function assertSetterConstantsAndDynamics(scene) {
  const t = api(scene);
  const setters = t.all(C.Exec_Var_Set.NAME);
  const literalValues = setters.filter(row =>
    t.incoming(row.brick, C.Exec_Var_Set.NAME, 'Value').length === 0)
    .map(row => row.comp.data.Value);
  assert(literalValues.some(value => value.$variant === 'Bool' && value.value === true),
    'serialized setters preserve literal Bool true');
  assert(literalValues.some(value => value.$variant === 'Bool' && value.value === false),
    'serialized setters preserve literal Bool false');
  assert(literalValues.some(value => value.$variant === 'str'
    && value.value === 'CONNECTING TO VEHICLE'),
  'serialized setters preserve a nonempty connection response');
  assert(literalValues.some(value => value.$variant === 'str'
    && value.value === 'VEHICLE CONNECTED'),
  'serialized setters preserve VEHICLE CONNECTED');

  const dynamic = setters.filter(row =>
    t.incoming(row.brick, C.Exec_Var_Set.NAME, 'Value').length === 1);
  assert(dynamic.length > 0, 'serialized artifact contains wired dynamic setters');
  const dynamicFamilies = new Set(dynamic.map(row => valueFamily(row.comp.data.Value)));
  assert(dynamicFamilies.has('weak_object'), 'wired weak-object setter retains its type');
  assert(dynamicFamilies.has('string'), 'wired string setter retains its type');
  assert(dynamicFamilies.has('number'), 'wired numeric setter retains its type');
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : [5, 5, 2]);
}

const CHIP_SPEC = {
  label: 'Mechanic Shop Controller', text: 'MECHANIC SHOP\r\nCONTROLLER',
  position: [115, -25, -25],
  center: { X: 500, Y: -240, Z: 0 }, extent: { X: 510, Y: 290, Z: 2 },
};

const MAJOR_HEADERS = [
  ['VEHICLE + OWNER', 0, 20, 250],
  ['INPUT + SELECTION', 270, 20, 280],
  ['CATALOG CONFIG', 570, 20, 430],
  ['PURCHASE CORE', 0, -210, 450],
  ['DISPLAY + SOUND', 470, -210, 390],
];

const SECTION_SPECS = {
  'MECHANIC SHOP CONTROLLER': [
    ['VEHICLE BAY LOCK', 0, 0, 110, -100],
    ['MECHANIC PROTOCOL', 120, 0, 120, -100],
    ['SEAT + OWNER AUTH', 0, -100, 140, -140],
    ['SESSION STATE', 150, -100, 100, -140],

    ['SEAT INPUT', 270, 0, 100, -100],
    ['ROW SELECTION', 380, 0, 120, -100],
    ['CATEGORY + PART', 270, -100, 140, -150],
    ['A/D TAP', 420, -100, 130, -150],
    ['BROWSE SOUNDS', 270, -150, 280, -210],

    ['VEHICLES MAP\r\nID = NAME | CLASS | OWNERSHIP | CATEGORY COUNT | REVISION',
      570, 0, 240, -60],
    ['CATEGORIES MAP\r\nTRUCK.ORDER = ID | NAME | SCORE KEY | PART COUNT | 4 STAT SPECS',
      570, -60, 240, -120],
    ['PARTS MAP\r\nTRUCK.CATEGORY.INDEX = NAME | SAVED | PRICE | DESCRIPTION | 4 STATS',
      570, -120, 240, -210],
    ['TRADE-IN RATE 0-1 + RELOAD', 820, 0, 130, -80],
    ['CONFIG NOTES\r\nOWNERSHIP IS RESERVED; RELOAD CHECKS THE ACTIVE RECORD PATH',
      820, -80, 180, -210],

    ['VEHICLE CATALOG', 0, -230, 120, -360],
    ['CATEGORY LOAD', 130, -230, 130, -360],
    ['INSTALLED PART LOOKUP', 270, -230, 140, -360],
    ['PART SELECTION', 0, -360, 140, -510],
    ['PRICE + TRADE-IN', 150, -360, 130, -510],
    ['PURCHASE FINAL GUARDS', 290, -360, 150, -510],
    ['SAVE + VEHICLE RELOAD', 0, -510, 180, -Infinity],
    ['SYSTEM RESPONSE', 190, -510, 170, -Infinity],

    ['SESSION SCREEN', 470, -230, 160, -350],
    ['SELECTION ROWS', 640, -230, 140, -350],
    ['SELECTION BLINK', 790, -230, 70, -350],
    ['DESCRIPTION + COMPARISONS', 470, -350, 210, -490],
    ['UPGRADE SCREEN', 690, -350, 170, -490],
    ['INDICATOR + SOUNDS', 470, -490, 160, -Infinity],
  ],
};

function assertOrganizedChips(scene) {
  const t = api(scene);
  const entities = new Map([...scene.r.entities()].map(entity =>
    [entity.persistentIndex, entity]));
  assert.equal(scene.links.length, 1, 'exactly one outer mechanic controller');
  assert.equal(new Set(scene.links.map(link => link.grid)).size, 1,
    'one consolidated child grid');
  const spec = CHIP_SPEC;
  const row = t.one(t.all(C.Interact.NAME,
    (data, brick) => brick.g === 1 && data.PromptCustomLabel === spec.label),
  `${spec.label} chip`);
  assert.deepEqual(row.brick.data.position, spec.position, `${spec.label} fixed board position`);
  assert.equal(component(row.brick, C.TextDisplay.NAME)?.data.Text, spec.text,
    `${spec.label} visible label`);
  assert(component(row.brick, C.Microchip.NAME), `${spec.label} is a microchip`);
  assert.equal(t.all(C.Microchip.NAME, (_data, brick) => brick.g === 1).length, 1,
    'no former subsystem chips remain outside');
  const links = scene.links.filter(link => link.key === row.brick.key);
  assert.equal(links.length, 1, `${spec.label} has one child grid`);
  const grid = links[0].grid;
  const entity = entities.get(grid);
  assert(entity, `${spec.label} child-grid entity exists`);
  assert.equal(entity.typeName, 'Entity_MicrochipDynamicBrickGrid',
    `${spec.label} uses a microchip grid`);
  assert.equal(entity.data.bCollapsed, true, `${spec.label} starts collapsed`);
  assert.deepEqual(entity.data.PlaneCenter, spec.center,
    `${spec.label} has the fitted plane center`);
  assert.deepEqual(entity.data.PlaneExtent, spec.extent,
    `${spec.label} has the fitted plane extent`);
  for (const brick of scene.bricks.filter(candidate => candidate.g === grid)) {
    const half = halfSize(brick);
    assert(brick.data.position[0] - half[0] >= spec.center.X - spec.extent.X
      && brick.data.position[0] + half[0] <= spec.center.X + spec.extent.X,
    `${spec.label} contains ${brick.key} on X`);
    assert(brick.data.position[1] - half[1] >= spec.center.Y - spec.extent.Y
      && brick.data.position[1] + half[1] <= spec.center.Y + spec.extent.Y,
    `${spec.label} contains ${brick.key} on Y`);
  }

  for (const [title, x, y, width] of MAJOR_HEADERS) {
    const header = t.one(t.all(C.TextDisplay.NAME,
      (data, brick) => brick.g === grid && data.Text === title), `${title} major header`).brick;
    assert.deepEqual(header.data.position, [x + width / 2, y + 10, 2],
      `${title} major header position`);
    assert.deepEqual(header.data.size, [width / 2, 10, 2],
      `${title} major header exact width`);
    assert(!scene.edges.some(edge => edge.a === header.key || edge.z === header.key),
      `${title} major header is passive`);
  }

  const reload = t.one(t.all(C.Button.NAME,
    data => data.PromptCustomLabel === 'Reload the active mechanic catalog path'),
  'catalog reload button').brick;
  assert.equal(reload.g, grid, 'catalog reload remains inside the controller');
  assert.deepEqual(reload.data.position, [885, -35, 2],
    'catalog reload follows the shifted config section');

  const gridByLabel = new Map([['MECHANIC SHOP CONTROLLER', grid]]);
  const isFunctionalBrick = brick => brick.data.asset.startsWith('B_1x1_Gate_')
    || brick.data.asset.startsWith('PB_Gate_')
    || Boolean(component(brick, C.OneShotAudioEmitter.NAME));

  const assigned = new Set();
  for (const [chipLabel, specs] of Object.entries(SECTION_SPECS)) {
    const grid = gridByLabel.get(chipLabel);
    for (const [title, x, y, width, minY] of specs) {
      const header = t.one(t.all(C.TextDisplay.NAME,
        (data, brick) => brick.g === grid && data.Text === title), `${title} header`).brick;
      assert.deepEqual(header.data.position, [x + width / 2, y + 10, 2],
        `${title} header position`);
      assert.deepEqual(header.data.size, [width / 2, 10, 2], `${title} header width`);
      assert.deepEqual(header.data.color, [0, 0, 0], `${title} black header`);
      assert.equal(header.data.material, 'BMC_Glow', `${title} glow header`);
      assert(!scene.edges.some(edge => edge.a === header.key || edge.z === header.key),
        `${title} header is passive`);

      const gates = scene.bricks.filter(brick => brick.g === grid
        && isFunctionalBrick(brick)
        && brick.data.position[1] <= y - 5 && brick.data.position[1] > minY
        && brick.data.position[0] - halfSize(brick)[0] >= x
        && brick.data.position[0] + halfSize(brick)[0] <= x + width);
      for (const gate of gates) {
        assert(!assigned.has(gate.key), `${gate.key} belongs to one labeled section`);
        assigned.add(gate.key);
        assert.equal(gate.data.position[2], 2, `${title} gate is on the chip plane`);
        assert.equal((y - 5 - gate.data.position[1]) % 10, 0,
          `${title} gate row stays on 10-unit grid`);
      }
      const rows = Map.groupBy(gates, gate => gate.data.position[1]);
      for (const row of rows.values()) {
        row.sort((a, b) => a.data.position[0] - b.data.position[0]);
        assert.equal(row[0].data.position[0] - halfSize(row[0])[0], x,
          `${title} row begins at the labeled section edge`);
        for (let index = 1; index < row.length; index++)
          assert.equal(row[index].data.position[0] - halfSize(row[index])[0],
            row[index - 1].data.position[0] + halfSize(row[index - 1])[0],
            `${title} neighboring gates touch`);
      }
    }
  }
  const allChildGates = scene.bricks.filter(brick => brick.g !== 1
    && isFunctionalBrick(brick));
  assert.equal(assigned.size, allChildGates.length,
    'every functional child-grid gate is inside one labeled section');
  return gridByLabel;
}

function expectCatalogFailure(mutator, pattern) {
  const data = {
    vehicles: clone(catalog.VEHICLES),
    categories: clone(catalog.CATEGORIES),
    parts: clone(catalog.PARTS),
  };
  mutator(data);
  assert.throws(() => catalog.validate(data), pattern);
}

function assertCatalogContract(scene) {
  const result = catalog.validate();
  assert.equal(result.vehicles.size, 1, 'one supported vehicle');
  assert.equal(result.categories.size, 6, 'six Truck1 categories');
  assert.equal(result.parts.size, 28, 'twenty-eight Truck1 parts');

  const t = api(scene);
  const maps = t.all(C.MapVar.NAME).map(row => row.comp.data.Value.$map);
  assert.equal(maps.length, 3, 'three editable catalog maps');
  for (const expected of [catalog.VEHICLES, catalog.CATEGORIES, catalog.PARTS])
    assert(maps.some(actual => JSON.stringify(actual) === JSON.stringify(expected)),
      `serialized exact ${expected.length}-row catalog map`);
  const rates = t.all(C.Var.NAME, data => data.Value?.$variant === 'f64'
    && data.Value.value === 0.75);
  assert.equal(rates.length, 1, 'one editable 75% trade-in setting');

  expectCatalogFailure(data => data.vehicles.push(clone(data.vehicles[0])),
    /duplicate vehicle IDs/);
  expectCatalogFailure(data => data.categories.shift(), /missing category Truck1\.0/);
  expectCatalogFailure(data => { data.vehicles[0][1] += '|EXTRA'; }, /expected 5 fields/);
  expectCatalogFailure(data => {
    const fields = data.parts[0][1].split('|'); fields[2] = '-1';
    data.parts[0][1] = fields.join('|');
  }, /nonnegative price/);
  expectCatalogFailure(data => {
    const fields = data.parts[2][1].split('|'); fields[2] = '1';
    data.parts[2][1] = fields.join('|');
  }, /prices increase from left to right/);
  expectCatalogFailure(data => {
    const fields = data.categories[0][1].split('|');
    const spec = fields[4].split('^'); spec[3] = 'X'; fields[4] = spec.join('^');
    data.categories[0][1] = fields.join('|');
  }, /direction/);
  expectCatalogFailure(data => {
    const fields = data.parts[1][1].split('|'); fields[1] = '0';
    data.parts[1][1] = fields.join('|');
  }, /duplicate saved value/);
  expectCatalogFailure(data => {
    const fields = data.parts[0][1].split('|'); fields[4] = 'NaN';
    data.parts[0][1] = fields.join('|');
  }, /finite stat/);
  expectCatalogFailure(data => {
    const first = data.categories[0][1].split('|');
    const second = data.categories[1][1].split('|'); second[2] = first[2];
    data.categories[1][1] = second.join('|');
  }, /duplicate leaderboard key/);

  assert.deepEqual(catalog.quote({
    selectedPrice: 5000, installedPrice: 2500, scrap: 10000,
    selectedSaved: 2, installedSaved: 2,
  }), { status: 'installed', net: 0 });
  assert.deepEqual(catalog.quote({
    selectedPrice: 1000, installedPrice: 0, scrap: 1000,
    selectedSaved: 1, installedSaved: 0,
  }), { status: 'pay', tradeIn: 0, net: 1000 });
  assert.deepEqual(catalog.quote({
    selectedPrice: 1000, installedPrice: 0, scrap: 999,
    selectedSaved: 1, installedSaved: 0,
  }), { status: 'insufficient', tradeIn: 0, net: 1000, missing: 1 });
  assert.deepEqual(catalog.quote({
    selectedPrice: 750, installedPrice: 1000, scrap: 0,
    selectedSaved: 1, installedSaved: 0,
  }), { status: 'free', tradeIn: 750, net: 0 });
  assert.deepEqual(catalog.quote({
    selectedPrice: 500, installedPrice: 1000, scrap: 0,
    selectedSaved: 1, installedSaved: 0,
  }), { status: 'receive', tradeIn: 750, net: -250 });
  assert.deepEqual(catalog.quote({
    selectedPrice: 751, installedPrice: 1001, scrap: 1,
    selectedSaved: 1, installedSaved: 0,
  }), { status: 'pay', tradeIn: 750, net: 1 });

  const parts = new Map(catalog.PARTS);
  for (const [categoryKey, record] of catalog.CATEGORIES) {
    const [categoryId, , , countText] = record.split('|');
    const vehicleId = categoryKey.split('.')[0];
    const count = Number(countText);
    const savedValues = [];
    const prices = [];
    for (let index = 0; index < count; index++) {
      const fields = parts.get(`${vehicleId}.${categoryId}.${index}`).split('|');
      savedValues.push(Number(fields[1]));
      prices.push(Number(fields[2]));
    }
    assert.deepEqual(savedValues.slice().sort((a, b) => a - b),
      Array.from({ length: count }, (_value, index) => index),
    `${vehicleId}.${categoryId} saved values remain a complete vehicle-array index set`);
    assert.deepEqual(prices, prices.slice().sort((a, b) => a - b),
      `${vehicleId}.${categoryId} is ordered cheapest-to-most-expensive`);
  }
}

function assertQuoteGraph(scene) {
  const t = api(scene);
  const rate = t.one(t.all(C.Var.NAME, data => data.Value?.$variant === 'f64'
    && data.Value.value === 0.75), 'trade-in rate variable').brick;
  const clampEdge = t.one(t.outgoing(rate, C.Var.NAME, 'Value').filter(edge =>
    edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'),
  'editable trade-in rate enters the safety clamp');
  const clamp = t.target(clampEdge);
  const clampData = component(clamp, C.Expr_MathClamp.NAME).data;
  assert.equal(clampData.Min.value, 0, 'trade-in rate clamps at zero');
  assert.equal(clampData.Max.value, 1, 'trade-in rate clamps at one');
  const multiplyEdge = t.one(t.outgoing(clamp, C.Expr_MathClamp.NAME, 'Output').filter(edge =>
    edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB'),
  'clamped trade-in rate enters installed-price multiplication');
  const multiply = t.target(multiplyEdge);
  const installedPriceEdge = t.one(t.incoming(multiply,
    C.Expr_MathMultiply.NAME, 'InputA'), 'eligible price enters trade-in multiplication');
  const eligiblePrice = t.source(installedPriceEdge);
  const eligibleData = component(eligiblePrice, C.Expr_Select.NAME)?.data;
  assert(eligibleData, 'invalid installed scores use a trade-in eligibility selector');
  assert.equal(eligibleData.InputB.value, 0, 'invalid installed scores receive no trade-in');
  const normalInstalledEdge = t.one(t.incoming(eligiblePrice,
    C.Expr_Select.NAME, 'InputA'), 'normal installed price enters eligibility selector');
  assert(component(t.source(normalInstalledEdge), C.Expr_String_ParseNumber.NAME),
    'valid installed score uses the parsed installed-part price');
  const invalidEdge = t.one(t.incoming(eligiblePrice,
    C.Expr_Select.NAME, 'bSelectB'), 'invalid-score state controls trade-in eligibility');
  assert(component(t.source(invalidEdge), C.Var.NAME)?.data.Value?.$variant === 'Bool',
    'trade-in eligibility is controlled by the retained invalid-score flag');
  const floorEdge = t.one(t.outgoing(multiply,
    C.Expr_MathMultiply.NAME, 'Output'), 'trade-in multiplication is floored');
  const floor = t.target(floorEdge);
  assert(component(floor, C.Expr_Floor.NAME), 'trade-in explicitly floors 75%');
  const netEdge = t.one(t.outgoing(floor, C.Expr_Floor.NAME, 'Output').filter(edge =>
    edge.zt === C.Expr_MathSubtract.NAME && edge.q === 'InputB'),
  'floored trade-in enters net calculation');
  const net = t.target(netEdge);
  const selectedPriceEdge = t.one(t.incoming(net,
    C.Expr_MathSubtract.NAME, 'InputA'), 'selected price enters net calculation');
  assert(component(t.source(selectedPriceEdge), C.Expr_String_ParseNumber.NAME),
    'net uses the parsed selected-part price');
  const txnNetSetterEdge = t.one(t.outgoing(net, C.Expr_MathSubtract.NAME, 'Output')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
  'calculated net is snapshotted for purchase');
  const txnNetSetter = t.target(txnNetSetterEdge);
  const txnNetRef = t.one(t.incoming(txnNetSetter,
    C.Exec_Var_Set.NAME, 'VarRef'), 'transaction net variable');
  const txnNet = t.source(txnNetRef);
  assert.equal(component(txnNet, C.Var.NAME).data.Value.$variant, 'f64',
    'transaction net is numeric');

  const formats = t.all(C.Expr_String_FormatText.NAME)
    .map(row => row.comp.data.FormatString);
  for (const text of ['TOTAL: PAY 🔩{A}', 'YOU RECEIVE: 🔩{A}',
    'PART INSTALLED -🔩{A}', 'PART INSTALLED +🔩{A}'])
    assert(formats.includes(text), `terminal formats ${text}`);
  assert(t.all(C.Expr_Select.NAME, data => data.InputB?.$variant === 'str'
    && data.InputB.value === 'TOTAL: CURRENTLY INSTALLED').length === 1,
  'installed selection overrides the misleading trade-in total');
  return { t, rate, clamp, eligiblePrice, multiply, floor, net, txnNet };
}

function assertInvalidScoreFallback(scene, buildResult) {
  const t = api(scene);
  const readySelect = t.one(t.all(C.Expr_Select.NAME, data =>
    data.InputA?.$variant === 'str' && data.InputA.value === 'READY'
      && data.InputB?.$variant === 'str'
      && data.InputB.value === 'SAVED PART INVALID\r\nSTOCK ACTIVE'),
  'invalid-score system-response selector').brick;
  const invalidEdge = t.one(t.incoming(readySelect,
    C.Expr_Select.NAME, 'bSelectB'), 'invalid flag selects the fallback response');
  const invalidVar = t.source(invalidEdge);
  assert.equal(component(invalidVar, C.Var.NAME).data.Value.$variant, 'Bool',
    'installed-invalid state is retained as a Bool');
  const responseTargets = t.outgoing(readySelect, C.Expr_Select.NAME, 'Output')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value');
  assert.equal(responseTargets.length, 2,
    'normal category load and part browse share the fallback-aware response');

  const build = buildResult.build;
  const invalidState = buildResult.nodes.installedInvalid;
  assert(invalidState, 'builder exposes the invalid-score state for regression checks');
  const invalidSetters = settersFor(build, invalidState);
  const setTrue = invalidSetters.filter(setter => setter.data.Value?.$variant === 'Bool'
    && setter.data.Value.value === true);
  const setFalse = invalidSetters.filter(setter => setter.data.Value?.$variant === 'Bool'
    && setter.data.Value.value === false);
  assert.equal(setTrue.length, 1, 'scan exhaustion marks the installed score invalid');
  assert(setFalse.length >= 2,
    'valid scan and successful repair both clear the invalid-score flag');

  const dataReadyTrue = settersFor(build, buildResult.nodes.dataReady).filter(setter =>
    setter.data.Value?.$variant === 'Bool' && setter.data.Value.value === true);
  assert(dataReadyTrue.some(setter => buildExecReachableFromPort(build,
    setTrue[0], 'ExecOut', setter)),
  'invalid scan falls through stock record loading and restores browsing');
  assert(setFalse.some(setter => buildExecReachableFromPort(build,
    buildResult.nodes.reload, 'ExecOut', setter)),
  'successful purchase clears the invalid state after targeted reload');
}

function assertSoundWiring(scene) {
  const t = api(scene);
  const sounds = t.all(C.OneShotAudioEmitter.NAME);
  assert.equal(sounds.length, 5, 'terminal has three purchase and two browse sounds');
  const purchase = sounds.filter(row => row.brick.g === 1);
  const browse = sounds.filter(row => row.brick.g !== 1);
  assert.equal(purchase.length, 3, 'frame retains its three configured purchase sounds');
  assert.equal(browse.length, 2, 'controller adds exactly two tap-based browsing sounds');
  const groups = Map.groupBy(purchase, row => row.comp.data.AudioDescriptor);
  const success = [...groups.values()].find(rows => rows.length === 2);
  const failureRows = [...groups.values()].find(rows => rows.length === 1);
  assert(success, 'the two cash-register emitters share one descriptor');
  assert(failureRows, 'the failed-purchase beep uses the other descriptor');
  assert.deepEqual(success.map(row => row.comp.data.PitchMultiplier).sort(), [0.5, 0.75],
    'success retains both configured cash-register pitches');
  assert.equal(failureRows[0].comp.data.PitchMultiplier, 0.75,
    'failure retains the configured beep pitch');

  const successPlay = success.map(row => t.one(t.incoming(row.brick,
    C.OneShotAudioEmitter.NAME, 'Play'), 'successful-purchase sound trigger'));
  assert.deepEqual(successPlay.map(edge => [edge.a, edge.at, edge.p]),
    [successPlay[0], successPlay[0]].map(edge => [edge.a, edge.at, edge.p]),
  'both cash-register sounds use the exact same success pulse');
  assert(component(t.source(successPlay[0]), C.Exec_Var_Set.NAME),
    'success sounds fire only after the retained success response is committed');

  const failurePlay = t.one(t.incoming(failureRows[0].brick,
    C.OneShotAudioEmitter.NAME, 'Play'), 'failed-purchase sound trigger');
  assert(component(t.source(failurePlay), C.Exec_Union.NAME),
    'failed-purchase reasons join before the beep');
  assert.notEqual(failurePlay.a, successPlay[0].a,
    'failure never reuses the successful-purchase pulse');

  const assets = [...scene.r.externalAssets()];
  const assetName = row => assets[row.comp.data.AudioDescriptor]?.name;
  assert.equal(assets.filter(asset => asset.name === 'OBA_Keypad').length, 1,
    'exact Keypad browsing asset is serialized once');
  assert.equal(assets.filter(asset => asset.name === 'OBA_Keyboard').length, 1,
    'exact Keyboard browsing asset is serialized once');
  const selectSound = t.one(browse.filter(row => assetName(row) === 'OBA_Keypad'),
    'W/S selection sound');
  const keyboardSounds = browse.filter(row => assetName(row) === 'OBA_Keyboard');
  assert.equal(keyboardSounds.length, 1, 'A/D tap uses one exact Keyboard asset');
  const tapSound = keyboardSounds[0];
  const assertBrowseSettings = (row, volume, pitch, label) => {
    assert(Math.abs(row.comp.data.VolumeMultiplier - volume) < 1e-5, `${label} volume`);
    assert(Math.abs(row.comp.data.PitchMultiplier - pitch) < 1e-5, `${label} pitch`);
    assert.equal(row.comp.data.InnerRadius, 30, `${label} inner radius`);
    assert.equal(row.comp.data.MaxDistance, 250, `${label} max distance`);
    assert.equal(row.comp.data.bSpatialization, true, `${label} is spatial`);
    assert.equal(row.comp.data.bEnableRepeat, false, `${label} emitter repeat is disabled`);
  };
  assertBrowseSettings(selectSound, 0.32, 1.12, 'W/S select');
  assertBrowseSettings(tapSound, 0.26, 1.08, 'A/D tap');

  const prefixes = t.all(C.Expr_Select.NAME, data =>
    data.InputA?.$variant === 'str' && data.InputA.value === ''
      && data.InputB?.$variant === 'str'
      && data.InputB.value === '<color="ff8700">');
  assert.equal(prefixes.length, 3, 'three selected-row prefix formatters');
  const rowCompares = prefixes.map(row => t.source(t.one(t.incoming(row.brick,
    C.Expr_Select.NAME, 'bSelectB'), 'selected-row prefix condition')));
  assert.deepEqual(rowCompares.map(brick =>
    component(brick, C.Expr_CompareEqual.NAME).data.InputB.value).sort(), [0, 1, 2],
  'selection rows are category, part, and buy');
  const selectedRowRefs = rowCompares.map(brick => t.source(t.one(t.incoming(brick,
    C.Expr_CompareEqual.NAME, 'InputA'), 'selected-row comparison value')).key);
  assert.equal(new Set(selectedRowRefs).size, 1, 'all row comparisons use selectedRow');
  const selectedRow = t.bricks.get(selectedRowRefs[0]);

  const selectPlay = t.one(t.incoming(selectSound.brick,
    C.OneShotAudioEmitter.NAME, 'Play'), 'W/S select sound trigger');
  const selectUnion = t.source(selectPlay);
  assert(component(selectUnion, C.Exec_Union.NAME), 'W/S setters join before select sound');
  const selectInputs = t.incoming(selectUnion, C.Exec_Union.NAME);
  assert.equal(selectInputs.length, 2, 'both W and S selection setters trigger select sound');
  for (const edge of selectInputs) {
    const setter = t.source(edge);
    assert(component(setter, C.Exec_Var_Set.NAME), 'selection sound follows a row setter');
    const ref = t.one(t.incoming(setter, C.Exec_Var_Set.NAME, 'VarRef'),
      'selection sound setter reference');
    assert.equal(ref.a, selectedRow.key, 'selection sound is driven only by W/S row changes');
  }

  const tapPlay = t.one(t.incoming(tapSound.brick,
    C.OneShotAudioEmitter.NAME, 'Play'), 'A/D tap sound trigger');
  const tapUnion = t.source(tapPlay);
  assert(component(tapUnion, C.Exec_Union.NAME),
    'successful bounded changes join before the A/D sound');
  const unionLeaves = union => t.incoming(union, C.Exec_Union.NAME)
    .flatMap(edge => {
      const source = t.source(edge);
      return component(source, C.Exec_Union.NAME) ? unionLeaves(source) : [edge];
    });
  const tapInputs = unionLeaves(tapUnion);
  assert.equal(tapInputs.length, 4,
    'category left/right and part left/right each feed the A/D sound');
  const tapVariables = [];
  for (const edge of tapInputs) {
    const setter = t.source(edge);
    assert(component(setter, C.Exec_Var_Set.NAME),
      'A/D sound follows a successful bounded setter');
    assert.equal(edge.p, 'ExecOut', 'A/D sound cannot play for a rejected boundary tap');
    tapVariables.push(t.one(t.incoming(setter, C.Exec_Var_Set.NAME, 'VarRef'),
      'A/D sound setter variable').a);
  }
  assert.deepEqual([...Map.groupBy(tapVariables, value => value).values()]
    .map(values => values.length).sort(), [2, 2],
  'A/D sound follows two category and two part setters');

  const directionInputs = t.scene.edges.filter(edge => edge.at === C.InputSplitter.NAME
    && edge.p === 'InputRight' && edge.q === 'InputA'
    && [C.Expr_CompareGreater.NAME, C.Expr_CompareLess.NAME].includes(edge.zt));
  assert.equal(directionInputs.length, 2, 'A and D each have one raw direction comparison');
  for (const directionInput of directionInputs) {
    const rawInput = t.target(directionInput);
    const compareType = directionInput.zt;
    const detectorEdge = t.one(t.outgoing(rawInput, compareType, 'bOutput').filter(edge =>
      edge.q === 'Input' && component(t.target(edge), C.Expr_EdgeDetectorExec.NAME)),
    'raw A/D detector input');
    const detector = t.target(detectorEdge);
    const categoryBranchEdge = t.one(t.outgoing(detector,
      C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge'), 'single A/D tap pulse');
    const categoryBranch = t.target(categoryBranchEdge);
    assert(component(categoryBranch, C.Exec_Branch.NAME),
      'raw A/D tap enters a bounded category branch');
    const partBranchEdge = t.one(t.outgoing(categoryBranch,
      C.Exec_Branch.NAME, 'ExecOutB'), 'category rejection falls through to part');
    const partBranch = t.target(partBranchEdge);
    assert(component(partBranch, C.Exec_Branch.NAME),
      'raw A/D tap then enters a bounded part branch');
    const expectedBound = compareType === C.Expr_CompareGreater.NAME
      ? C.Expr_CompareLess.NAME : C.Expr_CompareGreater.NAME;
    for (const [branch, label] of [[categoryBranch, 'category'], [partBranch, 'part']]) {
      const guard = t.source(t.one(t.incoming(branch,
        C.Exec_Branch.NAME, 'bCond'), `${label} boundary guard`));
      assert(component(guard, C.Expr_LogicalAND.NAME),
        `${label} navigation retains post-edge readiness authorization`);
      assert(t.incoming(guard, C.Expr_LogicalAND.NAME).some(edge =>
        component(t.source(edge), expectedBound)),
      `${label} navigation stops at its ${expectedBound === C.Expr_CompareLess.NAME
        ? 'right' : 'left'} boundary`);
    }
  }
  const spaceCompareEdge = t.one(t.scene.edges.filter(edge => edge.p === 'InputUp'
    && edge.at === C.InputSplitter.NAME && edge.q === 'InputA'
    && edge.zt === C.Expr_CompareGreater.NAME), 'raw Space comparison');
  const spaceCompare = t.target(spaceCompareEdge);
  const spaceGateEdge = t.one(t.outgoing(spaceCompare,
    C.Expr_CompareGreater.NAME, 'bOutput').filter(edge =>
      component(t.target(edge), C.Expr_LogicalAND.NAME)), 'Space readiness gate');
  const spaceGate = t.target(spaceGateEdge);
  const spaceDetectorEdge = t.one(t.outgoing(spaceGate,
    C.Expr_LogicalAND.NAME, 'bOutput').filter(edge => edge.q === 'Input'
      && component(t.target(edge), C.Expr_EdgeDetectorExec.NAME)),
  'gated Space edge detector');
  const spaceDetector = t.target(spaceDetectorEdge);
  const buyStartEdge = t.one(t.outgoing(spaceDetector,
    C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge'), 'single Space activation pulse');
  assert(component(t.target(buyStartEdge), C.Exec_Branch.NAME),
    'working gated Space path reaches purchase authorization');
  assert.equal(t.all(C.Clock.NAME, data => data.IntervalSeconds === 0.18).length, 0,
    'A/D has no held-repeat clocks');
}

function assertSelectionUiAndResponse(scene) {
  const t = api(scene);
  const prefixes = t.all(C.Expr_Select.NAME, data =>
    data.InputA?.$variant === 'str' && data.InputA.value === ''
      && data.InputB?.$variant === 'str'
      && data.InputB.value === '<color="ff8700">');
  const suffixes = t.all(C.Expr_Select.NAME, data =>
    data.InputA?.$variant === 'str' && data.InputA.value === '  </>'
      && data.InputB?.$variant === 'str' && data.InputB.value === ' <</>');
  assert.equal(prefixes.length, 3, 'category, part, and buy use the exact orange prefix');
  assert.equal(suffixes.length, 3, 'category, part, and buy use exact trailing symbols');

  const rowConditions = [];
  for (const prefix of prefixes) {
    const condition = t.source(t.one(t.incoming(prefix.brick,
      C.Expr_Select.NAME, 'bSelectB'), 'prefix selection condition'));
    rowConditions.push(condition);
    const output = t.one(t.outgoing(prefix.brick,
      C.Expr_Select.NAME, 'Output'), 'prefix formatter output');
    assert.equal(output.zt, C.Expr_String_FormatText.NAME,
      'orange prefix feeds a row formatter');
    assert.equal(output.q, 'InputA', 'orange prefix begins its selected row');
  }
  assert.deepEqual(rowConditions.map(brick =>
    component(brick, C.Expr_CompareEqual.NAME).data.InputB.value).sort(), [0, 1, 2],
  'all three selectable rows have an orange selected state');

  let activeBlink;
  for (const suffix of suffixes) {
    const suffixCondition = t.source(t.one(t.incoming(suffix.brick,
      C.Expr_Select.NAME, 'bSelectB'), 'suffix blink condition'));
    assert(component(suffixCondition, C.Expr_LogicalAND.NAME),
      'each trailing selector requires row selection and active blink');
    assert(rowConditions.some(row => dataDependsOn(t, suffixCondition, row)),
      'each trailing selector depends on its selected row');
    const candidate = t.source(t.one(t.incoming(suffixCondition,
      C.Expr_LogicalAND.NAME, 'bInputB'), 'active blink input'));
    activeBlink ||= candidate;
    assert.equal(candidate.key, activeBlink.key, 'all three rows share one blink state');
    const output = t.one(t.outgoing(suffix.brick,
      C.Expr_Select.NAME, 'Output'), 'suffix formatter output');
    assert.equal(output.zt, C.Expr_String_FormatText.NAME,
      'trailing symbols feed a row formatter');
    assert.equal(output.q, 'InputC', 'trailing symbols finish their selected row');
  }
  assert(component(activeBlink, C.Expr_LogicalAND.NAME),
    'visible blink is gated by authorization and blink state');

  const blinkClock = t.one(t.all(C.Clock.NAME,
    data => data.IntervalSeconds === 0.25), 'quarter-second selection blink').brick;
  const clockEnable = t.one(t.incoming(blinkClock,
    C.Clock.NAME, 'bEnabled'), 'blink authorization');
  const controlsReady = t.source(clockEnable);
  assert(component(controlsReady, C.Expr_LogicalAND.NAME),
    'blink clock is enabled only by controlsReady authorization');
  assert(dataDependsOn(t, activeBlink, controlsReady),
    'visible blink is blanked immediately outside controlsReady');
  const readyEdge = t.one(t.all(C.Expr_EdgeDetectorExec.NAME, (_data, brick) => {
    const input = t.incoming(brick, C.Expr_EdgeDetectorExec.NAME, 'Input')[0];
    return input && input.a === clockEnable.a && input.at === clockEnable.at
      && input.p === clockEnable.p;
  }), 'controls-ready edge detector').brick;

  const toggleSetter = t.target(t.one(t.outgoing(blinkClock,
    C.Clock.NAME, 'Pulse'), 'blink toggle pulse'));
  assert(component(toggleSetter, C.Exec_Var_Set.NAME), 'blink pulse toggles a Bool variable');
  const blinkVar = t.source(t.one(t.incoming(toggleSetter,
    C.Exec_Var_Set.NAME, 'VarRef'), 'blink state reference'));
  assert.equal(component(blinkVar, C.Var.NAME).data.Value.$variant, 'Bool',
    'blink state is retained as a Bool');
  const blinkNot = t.source(t.one(t.incoming(toggleSetter,
    C.Exec_Var_Set.NAME, 'Value'), 'inverted blink value'));
  assert(component(blinkNot, C.Expr_LogicalNOT.NAME), 'each pulse inverts blink state');
  assert.equal(t.one(t.incoming(blinkNot, C.Expr_LogicalNOT.NAME, 'bInput'),
    'blink inversion source').a, blinkVar.key, 'blink state feeds its own inversion');
  assert(dataDependsOn(t, activeBlink, blinkVar), 'visible blink uses retained blink state');

  const rising = t.one(t.outgoing(readyEdge,
    C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge'), 'blink activation reset');
  const falling = t.one(t.outgoing(readyEdge,
    C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge'), 'blink deactivation reset');
  assert.equal(falling.z, rising.z, 'ready and not-ready edges share the reset path');
  const resetJoin = t.target(rising);
  assert(component(resetJoin, C.Exec_Union.NAME), 'blink edges join before state reset');
  const resetSetter = t.target(t.one(t.outgoing(resetJoin,
    C.Exec_Union.NAME, 'ExecOut'), 'blink reset setter'));
  assert(component(resetSetter, C.Exec_Var_Set.NAME), 'authorization edges reset blink state');
  assert.equal(component(resetSetter, C.Exec_Var_Set.NAME).data.Value.value, false,
    'blink resets to off');
  assert.equal(t.one(t.incoming(resetSetter, C.Exec_Var_Set.NAME, 'VarRef'),
    'blink reset state reference').a, blinkVar.key,
  'authorization reset clears the same retained blink state');

  const formats = t.all(C.Expr_String_FormatText.NAME)
    .map(row => row.comp.data.FormatString);
  assert(formats.includes('{A}CATEGORY: {B}{C}'), 'category row has no left arrow');
  assert(formats.includes('{A}SELECTED: {B}{C}'), 'part row has no left arrow');
  assert(formats.includes('{A}{B}{C}'), 'BUY row has no left arrow');
  const controlsHelp = formats.find(format => format.includes('W/S SELECT'));
  assert(controlsHelp?.includes('A/D TAP: 1'), 'screen documents one A/D step per tap');
  assert(!controlsHelp?.includes('HOLD'), 'screen does not advertise held repeat');
  const leftScreen = t.one(t.all(C.Expr_String_FormatText.NAME,
    data => data.FormatString.startsWith('PROCESS: MECHANIC_SHOP')),
  'left terminal screen formatter').comp.data.FormatString;
  assert(leftScreen.includes('SYSTEM RESPONSE:\r\n{D}'),
    'system response value starts on its own line');
  assert(!leftScreen.includes('SYSTEM RESPONSE: {D}'),
    'system response is not crowded onto its label line');

  const strings = [];
  for (const row of t.rows) for (const value of Object.values(row.comp.data)) {
    if (typeof value === 'string') strings.push(value);
    else if (value?.$variant === 'str') strings.push(value.value);
  }
  for (const response of [
    'VEHICLE NOT\r\nSUPPORTED',
    'CATALOG ERROR:\r\nCATEGORY NOT FOUND',
    'SAVED PART INVALID\r\nSTOCK ACTIVE',
    'CATALOG ERROR:\r\nPART NOT FOUND',
    'INSUFFICIENT SCRAP\r\nNEED 🔩{A}',
    'PART INSTALLED\r\nNO SCRAP COST',
  ]) assert(strings.includes(response), `long response is split: ${JSON.stringify(response)}`);
}

function assertBoundedNavigation(buildResult) {
  const { build, nodes } = buildResult;
  for (const [label, variable] of [
    ['category', nodes.categoryIndex],
    ['part', nodes.selectedIndex],
  ]) {
    const setters = settersFor(build, variable).filter(setter =>
      setter.id.startsWith('mechanic_input_'));
    assert.equal(setters.length, 2, `${label} has one left and one right setter`);
    const moves = setters.map(setter => ({
      setter,
      value: setterValueSource(build, setter, `${label} movement value`),
    }));
    const next = buildOne(moves.filter(move => move.value.type === C.Expr_MathAdd.NAME),
      `${label} right movement`);
    const previous = buildOne(moves.filter(move =>
      move.value.type === C.Expr_MathSubtract.NAME), `${label} left movement`);
    for (const [move, boundType, direction] of [
      [next, C.Expr_CompareLess.NAME, 'right'],
      [previous, C.Expr_CompareGreater.NAME, 'left'],
    ]) {
      assert.equal(move.value.data.InputB.value, 1,
        `${label} ${direction} changes exactly one position`);
      assert.equal(buildIncoming(build, move.value, 'InputA',
        `${label} ${direction} current index`).a, variable,
      `${label} ${direction} starts from the retained index`);
      const exec = buildIncoming(build, move.setter, 'Exec',
        `${label} ${direction} accepted execution`);
      assert.equal(exec.p, 'ExecOutA', `${label} ${direction} runs only when accepted`);
      assert.equal(exec.a.type, C.Exec_Branch.NAME,
        `${label} ${direction} uses a boundary branch`);
      const guard = buildIncoming(build, exec.a, 'bCond',
        `${label} ${direction} boundary guard`).a;
      assert.equal(guard.type, C.Expr_LogicalAND.NAME,
        `${label} ${direction} keeps readiness and boundary authorization`);
      const bound = buildOne(build.edges.filter(edge => edge.z === guard
        && edge.a.type === boundType).map(edge => edge.a),
      `${label} ${direction} bound comparison`);
      assert.equal(buildIncoming(build, bound, 'InputA',
        `${label} ${direction} compared index`).a, variable,
      `${label} ${direction} bound checks the retained index`);
      if (direction === 'left') {
        assert.equal(bound.data.InputB.value, 0, `${label} left stops at zero`);
      } else {
        const last = buildIncoming(build, bound, 'InputB',
          `${label} right last index`).a;
        assert.equal(last.type, C.Expr_MathSubtract.NAME,
          `${label} right maximum is count minus one`);
        assert.equal(last.data.InputB.value, 1,
          `${label} right maximum subtracts exactly one`);
      }
    }
  }

  const step = (index, count, direction) => direction > 0
    ? (index < count - 1 ? index + 1 : index)
    : (index > 0 ? index - 1 : index);
  assert.deepEqual([step(0, 3, 1), step(1, 3, 1), step(2, 3, 1)], [1, 2, 2],
    'right navigation stops at the final entry');
  assert.deepEqual([step(2, 3, -1), step(1, 3, -1), step(0, 3, -1)], [1, 0, 0],
    'left navigation stops at the first entry');
}

function assertPreReadSettling(buildResult) {
  const { build, nodes } = buildResult;
  const buffers = [
    ['category', nodes.categoryLookupSettle],
    ['scan reset', nodes.scanResetSettle],
    ['installed part', nodes.installedPartSettle],
    ['selected part', nodes.selectedPartSettle],
  ];
  for (const [label, buffer] of buffers) {
    assert.equal(buffer.type, C.BufferTicks.NAME, `${label} uses a pre-read buffer`);
    assert.equal(buffer.data.TicksToWait, 1, `${label} waits exactly one tick`);
  }

  const categoryReadSource = buildIncoming(build, nodes.categoryGet, 'Exec',
    'category read execution').a;
  assert.equal(categoryReadSource.type, C.Exec_Var_Set.NAME,
    'category load first clears dataReady');
  assert.equal(buildIncoming(build, categoryReadSource, 'Exec',
    'category pre-read settlement').a, nodes.categoryLookupSettle,
  'category lookup waits after every reset or accepted navigation change');
  for (const setter of settersFor(build, nodes.categoryIndex))
    assert(buildExecReachableFromPort(build, setter, 'ExecOut',
      nodes.categoryLookupSettle), `${setter.id} settles before category lookup`);

  assert.equal(buildIncoming(build, nodes.scanResetSettle, 'Input',
    'scan reset settlement input').a, nodes.resetScan,
  'installed-score scan cursor reset settles before its first lookup');
  assert(buildExecReachableFromPort(build, nodes.scanResetSettle, 'Output', nodes.scanGet),
    'settled scan cursor reaches the first part scan');

  assert.equal(buildIncoming(build, nodes.installedPartGet, 'Exec',
    'installed part read execution').a, nodes.installedPartSettle,
  'installed-part lookup reads only after its index settles');
  const installedReadSetters = settersFor(build, nodes.installedIndex).filter(setter =>
    buildExecReachableFromPort(build, setter, 'ExecOut', nodes.installedPartSettle));
  assert.equal(installedReadSetters.length, 2,
    'scan success and invalid-score fallback both settle before installed-part lookup');

  assert.equal(buildIncoming(build, nodes.selectedPartGet, 'Exec',
    'selected part read execution').a, nodes.selectedPartSettle,
  'selected tuning lookup reads only after its index settles');
  for (const setter of settersFor(build, nodes.selectedIndex))
    assert(buildExecReachableFromPort(build, setter, 'ExecOut',
      nodes.selectedPartSettle), `${setter.id} settles before selected-part lookup`);
}

function assertProtocolAndNonLive(scene, buildResult) {
  const t = api(scene);
  const request = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Mechanic.Request'), 'mechanic request').brick;
  const reply = t.one(t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Mechanic.Reply'), 'mechanic reply receiver').brick;
  const reload = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Mechanic.Reload'), 'mechanic reload').brick;
  const requestData = component(request, C.Exec_SendCustomEventGlobal.NAME).data;
  const replyData = component(reply, C.Event_CustomGlobal.NAME).data;
  const reloadData = component(reload, C.Exec_SendCustomEventGlobal.NAME).data;
  const variants = (data, prefix, count) => Array.from({ length: count }, (_, index) =>
    data[`${prefix}${index + 1}`].$variant);
  assert.deepEqual(variants(requestData, 'DataIn', 3),
    ['weak_object', 'f64', 'f64'], 'typed request payload');
  assert.deepEqual(variants(replyData, 'DataOut', 6),
    ['weak_object', 'f64', 'str', 'f64', 'f64', 'str'], 'typed reply payload');
  assert.equal(replyData.bIsObjectEvent, false, 'reply is a global return event');
  assert.deepEqual(variants(reloadData, 'DataIn', 8),
    ['weak_object', 'f64', 'str', 'str', 'f64', 'str', 'f64', 'f64'],
  'typed reload payload');
  assert.equal(reloadData.DataIn8.value, 1, 'reload protocol version 1');
  assert.equal(t.incoming(request, C.Exec_SendCustomEventGlobal.NAME, 'Target').length, 1,
    'request targets the retained vehicle');
  assert.equal(t.incoming(reload, C.Exec_SendCustomEventGlobal.NAME, 'Target').length, 1,
    'reload targets the transaction vehicle');

  const eventNames = t.rows.filter(row => row.comp.type === C.Event_CustomGlobal.NAME
    || row.comp.type === C.Exec_SendCustomEventGlobal.NAME)
    .map(row => row.comp.data.EventName).sort();
  assert.deepEqual(eventNames,
    ['SR.Mechanic.Reload', 'SR.Mechanic.Reply', 'SR.Mechanic.Request'],
  'mechanic protocol is the complete custom-event surface');
  assert.equal(t.all(C.Exec_Entity_SetCustomProperty.NAME).length, 0,
    'browsing has no live entity-property mutation');

  const build = buildResult.build;
  const isBuildExec = (node, port) => {
    if (node.type === C.BufferTicks.NAME && (port === 'Input' || port === 'Output')) return true;
    if (node.type === C.QueueTicks.NAME && (port === 'ExecIn' || port === 'ExecOut')) return true;
    if (node.type === C.Clock.NAME && port === 'Pulse') return true;
    if (node.type === C.Expr_EdgeDetectorExec.NAME
      && (port === 'OnRisingEdge' || port === 'OnFallingEdge')) return true;
    if (node.type === C.Event_CustomGlobal.NAME && port === 'ExecOut') return true;
    if ((node.type === C.EntityZoneEvent_Entered.NAME || node.type === C.EntityZoneEvent_Left.NAME)
      && port === 'Exec') return true;
    if (node.type === C.OneShotAudioEmitter.NAME && port === 'Play') return true;
    return /^BrickComponentType_Exec_/.test(node.type) && /^Exec/.test(port);
  };
  const reachable = (start, goal) => {
    const queue = [start];
    const seen = new Set(queue);
    while (queue.length) {
      const node = queue.shift();
      if (node === goal) return true;
      for (const edge of build.edges) {
        if (edge.a !== node || seen.has(edge.z)) continue;
        if (!isBuildExec(edge.a, edge.p) || !isBuildExec(edge.z, edge.q)) continue;
        seen.add(edge.z); queue.push(edge.z);
      }
    }
    return false;
  };
  const browseVars = [buildResult.nodes.categoryIndex,
    buildResult.nodes.selectedIndex, buildResult.nodes.selectedRow];
  const browseSetters = browseVars.flatMap(variable => build.edges.filter(edge =>
    edge.a === variable && edge.p === 'VarRef'
      && edge.z.type === C.Exec_Var_Set.NAME && edge.z.id.startsWith('mechanic_input_'))
    .map(edge => edge.z));
  assert.equal(browseSetters.length, 6, 'two screen-only setters for each browse axis');
  for (const setter of browseSetters) {
    assert(!reachable(setter, buildResult.nodes.writeUpgrade),
      `${setter.id} cannot reach the upgrade write`);
    assert(!reachable(setter, buildResult.nodes.adjustScrap),
      `${setter.id} cannot reach the Scrap mutation`);
    assert(!reachable(setter, buildResult.nodes.reload),
      `${setter.id} cannot reach vehicle reload`);
  }
  const soundNodes = build.nodes.filter(node => node.type === C.OneShotAudioEmitter.NAME);
  assert.equal(soundNodes.length, 5, 'build graph has three purchase and two browse sounds');
  const purchaseSounds = soundNodes.filter(node => !node.grid);
  const browseSounds = soundNodes.filter(node => node.grid);
  assert.equal(purchaseSounds.length, 3, 'build graph retains exactly three purchase sounds');
  assert.equal(browseSounds.length, 2, 'build graph adds exactly two tap-based browse sounds');
  for (const setter of browseSetters) for (const sound of purchaseSounds)
    assert(!reachable(setter, sound), `${setter.id} cannot play a purchase sound`);
  const selectSound = buildOne(browseSounds.filter(sound =>
    sound.data.AudioDescriptor === 4), 'build W/S selection sound');
  const rowSetters = settersFor(build, buildResult.nodes.selectedRow).filter(setter =>
    setter.id.startsWith('mechanic_input_'));
  assert.equal(rowSetters.length, 2, 'W and S each update the selected row');
  for (const setter of rowSetters)
    assert(reachable(setter, selectSound), `${setter.id} plays the W/S selection sound`);
  return { t, request, reply, reload };
}

function assertFreshFinalGuardAndPurchaseOrder(scene, protocol) {
  const t = protocol.t;
  const write = t.one(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME),
    'one upgrade score write').brick;
  const scrap = t.one(t.all(C.Exec_Gamemode_IncrementLeaderboardValue.NAME),
    'one Scrap adjustment').brick;
  assert.equal(component(scrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME).data.Key,
    'Scrap', 'the only increment mutates Scrap');
  assertEdge(t, write, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut', scrap,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec',
    'upgrade score is saved before Scrap changes');
  const waitEdge = t.one(t.outgoing(scrap,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut'), 'reload wait after Scrap');
  const reloadWait = t.target(waitEdge);
  assert(component(reloadWait, C.BufferTicks.NAME), 'post-write reload uses a buffer');
  assertEdge(t, reloadWait, C.BufferTicks.NAME, 'Output', protocol.reload,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn', 'reload follows both saved mutations');
  assert(execReachableFromPort(t, write, C.Exec_Gamemode_SetLeaderboardValue.NAME,
    'ExecOut', protocol.reload), 'successful write reaches targeted vehicle reload');

  const finalPlayer = t.one(t.all(C.Exec_PlayerState_GetFromEntity.NAME,
    (_data, brick) => t.incoming(brick, C.Exec_PlayerState_GetFromEntity.NAME, 'Exec')
      .some(edge => component(t.source(edge),
        C.Exec_Gamemode_GetLeaderboardValue.NAME)?.data.Key === 'Scrap')),
  'fresh final PlayerState lookup').brick;
  const finalUserIdEdge = t.one(t.outgoing(finalPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState').filter(edge =>
    edge.zt === C.Exec_PlayerState_GetUserId.NAME && edge.q === 'PlayerState'),
  'fresh final user ID lookup');
  const finalUserId = t.target(finalUserIdEdge);
  const seat = t.one(t.all(C.Seat.NAME), 'mechanic seat').brick;
  assertEdge(t, seat, C.Seat.NAME, 'SittingCharacter', finalPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'Entity',
    'final guard rereads the character currently in the seat');
  assertEdge(t, finalPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', finalUserId,
    C.Exec_PlayerState_GetUserId.NAME, 'PlayerState',
    'final guard resolves the fresh seated PlayerState ID');
  assertEdge(t, finalPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', finalUserId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec', 'fresh identity resolution is ordered');
  const finalWaitEdge = t.one(t.outgoing(finalUserId,
    C.Exec_PlayerState_GetUserId.NAME, 'ExecOut'), 'final identity settlement wait');
  const finalWait = t.target(finalWaitEdge);
  assert(component(finalWait, C.BufferTicks.NAME), 'final identity settles before the guard');
  const finalBranchEdge = t.one(t.outgoing(finalWait, C.BufferTicks.NAME, 'Output'),
    'final purchase guard branch');
  const finalBranch = t.target(finalBranchEdge);
  assert(component(finalBranch, C.Exec_Branch.NAME), 'final branch follows fresh identity');
  assert(dataDependsOn(t, finalBranch, finalPlayer, 'bCond'),
    'final mutation depends on fresh seated PlayerState continuity');
  assert(dataDependsOn(t, finalBranch, finalUserId, 'bCond'),
    'final mutation depends on fresh seated user ID ownership');
  assert(execReachableFromPort(t, finalBranch, C.Exec_Branch.NAME, 'ExecOutA', write),
    'only an accepted final guard reaches mutation');
  assert(!execReachableFromPort(t, finalBranch, C.Exec_Branch.NAME, 'ExecOutB', write),
    'rejected final guard cannot mutate');
}

function test({
  input = DEFAULT_INPUT,
  output = DEFAULT_OUTPUT,
  builder = DEFAULT_BUILDER,
} = {}) {
  const bytes = fs.readFileSync(output);
  const scene = read(bytes);
  assert.equal(scene.bricks.length, 565, 'mechanic shop brick count is intentional');
  assert.equal(scene.edges.length, 820, 'mechanic shop wire count is intentional');
  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, 'mechanic shop passes strict placement');
  assert.deepEqual(placement.invalidBricks, [], 'no invalid bricks');
  assert.deepEqual(placement.confirmedPairs, [], 'no confirmed overlaps');
  assert.deepEqual(placement.uncertainPairs, [], 'no uncertain overlaps');
  assert.deepEqual(placement.warnings, [], 'no placement warnings');
  assertWireIntegrity(scene);
  assertWireValueTypes(scene);
  assertSetterConstantsAndDynamics(scene);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build(input);
  const second = build(input);
  assert.deepEqual(first.bytes, second.bytes, 'mechanic shop generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), bytes,
    'checked artifact exactly matches a fresh deterministic build');

  const grids = assertOrganizedChips(scene);
  assertCatalogContract(scene);
  assertQuoteGraph(scene);
  assertInvalidScoreFallback(scene, first);
  assertSoundWiring(scene);
  assertSelectionUiAndResponse(scene);
  assertBoundedNavigation(first);
  assertPreReadSettling(first);
  const protocol = assertProtocolAndNonLive(scene, first);
  assertFreshFinalGuardAndPurchaseOrder(scene, protocol);

  const result = {
    output,
    bricks: scene.bricks.length,
    wires: scene.edges.length,
    childChips: scene.links.length,
    labeledSections: Object.values(SECTION_SPECS).reduce((total, rows) => total + rows.length, 0),
    catalog: {
      vehicles: catalog.VEHICLES.length,
      categories: catalog.CATEGORIES.length,
      parts: catalog.PARTS.length,
    },
    childGrids: Object.fromEntries(grids),
    livePreview: false,
    strictPlacement: true,
    wireValueMismatches: 0,
    deterministic: true,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { scene, first, result };
}

if (require.main === module) test({
  input: process.argv[2] || DEFAULT_INPUT,
  output: process.argv[3] || DEFAULT_OUTPUT,
  builder: process.argv[4] || DEFAULT_BUILDER,
});

module.exports = test;

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_TERMINAL_INPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v8.brz');
const DEFAULT_TRUCK_INPUT = path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v4.brz');
const DEFAULT_TERMINAL_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v9.brz');
const DEFAULT_TRUCK_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v5.brz');

const clone = value => structuredClone(value);
const valueOf = value => value && typeof value === 'object' && '$variant' in value ? value.value : value;

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

function assertOwner(source, output, label) {
  const sourceOwners = source.r.owners();
  const sourceIndex = sourceOwners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceIndex >= 0, `${label}: source owner`);
  const sourceId = brdb.guidToUuid(sourceOwners.UserIds[sourceIndex]).toLowerCase();
  const outputOwners = output.r.owners();
  const outputIndex = outputOwners.UserIds.map(brdb.guidToUuid)
    .map(value => value.toLowerCase()).indexOf(sourceId);
  assert(outputIndex >= 0, `${label}: source owner ID retained`);
  assert.equal(outputOwners.UserNames[outputIndex], sourceOwners.UserNames[sourceIndex], `${label}: username`);
  assert.equal(outputOwners.DisplayNames[outputIndex], sourceOwners.DisplayNames[sourceIndex], `${label}: display name`);
  for (const grid of output.r.gridIds()) for (const chunk of output.r.brickChunkIndex(grid)) {
    const soa = output.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputIndex), `${label}: grid ${grid} owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputIndex), `${label}: grid ${grid} original owner`);
  }
  for (const entity of output.r.entities()) {
    assert.equal(entity.ownerIndex, outputIndex, `${label}: entity ${entity.persistentIndex} owner`);
    assert.equal(entity.originalOwnerIndex, outputIndex,
      `${label}: entity ${entity.persistentIndex} original owner`);
  }
}

function assertIntegrity(scene, label) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const definitions = new Map(Object.values(C).map(definition => [definition.NAME, definition]));
  const driven = new Set();
  for (const edge of scene.edges) {
    const source = byKey.get(edge.a);
    const target = byKey.get(edge.z);
    assert(source, `${label}: dangling source ${edge.a}`);
    assert(target, `${label}: dangling target ${edge.z}`);
    assert(component(source, edge.at), `${label}: missing source component ${edge.at}`);
    assert(component(target, edge.zt), `${label}: missing target component ${edge.zt}`);
    const sourceDefinition = definitions.get(edge.at);
    const targetDefinition = definitions.get(edge.zt);
    assert(sourceDefinition && Object.values(sourceDefinition.PORTS).includes(edge.p),
      `${label}: invalid source port ${edge.at}.${edge.p}`);
    assert(targetDefinition && Object.values(targetDefinition.PORTS).includes(edge.q),
      `${label}: invalid target port ${edge.zt}.${edge.q}`);
    const targetPort = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!driven.has(targetPort), `${label}: duplicate driver ${targetPort}`);
    driven.add(targetPort);
  }
  for (const link of scene.links) assert(byKey.has(link.key), `${label}: dangling link ${link.key}`);
  for (const joint of scene.joints || []) assert(byKey.has(joint.key), `${label}: dangling joint ${joint.key}`);
}

function assertContainer(sourcePath, outputPath, source, output, label) {
  const sourceBytes = fs.readFileSync(sourcePath);
  const outputBytes = fs.readFileSync(outputPath);
  assert.equal(outputBytes[4], sourceBytes[4], `${label}: compression method`);
  assert.deepEqual(output.r.externalAssets(), source.r.externalAssets(), `${label}: external assets`);
  assert.deepEqual(output.r.prefabJson(), source.r.prefabJson(), `${label}: Prefab.json`);
  const thumbnail = 'Meta/Thumbnail.png';
  const sourceHas = source.r.fs.listPaths().includes(thumbnail);
  const outputHas = output.r.fs.listPaths().includes(thumbnail);
  assert.equal(outputHas, sourceHas, `${label}: thumbnail presence`);
  if (sourceHas) assert.deepEqual(Buffer.from(output.r.fs.readFile(thumbnail)),
    Buffer.from(source.r.fs.readFile(thumbnail)), `${label}: thumbnail bytes`);
}

function reachable(scene, start, target, limit = 2000) {
  const sourcePorts = /^(?:ExecOut|ExecOutA|ExecOutB|Output|Pulse|Expired|OnRisingEdge|OnFallingEdge|RER_Output|bOutput|bPulseOnChange)$/;
  const targetPorts = /^(?:Exec|ExecIn|ExecA|ExecB|Input|Restart|Resume|Pause|RER_Input)$/;
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    for (const edge of scene.edges) {
      if (edge.a !== key || !sourcePorts.test(edge.p) || !targetPorts.test(edge.q)) continue;
      if (!seen.has(edge.z)) {
        seen.add(edge.z);
        queue.push(edge.z);
      }
    }
  }
  return seen.has(target.key);
}

function dataReachable(scene, start, target, limit = 3000) {
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    for (const edge of scene.edges) if (edge.a === key && !seen.has(edge.z)) {
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return seen.has(target.key);
}

function sourceBrick(apiObject, brick, type, port, label) {
  const edge = apiObject.one(apiObject.incoming(brick, type, port), label);
  return { edge, brick: apiObject.source(edge), comp: component(apiObject.source(edge), edge.at) };
}

function rowStateVariable(t, formatterLabel) {
  const formatter = t.row(C.Expr_String_FormatText.NAME,
    data => new RegExp(`^\\{A\\}${formatterLabel}`).test(data.FormatString), `${formatterLabel} formatter`);
  const roundEdge = t.one(t.incoming(formatter.brick, C.Expr_String_FormatText.NAME, 'InputB'),
    `${formatterLabel} rounded value`);
  const round = t.source(roundEdge);
  assert.equal(roundEdge.at, C.Expr_Round.NAME, `${formatterLabel}: display value is rounded`);
  const varEdge = t.one(t.incoming(round, C.Expr_Round.NAME, 'Input'), `${formatterLabel} state`);
  assert.equal(varEdge.at, C.Var.NAME, `${formatterLabel}: state is Var`);
  return t.source(varEdge);
}

function collectStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, result);
  else if (value && typeof value === 'object') for (const item of Object.values(value))
    collectStrings(item, result);
  return result;
}

function isBrickHandle(value) {
  return value && typeof value === 'object'
    && Number.isInteger(value.GridPersistentIndex)
    && value.ChunkIndex && Number.isInteger(value.ChunkIndex.X)
    && Number.isInteger(value.ChunkIndex.Y) && Number.isInteger(value.ChunkIndex.Z)
    && Number.isInteger(value.BrickIndexInChunk);
}

function brickHandles(scene) {
  const result = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (isBrickHandle(value)) result.push(value);
    if (Array.isArray(value)) for (const child of value) visit(child);
    else for (const child of Object.values(value)) visit(child);
  }
  for (const brick of scene.bricks) for (const saved of brick.comps) visit(saved.data);
  return result;
}

function handleKey(value) {
  return JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X, value.ChunkIndex.Y,
    value.ChunkIndex.Z, value.BrickIndexInChunk]);
}

function canonicalComponents(scene, type) {
  return scene.bricks.flatMap(brick => brick.comps)
    .filter(saved => saved.type === type)
    .map(saved => JSON.stringify(saved.data)).sort();
}

function test({
  terminalInput = DEFAULT_TERMINAL_INPUT,
  truckInput = DEFAULT_TRUCK_INPUT,
  terminalOutput = DEFAULT_TERMINAL_OUTPUT,
  truckOutput = DEFAULT_TRUCK_OUTPUT,
  selectionMarkers = 'v9',
} = {}) {
  const sourceTerminal = read(fs.readFileSync(terminalInput));
  const sourceTruck = read(fs.readFileSync(truckInput));
  const terminal = read(fs.readFileSync(terminalOutput));
  const truck = read(fs.readFileSync(truckOutput));
  const t = api(terminal);
  const v = api(truck);

  assertOwner(sourceTerminal, terminal, 'terminal');
  assertOwner(sourceTruck, truck, 'truck');
  assertIntegrity(terminal, 'terminal');
  assertIntegrity(truck, 'truck');
  assertContainer(terminalInput, terminalOutput, sourceTerminal, terminal, 'terminal');
  assertContainer(truckInput, truckOutput, sourceTruck, truck, 'truck');
  assert(validate(fs.readFileSync(terminalOutput)).strictOk, 'Terminal strict placement');
  assert(validate(fs.readFileSync(truckOutput)).strictOk, 'Truck strict placement');

  // Preserve the visible terminal frame, configured sounds, and orange selection treatment.
  const canonicalRoot = scene => scene.bricks.filter(brick => [1, 2].includes(brick.g))
    .map(brick => JSON.stringify([brick.g, brick.data, brick.comps])).sort();
  const expectedRoot = selectionMarkers === 'v10'
    ? canonicalRoot(sourceTerminal).map(value => value.replaceAll('> BUY <', 'BUY'))
    : canonicalRoot(sourceTerminal);
  assert.deepEqual(canonicalRoot(terminal), expectedRoot, 'Visible terminal geometry changed');
  assert.deepEqual(canonicalComponents(terminal, C.OneShotAudioEmitter.NAME),
    canonicalComponents(sourceTerminal, C.OneShotAudioEmitter.NAME), 'Interactive sounds changed');
  const terminalComponents = terminal.bricks.flatMap(brick => brick.comps);
  if (selectionMarkers === 'v9') {
    assert.equal(terminalComponents.filter(saved => saved.type === C.Expr_Select.NAME
      && saved.data.InputB?.value === '<color="ff8700">> ').length, 6, 'Six orange prefixes');
    assert.equal(terminalComponents.filter(saved => saved.type === C.Expr_Select.NAME
      && saved.data.InputB?.value === ' <</>').length, 6, 'Six orange suffixes');
  } else assert.equal(selectionMarkers, 'v10', 'Known selection-marker contract');

  const zoneEntered = t.row(C.EntityZoneEvent_Entered.NAME, () => true, 'vehicle zone entered');
  const terminalGrid = zoneEntered.brick.g;
  const insert = t.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === terminalGrid, 'zone vehicle insert');
  const previewSend = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'vehicle preview sender');
  assert(!reachable(terminal, insert.brick, previewSend.brick),
    'Zone entry must never send the terminal default appearance to the vehicle');
  const zoneLeft = t.row(C.EntityZoneEvent_Left.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle zone left');
  const restoreSend = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color', 'zone-exit appearance restore sender');
  const restoreTarget = t.one(t.incoming(restoreSend.brick,
    C.Exec_SendCustomEventGlobal.NAME, 'Target'), 'zone-exit restore Target');
  const restoreExec = t.one(t.incoming(restoreSend.brick,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'), 'zone-exit restore execution');
  assert.equal(restoreTarget.a, zoneLeft.brick.key, 'Zone exit restores the leaving vehicle');
  assert.equal(restoreTarget.at, C.EntityZoneEvent_Left.NAME);
  assert.equal(restoreTarget.p, 'Entity');
  assert.equal(restoreExec.a, zoneLeft.brick.key, 'Zone exit pulses the vehicle restore event');
  assert.equal(restoreExec.at, C.EntityZoneEvent_Left.NAME);
  assert.equal(restoreExec.p, 'Exec');

  // The entering vehicle itself supplies its current saved appearance immediately.
  const currentColor = t.row(C.Exec_Entity_GetCustomProperty.NAME,
    data => data.Key === 'CurrentColorScore', 'CurrentColorScore reader');
  const currentMaterial = t.row(C.Exec_Entity_GetCustomProperty.NAME,
    data => data.Key === 'CurrentMaterialEnum', 'CurrentMaterialEnum reader');
  for (const item of [currentColor, currentMaterial]) {
    const entity = t.one(t.incoming(item.brick, C.Exec_Entity_GetCustomProperty.NAME, 'Entity'),
      `${item.comp.data.Key} entity`);
    assert.equal(entity.a, zoneEntered.brick.key, `${item.comp.data.Key} reads the entering entity`);
    assert.equal(entity.p, 'Entity');
    assert(reachable(terminal, insert.brick, item.brick), `${item.comp.data.Key} executes after insertion`);
  }
  assert(reachable(terminal, currentColor.brick, currentMaterial.brick)
    || reachable(terminal, currentMaterial.brick, currentColor.brick),
  'Appearance properties load as one ordered entry transaction');

  // Resolve the hidden core by its InputSplitter and public Color/Material outputs.
  const splitters = t.all(C.InputSplitter.NAME);
  assert.equal(splitters.length, 1, 'One color-customizer InputSplitter');
  const hiddenGrid = splitters[0].brick.g;
  const coreColorOutput = t.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === hiddenGrid && data.PortLabel === 'Color', 'core Color output');
  const coreMaterialOutput = t.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === hiddenGrid && data.PortLabel === 'Material', 'core Material output');
  const appearanceSyncPorts = [
    ...t.all(C.MicrochipOutput.NAME, data => data.PortLabel === 'Appearance Sync'),
    ...t.all(C.MicrochipInput.NAME, data => data.PortLabel === 'Appearance Sync'),
  ];
  assert.equal(appearanceSyncPorts.length, 3, 'Appearance Sync crosses all three chip layers');
  for (const port of appearanceSyncPorts) {
    const fields = port.comp.type === C.MicrochipOutput.NAME
      ? ['CallableDefault', 'CallableResult'] : ['CallableDefault', 'CallableMirror'];
    for (const field of fields) assert.equal(port.comp.data[field]?.$variant, 'WireGraphExec',
      `Appearance Sync ${field} is executable, not a data pin`);
  }
  const hue = rowStateVariable(t, 'HUE');
  const saturation = rowStateVariable(t, 'SATURATION');
  const brightness = rowStateVariable(t, 'BRIGHTNESS');
  const appearanceSync = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === hiddenGrid && data.PortLabel === 'Appearance Sync',
    'core Appearance Sync input');
  const hsvSetters = [hue, saturation, brightness].map((variable, index) => {
    const setters = t.outgoing(variable, C.Var.NAME, 'VarRef')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
      .map(edge => t.target(edge))
      .filter(setter => {
        const value = t.incoming(setter, C.Exec_Var_Set.NAME, 'Value');
        if (value.length !== 1) return false;
        const source = t.source(value[0]);
        return dataReachable(terminal, currentColor.brick, source)
          && (index === 0 ? !!component(source, C.Expr_SplitColor.NAME)
            : !!component(source, C.Expr_MathMultiply.NAME));
      });
    assert.equal(setters.length, 1, `Vehicle color has one sync setter for HSV state ${index}`);
    assert(reachable(terminal, appearanceSync.brick, setters[0]),
      `Appearance Sync executes HSV setter ${index}`);
    assert(dataReachable(terminal, variable, coreColorOutput.brick),
      `HSV state ${index} feeds the authoritative core Color output`);
    return setters[0];
  });
  assert(hsvSetters.every((setter, index) => index === 0
    || reachable(terminal, hsvSetters[index - 1], setter)),
  'Appearance Sync executes the H/S/B setters as one ordered chain');

  const materialSyncSetters = t.all(C.Exec_Var_Set.NAME, (_data, brick) => brick.g === hiddenGrid)
    .filter(({ brick }) => {
      const value = t.incoming(brick, C.Exec_Var_Set.NAME, 'Value');
      return value.length === 1 && dataReachable(terminal, currentMaterial.brick, t.source(value[0]));
    });
  assert.equal(materialSyncSetters.length, 1, 'Vehicle material has one sync setter');
  const materialSyncSetter = materialSyncSetters[0].brick;
  assert(reachable(terminal, appearanceSync.brick, materialSyncSetter),
    'Appearance Sync executes the material setter');
  const materialVarEdge = t.one(t.incoming(materialSyncSetter, C.Exec_Var_Set.NAME, 'VarRef'),
    'synced material VarRef');
  assert.equal(materialVarEdge.at, C.Var.NAME, 'Synced material state is a Var');
  const materialState = t.source(materialVarEdge);
  assert(dataReachable(terminal, materialState, coreMaterialOutput.brick),
    'Material Var feeds the authoritative core Material output');

  // Repeat clocks are entirely idle until A or D is actually held.
  const clocks = t.all(C.Clock.NAME, (_data, brick) => brick.g === hiddenGrid);
  assert.equal(clocks.length, 4, 'Two hold-delay and two repeat clocks');
  for (const clock of clocks) {
    assert.equal(clock.comp.data.bEnabled, false, 'No clock has a free-running saved default');
    assert.equal(t.incoming(clock.brick, C.Clock.NAME, 'bEnabled').length, 1,
      'Every clock is conditionally enabled');
  }
  const holdClocks = clocks.filter(clock => clock.comp.data.IntervalSeconds === Math.fround(0.75)
    || clock.comp.data.IntervalSeconds === 0.75);
  assert.equal(holdClocks.length, 2, 'Two 0.75-second hold clocks');
  const fastClocks = clocks.filter(clock => clock !== holdClocks[0] && clock !== holdClocks[1]);
  assert.equal(fastClocks.length, 2, 'Two fast repeat clocks');
  const repeatInput = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === hiddenGrid && data.PortLabel === 'Repeat Interval', 'Repeat Interval input');
  for (const fast of fastClocks) {
    assert(t.incoming(fast.brick, C.Clock.NAME, 'IntervalSeconds')
      .some(edge => edge.a === repeatInput.brick.key), 'Fast clock retains configurable repeat interval');
    const enable = t.one(t.incoming(fast.brick, C.Clock.NAME, 'bEnabled'), 'fast clock enable');
    assert([C.Expr_CompareLess.NAME, C.Expr_CompareGreater.NAME, C.Var.NAME].includes(enable.at),
      'Fast clock is enabled only by held-direction state');
    assert(t.outgoing(fast.brick, C.Clock.NAME, 'Pulse').some(edge => edge.zt === C.Exec_Branch.NAME),
      'Fast pulse retains repeat gate');
  }

  // Material is exactly Plastic/Metal, represented by Brickadia enum 0/4.
  const componentStrings = terminal.bricks.flatMap(brick => brick.comps)
    .flatMap(saved => collectStrings(saved.data));
  for (const forbidden of ['GLASS', 'TRANSLUCENT PLASTIC', 'GLOW', 'HOLOGRAM']) {
    assert(!componentStrings.some(value => new RegExp(`\\b${forbidden}\\b`, 'i').test(value)),
      `Removed material ${forbidden} remains in editable logic`);
  }
  assert(componentStrings.some(value => value === 'PLASTIC'), 'Plastic label');
  assert(componentStrings.some(value => value === 'METAL'), 'Metal label');
  const materialInput = sourceBrick(t, coreMaterialOutput.brick, C.MicrochipOutput.NAME,
    'RER_Input', 'core material value');
  assert(component(materialInput.brick, C.Var.NAME) || component(materialInput.brick, C.Expr_Select.NAME),
    'Material output is driven by a bounded state/mapping gate');
  const moduloEight = t.all(C.Expr_MathModuloFloored.NAME,
    (data, brick) => brick.g === hiddenGrid && valueOf(data.InputB) === 8);
  const addFour = t.all(C.Expr_MathAdd.NAME,
    (data, brick) => brick.g === hiddenGrid && valueOf(data.InputB) === 4);
  assert.equal(moduloEight.length, 2, 'Both material directions wrap over enum domain 0/4');
  assert.equal(addFour.length, 2, 'Both material directions toggle by four');
  assert(t.incoming(previewSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'DataIn2')
    .some(edge => edge.at === C.MicrochipOutput.NAME
      && component(t.source(edge), C.MicrochipOutput.NAME)?.data.PortLabel === 'Material'),
  'Vehicle preview includes material as DataIn2');

  // Successful purchase response uses the configurable price, while BUY remains color-only.
  const cost = t.row(C.Var.NAME, (data, brick) => valueOf(data.Value) === 100
    && component(brick, C.Interact.NAME)?.data.PromptCustomLabel === 'Color purchase cost',
  'configured color price');
  const successFormat = t.row(C.Expr_String_FormatText.NAME,
    data => /SYSTEM RESPONSE: COLOR APPLIED -🔩\{A\}/.test(data.FormatString),
    'dynamic success response');
  assert(t.incoming(successFormat.brick, C.Expr_String_FormatText.NAME, 'InputA')
    .some(edge => edge.a === cost.brick.key && edge.at === C.Var.NAME),
  'Success response reads configured price');
  const successSetter = t.row(C.Exec_Var_Set.NAME, (_data, brick) =>
    t.incoming(brick, C.Exec_Var_Set.NAME, 'Value').some(edge => edge.a === successFormat.brick.key),
  'success response setter');
  const responseVarEdge = t.one(t.incoming(successSetter.brick, C.Exec_Var_Set.NAME, 'VarRef'),
    'success response VarRef');
  assert.equal(responseVarEdge.at, C.Var.NAME, 'Success response writes the screen response Var');
  const responseVar = t.source(responseVarEdge);
  const visibleResponseFormatters = t.outgoing(responseVar, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_String_FormatText.NAME)
    .map(edge => t.target(edge))
    .filter(formatter => t.outgoing(formatter, C.Expr_String_FormatText.NAME, 'Output')
      .some(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'Text'));
  assert(visibleResponseFormatters.length >= 1,
    'Dynamic success response reaches the visible terminal TextDisplay');
  const debit = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'one Scrap debit');
  const debitValueEdge = t.one(t.incoming(debit.brick,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Value'), 'Scrap debit value');
  assert.equal(debitValueEdge.at, C.Expr_MathNegate.NAME, 'Configured price is negated for the debit');
  const debitNegate = t.source(debitValueEdge);
  assert(t.incoming(debitNegate, C.Expr_MathNegate.NAME, 'Input')
    .some(edge => edge.a === cost.brick.key && edge.at === C.Var.NAME),
  'Scrap debit uses the same configured color price');
  assert(t.incoming(successSetter.brick, C.Exec_Var_Set.NAME, 'Exec')
    .some(edge => edge.a === debit.brick.key && edge.p === 'ExecOut'),
  'Success response follows completed debit');
  assert.equal(t.all(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap').length, 1, 'One configured Scrap charge');
  assert.equal(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME).length, 1,
    'BUY still persists only the requested color value');
  assert.equal(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    data => /Material/i.test(data.Key || '')).length, 0, 'BUY does not silently purchase material');

  // Vehicle publishes saved appearance on its own root for literal zone-entry synchronization.
  const vehicleRoot = v.one([...truck.r.entities()].filter(entity => entity.data?.EntityTag === 'Vehicle'),
    'truck Vehicle root');
  const colorProperty = v.row(C.Exec_Entity_SetCustomProperty.NAME,
    data => data.Key === 'CurrentColorScore', 'vehicle CurrentColorScore publisher');
  const materialProperty = v.row(C.Exec_Entity_SetCustomProperty.NAME,
    data => data.Key === 'CurrentMaterialEnum', 'vehicle CurrentMaterialEnum publisher');
  const rootReaders = v.all(C.ReadBrickGrid.NAME);
  assert(rootReaders.length >= 1, 'Vehicle has owning-grid reference');
  for (const property of [colorProperty, materialProperty]) {
    const entity = v.one(v.incoming(property.brick, C.Exec_Entity_SetCustomProperty.NAME, 'Entity'),
      `${property.comp.data.Key} entity`);
    assert.equal(entity.at, C.ReadBrickGrid.NAME, `${property.comp.data.Key} writes vehicle root`);
  }
  const colorGet = v.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Color', 'Truck1Color getter');
  const materialGet = v.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material', 'Truck1Material getter');
  const updateEvent = v.row(C.Event_CustomGlobal.NAME,
    (data, brick) => data.EventName === 'UpdateCar' && brick.g === colorGet.brick.g,
    'vehicle UpdateCar event');
  assert(reachable(truck, updateEvent.brick, colorGet.brick),
    'Initial vehicle update loads saved color');
  assert(reachable(truck, updateEvent.brick, materialGet.brick),
    'Initial vehicle update loads saved material');
  assert(dataReachable(truck, colorGet.brick, colorProperty.brick), 'Color getter publishes score property');
  assert(dataReachable(truck, materialGet.brick, materialProperty.brick), 'Material getter publishes enum property');
  assert(v.incoming(colorProperty.brick, C.Exec_Entity_SetCustomProperty.NAME, 'Exec')
    .some(edge => edge.a === colorGet.brick.key && edge.p === 'ExecOut'),
  'Color property publishes after its leaderboard read completes');
  assert(v.incoming(materialProperty.brick, C.Exec_Entity_SetCustomProperty.NAME, 'Exec')
    .some(edge => edge.a === materialGet.brick.key && edge.p === 'ExecOut'),
  'Material property publishes after its leaderboard read completes');

  const restore = v.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color' && data.bIsObjectEvent, 'appearance restore event');
  assert(reachable(truck, restore.brick, colorGet.brick), 'Zone exit reloads saved color');
  assert(reachable(truck, restore.brick, materialGet.brick), 'Zone exit reloads saved material');

  const previewEvent = v.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle' && data.bIsObjectEvent,
    'vehicle appearance preview receiver');
  const materialVariable = v.row(C.Var.NAME,
    (data, brick) => data.Value?.$variant === 'dynamic_enum'
      && data.Value.value?.$enum === 'EBrickMaterial', 'vehicle material variable');
  const previewMaterialSetters = v.outgoing(materialVariable.brick, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => v.target(edge))
    .filter(setter => reachable(truck, previewEvent.brick, setter));
  assert.equal(previewMaterialSetters.length, 2, 'Preview chooses Plastic or Metal material setter');
  assert.deepEqual(previewMaterialSetters.map(setter =>
    valueOf(component(setter, C.Exec_Var_Set.NAME).data.Value)?.value).sort((a, b) => a - b),
  [0, 4], 'Preview material setter enum values');
  assert(previewMaterialSetters.every(setter => dataReachable(truck, previewEvent.brick, setter)),
    'Preview DataOut2 controls material choice');

  const materialChange = v.row(C.Expr_ChangeDetector.NAME,
    (_data, brick) => v.incoming(brick, C.Expr_ChangeDetector.NAME, 'Input')
      .some(edge => edge.a === materialVariable.brick.key), 'material change detector');
  const bodyLoop = v.row(C.Microchip_ForEachArray.NAME, () => true, 'body brick application loop');
  assert(reachable(truck, materialChange.brick, bodyLoop.brick),
    'A previewed material change reapplies all body bricks');
  const bodyMaterialSetter = v.row(C.Exec_SetBrickProperty.NAME,
    data => data.Property === 2, 'body material property setter');
  assert(dataReachable(truck, materialVariable.brick, bodyMaterialSetter.brick),
    'Selected Plastic/Metal value reaches the body material property setter');

  // Stored body-brick references survive the truck rewrite exactly.
  const sourceHandles = brickHandles(sourceTruck);
  const outputHandles = brickHandles(truck);
  assert.equal(outputHandles.length, sourceHandles.length, 'Stored body BrickHandle count');
  const validHandleTargets = new Set(truck.bricks.map(brick => brick.key));
  for (const handle of outputHandles) assert(validHandleTargets.has(handleKey(handle)),
    `Remapped BrickHandle target ${handleKey(handle)}`);

  console.log(JSON.stringify({
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    truckOutput,
    truckBricks: truck.bricks.length,
    truckWires: truck.edges.length,
    zoneEntrySync: ['CurrentColorScore', 'CurrentMaterialEnum'],
    freeRunningClocks: 0,
    materials: ['PLASTIC', 'METAL'],
    successResponse: 'SYSTEM RESPONSE: COLOR APPLIED -🔩100',
    vehicleRoot: vehicleRoot.persistentIndex,
    storedBrickHandles: outputHandles.length,
    checks: 'passed',
  }, null, 2));
  return { sourceTerminal, sourceTruck, terminal, truck };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_TERMINAL_INPUT,
  truckInput: process.argv[3] || DEFAULT_TRUCK_INPUT,
  terminalOutput: process.argv[4] || DEFAULT_TERMINAL_OUTPUT,
  truckOutput: process.argv[5] || DEFAULT_TRUCK_OUTPUT,
});

module.exports = test;

'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const bricksOf = (scene, type) => scene.bricks.filter(brick => component(brick, type));
const compOf = (scene, type) => bricksOf(scene, type)
  .map(brick => ({brick, comp: component(brick, type)}));
const incoming = (scene, target, type, port) => scene.edges.filter(candidate =>
  candidate.z === target.key && candidate.zt === type && candidate.q === port);
const outgoing = (scene, source, type, port) => scene.edges.filter(candidate =>
  candidate.a === source.key && candidate.at === type && candidate.p === port);
const one = (items, label) => {
  assert.equal(items.length, 1, label);
  return items[0];
};

function roles(scene) {
  const rootChip = one(scene.bricks.filter(brick => brick.g === 1
    && component(brick, C.Microchip.NAME)), 'one root microchip');
  const outer = one(scene.links.filter(link => link.key === rootChip.key), 'root chip link').grid;
  const children = scene.links.filter(link => {
    const brick = scene.bricks.find(candidate => candidate.key === link.key);
    return brick?.g === outer && component(brick, C.Microchip.NAME);
  });
  assert.equal(children.length, 2, 'player and profile child chips');
  children.sort((a, z) => scene.bricks.filter(brick => brick.g === z.grid).length
    - scene.bricks.filter(brick => brick.g === a.grid).length);
  const player = children[0].grid;
  const profiles = children[1].grid;
  const definition = one(scene.bricks.filter(brick => brick.g === player
    && component(brick, C.Microchip_FunctionDefinition.NAME)), 'DecodeNote definition');
  const decode = one(scene.links.filter(link => link.key === definition.key),
    'DecodeNote function link').grid;
  return {root: 1, outer, player, profiles, decode};
}

function assertPreservedGrid(source, output, sourceGrid, outputGrid, label,
  ignoreOutputFreeExpressions = false) {
  const semantics = (scene, grid) => {
    const outgoingKeys = new Set(scene.edges.map(edge => edge.a));
    return scene.bricks.filter(brick => brick.g === grid
      && !(ignoreOutputFreeExpressions && !outgoingKeys.has(brick.key)
        && brick.comps.some(item => item.type.startsWith('BrickComponentType_Expr_'))))
    .map(brick => JSON.stringify({data: brick.data, comps: brick.comps})).sort();
  };
  assert.deepEqual(semantics(output, outputGrid), semantics(source, sourceGrid),
    `${label} changed`);
}

function assertRootWiresPreserved(source, output, sourceRoles, outputRoles) {
  const normalize = (scene, sceneRoles) => {
    const roleFor = grid => Object.entries(sceneRoles)
      .find(([, value]) => value === grid)?.[0] ?? `grid:${grid}`;
    const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
    const id = key => {
      const brick = byKey.get(key);
      assert(brick, `wire brick ${key}`);
      return JSON.stringify([roleFor(brick.g), brick.data.position,
        brick.comps.map(item => item.type).filter(type => type !== C.Interact.NAME).sort()]);
    };
    return scene.edges.filter(edge => byKey.get(edge.a)?.g === 1 || byKey.get(edge.z)?.g === 1)
      .map(edge => JSON.stringify({a: id(edge.a), at: edge.at, p: edge.p,
        z: id(edge.z), zt: edge.zt, q: edge.q})).sort();
  };
  assert.deepEqual(normalize(output, outputRoles), normalize(source, sourceRoles),
    'root-connected UI wires changed');
}

function assertGraphIntegrity(scene) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of scene.edges) {
    const source = byKey.get(edge.a);
    const target = byKey.get(edge.z);
    assert(source && component(source, edge.at), `missing source ${edge.a}:${edge.at}`);
    assert(target && component(target, edge.zt), `missing target ${edge.z}:${edge.zt}`);
    const key = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(key), `duplicate target ${key}`);
    targets.add(key);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `invalid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `invalid input ${edge.zt}.${edge.q}`);
  }
  for (const link of scene.links) assert(byKey.has(link.key), `missing link brick ${link.key}`);
}

function controlPath(scene, label) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const button = one(compOf(scene, C.Button.NAME)
    .filter(({comp}) => comp.data.PromptCustomLabel === label), `button ${label}`).brick;
  const edge = one(outgoing(scene, button, C.Button.NAME, 'bHeld')
    .filter(wire => wire.zt === C.Expr_EdgeDetectorExec.NAME && wire.q === 'Input')
    .map(wire => byKey.get(wire.z)), `${label} edge`);
  const setter = one(outgoing(scene, edge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge')
    .filter(wire => wire.zt === C.Exec_Var_Set.NAME && wire.q === 'Exec')
    .map(wire => byKey.get(wire.z)), `${label} setter`);
  const clamp = one(incoming(scene, setter, C.Exec_Var_Set.NAME, 'Value')
    .filter(wire => wire.at === C.Expr_MathClamp.NAME && wire.p === 'Output')
    .map(wire => byKey.get(wire.a)), `${label} clamp`);
  const calculationWire = one(incoming(scene, clamp, C.Expr_MathClamp.NAME, 'Input'),
    `${label} calculation`);
  const calculation = byKey.get(calculationWire.a);
  const stateWire = one(incoming(scene, calculation, calculationWire.at, 'InputA'),
    `${label} state read`);
  const state = byKey.get(stateWire.a);
  const stateWrite = one(incoming(scene, setter, C.Exec_Var_Set.NAME, 'VarRef'),
    `${label} state write`);
  assert.equal(stateWrite.a, state.key, `${label} must read/write one state Var`);
  assert.equal(stateWrite.at, C.Var.NAME);
  return {clamp, calculation, state};
}

function assertControl(scene, label, operation, step, minimum, maximum) {
  const path = controlPath(scene, label);
  const calculation = component(path.calculation, operation.NAME);
  assert(calculation, `${label} operation ${operation.NAME}`);
  assert.equal(path.calculation.data.asset, operation.BRICK, `${label} gate asset`);
  assert(Math.abs(scalar(calculation.data.InputB) - step) < 1e-9, `${label} step`);
  const clamp = component(path.clamp, C.Expr_MathClamp.NAME).data;
  assert.equal(scalar(clamp.Min), minimum, `${label} minimum`);
  assert.equal(scalar(clamp.Max), maximum, `${label} maximum`);
  const retained = scalar(component(path.state, C.Var.NAME).data.Value);
  assert(retained >= minimum && retained <= maximum, `${label} retained value ${retained}`);
}

function assertOverride(scene, label, marker, minimum, maximum) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const input = one(compOf(scene, C.MicrochipInput.NAME)
    .filter(({brick, comp}) => comp.data.PortLabel === label
      && outgoing(scene, brick, C.MicrochipInput.NAME, 'RER_Output').length > 0),
  `live input ${label}`).brick;
  const clamp = one(outgoing(scene, input, C.MicrochipInput.NAME, 'RER_Output')
    .filter(wire => wire.zt === C.Expr_MathClamp.NAME && wire.q === 'Input')
    .map(wire => byKey.get(wire.z)), `${label} override clamp`);
  assert.equal(component(clamp, C.Interact.NAME)?.data.Message, marker, `${label} marker`);
  const data = component(clamp, C.Expr_MathClamp.NAME).data;
  assert.equal(scalar(data.Min), minimum, `${label} override minimum`);
  assert.equal(scalar(data.Max), maximum, `${label} override maximum`);
  assert.equal(outgoing(scene, clamp, C.Expr_MathClamp.NAME, 'Output')
    .filter(wire => wire.zt === C.Expr_Select.NAME && wire.q === 'InputB').length, 1,
  `${label} clamped override selector`);
  assert.equal(outgoing(scene, input, C.MicrochipInput.NAME, 'RER_Output')
    .filter(wire => wire.zt === C.Expr_CompareGreater.NAME && wire.q === 'InputA').length, 1,
  `${label} zero fallback`);
}

function assertTransportAndPlayback(scene) {
  const request = one(compOf(scene, C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Request'), 'request').brick;
  const ack = one(compOf(scene, C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Ack'), 'ack').brick;
  const offer = one(compOf(scene, C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Offer'), 'offer').brick;
  const requestTarget = one(incoming(scene, request, C.Exec_SendCustomEventGlobal.NAME, 'Target'),
    'request target');
  assert.equal(requestTarget.a,
    one(incoming(scene, ack, C.Exec_SendCustomEventGlobal.NAME, 'Target'), 'ack target').a,
  'request/ack cartridge target');
  assert.equal(bricksOf(scene, C.Exec_ArrayVar_CopyFrom.NAME).length, 2,
    'staging and active copies');
  assert(outgoing(scene, offer, C.Event_CustomGlobal.NAME, 'DataOut3')
    .some(wire => wire.zt === C.Exec_ArrayVar_CopyFrom.NAME && wire.q === 'SourceRef'),
  'remote score copy');
  const consume = one(bricksOf(scene, C.Exec_Entity_DestroySpawnedPrefab.NAME),
    'cartridge consumption');
  assert.equal(one(incoming(scene, consume, C.Exec_Entity_DestroySpawnedPrefab.NAME, 'Entity'),
    'consumed entity').a, requestTarget.a);

  assert.equal(bricksOf(scene, C.FunctionCall.NAME).length, 18, 'DecodeNote callers');
  const emitters = compOf(scene, C.AudioEmitter.NAME);
  assert.equal(emitters.length, 54, 'Sine emitters');
  const assets = scene.r.externalAssets();
  for (const {brick, comp} of emitters) {
    assert.deepEqual(assets[comp.data.AudioDescriptor],
      {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'});
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier']) {
      assert.equal(incoming(scene, brick, C.AudioEmitter.NAME, port).length, 1,
        `${brick.key}.${port}`);
    }
  }
}

function assertIdleClockPaused(scene) {
  const clock = one(bricksOf(scene, C.Stopwatch.NAME), 'playback Stopwatch');
  const playing = one(compOf(scene, C.MicrochipOutput.NAME)
    .filter(({brick, comp}) => comp.data.PortLabel === 'Playing'
      && incoming(scene, brick, C.MicrochipOutput.NAME, 'RER_Input').length === 1),
  'wired Playing output').brick;
  const playingSource = one(incoming(scene, playing, C.MicrochipOutput.NAME, 'RER_Input'),
    'Playing source');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const detector = one(scene.edges.filter(wire => wire.a === playingSource.a
    && wire.at === C.Var.NAME && wire.p === 'Value'
    && wire.zt === C.Expr_EdgeDetectorExec.NAME && wire.q === 'Input')
    .map(wire => byKey.get(wire.z))
    .filter(candidate => outgoing(scene, candidate, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge')
      .some(wire => wire.z === clock.key && wire.zt === C.Stopwatch.NAME && wire.q === 'Resume')
      && outgoing(scene, candidate, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge')
        .some(wire => wire.z === clock.key && wire.zt === C.Stopwatch.NAME && wire.q === 'Pause')),
  'Playing edge controls Stopwatch Resume/Pause');
  assert.equal(component(detector, C.Expr_EdgeDetectorExec.NAME).data.bSeeded, true,
    'Stopwatch control edge is seeded');
  assert.equal(component(clock, C.Stopwatch.NAME).data.bRunning, false,
    'Stopwatch is saved paused while idle');
}

function assertEmitterSetting(scene, marker, initial, port) {
  const variable = one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === marker
      && component(brick, C.Var.NAME)), marker);
  assert.equal(scalar(component(variable, C.Var.NAME).data.Value), initial, `${marker} initial`);
  const wires = outgoing(scene, variable, C.Var.NAME, 'Value')
    .filter(wire => wire.zt === C.AudioEmitter.NAME && wire.q === port);
  assert.equal(wires.length, 54, `${marker} fanout`);
  assert.equal(new Set(wires.map(wire => wire.z)).size, 54, `${marker} distinct emitters`);
}

function retainedOutput(scene, label) {
  const rootChip = one(scene.bricks.filter(brick => brick.g === 1
    && component(brick, C.Microchip.NAME)), 'root microchip for retained output');
  const outerGrid = one(scene.links.filter(link => link.key === rootChip.key),
    'root microchip link for retained output').grid;
  const output = one(compOf(scene, C.MicrochipOutput.NAME)
    .filter(({brick, comp}) => brick.g === outerGrid && comp.data.PortLabel === label
      && incoming(scene, brick, C.MicrochipOutput.NAME, 'RER_Input').length === 1),
  `wired ${label} output`).brick;
  const wire = one(incoming(scene, output, C.MicrochipOutput.NAME, 'RER_Input'),
    `${label} retained source`);
  const source = scene.bricks.find(brick => brick.key === wire.a);
  return component(source, wire.at)?.data;
}

function assertRetainedSongPreserved(source, output) {
  const arrays = scene => compOf(scene, C.ArrayVar.NAME).map(({comp}) => comp.data.Value)
    .sort((a, z) => (a.$array?.length ?? 0) - (z.$array?.length ?? 0));
  assert.deepEqual(arrays(output), arrays(source), 'staging/active retained score arrays changed');
  assert.deepEqual(retainedOutput(output, 'Loaded'), retainedOutput(source, 'Loaded'),
    'Loaded retained state changed');
  assert.deepEqual(retainedOutput(output, 'Song Title'), retainedOutput(source, 'Song Title'),
    'retained song title changed');
}

function test(sourceBytes, outputBytes) {
  const source = read(sourceBytes);
  const output = read(outputBytes);
  assert(validatePlacement(outputBytes).strictOk, 'strict placement');
  assertGraphIntegrity(output);
  const before = roles(source);
  const after = roles(output);
  assertPreservedGrid(source, output, before.root, after.root, 'user root UI');
  assertPreservedGrid(source, output, before.outer, after.outer, 'outer ports');
  assertPreservedGrid(source, output, before.profiles, after.profiles, 'instrument selector', true);
  assertPreservedGrid(source, output, before.decode, after.decode, 'DecodeNote function');
  assertRootWiresPreserved(source, output, before, after);
  assert.deepEqual(output.r.externalAssets(), source.r.externalAssets(), 'external assets');
  assert.deepEqual(output.r.prefabJson(), source.r.prefabJson(), 'prefab metadata');
  assertRetainedSongPreserved(source, output);

  assertControl(output, 'Volume down', C.Expr_MathSubtract, 0.1, 1, 2);
  assertControl(output, 'Volume Up', C.Expr_MathAdd, 0.1, 1, 2);
  assertControl(output, 'Pitch Down', C.Expr_MathSubtract, 0.1, 0.25, 2);
  assertControl(output, 'Pitch Up', C.Expr_MathAdd, 0.1, 0.25, 2);
  assertControl(output, 'Playback speed down', C.Expr_MathSubtract, 0.1, 0.1, 2);
  assertControl(output, 'Playback speed Up', C.Expr_MathAdd, 0.1, 0.1, 2);
  assertOverride(output, 'Volume (0=buttons)', 'SQM1CFG:Volume Clamp', 1, 2);
  assertOverride(output, 'Pitch (0=buttons)', 'SQM1CFG:Pitch Clamp', 0.25, 2);
  assertOverride(output, 'Speed (0=buttons)', 'SQM1CFG:Speed Clamp', 0.1, 2);

  assertTransportAndPlayback(output);
  assertIdleClockPaused(output);
  assertEmitterSetting(output, 'SQM1CFG:Inner Radius', 400, 'InnerRadius');
  assertEmitterSetting(output, 'SQM1CFG:Max Distance', 4000, 'MaxDistance');
  assertEmitterSetting(output, 'SQM1CFG:Directional', false, 'bSpatialization');
  assert(output.bricks.length <= source.bricks.length - 290,
    `expected diagnostic strip; ${source.bricks.length} -> ${output.bricks.length}`);
  assert.equal(output.bricks.filter(brick => component(brick, C.Interact.NAME)
    ?.data.Message?.startsWith('MWSP5:')).length, 0, 'hidden MWSP5 diagnostics stripped');
  console.log(`Optimized user player checks passed: UI preserved; requested controls and `
    + `speaker Vars verified; idle clock paused; ${source.bricks.length - output.bricks.length} `
    + `diagnostic bricks removed; transport and eighteen-voice Sine playback retained.`);
  return {source, output, before, after};
}

module.exports = test;
if (require.main === module) {
  const [sourceFile, outputFile] = process.argv.slice(2);
  assert(sourceFile && outputFile,
    'Usage: node test-sqm1-user-player-optimized-v1.cjs <source.brz> <optimized.brz>');
  test(fs.readFileSync(sourceFile), fs.readFileSync(outputFile));
}

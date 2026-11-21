'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {read, write} = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const refresh = require('./apply-sqm1-instrument-family-refresh-v1.cjs');

const SOURCE_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v10-3-dynamic-hammer.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'outputs',
  'sqm1-music-player-v11-balanced-instruments-saxophone.brz');
const STATE_COMPONENT_TYPES = new Set([
  'BrickComponentType_Var',
  'BrickComponentType_ArrayVar',
  'BrickComponentType_MapVar',
]);

function gridOrdinals(scene) {
  return new Map([...scene.r.gridIds()].map((id, index) => [id, index]));
}

function geometrySnapshot(scene) {
  const grids = gridOrdinals(scene);
  return scene.bricks.map(brick => JSON.stringify({
    grid: grids.get(brick.g),
    data: brick.data,
  })).sort();
}

function stateSnapshot(scene) {
  const grids = gridOrdinals(scene);
  return scene.bricks.flatMap(brick => brick.comps
    .filter(item => STATE_COMPONENT_TYPES.has(item.type))
    .map(item => JSON.stringify({
      grid: grids.get(brick.g),
      position: brick.data.position,
      asset: brick.data.asset,
      type: item.type,
      data: item.data,
    }))).sort();
}

function entitySnapshot(reader) {
  return [...reader.entities()].map(entity => Object.fromEntries([
    'typeName', 'className', 'location', 'rotation', 'frozen', 'sleeping',
    'linearVelocity', 'angularVelocity', 'colors', 'data',
  ].map(key => [key, structuredClone(entity[key])])));
}

function prefabOwner(reader) {
  const owners = reader.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  if (index < 0) return undefined;
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function build(options = {}) {
  const inputFile = path.resolve(options.inputFile ?? SOURCE_DEFAULT);
  assert(fs.existsSync(inputFile), `Input player exists: ${inputFile}`);
  const inputBytes = fs.readFileSync(inputFile);
  const scene = read(inputBytes);
  const inputGeometry = geometrySnapshot(scene);
  const inputState = stateSnapshot(scene);
  const inputEntities = entitySnapshot(scene.r);
  const inputPrefab = structuredClone(scene.r.prefabJson());
  const inputAssets = structuredClone(scene.r.externalAssets());
  const inputEmitters = scene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'Component_AudioEmitter')
    .map(item => structuredClone(item.data)));
  const inputText = scene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'Component_TextDisplay')
    .map(item => item.data.Text));
  const inputArrays = scene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'BrickComponentType_ArrayVar')
    .map(item => structuredClone(item.data.Value)));
  const patch = refresh.apply(scene);
  const owner = prefabOwner(scene.r);
  const name = 'SQM1 Music Player V11 - Balanced Instruments + Saxophone';
  const description = 'V10.3 Dynamic Hammer Piano preserved exactly. Bell, Organ, Strings, Bass, '
      + 'Flute and Synth receive rebalanced harmonic profiles, per-family headroom and a shared '
      + '0.65-RMS non-Piano limiter. Saxophone is manual mode 8 and the Auto profile for General '
      + 'MIDI reed programs 64 through 71. Existing cartridge, controls, geometry and retained '
      + 'song data are preserved.';
  const generated = write(scene, {name, description, owner});
  const bytes = repack(generated.bytes, inputBytes, {name, description});
  const outputScene = read(bytes);
  const outputArrays = outputScene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'BrickComponentType_ArrayVar')
    .map(item => structuredClone(item.data.Value)));
  assert.deepEqual(outputArrays, inputArrays, 'retained cartridge arrays survive build');
  const outputAssets = structuredClone(outputScene.r.externalAssets());
  const outputEmitters = outputScene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'Component_AudioEmitter')
    .map(item => structuredClone(item.data)));
  const outputText = outputScene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === 'Component_TextDisplay')
    .map(item => item.data.Text));
  const outputGeometry = geometrySnapshot(outputScene);
  const outputState = stateSnapshot(outputScene);
  const outputEntities = entitySnapshot(outputScene.r);
  const outputPrefab = structuredClone(outputScene.r.prefabJson());
  assert.deepEqual(outputAssets, inputAssets, 'audio/UI assets survive build');
  assert.deepEqual(outputEmitters, inputEmitters, 'all physical emitter settings survive build');
  assert.deepEqual(outputText, inputText, 'visible UI and retained song title survive build');
  return {inputFile, inputBytes, scene, patch, bytes, outputScene, owner, name, description,
    inputArrays, outputArrays, inputAssets, outputAssets, inputEmitters, outputEmitters,
    inputText, outputText, inputGeometry, outputGeometry, inputState, outputState,
    inputEntities, outputEntities, inputPrefab, outputPrefab};
}

build.constants = {SOURCE_DEFAULT, OUTPUT_DEFAULT, ...refresh.constants};
module.exports = build;

if (require.main === module) {
  const [inputFile = SOURCE_DEFAULT, outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build({inputFile});
    const test = require('./test-sqm1-instrument-family-player-v11.cjs');
    test(context);
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), {recursive: true});
    fs.writeFileSync(path.resolve(outputFile), context.bytes);
    console.log(JSON.stringify({
      inputFile: context.inputFile,
      outputFile: path.resolve(outputFile),
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      addedBricks: context.patch.addedBricks,
      voices: context.patch.constants.VOICES,
      modes: ['Auto', ...Object.values(context.patch.constants.PROFILES).map(item => item.name)],
      rmsCeiling: context.patch.constants.RMS_CEILING,
      saxMode: context.patch.constants.SAX_MODE,
      retainedArrays: context.outputArrays.length,
      validation: 'structural checks passed',
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/')
        && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

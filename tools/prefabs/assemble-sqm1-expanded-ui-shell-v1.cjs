'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const buildAutoZone = require('./build-sqm1-auto-zone-frame-integration-v2.cjs');
const {C} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const SHELL_DEFAULT = path.join(__dirname, 'sources', 'sqm1-working-as-intended-ui.brz');
const FRAME_DEFAULT = path.join(__dirname, 'sources', 'music-player-frame-and-cartridge.brz');
const DEFAULT_MAX_VOICES = 24;

const clone = value => structuredClone(value);
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function roles(scene) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rootLink = one(scene.links.filter(link => {
    const brick = byKey.get(link.key);
    return brick?.g === 1 && component(brick, C.Microchip.NAME);
  }), 'one root shell microchip link');
  const childLinks = scene.links.filter(link => {
    const brick = byKey.get(link.key);
    return brick?.g === rootLink.grid && component(brick, C.Microchip.NAME);
  });
  assert.equal(childLinks.length, 2, 'player and profile child chips');
  const mainLink = one(childLinks.filter(link => scene.bricks.some(brick =>
    brick.g === link.grid && component(brick, C.Microchip_FunctionDefinition.NAME))),
  'main player child link');
  const profileLink = one(childLinks.filter(link => link !== mainLink),
    'profile child link');
  const functionDefinition = one(scene.bricks.filter(brick => brick.g === mainLink.grid
    && component(brick, C.Microchip_FunctionDefinition.NAME)), 'DecodeNote function definition');
  const functionLink = one(scene.links.filter(link => link.key === functionDefinition.key),
    'DecodeNote function link');
  return {
    root: 1,
    outer: rootLink.grid,
    main: mainLink.grid,
    profile: profileLink.grid,
    function: functionLink.grid,
    rootLink,
    mainLink,
    profileLink,
    functionDefinition,
    functionLink,
    byKey,
  };
}

function entityClone(entity, persistentIndex = entity.persistentIndex) {
  return {...entity, persistentIndex, data: clone(entity.data), location: clone(entity.location),
    rotation: clone(entity.rotation), colors: clone(entity.colors)};
}

function semanticBoundaryId(scene, sceneRoles, brick) {
  if (brick.g === sceneRoles.root) {
    const button = component(brick, C.Button.NAME);
    if (button) return `root:button:${button.data.PromptCustomLabel}`;
    if (component(brick, C.AttachedZone.NAME)) return 'root:attached-zone';
    if (component(brick, C.TextDisplay.NAME)) {
      const driver = scene.edges.find(edge => edge.z === brick.key
        && edge.zt === C.TextDisplay.NAME && edge.q === 'Text');
      if (driver?.at === C.Var.NAME) return 'root:display:title';
      if (driver?.at === C.Expr_String_FormatText.NAME) return 'root:display:status';
    }
  }
  if (brick.g === sceneRoles.outer) {
    for (const type of [C.MicrochipInput.NAME, C.MicrochipOutput.NAME]) {
      const port = component(brick, type);
      if (port) return `outer:${type}:${port.data.PortLabel}`;
    }
    if (component(brick, C.Microchip.NAME)) {
      const link = scene.links.find(candidate => candidate.key === brick.key);
      if (link?.grid === sceneRoles.main) return 'outer:chip:main';
      if (link?.grid === sceneRoles.profile) return 'outer:chip:profile';
    }
  }
  if (brick.g === sceneRoles.profile) {
    const primary = brick.comps.find(item => item.type !== C.Interact.NAME);
    return `profile:${primary?.type ?? 'brick'}:${JSON.stringify(brick.data.position)}`;
  }
  return null;
}

function rootUiSignature(scene) {
  return scene.bricks.filter(brick => brick.g === 1)
    .map(brick => JSON.stringify({data: brick.data, comps: brick.comps})).sort();
}

function assemble(options = {}) {
  const maxVoices = options.maxVoices ?? DEFAULT_MAX_VOICES;
  const shellFile = options.shellFile ?? SHELL_DEFAULT;
  const frameFile = options.frameFile ?? FRAME_DEFAULT;
  assert(Number.isInteger(maxVoices) && maxVoices >= 1 && maxVoices <= 32,
    'Expanded shell voice count must be 1..32');
  assert(fs.existsSync(shellFile), `Preserved UI shell not found: ${shellFile}`);
  assert(fs.existsSync(frameFile), `Frame source not found: ${frameFile}`);

  const shell = read(fs.readFileSync(shellFile));
  const generatedContext = buildAutoZone(frameFile, {maxVoices});
  const generated = generatedContext.playerScene;
  const shellRoles = roles(shell);
  const generatedRoles = roles(generated);
  assert.equal(generatedContext.constants.MAX_VOICES, maxVoices,
    'Auto-zone builder honored expanded voice count');

  const shellSemantic = new Map();
  for (const brick of shell.bricks) {
    const id = semanticBoundaryId(shell, shellRoles, brick);
    if (!id) continue;
    assert(!shellSemantic.has(id), `unique preserved shell semantic ${id}`);
    shellSemantic.set(id, brick.key);
  }

  const transplantedGeneratedGrids = new Set([generatedRoles.main, generatedRoles.function]);
  const replacedShellGrids = new Set([shellRoles.main, shellRoles.function]);
  const keyMap = new Map();
  for (const brick of generated.bricks.filter(candidate =>
    transplantedGeneratedGrids.has(candidate.g))) {
    keyMap.set(brick.key, `sqm1v8:${brick.key}`);
  }
  const mapBoundaryKey = key => {
    const brick = generatedRoles.byKey.get(key);
    assert(brick, `generated boundary brick ${key}`);
    const id = semanticBoundaryId(generated, generatedRoles, brick);
    assert(id, `semantic boundary mapping for ${key}`);
    const mapped = shellSemantic.get(id);
    assert(mapped, `preserved shell boundary ${id}`);
    return mapped;
  };
  const mapKey = key => keyMap.get(key) ?? mapBoundaryKey(key);

  const shellAssets = clone(shell.r.externalAssets());
  const generatedAssets = generated.r.externalAssets();
  const sineAsset = {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'};
  const shellSineIndex = shellAssets.findIndex(asset =>
    JSON.stringify(asset) === JSON.stringify(sineAsset));
  assert(shellSineIndex >= 0, 'preserved shell contains the Sine descriptor');

  const transplantedBricks = generated.bricks
    .filter(brick => transplantedGeneratedGrids.has(brick.g))
    .map(brick => {
      const copy = clone(brick);
      copy.key = keyMap.get(brick.key);
      copy.g = brick.g === generatedRoles.main ? shellRoles.main : shellRoles.function;
      for (const item of copy.comps) if (item.type === C.AudioEmitter.NAME) {
        const asset = generatedAssets[item.data.AudioDescriptor];
        assert.deepEqual(asset, sineAsset, 'transplanted emitter uses Sine');
        item.data.AudioDescriptor = shellSineIndex;
      }
      return copy;
    });
  const retainedBricks = shell.bricks.filter(brick => !replacedShellGrids.has(brick.g));

  const retainedEdges = shell.edges.filter(edge => {
    const source = shellRoles.byKey.get(edge.a);
    const target = shellRoles.byKey.get(edge.z);
    return source && target && !replacedShellGrids.has(source.g)
      && !replacedShellGrids.has(target.g);
  }).map(clone);
  const transplantedEdges = generated.edges.filter(edge => {
    const source = generatedRoles.byKey.get(edge.a);
    const target = generatedRoles.byKey.get(edge.z);
    return source && target && (transplantedGeneratedGrids.has(source.g)
      || transplantedGeneratedGrids.has(target.g));
  }).map(edge => ({...clone(edge), a: mapKey(edge.a), z: mapKey(edge.z)}));

  const retainedLinks = shell.links.filter(link => {
    const brick = shellRoles.byKey.get(link.key);
    return !(brick?.g === shellRoles.main && link.grid === shellRoles.function);
  }).map(clone);
  const transplantedFunctionLink = {
    key: keyMap.get(generatedRoles.functionDefinition.key),
    grid: shellRoles.function,
  };

  const outputScene = {
    ...shell,
    bricks: [...retainedBricks, ...transplantedBricks],
    edges: [...retainedEdges, ...transplantedEdges],
    links: [...retainedLinks, transplantedFunctionLink],
    entityOverrides: new Map(),
  };
  const shellEntities = new Map([...shell.r.entities()].map(entity =>
    [entity.persistentIndex, entity]));
  const generatedEntities = new Map([...generated.r.entities()].map(entity =>
    [entity.persistentIndex, entity]));
  for (const [shellGrid, generatedGrid] of [
    [shellRoles.main, generatedRoles.main],
    [shellRoles.function, generatedRoles.function],
  ]) {
    const shellEntity = shellEntities.get(shellGrid);
    const generatedEntity = generatedEntities.get(generatedGrid);
    assert(shellEntity && generatedEntity, `grid entities ${shellGrid}/${generatedGrid}`);
    outputScene.entityOverrides.set(shellGrid, {
      ...entityClone(shellEntity),
      data: clone(generatedEntity.data),
    });
  }

  const targets = new Set();
  const outputKeys = new Set(outputScene.bricks.map(brick => brick.key));
  for (const edge of outputScene.edges) {
    assert(outputKeys.has(edge.a) && outputKeys.has(edge.z), 'transplanted wire endpoints exist');
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `duplicate transplanted target ${target}`);
    targets.add(target);
  }

  const output = write(outputScene, {
    assets: shellAssets,
    prefab: clone(shell.r.prefabJson()),
    name: `SQM1 Preserved UI Expanded ${maxVoices}-Lane Base`,
    description: `Exact preserved Working as intended UI shell with a freshly generated `
      + `${maxVoices}-lane SQM1 format-1 player and shared DecodeNote function.`,
  });
  const scene = read(output.bytes);
  assert.deepEqual(rootUiSignature(scene), rootUiSignature(shell),
    'visible root UI remains byte-structurally exact');
  const outputRoles = roles(scene);
  assert.equal(scene.bricks.filter(brick => brick.g === outputRoles.main
    && component(brick, C.AudioEmitter.NAME)).length, maxVoices * 3,
  'expanded base has three physical emitters per lane');

  return {
    bytes: output.bytes,
    scene,
    shell,
    generated,
    generatedContext,
    outputScene,
    shellRoles,
    generatedRoles,
    outputRoles,
    keyMap,
    constants: {SHELL_DEFAULT, FRAME_DEFAULT, DEFAULT_MAX_VOICES, MAX_VOICES: maxVoices},
  };
}

assemble.constants = {SHELL_DEFAULT, FRAME_DEFAULT, DEFAULT_MAX_VOICES};
module.exports = assemble;

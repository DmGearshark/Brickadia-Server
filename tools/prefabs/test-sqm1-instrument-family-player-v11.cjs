'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const number = value => value?.$variant === 'f64' ? value.value : value;

function assertMultisetContains(actual, expected, label) {
  const counts = new Map();
  for (const value of actual) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of expected) {
    const count = counts.get(value) ?? 0;
    assert(count > 0, `${label}: missing ${value}`);
    counts.set(value, count - 1);
  }
}

function test(context) {
  const {scene, outputScene, patch, inputArrays, outputArrays,
    inputAssets, outputAssets, inputEmitters, outputEmitters, inputText, outputText,
    owner, name, description, inputGeometry, outputGeometry, inputState, outputState,
    inputEntities, outputEntities, inputPrefab, outputPrefab} = context;
  const {PROFILES, SAX_MODE, RMS_CEILING, RMS_NUMERATOR} = patch.constants;
  assert.equal(SAX_MODE, 8);
  assert.deepEqual(Object.values(PROFILES).map(item => item.name),
    ['Piano', 'Bell', 'Organ', 'Strings', 'Bass', 'Flute', 'Synth', 'Saxophone']);
  assert.equal(PROFILES[1].headroom, 0,
    'unused legacy branch is silent while the independent Piano path is selected');
  assert.equal(patch.groups.length, 24);
  assert.equal(patch.baseVolumes.length, 72);
  assert.equal(patch.detectorVolumes.length, 72);
  assert.equal(patch.limitedVolumes.length, 72);
  assert.equal(patch.magnitudeGroups.length, 24);
  assert.equal(patch.energyAdders.length, 23);
  assert.equal(patch.retuned.length, 24 * 6 * 5);
  assert.deepEqual(outputArrays, inputArrays, 'score arrays retained exactly');
  assert.deepEqual(outputAssets, inputAssets, 'external assets retained exactly');
  assert.deepEqual(outputEmitters, inputEmitters, 'emitter descriptors and runtime values retained');
  assert.deepEqual(outputText, inputText, 'visible UI and song title retained');
  assertMultisetContains(outputGeometry, inputGeometry,
    'all pre-existing brick geometry, material and color retained');
  assert.equal(outputGeometry.length, inputGeometry.length + patch.addedBricks,
    'only the declared instrument-family gates add geometry');
  assert.deepEqual(outputState, inputState,
    'ordinary Var, ArrayVar and MapVar saved state retained');
  assert.deepEqual(outputEntities, inputEntities, 'all entity runtime/configuration state retained');
  assert.deepEqual(outputPrefab, inputPrefab, 'prefab placement and physics metadata retained');

  const outputOwners = outputScene.r.owners();
  if (owner) {
    const outputOwnerIndex = outputOwners.UserNames.indexOf(owner.name);
    assert(outputOwnerIndex >= 0, 'source player owner retained');
    assert.equal(outputOwners.DisplayNames[outputOwnerIndex], owner.display_name,
      'source owner display name retained');
    assert.equal(brdb.guidToUuid(outputOwners.UserIds[outputOwnerIndex]), owner.id,
      'source owner UUID retained');
    assert.equal(outputOwners.BrickCounts[outputOwnerIndex], outputScene.bricks.length,
      'all output bricks remain owned by the source owner');
  } else {
    assert(!outputOwners.UserNames.some(name => name !== 'PUBLIC'),
      'PUBLIC-only source remains PUBLIC-only');
  }
  const inputBundle = JSON.parse(Buffer.from(scene.r.fs.readFile('Meta/Bundle.json')));
  const outputBundle = JSON.parse(Buffer.from(outputScene.r.fs.readFile('Meta/Bundle.json')));
  assert.deepEqual(outputBundle.authors, inputBundle.authors, 'bundle authors retained');
  assert.equal(outputBundle.createdAt, inputBundle.createdAt, 'bundle creation timestamp retained');
  assert.equal(outputBundle.updatedAt, inputBundle.updatedAt, 'bundle update timestamp retained');
  assert.equal(outputBundle.gameVersion, inputBundle.gameVersion, 'bundle game version retained');
  assert.equal(outputBundle.name, name, 'V11 bundle name applied');
  assert.equal(outputBundle.description, description, 'V11 bundle description applied');
  const thumbnailPath = 'Meta/Thumbnail.png';
  assert.equal(outputScene.r.fs.listPaths().includes(thumbnailPath),
    scene.r.fs.listPaths().includes(thumbnailPath), 'thumbnail presence retained');
  if (scene.r.fs.listPaths().includes(thumbnailPath)) {
    assert.deepEqual(Buffer.from(outputScene.r.fs.readFile(thumbnailPath)),
      Buffer.from(scene.r.fs.readFile(thumbnailPath)), 'thumbnail bytes retained exactly');
  }

  const mode8 = component(patch.modeCheck8, C.Expr_CompareEqual.NAME);
  assert.equal(number(mode8.data.InputB), 8, 'mode 8 equality');
  assert.equal(component(patch.saxName, C.Expr_Select.NAME).data.InputB.value,
    'Saxophone', 'Saxophone status label');
  assert.equal(number(component(patch.previousWrap, C.Expr_Select.NAME).data.InputB), 8,
    'previous selector wraps from Auto to Saxophone');
  assert.equal(number(component(patch.nextLimit, C.Expr_CompareGreater.NAME).data.InputB), 8,
    'next selector wraps after Saxophone');
  assert.deepEqual(component(patch.recovery, C.Dampen.NAME).data.Velocity,
    {X: 0, Y: 0, Z: 0, W: 0}, 'new limiter starts without inherited runtime velocity');

  for (const item of patch.retuned) {
    assert.equal(item.newValue, PROFILES[item.mode][item.parameter],
      `voice ${item.voice} ${PROFILES[item.mode].name} ${item.parameter}`);
  }

  for (const group of patch.groups) {
    assert.equal(group.headroomStages.length, 7,
      `voice ${group.voice} complete headroom profile`);
    assert.equal(number(component(group.headroomStages[0], C.Expr_Select.NAME).data.InputB), 0,
      `voice ${group.voice} Piano contributes no phantom legacy energy`);
    const fallback = component(group.headroomStages[0], C.Expr_Select.NAME).data.InputA;
    assert.equal(number(fallback), PROFILES[8].headroom,
      `voice ${group.voice} Saxophone headroom fallback`);
    assert.equal(number(component(group.autoReed.atLeast64,
      C.Expr_CompareGreaterOrEqual.NAME).data.InputB), 64);
    assert.equal(number(component(group.autoReed.below72,
      C.Expr_CompareLess.NAME).data.InputB), 72);
    assert.equal(number(component(group.autoReed.autoSax,
      C.Expr_Select.NAME).data.InputB), 8);
    assert.equal(group.baseVolumes.length, 3);
    assert.equal(group.detectorVolumes.length, 3);
    assert.equal(group.limitedVolumes.length, 3);
    for (const [parameter, brick] of group.saxFallbacks) {
      assert.equal(number(component(brick, C.Expr_Select.NAME).data.InputA),
        PROFILES[8][parameter], `voice ${group.voice} Saxophone ${parameter}`);
    }
  }

  // The profile tables keep solo peaks close to the accepted Piano reference.
  // The adaptive formula guarantees dense RMS cannot exceed 0.65.
  for (let mode = 2; mode <= 8; mode++) {
    const profile = PROFILES[mode];
    const alignedPeakAtVolume2 = 2 * profile.headroom
      * (1 + profile.h2Gain + profile.h3Gain);
    assert(alignedPeakAtVolume2 >= 0.65 && alignedPeakAtVolume2 <= 0.90,
      `${profile.name} solo aligned peak ${alignedPeakAtVolume2}`);
    for (const energy of [0, 0.1, 0.5, 1, 4, 16, 64]) {
      const root = Math.sqrt(energy);
      const scale = RMS_NUMERATOR / Math.max(RMS_NUMERATOR, root);
      const resultingRms = root * scale / Math.sqrt(2);
      assert(resultingRms <= RMS_CEILING + 1e-12,
        `${profile.name} limiter bound at energy ${energy}`);
    }
  }

  // No sound assets or emitter count changed; Piano inputs and emitter enable
  // routes were not touched by the patch.
  const inputEmitterBricks = scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME));
  const outputEmitterBricks = outputScene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME));
  assert.equal(inputEmitterBricks.length, 72);
  assert.equal(outputEmitterBricks.length, 72);
  assert.equal(patch.originalPianoEdges.length, 48,
    '24 Piano bodies and 24 Piano H2 strikes remain wired');
  assert.equal(patch.originalPianoInputs.length, 72,
    'all Piano-side inputs recorded, including 24 constant-zero H3 inputs');
  const outputVolumeEdges = outputScene.edges.filter(edge => edge.zt === C.AudioEmitter.NAME
    && edge.q === 'VolumeMultiplier');
  const outputEnableEdges = outputScene.edges.filter(edge => edge.zt === C.AudioEmitter.NAME
    && edge.q === 'bEnabled');
  assert.equal(outputVolumeEdges.length, 72);
  assert.equal(outputEnableEdges.length, 72);
  assert.equal(patch.constants.MAX_ACTIVE_SOURCES_DENSE, 48);
  assert.equal(patch.constants.MAX_ACTIVE_SOURCES_SPARSE, 54);

  // Every serialized component and wire port must remain known to Brickadia.
  for (const brick of outputScene.bricks) for (const item of brick.comps) {
    assert(brdb.COMPONENT_TYPE_STRUCTS.has(item.type), `known component ${item.type}`);
  }
  const targets = new Set();
  for (const edge of outputScene.edges) {
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `known output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `known input ${edge.zt}.${edge.q}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `one driver for ${target}`);
    targets.add(target);
  }

  // Writing the same patched scene twice is byte deterministic.
  const metadata = {
    name: 'SQM1 Music Player V11 - Balanced Instruments + Saxophone',
    description: 'Deterministic V11 instrument-family validation build.',
  };
  const first = write(scene, metadata).bytes;
  const second = write(scene, metadata).bytes;
  assert.deepEqual(second, first, 'deterministic V11 serialization');
  return true;
}

module.exports = test;

if (require.main === module) {
  const build = require('./build-sqm1-instrument-family-player-v11.cjs');
  const inputFile = process.argv[2] ?? build.constants.SOURCE_DEFAULT;
  const context = build({inputFile});
  test(context);
  console.log('SQM1 V11 instrument-family checks passed: nine-mode selector, Saxophone Auto '
    + 'mapping, six rebalanced legacy profiles, per-family headroom, 72-layer adaptive limiter, '
    + 'retained score arrays, unchanged emitter count and deterministic serialization.');
}

'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const { read, write } = require('./reskin-loadboard.cjs');
const { C, N } = require('./loadboard-lib.cjs');

const SCALE = 10;

function one(values, description) {
  assert.equal(values.length, 1, `Expected one ${description}, found ${values.length}`);
  return values[0];
}

function build(input) {
  const source = fs.readFileSync(input);
  const original = read(source);
  const scene = read(source);
  const components = scene.bricks.flatMap(brick => brick.comps);

  // Same linear player-relative adjustments proven by the 2x and 3x builds.
  const follow = one(components.filter(comp => comp.type === C.Expr_VecScale.NAME), 'follow VecScale');
  assert.equal(follow.data.Scalar, -5, 'Expected the unscaled follow offset');
  follow.data.Scalar = -5 * SCALE;

  const crouchProbeOrigin = one(components.filter(comp => comp.type === C.Expr_MathAdd.NAME
    && comp.data.InputB?.$variant === 'Vector'
    && comp.data.InputB.value?.X === 0
    && comp.data.InputB.value?.Y === 0
    && comp.data.InputB.value?.Z === 20), 'crouch height offset');
  // At 10x, casting from X=0 begins deep inside the player capsule and does
  // not reliably report an entry hit. Use the proven outside-in probe layout:
  // start 30 scaled units to one side and cross 60 scaled units through it.
  crouchProbeOrigin.data.InputB.value.X = -30 * SCALE;
  crouchProbeOrigin.data.InputB.value.Z = 20 * SCALE;

  const sweep = one(components.filter(comp => comp.type === C.Exec_Sweep.NAME), 'player sweep');
  assert.equal(sweep.data.Distance, 150, 'Expected the unscaled sweep distance');
  assert.deepEqual(sweep.data.Direction, { X: 1, Y: 0, Z: 0 }, 'Expected +X player sweep');
  sweep.data.Distance = 60 * SCALE;
  sweep.data.Radius *= SCALE;

  // A ten-times-larger rigid assembly has 10^3 the mass. The prior 2x and 3x
  // versions therefore use cubic power/damping scaling (8x and 27x).
  const servo = one(components.filter(comp => comp.type === C.Servo.NAME), 'tail servo');
  assert.equal(servo.data.Power, 10000, 'Expected the unscaled servo power');
  assert.equal(servo.data.ActiveDamping, 1000, 'Expected the unscaled servo damping');
  servo.data.Power *= SCALE ** 3;
  servo.data.ActiveDamping *= SCALE ** 3;

  // The original crouch test asks whether a horizontal sweep at a fixed
  // height hit the character. At scale 10 the scaled sample height sits near
  // the capsule top, making both poses report the same result. Detect pose
  // from eye height instead: AimOrigin.Z - CharacterLocation.Z is about 17
  // units standing at scale 1 and substantially lower while crouched.
  const logicGrid = scene.bricks.find(brick => brick.comps.some(comp => comp.type === C.Exec_Sweep.NAME)).g;
  const aim = one(scene.bricks.filter(brick => brick.g === logicGrid
    && brick.comps.some(comp => comp.type === C.Exec_Character_GetAim.NAME)), 'character aim gate');
  const transform = one(scene.bricks.filter(brick => brick.g === logicGrid
    && brick.comps.some(comp => comp.type === C.Exec_Entity_GetLocationRotation.NAME)), 'character transform gate');
  const poseAnd = one(scene.bricks.filter(brick => brick.g === logicGrid
    && brick.comps.some(comp => comp.type === C.Expr_LogicalAND.NAME)
    && scene.edges.filter(edge => edge.a === brick.key && edge.p === 'bOutput'
      && edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB').length === 2), 'old pose AND');
  const poseSelectEdges = scene.edges.filter(edge => edge.a === poseAnd.key && edge.p === 'bOutput'
    && edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB');
  assert.equal(poseSelectEdges.length, 2);

  const template = scene.bricks.find(brick => brick.g === logicGrid
    && brick.data.asset.includes('_Gate_'));
  assert(template, 'Logic gate template');
  let gateIndex = 0;
  function gate(kind, data, position) {
    const definition = C[kind];
    assert(definition, kind);
    const brick = {
      key: `scale10-crouch:${gateIndex++}:${kind}`,
      g: logicGrid,
      data: { ...structuredClone(template.data), asset: definition.BRICK, position },
      comps: [{ type: definition.NAME, data }],
    };
    scene.bricks.push(brick);
    return brick;
  }
  const aimSplit = gate('Expr_SplitVector', { Input: { X: 0, Y: 0, Z: 0 } }, [-30, 35, 2]);
  const locationSplit = gate('Expr_SplitVector', { Input: { X: 0, Y: 0, Z: 0 } }, [-10, 35, 2]);
  const eyeHeight = gate('Expr_MathSubtract', { InputA: N(0), InputB: N(0) }, [10, 35, 2]);
  const standing = gate('Expr_CompareGreater', { InputA: N(0), InputB: N(14 * SCALE) }, [30, 35, 2]);
  scene.edges.push(
    { a: aim.key, at: C.Exec_Character_GetAim.NAME, p: 'Origin', z: aimSplit.key, zt: C.Expr_SplitVector.NAME, q: 'Input' },
    { a: transform.key, at: C.Exec_Entity_GetLocationRotation.NAME, p: 'Vector', z: locationSplit.key, zt: C.Expr_SplitVector.NAME, q: 'Input' },
    { a: aimSplit.key, at: C.Expr_SplitVector.NAME, p: 'Z', z: eyeHeight.key, zt: C.Expr_MathSubtract.NAME, q: 'InputA' },
    { a: locationSplit.key, at: C.Expr_SplitVector.NAME, p: 'Z', z: eyeHeight.key, zt: C.Expr_MathSubtract.NAME, q: 'InputB' },
    { a: eyeHeight.key, at: C.Expr_MathSubtract.NAME, p: 'Output', z: standing.key, zt: C.Expr_CompareGreater.NAME, q: 'InputA' },
  );
  scene.edges = scene.edges.filter(edge => !poseSelectEdges.includes(edge));
  for (const old of poseSelectEdges) scene.edges.push({
    a: standing.key, at: C.Expr_CompareGreater.NAME, p: 'bOutput',
    z: old.z, zt: old.zt, q: old.q,
  });

  // This upload already contains both readers. Confirm the physical helper is
  // still connected rather than duplicating or rebuilding it.
  const readers = scene.bricks.filter(brick => brick.comps.some(comp => comp.type === C.ReadBrickGrid.NAME));
  assert.equal(readers.length, 2, 'Expected logic reader and physical pose helper reader');
  const logicGrids = new Set(scene.links.map(link => link.grid));
  const physicalReader = one(readers.filter(brick => !logicGrids.has(brick.g)), 'physical helper reader');
  assert(scene.edges.some(edge => edge.a === physicalReader.key
    && edge.at === C.ReadBrickGrid.NAME
    && edge.p === 'BrickGrid'
    && edge.zt === C.Rerouter.NAME
    && edge.q === 'RER_Input'), 'Physical helper reader must remain wired');

  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const output = write(scene, {
    assets: scene.r.externalAssets(),
    embedded,
    name: 'Shark Tail - Player Scale 10',
    description: 'User-supplied 10x geometry preserved. Follow offset, crouch height, player sweep, and cubic servo power/damping are retuned for player scale 10.',
  });
  return { bytes: output.bytes, original, scene, values: {
    follow: follow.data.Scalar,
    crouchProbeX: crouchProbeOrigin.data.InputB.value.X,
    crouchHeight: crouchProbeOrigin.data.InputB.value.Z,
    sweepDistance: sweep.data.Distance,
    sweepRadius: sweep.data.Radius,
    servoPower: servo.data.Power,
    servoDamping: servo.data.ActiveDamping,
    crouchEyeHeightThreshold: 14 * SCALE,
    crouchDetection: 'eye-height',
  } };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node retune-shark-tail-10x.cjs input.brz output.brz');
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({ output, bytes: result.bytes.length, ...result.values }, null, 2));
}

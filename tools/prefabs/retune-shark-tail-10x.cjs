'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const { read, write } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

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

  const crouchHeight = one(components.filter(comp => comp.type === C.Expr_MathAdd.NAME
    && comp.data.InputB?.$variant === 'Vector'
    && comp.data.InputB.value?.X === 0
    && comp.data.InputB.value?.Y === 0
    && comp.data.InputB.value?.Z === 20), 'crouch height offset');
  crouchHeight.data.InputB.value.Z = 20 * SCALE;

  const sweep = one(components.filter(comp => comp.type === C.Exec_Sweep.NAME), 'player sweep');
  assert.equal(sweep.data.Distance, 150, 'Expected the unscaled sweep distance');
  sweep.data.Distance = 150 * SCALE;
  sweep.data.Radius *= SCALE;

  // A ten-times-larger rigid assembly has 10^3 the mass. The prior 2x and 3x
  // versions therefore use cubic power/damping scaling (8x and 27x).
  const servo = one(components.filter(comp => comp.type === C.Servo.NAME), 'tail servo');
  assert.equal(servo.data.Power, 10000, 'Expected the unscaled servo power');
  assert.equal(servo.data.ActiveDamping, 1000, 'Expected the unscaled servo damping');
  servo.data.Power *= SCALE ** 3;
  servo.data.ActiveDamping *= SCALE ** 3;

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
    crouchHeight: crouchHeight.data.InputB.value.Z,
    sweepDistance: sweep.data.Distance,
    sweepRadius: sweep.data.Radius,
    servoPower: servo.data.Power,
    servoDamping: servo.data.ActiveDamping,
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

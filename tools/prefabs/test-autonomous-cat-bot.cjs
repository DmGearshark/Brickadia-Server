'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const build = require('./build-autonomous-cat-bot.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {assertNoInstantCycles} = require('./loadboard-queue-repair.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
if (!input) throw new Error('Usage: node test-autonomous-cat-bot.cjs input.brz');

const result = build(input);
const {original, scene} = result;
const component = (brick, type) => brick.comps.find(comp => comp.type === type);
const all = type => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type).map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};
const edge = (targetType, targetPort) => scene.edges.filter(e => e.zt === targetType && e.q === targetPort);

assert.equal(result.created.length, 57, 'Compact brain gate count');
assert.equal(scene.bricks.length, original.bricks.length + result.created.length);
assert.equal(scene.links.length, original.links.length);
assert.equal(scene.joints.length, 4, 'All native wheel joints survive');
assert.equal(scene.edges.length, original.edges.length + 84, 'Original wheel wires plus complete brain wiring');
assert.deepEqual(scene.r.externalAssets(), original.r.externalAssets());
assert.deepEqual(scene.r.prefabJson(), original.r.prefabJson());
assert.equal(scene.r.bundle().name, 'Autonomous Cat Companion Bot');
assert.equal(scene.r.bundle().description,
  'Four-wheel autonomous cat companion that follows nearby players, roams when alone, avoids obstacles, and changes expression with its behavior.');
assertNoInstantCycles(scene);

const placement = validatePlacement(result.bytes);
assert(placement.strictOk, JSON.stringify(placement));

const oldPhysical = original.bricks.filter(brick => brick.g !== result.grid);
const physicalEntity = [...scene.r.entities()].find(e => e.typeName === 'Entity_DynamicBrickGrid');
assert(physicalEntity, 'Dynamic chassis entity');
const newPhysical = scene.bricks.filter(brick => brick.g === physicalEntity.persistentIndex);
assert.equal(newPhysical.length, oldPhysical.length, 'No visible chassis bricks added or removed');
for (const before of oldPhysical) {
  const after = one(newPhysical.filter(brick => brick.data.asset === before.data.asset &&
    brick.data.position.join() === before.data.position.join()), `physical brick ${before.data.asset}@${before.data.position}`);
  assert.deepEqual(after.data, before.data, 'Physical geometry and collision remain exact');
  for (const oldComp of before.comps) {
    const actual = component(after, oldComp.type);
    assert(actual, `Retained ${oldComp.type}`);
    const expected = structuredClone(oldComp.data);
    if (oldComp.type === C.WheelEngine.NAME) {
      expected.bEnableManualControl = true;
      expected.ManualControlMode = 1;
    } else if (oldComp.type === C.TextDisplay.NAME) {
      expected.Text = '😺';
      expected.LineHeight = 10;
      expected.WidthScale = 1;
      expected.bEnabled = true;
    }
    assert.deepEqual(actual.data, expected, `${oldComp.type} only receives intended configuration`);
  }
}

const oldWheels = [...original.r.entities()].filter(e => e.typeName === 'Entity_Wheel_Offroad1');
const newWheels = [...scene.r.entities()].filter(e => e.typeName === 'Entity_Wheel_Offroad1');
assert.equal(newWheels.length, 4);
assert.equal(oldWheels.length, 4);
for (let i = 0; i < 4; i++) {
  assert.deepEqual(newWheels[i].location, oldWheels[i].location, 'Wheel world location retained');
  assert.deepEqual(newWheels[i].rotation, oldWheels[i].rotation, 'Wheel world rotation retained');
  assert.deepEqual(newWheels[i].data, oldWheels[i].data, 'Native wheel settings retained');
  assert.deepEqual(newWheels[i].colors, oldWheels[i].colors, 'Wheel palette retained');
  assert.equal(newWheels[i].frozen, oldWheels[i].frozen, 'Wheel frozen state retained');
  assert.equal(newWheels[i].sleeping, oldWheels[i].sleeping, 'Wheel sleeping state retained');
  assert.deepEqual(newWheels[i].linearVelocity, oldWheels[i].linearVelocity, 'Wheel linear velocity retained');
  assert.deepEqual(newWheels[i].angularVelocity, oldWheels[i].angularVelocity, 'Wheel angular velocity retained');
}
const entityIds = new Set([...scene.r.entities()].map(e => e.persistentIndex));
for (const joint of scene.joints) assert(entityIds.has(joint.entity), `Resolved wheel joint ${joint.entity}`);
for (const beforeJoint of original.joints) {
  const beforeBrick = one(original.bricks.filter(brick => brick.key === beforeJoint.key), 'source suspension brick');
  const afterBrick = one(newPhysical.filter(brick => brick.data.asset === beforeBrick.data.asset &&
    brick.data.position.join() === beforeBrick.data.position.join()), 'saved suspension brick');
  const afterJoint = one(scene.joints.filter(joint => joint.key === afterBrick.key), 'saved suspension joint');
  assert.deepEqual(afterJoint.offset, beforeJoint.offset, 'Suspension attachment offset retained');
  assert.deepEqual(afterJoint.rotation, beforeJoint.rotation, 'Suspension attachment rotation retained');
  const beforeWheel = one([...original.r.entities()].filter(e => e.persistentIndex === beforeJoint.entity), 'source wheel');
  const afterWheel = one([...scene.r.entities()].filter(e => e.persistentIndex === afterJoint.entity), 'saved wheel');
  for (const property of ['typeName', 'location', 'rotation', 'data']) {
    assert.deepEqual(afterWheel[property], beforeWheel[property], `Suspension wheel ${property} retained`);
  }
}

const engine = one(all(C.WheelEngine.NAME), 'wheel engine');
assert.equal(engine.comp.data.bEnableManualControl, true);
assert.equal(engine.comp.data.ManualControlMode, 1);
const wheelWires = scene.edges.filter(e => e.a === engine.brick.key && e.at === C.WheelEngine.NAME &&
  e.p === 'Control_DriveAndSteer' && e.zt === C.Joint_Wheel_Suspension.NAME && e.q === 'Control_DriveAndSteer');
assert.equal(wheelWires.length, 4, 'Existing four-wheel control retained');
assert.equal(edge(C.WheelEngine.NAME, 'ManualInput_Drive').length, 1);
assert.equal(edge(C.WheelEngine.NAME, 'ManualInput_Steer').length, 1);
assert.equal(edge(C.WheelEngine.NAME, 'bManualInput_Brake').length, 1);

const sweeps = all(C.Exec_Sweep.NAME);
assert.equal(sweeps.length, 2);
const playerSweepNode = one(sweeps.filter(x => x.comp.data.Radius === 900), 'player acquisition sweep');
const playerSweep = playerSweepNode.comp.data;
assert.equal(playerSweep.Distance, 1);
assert.equal(playerSweep.CollisionChannel, 8);
assert.equal(playerSweep.bOnlyHitPlayerBodyParts, false);
assert.equal(playerSweep.bDetectBricks, false);
assert.equal(playerSweep.bDetectPhysics, false);
assert.equal(playerSweep.bDetectMap, false);
assert([playerSweep.bDetectPlayers1, playerSweep.bDetectPlayers2,
  playerSweep.bDetectPlayers3, playerSweep.bDetectPlayers4].every(Boolean));
const obstacleSweep = one(sweeps.filter(x => x.comp.data.Radius === 8), 'obstacle sweep').comp.data;
assert.equal(obstacleSweep.Distance, 140);
assert.equal(obstacleSweep.bDetectBricks, true);
assert.equal(obstacleSweep.bDetectPhysics, true);
assert.equal(obstacleSweep.bDetectMap, true);
assert([obstacleSweep.bDetectPlayers1, obstacleSweep.bDetectPlayers2,
  obstacleSweep.bDetectPlayers3, obstacleSweep.bDetectPlayers4].every(v => !v));

const clocks = all(C.Clock.NAME).map(x => x.comp.data.IntervalSeconds).sort((a, b) => a - b);
assert.deepEqual(clocks, [0.2, 3.5]);
assert.equal(all(C.Exec_Random.NAME).length, 1, 'Persistent random roam steering');
assert.equal(all(C.Stopwatch.NAME).length, 1, 'Held obstacle response');
assert.equal(all(C.Expr_Convert.NAME).length, 1, 'Rotator is explicitly converted to quaternion');
assert.equal(all(C.Expr_RotateVector.NAME).length, 0, 'ReadBrickGrid already resolves the owning chassis grid');
assert.equal(all(C.Expr_MathAtan2.NAME).length, 1, 'Full-range signed pursuit angle');

const driver = (target, port) => one(scene.edges.filter(e => e.z === target.brick.key && e.q === port),
  `${target.brick.key}.${port} driver`);
const ownTransform = one(all(C.Exec_Entity_GetLocationRotation.NAME), 'own-grid transform query');
const targetDelta = one(all(C.Expr_MathSubtract.NAME).filter(target => scene.edges.some(e =>
  e.a === ownTransform.brick.key && e.z === target.brick.key && e.q === 'InputB')), 'target-delta subtraction');
const nose = one(all(C.Expr_MathAdd.NAME).filter(target => scene.edges.some(e =>
  e.a === ownTransform.brick.key && e.z === target.brick.key && e.q === 'InputA')), 'obstacle nose offset');
assert.equal(driver(playerSweepNode, 'Origin').a, ownTransform.brick.key, 'Player sensor is centered on chassis');
assert.equal(driver(targetDelta, 'InputB').a, ownTransform.brick.key, 'Pursuit delta starts at chassis');
assert.equal(driver(nose, 'InputA').a, ownTransform.brick.key, 'Obstacle lookahead starts at chassis');

const textEdge = one(scene.edges.filter(e => e.zt === C.TextDisplay.NAME && e.q === 'Text'), 'dynamic face wire');
const textSource = scene.bricks.find(brick => brick.key === textEdge.a);
const faceFinal = {brick: textSource, comp: component(textSource, C.Expr_Select.NAME)};
assert(faceFinal.comp, 'Face driven by final priority selector');
const sourceOf = (target, port) => {
  const connection = driver(target, port);
  const brick = one(scene.bricks.filter(candidate => candidate.key === connection.a), `${port} source brick`);
  return {brick, comp: one(brick.comps.filter(comp => comp.type === connection.at), `${port} source component`), connection};
};
const closeFace = sourceOf(faceFinal, 'InputA');
const stalledFace = sourceOf(closeFace, 'InputA');
const followingFace = sourceOf(stalledFace, 'InputA');
assert.equal(faceFinal.comp.data.InputB.value, '😾');
assert.equal(closeFace.comp.data.InputB.value, '😻');
assert.equal(stalledFace.comp.data.InputB.value, '😿');
assert.equal(followingFace.comp.data.InputA.value, '😺');
assert.equal(followingFace.comp.data.InputB.value, '😼');
assert.equal(driver(faceFinal, 'bSelectB').at, C.Var.NAME, 'Angry face follows avoidance state');
assert.equal(driver(closeFace, 'bSelectB').at, C.Expr_LogicalAND.NAME, 'Heart-eyes face follows near-player state');
assert.equal(driver(stalledFace, 'bSelectB').p, 'bStalling', 'Sad face follows engine stall output');
assert.equal(driver(followingFace, 'bSelectB').at, C.Var.NAME, 'Follow face follows target state');
const serializedStrings = JSON.stringify(scene.bricks.filter(brick => brick.g !== physicalEntity.persistentIndex));
for (const emoji of ['😺', '😼', '😿', '😻', '😾']) assert(serializedStrings.includes(emoji), `Face ${emoji} present`);

// Independent numeric cases document and check the intended selector rules.
function control({hasTarget, avoiding, distance, angle, roam = 0.3, stalling = false}) {
  const steer = Math.max(-1, Math.min(1, angle / 0.8));
  const near = hasTarget && distance <= 90;
  const followDrive = near ? 0 : Math.abs(steer) > 0.75 ? 0.16 : 0.42;
  return {
    drive: avoiding ? -0.22 : hasTarget ? followDrive : 0.25,
    steer: avoiding ? 0.9 : hasTarget ? steer : roam,
    brake: near && !avoiding,
    face: avoiding ? '😾' : near ? '😻' : stalling ? '😿' : hasTarget ? '😼' : '😺',
  };
}
assert.deepEqual(control({hasTarget: false, avoiding: false, distance: 0, angle: 0}),
  {drive: 0.25, steer: 0.3, brake: false, face: '😺'});
assert.deepEqual(control({hasTarget: true, avoiding: false, distance: 200, angle: 0}),
  {drive: 0.42, steer: 0, brake: false, face: '😼'});
assert.deepEqual(control({hasTarget: true, avoiding: false, distance: 200, angle: 0.8}),
  {drive: 0.16, steer: 1, brake: false, face: '😼'});
assert.deepEqual(control({hasTarget: true, avoiding: false, distance: 70, angle: 0.2}),
  {drive: 0, steer: 0.25, brake: true, face: '😻'});
assert.deepEqual(control({hasTarget: true, avoiding: false, distance: 70, angle: 0.2, stalling: true}),
  {drive: 0, steer: 0.25, brake: true, face: '😻'});
assert.deepEqual(control({hasTarget: true, avoiding: true, distance: 70, angle: 0, stalling: true}),
  {drive: -0.22, steer: 0.9, brake: false, face: '😾'});

console.log(JSON.stringify({
  strictPlacement: true,
  originalPhysicalBricks: oldPhysical.length,
  addedBrainGates: result.created.length,
  wires: scene.edges.length,
  wheelEntities: newWheels.length,
  wheelJoints: scene.joints.length,
  behaviorCases: 6,
}, null, 2));

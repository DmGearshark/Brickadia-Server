'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const COLORS = {
  sense: [70, 145, 220],
  state: [180, 105, 220],
  steer: [55, 185, 135],
  roam: [225, 155, 55],
  output: [225, 80, 100],
};

function build(input) {
  const original = read(fs.readFileSync(input));
  const scene = read(fs.readFileSync(input));
  const byType = type => scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type)
    .map(comp => ({key: brick.key, type, brick, comp})));
  const one = (items, description) => {
    assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
    return items[0];
  };

  const engine = one(byType(C.WheelEngine.NAME), 'wheel engine');
  const face = one(byType(C.TextDisplay.NAME), 'face text display');
  const chipBrick = one(byType(C.Microchip.NAME), 'brain microchip');
  const chipLink = one(scene.links.filter(link => link.key === chipBrick.key), 'brain microchip link');
  const grid = chipLink.grid;
  assert.equal(scene.bricks.filter(brick => brick.g === grid).length, 0, 'Brain chip must begin empty');

  // The engine keeps its existing wheel discovery and four wheel-control wires.
  // Ground manual mode makes the two normalized logic outputs authoritative.
  engine.comp.data.bEnableManualControl = true;
  engine.comp.data.ManualControlMode = 1;
  face.comp.data.Text = '😺';
  face.comp.data.LineHeight = 10;
  face.comp.data.WidthScale = 1;
  face.comp.data.bEnabled = true;

  let serial = 0;
  const created = [];
  function position(row, column) {
    return [-200 + column * 40, -100 + row * 34, 2];
  }
  function node(kind, data, row, column, color = COLORS.steer) {
    const def = C[kind];
    assert(def, `Unknown component ${kind}`);
    const brick = {
      key: `catbot:${String(serial++).padStart(2, '0')}:${kind}`,
      g: grid,
      data: {
        asset: def.BRICK,
        material: 'BMC_Plastic',
        position: position(row, column),
        size: [0, 0, 0],
        direction: 4,
        rotation: 0,
        collision: {player: true, weapon: true, interaction: true, tool: true, physics: true},
        visibility: true,
        material_intensity: 0,
        color,
        owner_index: 0,
      },
      comps: [{type: def.NAME, data}],
    };
    scene.bricks.push(brick);
    const result = {key: brick.key, type: def.NAME, brick, comp: brick.comps[0], kind};
    created.push(result);
    return result;
  }
  function endpoint(key, type) {
    return {key, type};
  }
  function wire(source, sourcePort, target, targetPort) {
    assert(Object.values(C).find(def => def.NAME === source.type)?.PORTS[sourcePort],
      `Unknown output ${source.type}.${sourcePort}`);
    assert(Object.values(C).find(def => def.NAME === target.type)?.PORTS[targetPort],
      `Unknown input ${target.type}.${targetPort}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === target.type && edge.q === targetPort),
      `Duplicate driver for ${target.key}.${targetPort}`);
    scene.edges.push({a: source.key, at: source.type, p: sourcePort, z: target.key, zt: target.type, q: targetPort});
  }
  function variable(value, row, column, color = COLORS.state) {
    return node('Var', {Value: value}, row, column, color);
  }
  function set(variableNode, value, row, column, color = COLORS.state) {
    const setter = node('Exec_Var_Set', {Value: value}, row, column, color);
    wire(variableNode, 'VarRef', setter, 'VarRef');
    return setter;
  }
  function select(condition, conditionPort, a, b, row, column, color = COLORS.output) {
    const gate = node('Expr_Select', {InputA: a, InputB: b}, row, column, color);
    wire(condition, conditionPort, gate, 'bSelectB');
    return gate;
  }

  // SENSING: five updates per second. The one-tick boundary publishes the
  // native transform query before either sweep consumes it.
  const behaviorClock = node('Clock', {
    bEnabled: true, bPulseOn: false, OnTimeSeconds: 1, OffTimeSeconds: 1, IntervalSeconds: 0.2,
  }, 0, 0, COLORS.sense);
  const ownGrid = node('ReadBrickGrid', {}, 0, 1, COLORS.sense);
  const ownTransform = node('Exec_Entity_GetLocationRotation', {}, 0, 2, COLORS.sense);
  const transformReady = node('BufferTicks', {TicksToWait: 1, ZeroTicksToWait: 0}, 0, 3, COLORS.sense);
  wire(ownGrid, 'BrickGrid', ownTransform, 'Entity');
  wire(behaviorClock, 'Pulse', ownTransform, 'Exec');
  wire(ownTransform, 'ExecOut', transformReady, 'Input');

  // A radius-900 capsule sweep acquires a nearby player without a seat,
  // interaction, ownership rule, or external game modification.
  const playerSweep = node('Exec_Sweep', {
    Origin: {X: 0, Y: 0, Z: 0}, Direction: {X: 1, Y: 0, Z: 0}, Distance: 1, Radius: 900,
    bRelative: false, bIgnoreOwningGrid: true, CollisionChannel: 8,
    bDetectBricks: false, bDetectPlayers1: true, bDetectPlayers2: true,
    bDetectPlayers3: true, bDetectPlayers4: true, bOnlyHitPlayerBodyParts: false,
    bDetectPhysics: false, bDetectMap: false,
  }, 0, 4, COLORS.sense);
  wire(ownTransform, 'Vector', playerSweep, 'Origin');
  wire(transformReady, 'Output', playerSweep, 'Exec');
  const hitReady = node('BufferTicks', {TicksToWait: 1, ZeroTicksToWait: 0}, 0, 5, COLORS.sense);
  wire(playerSweep, 'Hit', hitReady, 'Input');
  const targetTransform = node('Exec_Entity_GetLocation', {}, 0, 6, COLORS.sense);
  wire(playerSweep, 'HitEntity', targetTransform, 'Entity');
  wire(hitReady, 'Output', targetTransform, 'Exec');
  const targetReady = node('BufferTicks', {TicksToWait: 1, ZeroTicksToWait: 0}, 0, 7, COLORS.sense);
  wire(targetTransform, 'ExecOut', targetReady, 'Input');
  const hasTarget = variable(B(false), 0, 8);
  const foundTarget = set(hasTarget, B(true), 0, 9);
  const lostTarget = set(hasTarget, B(false), 0, 10);
  wire(targetReady, 'Output', foundTarget, 'Exec');
  wire(playerSweep, 'Miss', lostTarget, 'Exec');

  // ORIENTATION AND PURSUIT: reduce both directions to the ground plane,
  // then use atan2(cross, dot) for a signed, full-range steering error.
  const rotationToQuat = node('Expr_Convert', {
    Input: {$variant: 'Rotator', value: {Pitch: 0, Yaw: 0, Roll: 0}},
    TargetType: {$variant: 'Quat', value: {X: 0, Y: 0, Z: 0, W: 0}},
  }, 2, 0);
  wire(ownTransform, 'Rotation', rotationToQuat, 'Input');
  const rawForward = node('Expr_RotationToDirection', {Rotation: {X: 0, Y: 0, Z: 0, W: 1}}, 2, 1);
  wire(rotationToQuat, 'Output', rawForward, 'Rotation');
  const splitForward = node('Expr_SplitVector', {Input: {X: 1, Y: 0, Z: 0}}, 2, 2);
  wire(rawForward, 'Output', splitForward, 'Input');
  const flatForward = node('Expr_MakeVector', {X: 1, Y: 0, Z: 0}, 2, 3);
  wire(splitForward, 'X', flatForward, 'X');
  wire(splitForward, 'Y', flatForward, 'Y');
  const forward = node('Expr_VecNormalize', {Input: {X: 1, Y: 0, Z: 0}}, 2, 4);
  wire(flatForward, 'Output', forward, 'Input');

  const targetDelta = node('Expr_MathSubtract', {
    InputA: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 0}},
    InputB: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 0}},
  }, 3, 0);
  wire(targetTransform, 'Vector', targetDelta, 'InputA');
  wire(ownTransform, 'Vector', targetDelta, 'InputB');
  const splitDelta = node('Expr_SplitVector', {Input: {X: 0, Y: 0, Z: 0}}, 3, 1);
  wire(targetDelta, 'Output', splitDelta, 'Input');
  const flatDelta = node('Expr_MakeVector', {X: 0, Y: 0, Z: 0}, 3, 2);
  wire(splitDelta, 'X', flatDelta, 'X');
  wire(splitDelta, 'Y', flatDelta, 'Y');
  const desired = node('Expr_VecNormalize', {Input: {X: 1, Y: 0, Z: 0}}, 3, 3);
  wire(flatDelta, 'Output', desired, 'Input');
  const cross = node('Expr_VecCrossProduct', {
    InputA: {X: 1, Y: 0, Z: 0}, InputB: {X: 1, Y: 0, Z: 0},
  }, 3, 4);
  wire(forward, 'Output', cross, 'InputA');
  wire(desired, 'Output', cross, 'InputB');
  const splitCross = node('Expr_SplitVector', {Input: {X: 0, Y: 0, Z: 0}}, 3, 5);
  wire(cross, 'Output', splitCross, 'Input');
  const dot = node('Expr_VecDotProduct', {
    InputA: {X: 1, Y: 0, Z: 0}, InputB: {X: 1, Y: 0, Z: 0},
  }, 3, 6);
  wire(forward, 'Output', dot, 'InputA');
  wire(desired, 'Output', dot, 'InputB');
  const angle = node('Expr_MathAtan2', {X: 1, Y: 0}, 3, 7);
  wire(dot, 'Output', angle, 'X');
  wire(splitCross, 'Z', angle, 'Y');
  const steeringGain = node('Expr_MathDivide', {InputA: N(0), InputB: N(0.8)}, 3, 8);
  wire(angle, 'Output', steeringGain, 'InputA');
  const clampedSteer = node('Expr_MathClamp', {Input: N(0), Min: N(-1), Max: N(1)}, 3, 9);
  wire(steeringGain, 'Output', clampedSteer, 'Input');
  const steeringPolarity = variable(N(1), 3, 10);
  const followSteer = node('Expr_MathMultiply', {InputA: N(0), InputB: N(1)}, 3, 11);
  wire(clampedSteer, 'Output', followSteer, 'InputA');
  wire(steeringPolarity, 'Value', followSteer, 'InputB');

  const distance = node('Expr_VecMagnitude', {Input: {X: 0, Y: 0, Z: 0}}, 4, 0);
  wire(flatDelta, 'Output', distance, 'Input');
  const close = node('Expr_CompareLessOrEqual', {InputA: N(0), InputB: N(90)}, 4, 1);
  wire(distance, 'Output', close, 'InputA');
  const nearTarget = node('Expr_LogicalAND', {bInputA: false, bInputB: false}, 4, 2);
  wire(hasTarget, 'Value', nearTarget, 'bInputA');
  wire(close, 'bOutput', nearTarget, 'bInputB');
  const steerMagnitude = node('Expr_MathAbs', {Input: N(0)}, 4, 3);
  wire(followSteer, 'Output', steerMagnitude, 'Input');
  const hardTurn = node('Expr_CompareGreater', {InputA: N(0), InputB: N(0.75)}, 4, 4);
  wire(steerMagnitude, 'Output', hardTurn, 'InputA');
  const movingDrive = select(hardTurn, 'bOutput', N(0.42), N(0.16), 4, 5);
  const followDrive = select(nearTarget, 'bOutput', N(0), N(0), 4, 6);
  wire(movingDrive, 'Output', followDrive, 'InputA');

  // ROAMING: keep one random turn for several seconds so the bot travels in
  // readable arcs instead of twitching each sensor update.
  const roamSteer = variable(N(0.25), 5, 0, COLORS.roam);
  const roamClock = node('Clock', {
    bEnabled: true, bPulseOn: false, OnTimeSeconds: 1, OffTimeSeconds: 1, IntervalSeconds: 3.5,
  }, 5, 1, COLORS.roam);
  const randomSteer = node('Exec_Random', {Min: N(-0.65), Max: N(0.65), Output: N(0)}, 5, 2, COLORS.roam);
  wire(roamClock, 'Pulse', randomSteer, 'Exec');
  const randomReady = node('BufferTicks', {TicksToWait: 1, ZeroTicksToWait: 0}, 5, 3, COLORS.roam);
  wire(randomSteer, 'ExecOut', randomReady, 'Input');
  const saveRoamSteer = set(roamSteer, N(0), 5, 4, COLORS.roam);
  wire(randomSteer, 'Output', saveRoamSteer, 'Value');
  wire(randomReady, 'Output', saveRoamSteer, 'Exec');

  // OBSTACLE AVOIDANCE: cast ahead of the nose. Each hit holds a short
  // reverse-and-turn response; repeated hits restart the hold timer.
  const forwardOffset = node('Expr_MathMultiply', {
    InputA: {$variant: 'Vector', value: {X: 1, Y: 0, Z: 0}}, InputB: N(22),
  }, 1, 0, COLORS.sense);
  wire(forward, 'Output', forwardOffset, 'InputA');
  const nose = node('Expr_MathAdd', {
    InputA: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 0}},
    InputB: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 0}},
  }, 1, 1, COLORS.sense);
  wire(ownTransform, 'Vector', nose, 'InputA');
  wire(forwardOffset, 'Output', nose, 'InputB');
  const liftedNose = node('Expr_MathAdd', {
    InputA: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 0}},
    InputB: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 5}},
  }, 1, 2, COLORS.sense);
  wire(nose, 'Output', liftedNose, 'InputA');
  const obstacleSweep = node('Exec_Sweep', {
    Origin: {X: 0, Y: 0, Z: 0}, Direction: {X: 1, Y: 0, Z: 0}, Distance: 140, Radius: 8,
    bRelative: false, bIgnoreOwningGrid: true, CollisionChannel: 8,
    bDetectBricks: true, bDetectPlayers1: false, bDetectPlayers2: false,
    bDetectPlayers3: false, bDetectPlayers4: false, bOnlyHitPlayerBodyParts: false,
    bDetectPhysics: true, bDetectMap: true,
  }, 1, 3, COLORS.sense);
  wire(liftedNose, 'Output', obstacleSweep, 'Origin');
  wire(forward, 'Output', obstacleSweep, 'Direction');
  wire(transformReady, 'Output', obstacleSweep, 'Exec');
  const avoiding = variable(B(false), 1, 4);
  const beginAvoid = set(avoiding, B(true), 1, 5);
  wire(obstacleSweep, 'Hit', beginAvoid, 'Exec');
  const avoidTimer = node('Stopwatch', {Limit: 0.9, Time: 0, bRunning: false}, 1, 6, COLORS.state);
  wire(beginAvoid, 'ExecOut', avoidTimer, 'Restart');
  const endAvoid = set(avoiding, B(false), 1, 7);
  wire(avoidTimer, 'Expired', endAvoid, 'Exec');

  // OUTPUTS: target following overrides roaming; avoidance overrides both.
  const modeDrive = select(hasTarget, 'Value', N(0.25), N(0), 6, 0);
  wire(followDrive, 'Output', modeDrive, 'InputB');
  const finalDrive = select(avoiding, 'Value', N(0), N(-0.22), 6, 1);
  wire(modeDrive, 'Output', finalDrive, 'InputA');
  const modeSteer = select(hasTarget, 'Value', N(0), N(0), 6, 2);
  wire(roamSteer, 'Value', modeSteer, 'InputA');
  wire(followSteer, 'Output', modeSteer, 'InputB');
  const finalSteer = select(avoiding, 'Value', N(0), N(0.9), 6, 3);
  wire(modeSteer, 'Output', finalSteer, 'InputA');
  const finalBrake = select(avoiding, 'Value', B(false), B(false), 6, 4);
  wire(nearTarget, 'bOutput', finalBrake, 'InputA');

  const engineEndpoint = endpoint(engine.key, engine.type);
  wire(finalDrive, 'Output', engineEndpoint, 'ManualInput_Drive');
  wire(finalSteer, 'Output', engineEndpoint, 'ManualInput_Steer');
  wire(finalBrake, 'Output', engineEndpoint, 'bManualInput_Brake');

  // FACE: roam 😺, pursue 😼, greet nearby 😻, stalled 😿,
  // and obstacle avoidance 😾. Later selectors have higher priority.
  const followingFace = select(hasTarget, 'Value', S('😺'), S('😼'), 6, 5);
  const stalledFace = select(engineEndpoint, 'bStalling', S(''), S('😿'), 6, 6);
  wire(followingFace, 'Output', stalledFace, 'InputA');
  const closeFace = select(nearTarget, 'bOutput', S(''), S('😻'), 6, 7);
  wire(stalledFace, 'Output', closeFace, 'InputA');
  const avoidFace = select(avoiding, 'Value', S(''), S('😾'), 6, 8);
  wire(closeFace, 'Output', avoidFace, 'InputA');
  wire(avoidFace, 'Output', endpoint(face.key, face.type), 'Text');

  // Keep the newly populated chip's editing canvas centered around the six
  // organized rows instead of retaining the empty chip's tiny default plane.
  const oldBrainEntity = one([...scene.r.entities()].filter(entity => entity.persistentIndex === grid), 'brain entity');
  scene.entityOverrides = new Map([[grid, {
    persistentIndex: oldBrainEntity.persistentIndex,
    typeName: oldBrainEntity.typeName,
    location: oldBrainEntity.location,
    rotation: oldBrainEntity.rotation,
    frozen: oldBrainEntity.frozen,
    sleeping: oldBrainEntity.sleeping,
    linearVelocity: oldBrainEntity.linearVelocity,
    angularVelocity: oldBrainEntity.angularVelocity,
    colors: oldBrainEntity.colors,
    data: {
      ...structuredClone(oldBrainEntity.data),
      PlaneCenter: {X: 20, Y: 10, Z: 0},
      PlaneExtent: {X: 255, Y: 130, Z: 2},
    },
  }]]);

  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const output = write(scene, {
    embedded,
    name: 'Autonomous Cat Companion Bot',
    description: 'Four-wheel autonomous cat companion that follows nearby players, roams when alone, avoids obstacles, and changes expression with its behavior.',
  });
  const saved = read(output.bytes);
  return {
    bytes: output.bytes,
    original,
    scene: saved,
    created,
    grid,
    engineKey: engine.key,
    faceKey: face.key,
    important: {behaviorClock, ownTransform, playerSweep, obstacleSweep, hasTarget, avoiding,
      steeringPolarity, targetDelta, nose, finalDrive, finalSteer, finalBrake, nearTarget,
      avoidFace},
  };
}

module.exports = build;
if (require.main === module) {
  const [input, output = 'prefabs/autonomous-cat-companion-bot.brz'] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node build-autonomous-cat-bot.cjs input.brz [output.brz]');
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    brainGrid: result.grid,
    addedBrainGates: result.created.length,
    playerSensorRadius: 900,
    behaviorHz: 5,
    faces: ['😺', '😼', '😿', '😻', '😾'],
  }, null, 2));
}

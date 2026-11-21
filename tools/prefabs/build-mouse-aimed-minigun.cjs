'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {brdb} = require('brs-js');
const {read, write} = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {C, N} = require('./loadboard-lib.cjs');

const DEFAULT_INPUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
const DEFAULT_OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/mouse-aimed-minigun.brz'));

const COLORS = {
  timing: [70, 145, 220],
  sensing: [230, 150, 55],
  transform: [55, 180, 190],
  yaw: [70, 185, 105],
  pitch: [175, 105, 220],
  output: [230, 85, 115],
};

function one(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}

function owner(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'A non-PUBLIC prefab owner is required');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function build(input = DEFAULT_INPUT) {
  assert(input, 'Input WASD Minigun .brz path is required');
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const original = read(donor);
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const component = (brick, type) => brick?.comps.find(saved => saved.type === type);
  const rows = type => scene.bricks.flatMap(brick => brick.comps
    .filter(saved => saved.type === type)
    .map(saved => ({brick, saved})));

  const splitterRow = one(rows(C.InputSplitter.NAME), 'seat input splitter');
  const aimGrid = splitterRow.brick.g;
  const splitter = {key: splitterRow.brick.key, type: C.InputSplitter.NAME};
  const seatRow = one(rows(C.Seat.NAME), 'gunner seat');
  const seat = {key: seatRow.brick.key, type: C.Seat.NAME};

  const bearingTargetEdges = scene.edges.filter(edge => edge.zt === C.RigidBearing.NAME
    && edge.q === 'TargetAngle' && edge.at === C.Var.NAME && edge.p === 'Value'
    && bricks.get(edge.a)?.g === aimGrid);
  assert.equal(bearingTargetEdges.length, 2, 'The aiming chip must drive two rigid bearings');
  const yawEdge = one(bearingTargetEdges.filter(edge => bricks.get(edge.z)?.g === 1),
    'root yaw-bearing target');
  const pitchEdge = one(bearingTargetEdges.filter(edge => edge !== yawEdge),
    'child pitch-bearing target');
  const yawVar = {key: yawEdge.a, type: C.Var.NAME};
  const pitchVar = {key: pitchEdge.a, type: C.Var.NAME};
  const yawBearing = {key: yawEdge.z, type: C.RigidBearing.NAME};
  const pitchBearing = {key: pitchEdge.z, type: C.RigidBearing.NAME};
  const yawValue = component(bricks.get(yawVar.key), C.Var.NAME).data.Value;
  const pitchValue = component(bricks.get(pitchVar.key), C.Var.NAME).data.Value;
  assert.equal(yawValue.value, -6, 'Expected saved yaw target');
  assert.equal(pitchValue.value, 7, 'Expected saved pitch target');

  const displaySelect = one(rows(C.Expr_Select.NAME)
    .filter(row => row.brick.g === aimGrid), 'left-mouse display selector').brick;
  const keep = new Set([splitter.key, yawVar.key, pitchVar.key, displaySelect.key]);
  const oldAimBricks = scene.bricks.filter(brick => brick.g === aimGrid);
  assert.equal(oldAimBricks.length, 25, 'Known WASD aiming-chip layout');
  const removed = new Set(oldAimBricks.filter(brick => !keep.has(brick.key))
    .map(brick => brick.key));
  assert.equal(removed.size, 21, 'WASD controller plus unused input poller removed');
  scene.bricks = scene.bricks.filter(brick => !removed.has(brick.key));
  scene.edges = scene.edges.filter(edge => !removed.has(edge.a) && !removed.has(edge.z));

  const gateBase = structuredClone(oldAimBricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  let serial = 0;
  const created = [];
  function gate(kind, position, data = {}, color = COLORS.transform, grid = aimGrid,
    options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate kind ${kind}`);
    const brickData = structuredClone(gateBase);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position,
      size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
      direction: 4,
      rotation: 0,
      material: 'BMC_Plastic',
      material_intensity: 0,
      color,
      visibility: options.visibility ?? true,
      collision: options.collision ?? {
        player: true, weapon: true, interaction: true, tool: true, physics: true,
      },
      owner_index: 0,
    });
    const brick = {
      key: `mouse-aim:${String(serial++).padStart(2, '0')}:${kind}`,
      g: grid,
      data: brickData,
      comps: [{type: definition.NAME, data: structuredClone(data)}],
    };
    scene.bricks.push(brick);
    const result = {key: brick.key, type: definition.NAME, kind, brick};
    created.push(result);
    return result;
  }
  function wire(source, sourcePort, target, targetPort) {
    const sourceDefinition = Object.values(C).find(definition => definition.NAME === source.type);
    const targetDefinition = Object.values(C).find(definition => definition.NAME === target.type);
    assert(sourceDefinition?.PORTS[sourcePort], `${source.type}.${sourcePort}`);
    assert(targetDefinition?.PORTS[targetPort], `${target.type}.${targetPort}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === target.type
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: source.type, p: sourcePort,
      z: target.key, zt: target.type, q: targetPort,
    });
  }

  // This reader is deliberately on the moving gun grid rather than in the
  // linked logic plane. It makes the world-to-local conversion unambiguous.
  const gunGrid = seatRow.brick.g;
  const readGunGrid = gate('ReadBrickGrid', [-29, -5, 35], {}, COLORS.transform,
    gunGrid, {
      visibility: false,
      collision: {player: false, weapon: false, interaction: false, tool: true, physics: false},
    });

  // EXECUTION: the entire aim loop is disabled as soon as the seat is empty.
  const clock = gate('Clock', [-95, -15, 2], {
    bEnabled: false,
    bPulseOn: false,
    OnTimeSeconds: 1,
    OffTimeSeconds: 1,
    IntervalSeconds: 0.025,
  }, COLORS.timing);
  const pose = gate('Exec_Entity_GetLocationRotation', [-85, -15, 2], {
    Vector: {X: 0, Y: 0, Z: 0},
    Rotation: {Pitch: 0, Yaw: 0, Roll: 0},
  }, COLORS.sensing);
  const aim = gate('Exec_Character_GetAim', [-75, -15, 2], {
    Origin: {X: 0, Y: 0, Z: 0},
    Direction: {X: 1, Y: 0, Z: 0},
    bLocalAim: false,
  }, COLORS.sensing);
  const settled = gate('BufferTicks', [-65, -15, 2], {
    TicksToWait: 1,
    ZeroTicksToWait: 0,
  }, COLORS.timing);
  const stillOccupied = gate('Exec_Branch', [-35, -15, 2], {
    bCond: false,
  }, COLORS.timing);

  wire(seat, 'bIsOccupied', clock, 'bEnabled');
  wire(clock, 'Pulse', pose, 'Exec');
  wire(readGunGrid, 'BrickGrid', pose, 'Entity');
  wire(pose, 'ExecOut', aim, 'Exec');
  wire(seat, 'SittingCharacter', aim, 'Character');
  wire(aim, 'ExecOut', settled, 'Input');
  wire(settled, 'Output', stillOccupied, 'Exec');
  wire(seat, 'bIsOccupied', stillOccupied, 'bCond');

  // COORDINATE CONVERSION: Get Aim is world-space. The minigun's moving grid
  // uses local +Y as forward, +Z as right and +X as up, so remap those axes to
  // the conventional +X-forward vector expected by Direction To Rotation.
  const toQuat = gate('Expr_Convert', [-95, 5, 2], {
    Input: {$variant: 'Rotator', value: {Pitch: 0, Yaw: 0, Roll: 0}},
    TargetType: {$variant: 'Quat', value: {X: 0, Y: 0, Z: 0, W: 0}},
  });
  const inverse = gate('Expr_InvertRotation', [-85, 5, 2], {
    Input: {X: 0, Y: 0, Z: 0, W: 1},
  });
  const localAim = gate('Expr_RotateVector', [-75, 5, 2], {
    Rotation: {X: 0, Y: 0, Z: 0, W: 1},
    Vector: {X: 1, Y: 0, Z: 0},
  });
  const localParts = gate('Expr_SplitVector', [-65, 5, 2], {
    Input: {X: 1, Y: 0, Z: 0},
  });
  const remapped = gate('Expr_MakeVector', [-55, 5, 2], {
    X: N(1), Y: N(0), Z: N(0),
  });
  const aimRotation = gate('Expr_DirectionToRotation', [-45, 5, 2], {
    Direction: {X: 1, Y: 0, Z: 0},
  });
  const aimAngles = gate('Expr_SplitRotation', [-35, 5, 2], {
    Input: {Pitch: 0, Yaw: 0, Roll: 0},
  });

  wire(pose, 'Rotation', toQuat, 'Input');
  wire(toQuat, 'Output', inverse, 'Input');
  wire(inverse, 'Output', localAim, 'Rotation');
  wire(aim, 'Direction', localAim, 'Vector');
  wire(localAim, 'Output', localParts, 'Input');
  wire(localParts, 'Y', remapped, 'X');
  wire(localParts, 'Z', remapped, 'Y');
  wire(localParts, 'X', remapped, 'Z');
  wire(remapped, 'Output', aimRotation, 'Direction');
  wire(aimRotation, 'Output', aimAngles, 'Input');

  // YAW: wrap the local error to -180..180, invert it for this bearing's
  // mechanical orientation, then retain the original -90..90 travel limits.
  const yawShift = gate('Expr_MathAdd', [-95, 25, 2], {
    InputA: N(0), InputB: N(180),
  }, COLORS.yaw);
  const yawModulo = gate('Expr_MathModuloFloored', [-85, 25, 2], {
    InputA: N(0), InputB: N(360),
  }, COLORS.yaw);
  const yawCentered = gate('Expr_MathSubtract', [-75, 25, 2], {
    InputA: N(0), InputB: N(180),
  }, COLORS.yaw);
  const yawTarget = gate('Expr_MathSubtract', [-65, 25, 2], {
    InputA: N(-6), InputB: N(0),
  }, COLORS.yaw);
  const yawClamp = gate('Expr_MathClamp', [-55, 25, 2], {
    Input: N(-6), Min: N(-90), Max: N(90),
  }, COLORS.yaw);

  wire(aimAngles, 'Yaw', yawShift, 'InputA');
  wire(yawShift, 'Output', yawModulo, 'InputA');
  wire(yawModulo, 'Output', yawCentered, 'InputA');
  wire(yawBearing, 'CurrentAngle', yawTarget, 'InputA');
  wire(yawCentered, 'Output', yawTarget, 'InputB');
  wire(yawTarget, 'Output', yawClamp, 'Input');

  // PITCH: this hinge's positive angle raises the barrels. Preserve the
  // original -25..45 travel limits.
  const pitchTarget = gate('Expr_MathAdd', [-25, 25, 2], {
    InputA: N(7), InputB: N(0),
  }, COLORS.pitch);
  const pitchClamp = gate('Expr_MathClamp', [-15, 25, 2], {
    Input: N(7), Min: N(-25), Max: N(45),
  }, COLORS.pitch);
  wire(pitchBearing, 'CurrentAngle', pitchTarget, 'InputA');
  wire(aimAngles, 'Pitch', pitchTarget, 'InputB');
  wire(pitchTarget, 'Output', pitchClamp, 'Input');

  // Latch both targets only after the fresh pose and aim outputs have settled.
  // The retained Vars continue to be the sole TargetAngle drivers.
  const yawSet = gate('Exec_Var_Set', [-55, -15, 2], {Value: N(-6)}, COLORS.output);
  const pitchSet = gate('Exec_Var_Set', [-45, -15, 2], {Value: N(7)}, COLORS.output);
  wire(yawVar, 'VarRef', yawSet, 'VarRef');
  wire(yawClamp, 'Output', yawSet, 'Value');
  wire(stillOccupied, 'ExecOutA', yawSet, 'Exec');
  wire(pitchVar, 'VarRef', pitchSet, 'VarRef');
  wire(pitchClamp, 'Output', pitchSet, 'Value');
  wire(yawSet, 'ExecOut', pitchSet, 'Exec');

  // The left mouse routes, barrel motor, selector, projectile timing, sounds,
  // two bearing smoothing settings, and all three physical joints are retained.
  assert.equal(scene.edges.filter(edge => edge.a === splitter.key
    && edge.at === C.InputSplitter.NAME && edge.p === 'bPressedLeftMouse').length, 2,
  'Both existing left-mouse routes are retained');
  assert.equal(scene.edges.filter(edge => edge.zt === C.RigidBearing.NAME
    && edge.q === 'TargetAngle').length, 2, 'One target driver per aiming bearing');

  const metadata = {
    name: 'Mouse Aimed Minigun',
    description: 'Seat-only camera-aimed eight-barrel minigun. Existing left-click fire, barrel sequencing, sounds and smooth bearing limits are preserved.',
    owner: owner(scene),
  };
  const generated = write(scene, {
    assets: scene.r.externalAssets(),
    embedded: scene.r.prefabPaths().map(prefabPath => scene.r.readPrefab(prefabPath)),
    ...metadata,
  }).bytes;
  const bytes = repack(generated, donor, metadata);
  const placement = validatePlacement(bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));

  return {
    bytes,
    scene,
    original,
    placement,
    aimGrid,
    gunGrid,
    created,
    summary: {
      bricks: scene.bricks.length,
      wires: scene.edges.length,
      removedWASDGates: removed.size,
      addedAimGates: created.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  if (!DEFAULT_INPUT) {
    throw new Error('Usage: node build-mouse-aimed-minigun.cjs input.brz [output.brz]');
  }
  const result = build(DEFAULT_INPUT);
  fs.mkdirSync(path.dirname(DEFAULT_OUTPUT), {recursive: true});
  fs.writeFileSync(DEFAULT_OUTPUT, result.bytes);
  console.log(JSON.stringify({
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    bytes: result.bytes.length,
    strictPlacement: result.placement.strictOk,
    ...result.summary,
  }, null, 2));
}

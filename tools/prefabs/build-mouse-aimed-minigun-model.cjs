'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {brdb} = require('brs-js');
const {read, write} = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const validatePlacement = require('./validate-placement.cjs');
const nativeBounds = require('./native-brick-half-extents.json');
const {C, N} = require('./loadboard-lib.cjs');

const CLI_INPUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
const CLI_OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/mouse-aimed-minigun-model-spacebar.brz'));

const COLORS = {
  input: [85, 155, 225],
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

function halfSize(brick) {
  if (brick.data.size?.some(number => number > 0)) return brick.data.size;
  return nativeBounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : [5, 5, 2]);
}

function fitMicrochip(scene, grid) {
  const entity = one([...scene.r.entities()].filter(saved => saved.persistentIndex === grid),
    `microchip entity ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const low = [0, 1].map(axis => Math.floor(Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis]))));
  const high = [0, 1].map(axis => Math.ceil(Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis]))));
  for (let axis = 0; axis < 2; axis++) if ((low[axis] + high[axis]) % 2) high[axis]++;
  const copy = structuredClone(entity);
  copy.data = structuredClone(entity.data);
  copy.data.bCollapsed = true;
  copy.data.PlaneCenter = {
    X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2,
    Z: 0,
  };
  copy.data.PlaneExtent = {
    X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10,
    Z: 0,
  };
  scene.entityOverrides.set(grid, copy);
}

function overlapSignatures(result) {
  return result.uncertainPairs.map(pair => {
    const ends = [
      `${pair.aAsset}@${pair.aPosition.join(',')}`,
      `${pair.zAsset}@${pair.zPosition.join(',')}`,
    ].sort();
    return ends.join('|');
  }).sort();
}

function build(input = CLI_INPUT) {
  assert(input, 'Input Minigun Model .brz path is required');
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const original = read(donor);
  scene.entityOverrides = new Map();
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = type => scene.bricks.flatMap(brick => brick.comps
    .filter(saved => saved.type === type)
    .map(saved => ({brick, saved, node: {key: brick.key, type}})));

  const seatRow = one(rows(C.Seat.NAME), 'gunner seat');
  const seat = {key: seatRow.brick.key, type: C.Seat.NAME};
  const gunGrid = seatRow.brick.g;
  const motorRow = one(rows(C.Motor.NAME), 'barrel motor');
  const motor = {key: motorRow.brick.key, type: C.Motor.NAME};
  const motorEnable = one(scene.edges.filter(edge => edge.z === motor.key
    && edge.zt === motor.type && edge.q === 'bEnabled'), 'existing fire-enable route');
  assert.equal(motorEnable.at, C.MicrochipInput.NAME);
  assert.equal(motorEnable.p, 'RER_Output');
  const fireInput = {key: motorEnable.a, type: C.MicrochipInput.NAME};
  const aimGrid = bricks.get(fireInput.key).g;
  const mainLink = one(scene.links.filter(link => link.grid === aimGrid), 'main logic chip link');
  assert.equal(bricks.get(mainLink.key).g, gunGrid, 'Main logic chip must be mounted on gun grid');

  const bearingRows = rows(C.RigidBearing.NAME);
  assert.equal(bearingRows.length, 3, 'Yaw, pitch and seat-mechanism bearings');
  const jointByKey = new Map(scene.joints.map(joint => [joint.key, joint]));
  const yawRow = one(bearingRows.filter(row => row.brick.g === 1), 'base yaw bearing');
  const yawJoint = jointByKey.get(yawRow.brick.key);
  assert(yawJoint, 'Yaw joint');
  const yawCarrierGrid = yawJoint.entity;
  const pitchRow = one(bearingRows.filter(row => row.brick.g === yawJoint.entity
    && jointByKey.get(row.brick.key)?.entity === gunGrid), 'gun pitch bearing');
  const mechanismRow = one(bearingRows.filter(row => row !== yawRow && row !== pitchRow),
    'seat-mechanism bearing');
  const yawBearing = {key: yawRow.brick.key, type: C.RigidBearing.NAME};
  const pitchBearing = {key: pitchRow.brick.key, type: C.RigidBearing.NAME};
  assert.equal(scene.edges.filter(edge => edge.z === yawBearing.key
    && edge.zt === yawBearing.type && edge.q === 'TargetAngle').length, 0,
  'Yaw bearing starts undriven');
  assert.equal(scene.edges.filter(edge => edge.z === pitchBearing.key
    && edge.zt === pitchBearing.type && edge.q === 'TargetAngle').length, 0,
  'Pitch bearing starts undriven');
  assert.equal(scene.edges.filter(edge => edge.z === mechanismRow.brick.key
    && edge.zt === C.RigidBearing.NAME && edge.q === 'TargetAngle').length, 1,
  'Seat-mechanism bearing retains its occupancy animation');

  const gateBase = structuredClone(scene.bricks.find(brick => brick.g === aimGrid
    && brick.data.asset.startsWith('B_1x1_Gate_')).data);
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
      key: `mouse-model:${String(serial++).padStart(2, '0')}:${kind}`,
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

  // Read the yaw carrier before the pitch hinge. This gives an exact local
  // yaw error and absolute pitch target without cross-axis coupling. Placing
  // the hidden reader above the carrier keeps it inside the donor's bounds.
  const readAimFrame = gate('ReadBrickGrid', [0, 0, 30], {}, COLORS.transform,
    yawCarrierGrid, {
      visibility: false,
      collision: {player: false, weapon: false, interaction: false, tool: true, physics: false},
    });

  // SEAT INPUT: InputUp is Space/Ctrl. The positive threshold accepts Space
  // and explicitly rejects Ctrl, then feeds the existing fire-enable port.
  const splitter = gate('InputSplitter', [55, -135, 2], {}, COLORS.input);
  const spacePressed = gate('Expr_CompareGreater', [65, -135, 2], {
    InputA: N(0), InputB: N(0.5),
  }, COLORS.input);
  const occupiedAndSpace = gate('Expr_LogicalAND', [75, -135, 2], {
    bInputA: false, bInputB: false,
  }, COLORS.input);
  wire(seat, 'SittingCharacter', splitter, 'Character');
  wire(splitter, 'InputUp', spacePressed, 'InputA');
  wire(spacePressed, 'bOutput', occupiedAndSpace, 'bInputA');
  wire(seat, 'bIsOccupied', occupiedAndSpace, 'bInputB');
  wire(occupiedAndSpace, 'bOutput', fireInput, 'RER_Input');

  // EXECUTION: poll camera aim at 40 Hz only while occupied, and re-check the
  // seat after the one-tick data-settling buffer before writing either target.
  const clock = gate('Clock', [55, -115, 2], {
    bEnabled: false,
    bPulseOn: false,
    OnTimeSeconds: 1,
    OffTimeSeconds: 1,
    IntervalSeconds: 0.025,
  }, COLORS.timing);
  const pose = gate('Exec_Entity_GetLocationRotation', [65, -115, 2], {
    Vector: {X: 0, Y: 0, Z: 0},
    Rotation: {Pitch: 0, Yaw: 0, Roll: 0},
  }, COLORS.sensing);
  const aim = gate('Exec_Character_GetAim', [75, -115, 2], {
    Origin: {X: 0, Y: 0, Z: 0},
    Direction: {X: 1, Y: 0, Z: 0},
    bLocalAim: false,
  }, COLORS.sensing);
  const settled = gate('BufferTicks', [85, -115, 2], {
    TicksToWait: 1,
    ZeroTicksToWait: 0,
  }, COLORS.timing);
  const stillOccupied = gate('Exec_Branch', [95, -115, 2], {
    bCond: false,
  }, COLORS.timing);
  wire(seat, 'bIsOccupied', clock, 'bEnabled');
  wire(clock, 'Pulse', pose, 'Exec');
  wire(readAimFrame, 'BrickGrid', pose, 'Entity');
  wire(pose, 'ExecOut', aim, 'Exec');
  wire(seat, 'SittingCharacter', aim, 'Character');
  wire(aim, 'ExecOut', settled, 'Input');
  wire(settled, 'Output', stillOccupied, 'Exec');
  wire(seat, 'bIsOccupied', stillOccupied, 'bCond');

  // COORDINATE CONVERSION: in the yaw-carrier frame this model points down
  // local -Y, with local +X right and +Z up. Remap to conventional axes.
  const toQuat = gate('Expr_Convert', [55, -95, 2], {
    Input: {$variant: 'Rotator', value: {Pitch: 0, Yaw: 0, Roll: 0}},
    TargetType: {$variant: 'Quat', value: {X: 0, Y: 0, Z: 0, W: 0}},
  });
  const inverse = gate('Expr_InvertRotation', [65, -95, 2], {
    Input: {X: 0, Y: 0, Z: 0, W: 1},
  });
  const localAim = gate('Expr_RotateVector', [75, -95, 2], {
    Rotation: {X: 0, Y: 0, Z: 0, W: 1},
    Vector: {X: 1, Y: 0, Z: 0},
  });
  const localParts = gate('Expr_SplitVector', [85, -95, 2], {
    Input: {X: 1, Y: 0, Z: 0},
  });
  const forward = gate('Expr_MathNegate', [95, -95, 2], {
    Input: N(-1),
  });
  const remapped = gate('Expr_MakeVector', [105, -95, 2], {
    X: N(1), Y: N(0), Z: N(0),
  });
  const aimRotation = gate('Expr_DirectionToRotation', [115, -95, 2], {
    Direction: {X: 1, Y: 0, Z: 0},
  });
  const aimAngles = gate('Expr_SplitRotation', [125, -95, 2], {
    Input: {Pitch: 0, Yaw: 0, Roll: 0},
  });
  wire(pose, 'Rotation', toQuat, 'Input');
  wire(toQuat, 'Output', inverse, 'Input');
  wire(inverse, 'Output', localAim, 'Rotation');
  wire(aim, 'Direction', localAim, 'Vector');
  wire(localAim, 'Output', localParts, 'Input');
  wire(localParts, 'Y', forward, 'Input');
  wire(forward, 'Output', remapped, 'X');
  wire(localParts, 'X', remapped, 'Y');
  wire(localParts, 'Z', remapped, 'Z');
  wire(remapped, 'Output', aimRotation, 'Direction');
  wire(aimRotation, 'Output', aimAngles, 'Input');

  // YAW: this base bearing turns opposite its numeric angle. Wrap the local
  // error and preserve the earlier minigun's -90..90 horizontal travel.
  const yawShift = gate('Expr_MathAdd', [55, -75, 2], {
    InputA: N(0), InputB: N(180),
  }, COLORS.yaw);
  const yawModulo = gate('Expr_MathModuloFloored', [65, -75, 2], {
    InputA: N(0), InputB: N(360),
  }, COLORS.yaw);
  const yawCentered = gate('Expr_MathSubtract', [75, -75, 2], {
    InputA: N(0), InputB: N(180),
  }, COLORS.yaw);
  const yawTarget = gate('Expr_MathSubtract', [85, -75, 2], {
    InputA: N(0), InputB: N(0),
  }, COLORS.yaw);
  const yawClamp = gate('Expr_MathClamp', [95, -75, 2], {
    Input: N(0), Min: N(-90), Max: N(90),
  }, COLORS.yaw);
  wire(aimAngles, 'Yaw', yawShift, 'InputA');
  wire(yawShift, 'Output', yawModulo, 'InputA');
  wire(yawModulo, 'Output', yawCentered, 'InputA');
  wire(yawBearing, 'CurrentAngle', yawTarget, 'InputA');
  wire(yawCentered, 'Output', yawTarget, 'InputB');
  wire(yawTarget, 'Output', yawClamp, 'Input');

  // PITCH: the yaw-carrier frame reports exact absolute elevation. This
  // hinge's positive angle raises the gun, so clamp that angle directly.
  const pitchClamp = gate('Expr_MathClamp', [95, -55, 2], {
    Input: N(0), Min: N(-25), Max: N(45),
  }, COLORS.pitch);
  wire(aimAngles, 'Pitch', pitchClamp, 'Input');

  // LATCHED TARGETS: variables remain the sole physical TargetAngle drivers.
  const yawVar = gate('Var', [55, -35, 2], {Value: N(0)}, COLORS.output);
  const pitchVar = gate('Var', [65, -35, 2], {Value: N(0)}, COLORS.output);
  const yawSet = gate('Exec_Var_Set', [75, -35, 2], {Value: N(0)}, COLORS.output);
  const pitchSet = gate('Exec_Var_Set', [85, -35, 2], {Value: N(0)}, COLORS.output);
  wire(yawVar, 'VarRef', yawSet, 'VarRef');
  wire(yawClamp, 'Output', yawSet, 'Value');
  wire(stillOccupied, 'ExecOutA', yawSet, 'Exec');
  wire(pitchVar, 'VarRef', pitchSet, 'VarRef');
  wire(pitchClamp, 'Output', pitchSet, 'Value');
  wire(yawSet, 'ExecOut', pitchSet, 'Exec');
  wire(yawVar, 'Value', yawBearing, 'TargetAngle');
  wire(pitchVar, 'Value', pitchBearing, 'TargetAngle');

  fitMicrochip(scene, aimGrid);
  const metadata = {
    name: 'Mouse Aimed Minigun Model - Spacebar Fire',
    description: 'Seat-only camera-aimed minigun model. Hold Space to spin and fire; the original eight-barrel sequencer, audio and seat mechanism are preserved.',
    owner: owner(scene),
  };
  const generated = write(scene, {
    assets: scene.r.externalAssets(),
    embedded: scene.r.prefabPaths().map(prefabPath => scene.r.readPrefab(prefabPath)),
    ...metadata,
  }).bytes;
  const bytes = repack(generated, donor, metadata);
  const donorPlacement = validatePlacement(donor);
  const placement = validatePlacement(bytes);
  assert(placement.ok, JSON.stringify(placement, null, 2));
  assert.deepEqual(overlapSignatures(placement), overlapSignatures(donorPlacement),
    'Conversion must not add placement overlaps to the supplied model');

  return {
    bytes,
    scene,
    original,
    placement,
    donorPlacement,
    aimGrid,
    gunGrid,
    yawCarrierGrid,
    created,
    summary: {
      bricks: scene.bricks.length,
      wires: scene.edges.length,
      addedControllerGates: created.length,
      preexistingUncertainOverlaps: placement.uncertainPairs.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  if (!CLI_INPUT) {
    throw new Error('Usage: node build-mouse-aimed-minigun-model.cjs input.brz [output.brz]');
  }
  const result = build(CLI_INPUT);
  fs.mkdirSync(path.dirname(CLI_OUTPUT), {recursive: true});
  fs.writeFileSync(CLI_OUTPUT, result.bytes);
  console.log(JSON.stringify({
    input: CLI_INPUT,
    output: CLI_OUTPUT,
    bytes: result.bytes.length,
    placementOk: result.placement.ok,
    ...result.summary,
  }, null, 2));
}

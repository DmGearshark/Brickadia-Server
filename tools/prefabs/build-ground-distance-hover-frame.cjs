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

const INPUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/hover-frame-wasd-ground-controller.brz'));

const COLORS = {
  sensing: [70, 150, 220],
  state: [85, 145, 205],
  proportional: [75, 185, 105],
  damping: [175, 105, 220],
  output: [230, 85, 115],
  movement: [55, 175, 215],
  movementState: [235, 145, 45],
  drivePod: [45, 125, 175],
  turnPod: [225, 120, 45],
  label: [18, 24, 32],
  gyro: [165, 95, 220],
  switch: [235, 145, 45],
};

function one(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}

function selectedOwner(scene) {
  const owners = scene.r.owners();
  const bundle = scene.r.bundle();
  const authorIds = (bundle.authors || [])
    .map(author => (author.iD || author.id || '').toLowerCase())
    .filter(Boolean);
  const ids = owners.UserIds.map(id => brdb.guidToUuid(id).toLowerCase());
  let index = ids.findIndex(id => authorIds.includes(id));
  if (index < 0) index = owners.UserNames.findIndex(name => name === 'Gearshark');
  if (index < 0) index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'A non-PUBLIC owner is required');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return nativeBounds.assets[brick.data.asset] || [5, 5, 2];
}

function fitMicrochip(scene, grid) {
  const entity = one([...scene.r.entities()]
    .filter(saved => saved.persistentIndex === grid), `microchip entity ${grid}`);
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

function overlapSignatures(report) {
  return report.uncertainPairs.map(pair => [
    `${pair.aAsset}@${pair.aPosition.join(',')}`,
    `${pair.zAsset}@${pair.zPosition.join(',')}`,
  ].sort().join('|')).sort();
}

function build(input = INPUT) {
  assert(input, 'Input Hover Frame .brz path is required');
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const original = read(donor);
  scene.entityOverrides = new Map();

  const rows = type => scene.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({brick, component})));
  const engineRow = one(rows(C.WheelEngine.NAME), 'vehicle engine');
  const seatRow = one(rows(C.Seat.NAME), 'seat');
  const thrusterRows = rows(C.Thruster.NAME);
  assert.equal(thrusterRows.length, 2, 'Expected the supplied pair of thrusters');
  const chipShell = one(rows(C.Microchip.NAME), 'microchip shell');
  const mainGrid = engineRow.brick.g;
  const chipLink = one(scene.links.filter(link => link.key === chipShell.brick.key),
    'microchip link');
  const chipGrid = chipLink.grid;
  assert.equal(scene.bricks.filter(brick => brick.g === chipGrid).length, 0,
    'The supplied controller microchip must start empty');

  const engine = {key: engineRow.brick.key, type: C.WheelEngine.NAME};
  const seat = {key: seatRow.brick.key, type: C.Seat.NAME};
  const thrusters = thrusterRows.map(row => ({
    key: row.brick.key,
    type: C.Thruster.NAME,
  }));

  // Keep the native B_2x2_Thruster orientation from the supplied frame. The
  // user verified in game that 5 / 1 points this native asset downward and
  // that the frame needs 50,000 force per lift thruster. A Thruster component
  // attached to a procedural brick has a different canonical axis, so the
  // donor module's host-brick orientation must not be copied onto this asset.
  for (const row of thrusterRows) {
    Object.assign(row.brick.data, {direction: 5, rotation: 1});
    Object.assign(row.component.data, {
      bEnabled: true,
      bDiscoverable: false,
      Force: 50000,
      ForceApplication: 0,
      Throttle: 0,
      Pitch: 0,
      Yaw: 0,
    });
  }

  // The reference hover controller is the sole lift authority. Disable the
  // unproven Vehicle Engine auto-hover path and remove both competing control
  // bus wires. The engine remains physically available for a later movement
  // pass after stationary hover is verified.
  Object.assign(engineRow.component.data, {
    bEnabled: false,
    bAutodiscoverWheels: false,
    bAutodiscoverThrusters: false,
    bAutodiscoverGyroscopes: false,
    bAutodiscoverAerodynamicSurfaces: false,
  });
  const oldBusEdges = scene.edges.filter(edge => edge.a === engine.key
    && edge.at === engine.type && edge.p === 'Control_DriveAndSteer'
    && edge.zt === C.Thruster.NAME && edge.q === 'Control_DriveAndSteer');
  assert.equal(oldBusEdges.length, 2, 'Expected two original engine-to-thruster wires');
  const oldBusSet = new Set(oldBusEdges);
  scene.edges = scene.edges.filter(edge => !oldBusSet.has(edge));
  seatRow.component.data.PromptCustomLabel = 'Pilot Hover Frame — W/S Drive, A/D Turn';

  let serial = 0;
  const created = [];
  function brickData(asset, position, color, options = {}) {
    return {
      asset,
      size: options.size || [0, 0, 0],
      position,
      direction: options.direction ?? 4,
      rotation: options.rotation ?? 0,
      collision: options.collision || {
        player: true,
        weapon: true,
        interaction: true,
        tool: true,
        physics: true,
      },
      visibility: options.visibility ?? true,
      material_intensity: options.materialIntensity ?? 0,
      color,
      owner_index: 0,
      material: options.material || 'BMC_Plastic',
    };
  }
  function textData(text, textColor = {R: 235, G: 245, B: 255, A: 255}) {
    return {
      Text: text,
      Font: 0,
      Rotation: 0,
      Skew: 0,
      Kerning: 0,
      LineHeight: 1,
      WidthScale: 0.65,
      LineOffset: 0,
      Anchor: {X: 0.5, Y: 0.5},
      Offset: {X: 0, Y: 0, Z: 0},
      Color: textColor,
      MaterialSlider: 0,
      ShadingWidth: 0,
      OutlineColor: {R: 0, G: 0, B: 0, A: 255},
      OutlineWidth: 0,
      ScuffWidth: 0,
      GraffitiDepthLimit: 0,
      GraffitiAngleLimit: 0,
      GraffitiLayer: 0,
      bEnabled: true,
      Face: 4,
      bAlignToWedge: false,
      bOverrideColor: true,
      Typeface: 0,
      Billboard: 0,
      Material: 0,
      Shading: 0,
      bFlipShading: false,
      Outline: 0,
      bSharpCorners: false,
      bSharpOutlines: false,
      bOverrideOutlineColor: false,
      bForeground: false,
    };
  }
  function addComponent(kind, grid, position, data, color, options = {}) {
    const definition = C[kind];
    assert(definition?.BRICK, `Unknown physical/gate component ${kind}`);
    const components = [{type: definition.NAME, data: structuredClone(data)}];
    if (options.label) components.push({
      type: C.TextDisplay.NAME,
      data: textData(options.label, options.labelColor),
    });
    const brick = {
      key: `ground-hover:${String(serial++).padStart(2, '0')}:${kind}`,
      g: grid,
      data: brickData(definition.BRICK, position, color, options),
      comps: components,
    };
    scene.bricks.push(brick);
    const node = {key: brick.key, type: definition.NAME, kind, brick};
    created.push(node);
    return node;
  }
  function addThrusterPod(role, position, direction, rotation,
    forceApplication, force, color) {
    const component = {
      type: C.Thruster.NAME,
      data: {
        bEnabled: true,
        bDiscoverable: false,
        Force: force,
        ForceApplication: forceApplication,
        Throttle: 0,
        Control_DriveAndSteer: {},
        Pitch: 0,
        Yaw: 0,
        bSpawnLight: false,
      },
    };
    const brick = {
      key: `ground-hover:${String(serial++).padStart(2, '0')}:pod:${role}`,
      g: mainGrid,
      data: brickData('PB_DefaultBrick', position, color, {
        size: [5, 5, 2], direction, rotation, materialIntensity: 2,
      }),
      comps: [component],
    };
    scene.bricks.push(brick);
    const node = {
      key: brick.key,
      type: C.Thruster.NAME,
      kind: `MovementThruster:${role}`,
      role,
      brick,
    };
    created.push(node);
    return node;
  }
  function addText(position, size, text, textColor) {
    const brick = {
      key: `ground-hover:${String(serial++).padStart(2, '0')}:Text`,
      g: chipGrid,
      data: brickData('PB_DefaultTile', position, COLORS.label, {size}),
      comps: [{type: C.TextDisplay.NAME, data: textData(text, textColor)}],
    };
    scene.bricks.push(brick);
    return brick;
  }
  function wire(source, sourcePort, target, targetPort) {
    const sourceDefinition = Object.values(C)
      .find(definition => definition.NAME === source.type);
    const targetDefinition = Object.values(C)
      .find(definition => definition.NAME === target.type);
    assert(sourceDefinition?.PORTS[sourcePort], `${source.type}.${sourcePort}`);
    assert(targetDefinition?.PORTS[targetPort], `${target.type}.${targetPort}`);
    assert(!scene.edges.some(edge => edge.z === target.key
      && edge.zt === target.type && edge.q === targetPort),
    `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: source.type, p: sourcePort,
      z: target.key, zt: target.type, q: targetPort,
    });
  }

  const gyro = addComponent('Gyroscope', mainGrid, [-10, 5, -8], {
    bEnabled: true,
    bDiscoverable: false,
    Strength: 50,
    Damping: 1,
    MaxForce: 0,
    TargetAxis: {X: 0, Y: 0, Z: 1},
    Control_DriveAndSteer: {},
  }, COLORS.gyro, {materialIntensity: 5});
  const hoverSwitch = addComponent('AnimatedSwitch', mainGrid, [25, -5, 9], {
    bEnabled: true,
    InteractSound: 0,
    bAllowNearbyInteraction: true,
    bHiddenInteraction: false,
    PromptCustomLabel: 'Toggle Hover',
  }, COLORS.switch);
  wire(hoverSwitch, 'bEnabled', gyro, 'bEnabled');
  for (const thruster of thrusters) wire(hoverSwitch, 'bEnabled', thruster, 'bEnabled');

  // The first in-game movement test proved that direction 4 makes a Thruster
  // component on PB_DefaultBrick act vertically: W/S bounced and the offset
  // A/D pairs rolled the frame. Directions 0/1 put the drive pair on the X
  // axis, while 2/3 put the steering pairs on Y. A second in-game test proved
  // that procedural thrusters push opposite their host normal: direction 1 is
  // physical +X (forward here), while direction 0 is physical -X (reverse).
  // Native and procedural hosts therefore cannot share orientation rules.
  // Drive applies at center of mass. Opposed AtThruster steering forces cancel
  // lateral translation and add into a pure yaw moment.
  const forwardDrive = addThrusterPod('forward', [-57, 5, 0], 1, 0,
    0, 15000, COLORS.drivePod);
  const reverseDrive = addThrusterPod('reverse', [37, 5, 0], 0, 0,
    0, 15000, COLORS.drivePod);
  const leftFront = addThrusterPod('left-front', [40, -15, 0], 2, 0,
    1, 5000, COLORS.turnPod);
  const leftRear = addThrusterPod('left-rear', [-60, -15, 0], 3, 0,
    1, 5000, COLORS.turnPod);
  const rightFront = addThrusterPod('right-front', [40, 25, 0], 3, 0,
    1, 5000, COLORS.turnPod);
  const rightRear = addThrusterPod('right-rear', [-60, 25, 0], 2, 0,
    1, 5000, COLORS.turnPod);
  const movementThrusters = [
    forwardDrive, reverseDrive,
    leftFront, leftRear, rightFront, rightRear,
  ];
  for (const thruster of movementThrusters) {
    wire(hoverSwitch, 'bEnabled', thruster, 'bEnabled');
  }

  addText([0, 85, 2], [55, 10, 2],
    'GROUND-DISTANCE HOVER CONTROLLER', {R: 110, G: 210, B: 255, A: 255});
  addText([-25, 70, 2], [25, 5, 2], 'EDITABLE STATE');
  const updateRate = addComponent('Var', chipGrid, [-30, 60, 2], {
    Value: N(0.01),
  }, COLORS.state, {label: 'UPDATE\nRATE'});
  const setpoint = addComponent('Var', chipGrid, [-20, 60, 2], {
    Value: N(40),
  }, COLORS.state, {label: 'HOVER\nHEIGHT'});
  const previousDistance = addComponent('Var', chipGrid, [-10, 60, 2], {
    Value: N(40),
  }, COLORS.state, {label: 'PREVIOUS\nDISTANCE'});

  addText([-20, 45, 2], [30, 5, 2], '100 Hz GROUND SAMPLE + STORE');
  const clock = addComponent('Clock', chipGrid, [-33, 35, 2], {
    bEnabled: true,
    bPulseOn: false,
    OnTimeSeconds: 1,
    OffTimeSeconds: 1,
    IntervalSeconds: 0.01,
  }, COLORS.sensing);
  const sweep = addComponent('Exec_Sweep', chipGrid, [-20, 35, 2], {
    Origin: {X: 0, Y: 0, Z: 0},
    Direction: {X: 0, Y: 0, Z: -1},
    Distance: 100,
    Radius: 0,
    bRelative: true,
    bIgnoreOwningGrid: true,
    CollisionChannel: 0,
    bDetectBricks: true,
    bDetectPlayers1: true,
    bDetectPlayers2: true,
    bDetectPlayers3: true,
    bDetectPlayers4: true,
    bOnlyHitPlayerBodyParts: false,
    bDetectPhysics: true,
    bDetectMap: true,
    HitLocation: {X: 0, Y: 0, Z: 0},
    HitNormal: {X: 0, Y: 0, Z: 1},
    HitDistance: 40,
    HitBrick: {
      GridPersistentIndex: 0,
      ChunkIndex: {X: 0, Y: 0, Z: 0},
      BrickIndexInChunk: 4294967295,
    },
    HitColor: {R: 0, G: 0, B: 0, A: 1},
  }, COLORS.sensing);
  const previousGet = addComponent('Exec_Var_Get', chipGrid, [-7, 35, 2], {
    Value: N(40),
  }, COLORS.sensing);
  const previousSet = addComponent('Exec_Var_Set', chipGrid, [3, 35, 2], {
    bChangeType: false,
    Value: N(40),
  }, COLORS.sensing);
  wire(updateRate, 'Value', clock, 'IntervalSeconds');
  wire(clock, 'Pulse', sweep, 'Exec');
  wire(sweep, 'ExecOut', previousGet, 'Exec');
  wire(previousDistance, 'VarRef', previousGet, 'VarRef');
  wire(previousGet, 'ExecOut', previousSet, 'Exec');
  wire(previousDistance, 'VarRef', previousSet, 'VarRef');
  wire(sweep, 'HitDistance', previousSet, 'Value');

  addText([-25, 20, 2], [20, 5, 2], 'HEIGHT ERROR / LIFT');
  const heightError = addComponent('Expr_MathSubtract', chipGrid, [-30, 10, 2], {
    InputA: N(40), InputB: N(40),
  }, COLORS.proportional, {label: 'HEIGHT\nERROR'});
  const proportional = addComponent('Expr_Remap', chipGrid, [-19, 10, 2], {
    Value: 0,
    InputMin: 10,
    InputMax: -10,
    OutputMin: 0,
    OutputMax: 1,
    Function: 0,
    Direction: 0,
  }, COLORS.proportional);
  const proportionalClamp = addComponent('Expr_MathClamp', chipGrid, [-8, 10, 2], {
    Input: N(0.5), Min: N(0), Max: N(1),
  }, COLORS.proportional);
  wire(sweep, 'HitDistance', heightError, 'InputA');
  wire(setpoint, 'Value', heightError, 'InputB');
  wire(heightError, 'Output', proportional, 'Value');
  wire(proportional, 'Output', proportionalClamp, 'Input');

  addText([20, 20, 2], [25, 5, 2], 'UPWARD VELOCITY DAMPING');
  const distanceDelta = addComponent('Expr_MathSubtract', chipGrid, [5, 10, 2], {
    InputA: N(40), InputB: N(40),
  }, COLORS.damping);
  const velocity = addComponent('Expr_MathDivide', chipGrid, [15, 10, 2], {
    InputA: N(0), InputB: N(0.01),
  }, COLORS.damping, {label: 'VERTICAL\nSPEED'});
  const damping = addComponent('Expr_Remap', chipGrid, [26, 10, 2], {
    Value: 0,
    InputMin: 0,
    InputMax: 100,
    OutputMin: 0,
    OutputMax: -1,
    Function: 0,
    Direction: 0,
  }, COLORS.damping);
  const dampingClamp = addComponent('Expr_MathClamp', chipGrid, [37, 10, 2], {
    Input: N(0), Min: N(-1), Max: N(0),
  }, COLORS.damping);
  wire(sweep, 'HitDistance', distanceDelta, 'InputA');
  wire(previousGet, 'Value', distanceDelta, 'InputB');
  wire(distanceDelta, 'Output', velocity, 'InputA');
  wire(updateRate, 'Value', velocity, 'InputB');
  wire(velocity, 'Output', damping, 'Value');
  wire(damping, 'Output', dampingClamp, 'Input');

  addText([0, -5, 2], [20, 5, 2], 'FINAL THROTTLE');
  const combine = addComponent('Expr_MathAdd', chipGrid, [-10, -15, 2], {
    InputA: N(0), InputB: N(0.5),
  }, COLORS.output);
  const finalClamp = addComponent('Expr_MathClamp', chipGrid, [0, -15, 2], {
    Input: N(0.5), Min: N(0), Max: N(1),
  }, COLORS.output, {label: 'THROTTLE'});
  const throttle = addComponent('Rerouter', chipGrid, [6, -15, 1], {}, COLORS.output);
  wire(dampingClamp, 'Output', combine, 'InputA');
  wire(proportionalClamp, 'Output', combine, 'InputB');
  wire(combine, 'Output', finalClamp, 'Input');
  wire(finalClamp, 'Output', throttle, 'RER_Input');
  for (const thruster of thrusters) wire(throttle, 'RER_Output', thruster, 'Throttle');

  addText([0, -55, 2], [55, 5, 2], 'SEAT-CONTROLLED MOVEMENT');
  const splitter = addComponent('InputSplitter', chipGrid, [-33, -70, 2], {},
    COLORS.movement, {label: 'SEAT\nINPUT'});
  const forwardThrottle = addComponent('Expr_MathClamp', chipGrid, [-22, -70, 2], {
    Input: N(0), Min: N(0), Max: N(1),
  }, COLORS.movement, {label: 'W\nFORWARD'});
  const reverseNegate = addComponent('Expr_MathNegate', chipGrid, [-11, -70, 2], {
    Input: N(0),
  }, COLORS.movement);
  const reverseThrottle = addComponent('Expr_MathClamp', chipGrid, [0, -70, 2], {
    Input: N(0), Min: N(0), Max: N(1),
  }, COLORS.movement, {label: 'S\nREVERSE'});
  const rightThrottle = addComponent('Expr_MathClamp', chipGrid, [11, -70, 2], {
    Input: N(0), Min: N(0), Max: N(1),
  }, COLORS.movement, {label: 'D\nRIGHT'});
  const leftNegate = addComponent('Expr_MathNegate', chipGrid, [22, -70, 2], {
    Input: N(0),
  }, COLORS.movement);
  const leftThrottle = addComponent('Expr_MathClamp', chipGrid, [33, -70, 2], {
    Input: N(0), Min: N(0), Max: N(1),
  }, COLORS.movement, {label: 'A\nLEFT'});
  const driveForce = addComponent('Var', chipGrid, [-15, -85, 2], {
    Value: N(15000),
  }, COLORS.movementState, {label: 'DRIVE\nFORCE'});
  const turnForce = addComponent('Var', chipGrid, [-5, -85, 2], {
    Value: N(5000),
  }, COLORS.movementState, {label: 'TURN\nFORCE'});
  addText([21, -85, 2], [20, 5, 2], 'W/S DRIVE  |  A/D TURN',
    {R: 110, G: 210, B: 255, A: 255});

  wire(seat, 'SittingCharacter', splitter, 'Character');
  wire(splitter, 'InputForward', forwardThrottle, 'Input');
  wire(splitter, 'InputForward', reverseNegate, 'Input');
  wire(reverseNegate, 'Output', reverseThrottle, 'Input');
  wire(splitter, 'InputRight', rightThrottle, 'Input');
  wire(splitter, 'InputRight', leftNegate, 'Input');
  wire(leftNegate, 'Output', leftThrottle, 'Input');
  wire(forwardThrottle, 'Output', forwardDrive, 'Throttle');
  wire(reverseThrottle, 'Output', reverseDrive, 'Throttle');
  for (const thruster of [rightFront, rightRear]) {
    wire(rightThrottle, 'Output', thruster, 'Throttle');
  }
  for (const thruster of [leftFront, leftRear]) {
    wire(leftThrottle, 'Output', thruster, 'Throttle');
  }
  for (const thruster of [forwardDrive, reverseDrive]) {
    wire(driveForce, 'Value', thruster, 'Force');
  }
  for (const thruster of [leftFront, leftRear, rightFront, rightRear]) {
    wire(turnForce, 'Value', thruster, 'Force');
  }

  // Neutral-only horizontal damping. ReadBrickGrid must live on the chassis,
  // not inside the linked controller, so Entity resolves to the moving frame.
  // At 100 Hz this adds -2% of the current world-X/Y velocity per sample while
  // preserving Z exactly. It therefore stops drift without competing with the
  // independently proven height controller.
  const chassisGrid = addComponent('ReadBrickGrid', mainGrid, [-10, 25, 8], {},
    COLORS.movementState, {
      visibility: false,
      collision: {
        player: false,
        weapon: false,
        interaction: false,
        tool: true,
        physics: false,
      },
    });

  addText([0, -105, 2], [55, 5, 2], 'NEUTRAL HORIZONTAL DAMPING',
    {R: 255, G: 190, B: 80, A: 255});
  const velocityGet = addComponent('Exec_Entity_GetLinearVelocity', chipGrid,
    [-40, -120, 2], {
      LinearVelocity: {X: 0, Y: 0, Z: 0},
    }, COLORS.movementState, {label: 'GRID\nVELOCITY'});
  const velocitySplit = addComponent('Expr_SplitVector', chipGrid,
    [-30, -120, 2], {
      Input: {X: 0, Y: 0, Z: 0},
    }, COLORS.movementState, {label: 'SPLIT\nXYZ'});
  const horizontalVector = addComponent('Expr_MakeVector', chipGrid,
    [-20, -120, 2], {
      X: 0,
      Y: 0,
      Z: 0,
    }, COLORS.movementState, {label: 'XY\nONLY'});
  const counterVelocity = addComponent('Expr_VecScale', chipGrid,
    [-10, -120, 2], {
      Input: {X: 0, Y: 0, Z: 0},
      Scalar: -0.02,
    }, COLORS.movementState, {label: 'COUNTER\nVELOCITY'});
  const velocityAdd = addComponent('Exec_Entity_AddVelocity', chipGrid,
    [0, -120, 2], {
      Vector: {X: 0, Y: 0, Z: 0},
      Rotation: {X: 0, Y: 0, Z: 0},
    }, COLORS.movementState, {label: 'APPLY\nDRAG'});
  const dragGain = addComponent('Var', chipGrid, [10, -120, 2], {
    Value: N(-0.02),
  }, COLORS.movementState, {label: 'DRAG\nGAIN'});

  const inputMagnitude = addComponent('Expr_MathAbs', chipGrid,
    [-40, -135, 2], {
      Input: N(0),
    }, COLORS.movement, {label: 'W/S\nABS'});
  const inputNeutral = addComponent('Expr_CompareLess', chipGrid,
    [-30, -135, 2], {
      InputA: N(0),
      InputB: N(0.05),
    }, COLORS.movement, {label: 'NEUTRAL\n< 0.05'});
  const dampingAllowed = addComponent('Expr_LogicalAND', chipGrid,
    [-20, -135, 2], {
      bInputA: false,
      bInputB: false,
    }, COLORS.movement, {label: 'HOVER +\nNEUTRAL'});
  const dampingBranch = addComponent('Exec_Branch', chipGrid,
    [-10, -135, 2], {
      bCond: false,
    }, COLORS.movement, {label: 'DAMPING\nGUARD'});

  wire(clock, 'Pulse', velocityGet, 'Exec');
  wire(chassisGrid, 'BrickGrid', velocityGet, 'Entity');
  wire(velocityGet, 'LinearVelocity', velocitySplit, 'Input');
  wire(velocitySplit, 'X', horizontalVector, 'X');
  wire(velocitySplit, 'Y', horizontalVector, 'Y');
  wire(horizontalVector, 'Output', counterVelocity, 'Input');
  wire(dragGain, 'Value', counterVelocity, 'Scalar');
  wire(counterVelocity, 'Output', velocityAdd, 'Vector');
  wire(chassisGrid, 'BrickGrid', velocityAdd, 'Entity');
  wire(velocityGet, 'ExecOut', dampingBranch, 'Exec');
  wire(splitter, 'InputForward', inputMagnitude, 'Input');
  wire(inputMagnitude, 'Output', inputNeutral, 'InputA');
  wire(inputNeutral, 'bOutput', dampingAllowed, 'bInputA');
  wire(hoverSwitch, 'bEnabled', dampingAllowed, 'bInputB');
  wire(dampingAllowed, 'bOutput', dampingBranch, 'bCond');
  wire(dampingBranch, 'ExecOutA', velocityAdd, 'Exec');

  addText([0, -155, 2], [65, 10, 2],
    'PROVEN HEIGHT LOOP + ISOLATED WASD THRUST + NEUTRAL XY DRAG\nTop switch enables all systems. HEIGHT 40 = four studs from the sweep origin.',
    {R: 255, G: 190, B: 80, A: 255});

  // Preserve the donor's seat-to-engine character route for future expansion.
  // The engine remains disabled; this version reads WASD through the isolated
  // InputSplitter path and never lets the engine compete with direct thrust.
  assert(scene.edges.some(edge => edge.a === seat.key && edge.at === seat.type
    && edge.p === 'SittingCharacter' && edge.z === engine.key
    && edge.zt === engine.type && edge.q === 'Character'),
  'Seat-to-engine character route was not preserved');
  fitMicrochip(scene, chipGrid);

  const metadata = {
    name: 'Hover Frame - Ground Distance WASD Controller',
    description: 'Seat-controlled W/S drive, A/D balanced turning, and neutral-only horizontal drag around the proven 100 Hz ground-distance hover controller. Lift and movement remain isolated.',
    owner: selectedOwner(scene),
  };
  const generated = write(scene, {
    assets: scene.r.externalAssets(),
    embedded: scene.r.prefabPaths().map(prefabPath => scene.r.readPrefab(prefabPath)),
    ...metadata,
  }).bytes;
  const bytes = repack(generated, donor, metadata);
  const donorPlacement = validatePlacement(donor);
  const placement = validatePlacement(bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  assert.deepEqual(overlapSignatures(placement), overlapSignatures(donorPlacement),
    'Ground-distance hover conversion must not introduce placement overlaps');

  return {
    bytes,
    scene,
    original,
    mainGrid,
    chipGrid,
    created,
    nodes: {
      engine, seat, thrusters, movementThrusters,
      forwardDrive, reverseDrive, leftFront, leftRear, rightFront, rightRear,
      gyro, hoverSwitch,
      updateRate, setpoint, previousDistance, clock, sweep,
      previousGet, previousSet, heightError, proportional,
      proportionalClamp, distanceDelta, velocity, damping,
      dampingClamp, combine, finalClamp, throttle,
      splitter, forwardThrottle, reverseNegate, reverseThrottle,
      rightThrottle, leftNegate, leftThrottle, driveForce, turnForce,
      chassisGrid, velocityGet, velocitySplit, horizontalVector,
      counterVelocity, velocityAdd, dragGain, inputMagnitude, inputNeutral,
      dampingAllowed, dampingBranch,
    },
    donorPlacement,
    placement,
    summary: {
      bricks: scene.bricks.length,
      wires: scene.edges.length,
      controllerGates: created.filter(node => node.brick.g === chipGrid).length,
      addedPhysicalComponents: created.filter(node => node.brick.g === mainGrid).length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  if (!INPUT) throw new Error(
    'Usage: node build-ground-distance-hover-frame.cjs "Hover Frame.brz" [output.brz]');
  const result = build(INPUT);
  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    input: INPUT,
    output: OUTPUT,
    bytes: result.bytes.length,
    placementStrictOk: result.placement.strictOk,
    ...result.summary,
  }, null, 2));
}

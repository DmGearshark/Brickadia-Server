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
  || path.join(__dirname, '../../outputs/hover-frame-native-auto-hover.brz'));

const COLORS = {
  label: [20, 25, 32],
  tune: [235, 145, 45],
  output: [230, 85, 155],
  gyro: [165, 95, 220],
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
  assert.equal(thrusterRows.length, 2, 'Expected the supplied pair of lift thrusters');
  const chipShell = one(rows(C.Microchip.NAME), 'microchip shell');
  const mainGrid = engineRow.brick.g;
  assert.equal(seatRow.brick.g, mainGrid, 'Seat must be attached to the vehicle grid');
  assert(thrusterRows.every(row => row.brick.g === mainGrid),
    'Both lift thrusters must be attached to the vehicle grid');
  const chipLink = one(scene.links.filter(link => link.key === chipShell.brick.key),
    'microchip link');
  const chipGrid = chipLink.grid;
  assert.equal(scene.bricks.filter(brick => brick.g === chipGrid).length, 0,
    'The supplied tuning microchip must start empty');

  const engine = {key: engineRow.brick.key, type: C.WheelEngine.NAME};
  const seat = {key: seatRow.brick.key, type: C.Seat.NAME};
  const thrusters = thrusterRows.map(row => ({
    key: row.brick.key,
    type: C.Thruster.NAME,
  }));

  // Native auto-hover is inferred by Vehicle Engine from its discoverable air
  // components. The existing frame already supplied the correct paired lift
  // thrusters and seat/engine bus; the disabled engine was the main blocker.
  Object.assign(engineRow.component.data, {
    bEnabled: true,
    bEnableManualControl: false,
    bAutodiscoverWheels: false,
    bAutodiscoverThrusters: true,
    bAutodiscoverGyroscopes: true,
    bAutodiscoverAerodynamicSurfaces: false,
    FlightHandling: 1,
    bEnableAirBraking: true,
    bEnableGlideTrim: false,
    KeyboardSteeringRollMix: 0,
    KeyboardSteeringYawMix: 1,
    HorizontalSteeringRollMix: 0,
    HorizontalSteeringYawMix: 1,
    bAutoRight: true,
  });
  Object.assign(seatRow.component.data, {
    SeatMode: 0,
    bStickyPlaneThrottle: false,
    bFlyingGroundControls: true,
    PromptCustomLabel: 'Drive Hover Frame',
  });
  for (const row of thrusterRows) Object.assign(row.component.data, {
    bEnabled: true,
    bDiscoverable: true,
    ForceApplication: 0,
    Throttle: 0,
  });

  let serial = 0;
  const created = [];
  function brickData(asset, position, color, options = {}) {
    return {
      asset,
      size: options.size || [0, 0, 0],
      position,
      direction: 4,
      rotation: 0,
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
  function addComponent(kind, grid, position, data, color, options = {}) {
    const definition = C[kind];
    assert(definition?.BRICK, `Unknown physical/gate component ${kind}`);
    const brick = {
      key: `native-hover:${String(serial++).padStart(2, '0')}:${kind}`,
      g: grid,
      data: brickData(definition.BRICK, position, color, options),
      comps: [{type: definition.NAME, data: structuredClone(data)}],
    };
    scene.bricks.push(brick);
    const node = {key: brick.key, type: definition.NAME, kind, brick};
    created.push(node);
    return node;
  }
  function addText(position, size, text, textColor = {R: 235, G: 245, B: 255, A: 255}) {
    const brick = {
      key: `native-hover:${String(serial++).padStart(2, '0')}:Text`,
      g: chipGrid,
      data: brickData('PB_DefaultTile', position, COLORS.label, {size}),
      comps: [{type: C.TextDisplay.NAME, data: {
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
      }}],
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

  // One centered gyro supplies roll/pitch stability and native yaw control.
  // It is face-connected to the platform underside and does not overlap either
  // thruster. Keeping it visible makes the first test easy to inspect/remove.
  const gyro = addComponent('Gyroscope', mainGrid, [-10, 5, -8], {
    bEnabled: true,
    bDiscoverable: true,
    Strength: 25,
    Damping: 1,
    MaxForce: 0,
    TargetAxis: {X: 0, Y: 0, Z: 1},
    Control_DriveAndSteer: {},
  }, COLORS.gyro, {materialIntensity: 5});
  wire(engine, 'Control_DriveAndSteer', gyro, 'Control_DriveAndSteer');

  const settings = [
    {label: 'MASS', value: 10, port: 'CustomMass', targets: [engine]},
    {label: 'LIFT', value: 7, port: 'LiftMultiplier', targets: [engine]},
    {label: 'THRUST', value: 4, port: 'ThrustMultiplier', targets: [engine]},
    {label: 'SPEED', value: 5000, port: 'FlightTopSpeed', targets: [engine]},
    {label: 'TURN', value: 280, port: 'ArcadeYawRate', targets: [engine]},
    {label: 'GYRO', value: 25, port: 'Strength', targets: [gyro]},
    {label: 'DAMP', value: 1, port: 'Damping', targets: [gyro]},
    {label: 'FORCE', value: 50000, port: 'Force', targets: thrusters},
  ];

  addText([0, 30, 2], [50, 10, 2],
    'NATIVE AUTO-HOVER  |  EDIT ORANGE VALUES',
    {R: 255, G: 185, B: 70, A: 255});
  const x0 = -35;
  for (let index = 0; index < settings.length; index++) {
    const setting = settings[index];
    const x = x0 + index * 10;
    addText([x, 15, 2], [5, 5, 2], setting.label);
    const variable = addComponent('Var', chipGrid, [x, 5, 2], {
      Value: N(setting.value),
    }, COLORS.tune);
    const output = addComponent('MicrochipOutput', chipGrid, [x, -5, 2], {
      PortLabel: setting.label,
      CallableDefault: N(setting.value),
      CallableResult: N(setting.value),
    }, COLORS.output);
    wire(variable, 'Value', output, 'RER_Input');
    for (const target of setting.targets) {
      wire(output, 'RER_Output', target, setting.port);
    }
  }
  addText([0, -25, 2], [75, 10, 2],
    'SEAT > ENGINE > 2 LIFT THRUSTERS + GYRO\nIf it rises or sinks, tune LIFT first. No clock or feedback loop.',
    {R: 170, G: 225, B: 255, A: 255});

  // The original three physical routes must remain and the gyro is the fourth
  // control-bus consumer.
  assert(scene.edges.some(edge => edge.a === seat.key && edge.at === seat.type
    && edge.p === 'SittingCharacter' && edge.z === engine.key
    && edge.zt === engine.type && edge.q === 'Character'),
  'Seat-to-engine character route was not preserved');
  for (const thruster of thrusters) assert(scene.edges.some(edge =>
    edge.a === engine.key && edge.at === engine.type
    && edge.p === 'Control_DriveAndSteer' && edge.z === thruster.key
    && edge.zt === thruster.type && edge.q === 'Control_DriveAndSteer'),
  `Engine-to-thruster route ${thruster.key} was not preserved`);

  fitMicrochip(scene, chipGrid);
  const metadata = {
    name: 'Hover Frame - Native Auto-Hover',
    description: 'Native Vehicle Engine auto-hover test using the supplied paired lift thrusters, a centered gyroscope, air braking, and an organized tuning microchip.',
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
    'Native hover conversion must not introduce placement overlaps');

  return {
    bytes,
    scene,
    original,
    mainGrid,
    chipGrid,
    gyro,
    created,
    donorPlacement,
    placement,
    summary: {
      bricks: scene.bricks.length,
      wires: scene.edges.length,
      addedPhysicalComponents: 1,
      tuningValues: settings.length,
      clocks: rows(C.Clock.NAME).length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  if (!INPUT) throw new Error(
    'Usage: node build-native-auto-hover-frame.cjs "Hover Frame.brz" [output.brz]');
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

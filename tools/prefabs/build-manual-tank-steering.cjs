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
  || path.join(__dirname, '../../outputs/manual-wasd-tank-steering.brz'));

const COLORS = {
  input: [65, 150, 210],
  scale: [235, 150, 45],
  left: [85, 190, 110],
  right: [185, 105, 220],
  output: [230, 85, 115],
  panel: [18, 24, 32],
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
  for (let axis = 0; axis < 2; axis++) {
    if ((low[axis] + high[axis]) % 2) high[axis]++;
  }
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

function textData(text, lineHeight = 1.1,
  color = {R: 240, G: 245, B: 255, A: 255}) {
  return {
    Text: text,
    Font: 0,
    Rotation: 0,
    Skew: 0,
    Kerning: 0,
    LineHeight: lineHeight,
    WidthScale: 0.65,
    LineOffset: 0,
    Anchor: {X: 0.5, Y: 0.5},
    Offset: {X: 0, Y: 0, Z: 0},
    Color: color,
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

function build(input = INPUT) {
  assert(input, 'Input WIP tank steering .brz path is required');
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const original = read(donor);
  scene.entityOverrides = new Map();

  const rows = type => scene.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({brick, component})));
  const rootGrid = one([...scene.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid'), 'root dynamic grid').persistentIndex;
  const seatRow = one(rows(C.Seat.NAME), 'driver seat');
  const engines = rows(C.WheelEngine.NAME);
  const wheels = rows(C.Joint_Wheel_Suspension.NAME);
  assert.equal(engines.length, 2, 'Expected separate left/right track engines');
  assert.equal(wheels.length, 8, 'Expected four wheels per track');
  const labeledEngine = pattern => one(engines.filter(row => row.brick.comps.some(component =>
    component.type === C.TextDisplay.NAME && pattern.test(component.data.Text || ''))),
  `${pattern} engine`);
  const leftEngineRow = labeledEngine(/left tracks/i);
  const rightEngineRow = labeledEngine(/right tracks/i);
  const leftEngine = {key: leftEngineRow.brick.key, type: C.WheelEngine.NAME};
  const rightEngine = {key: rightEngineRow.brick.key, type: C.WheelEngine.NAME};
  const seat = {key: seatRow.brick.key, type: C.Seat.NAME};

  assert(leftEngineRow.brick.data.position[0] > 0,
    'LEFT TRACKS engine should remain on positive-X side');
  assert(rightEngineRow.brick.data.position[0] < 0,
    'RIGHT TRACKS engine should remain on negative-X side');

  for (const row of engines) {
    Object.assign(row.component.data, {
      bEnabled: true,
      bEnableManualControl: true,
      ManualControlMode: 1,
      ManualInput_Drive: 0,
      ManualInput_Steer: 0,
      ManualInput_Pitch: 0,
      ManualInput_Roll: 0,
      bManualInput_Brake: false,
      bTankSteering: false,
      bAutodiscoverWheels: false,
      bAutodiscoverThrusters: false,
      bAutodiscoverGyroscopes: false,
      bAutodiscoverAerodynamicSurfaces: false,
    });
  }
  for (const row of wheels) {
    Object.assign(row.component.data, {
      bDiscoverable: false,
      bSteerEnabled: false,
      Steer: 0,
      bAllowEngineSteerCorrect: false,
    });
  }
  seatRow.component.data.PromptCustomLabel = 'Drive — W/S Move, A/D Tank Steer';

  const shellLinks = scene.links.filter(link => scene.bricks.some(brick =>
    brick.key === link.key && brick.comps.some(component =>
      component.type === C.Microchip.NAME)));
  assert.equal(shellLinks.length, 2, 'Expected the supplied nested two-chip structure');
  const rootLink = one(shellLinks.filter(link => scene.bricks.some(brick =>
    brick.key === link.key && brick.g === rootGrid)), 'root steering chip link');
  const middleGrid = rootLink.grid;
  const innerShell = one(scene.bricks.filter(brick => brick.g === middleGrid
    && brick.comps.some(component => component.type === C.Microchip.NAME)),
  'inner steering chip shell');
  const logicLink = one(scene.links.filter(link => link.key === innerShell.key),
    'inner steering logic link');
  const logicGrid = logicLink.grid;

  const removed = scene.bricks.filter(brick => brick.g === logicGrid);
  const removedKeys = new Set(removed.map(brick => brick.key));
  assert.equal(removed.length, 30,
    'Expected the unfinished 30-gate directional decoder');
  scene.bricks = scene.bricks.filter(brick => brick.g !== logicGrid);
  scene.edges = scene.edges.filter(edge =>
    !removedKeys.has(edge.a) && !removedKeys.has(edge.z));

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
  function gate(kind, position, data, color, label) {
    const definition = C[kind];
    assert(definition?.BRICK, `Unknown gate ${kind}`);
    const components = [{type: definition.NAME, data: structuredClone(data)}];
    if (label) components.push({
      type: C.TextDisplay.NAME,
      data: textData(label),
    });
    const brick = {
      key: `manual-tank:${String(serial++).padStart(2, '0')}:${kind}`,
      g: logicGrid,
      data: brickData(definition.BRICK, position, color),
      comps: components,
    };
    scene.bricks.push(brick);
    const node = {key: brick.key, type: definition.NAME, kind, brick};
    created.push(node);
    return node;
  }
  function panel(position, size, text, color) {
    const brick = {
      key: `manual-tank:${String(serial++).padStart(2, '0')}:panel`,
      g: logicGrid,
      data: brickData('PB_DefaultTile', position, COLORS.panel, {size}),
      comps: [{
        type: C.TextDisplay.NAME,
        data: textData(text, 1.35, color),
      }],
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

  panel([-15, 55, 2], [40, 5, 2], 'MANUAL WASD TANK MIXER',
    {R: 110, G: 210, B: 255, A: 255});
  const character = gate('MicrochipInput', [-35, 35, 2], {
    PortLabel: 'Driver Character', PortOrder: 1,
    CallableDefault: N(0), CallableMirror: N(0),
  }, COLORS.input, 'DRIVER');
  const splitter = gate('InputSplitter', [-25, 35, 2], {},
    COLORS.input, 'WASD');
  const forwardAbs = gate('Expr_MathAbs', [-35, 15, 2], {
    Input: N(0),
  }, COLORS.scale, '|FORWARD|');
  const halfForward = gate('Expr_MathMultiply', [-25, 15, 2], {
    InputA: N(0), InputB: N(0.5),
  }, COLORS.scale, '× 0.5');
  const turnScale = gate('Expr_MathSubtract', [-15, 15, 2], {
    InputA: N(1), InputB: N(0),
  }, COLORS.scale, 'TURN\nSCALE');
  const turnTerm = gate('Expr_MathMultiply', [-5, 15, 2], {
    InputA: N(0), InputB: N(1),
  }, COLORS.scale, 'STEER\nTERM');

  const leftMix = gate('Expr_MathAdd', [-15, -5, 2], {
    InputA: N(0), InputB: N(0),
  }, COLORS.left, 'LEFT\nMIX');
  const leftClamp = gate('Expr_MathClamp', [-5, -5, 2], {
    Input: N(0), Min: N(-1), Max: N(1),
  }, COLORS.left, 'LEFT\n[-1,1]');
  const leftOutput = gate('MicrochipOutput', [5, -5, 2], {
    PortLabel: 'Left Track Drive', PortOrder: 1,
    CallableDefault: N(0), CallableResult: N(0),
  }, COLORS.output, 'LEFT\nDRIVE');

  const rightMix = gate('Expr_MathSubtract', [-15, -25, 2], {
    InputA: N(0), InputB: N(0),
  }, COLORS.right, 'RIGHT\nMIX');
  const rightClamp = gate('Expr_MathClamp', [-5, -25, 2], {
    Input: N(0), Min: N(-1), Max: N(1),
  }, COLORS.right, 'RIGHT\n[-1,1]');
  const rightOutput = gate('MicrochipOutput', [5, -25, 2], {
    PortLabel: 'Right Track Drive', PortOrder: 2,
    CallableDefault: N(0), CallableResult: N(0),
  }, COLORS.output, 'RIGHT\nDRIVE');
  panel([-15, -45, 2], [40, 5, 2],
    'W/S MOVE  •  A/D STEER  •  A OR D PIVOTS IN PLACE',
    {R: 255, G: 190, B: 80, A: 255});

  wire(seat, 'SittingCharacter', character, 'RER_Input');
  wire(character, 'RER_Output', splitter, 'Character');
  wire(splitter, 'InputForward', forwardAbs, 'Input');
  wire(forwardAbs, 'Output', halfForward, 'InputA');
  wire(halfForward, 'Output', turnScale, 'InputB');
  wire(splitter, 'InputRight', turnTerm, 'InputA');
  wire(turnScale, 'Output', turnTerm, 'InputB');
  wire(splitter, 'InputForward', leftMix, 'InputA');
  wire(turnTerm, 'Output', leftMix, 'InputB');
  wire(leftMix, 'Output', leftClamp, 'Input');
  wire(leftClamp, 'Output', leftOutput, 'RER_Input');
  wire(splitter, 'InputForward', rightMix, 'InputA');
  wire(turnTerm, 'Output', rightMix, 'InputB');
  wire(rightMix, 'Output', rightClamp, 'Input');
  wire(rightClamp, 'Output', rightOutput, 'RER_Input');
  wire(leftOutput, 'RER_Output', leftEngine, 'ManualInput_Drive');
  wire(rightOutput, 'RER_Output', rightEngine, 'ManualInput_Drive');

  fitMicrochip(scene, logicGrid);

  const metadata = {
    name: 'Manual WASD Tank Steering',
    description: 'Two-engine analog tank mixer: W/S drive, A/D pivot at rest, and moving turns slow the inside track to 0.5. Built-in tank steering and actuator autodiscovery remain disabled.',
    owner: selectedOwner(scene),
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
    rootGrid,
    middleGrid,
    logicGrid,
    created,
    nodes: {
      seat, leftEngine, rightEngine, character, splitter,
      forwardAbs, halfForward, turnScale, turnTerm,
      leftMix, leftClamp, leftOutput,
      rightMix, rightClamp, rightOutput,
    },
    placement,
    summary: {
      bricks: scene.bricks.length,
      wires: scene.edges.length,
      logicGates: created.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

module.exports = build;

if (require.main === module) {
  if (!INPUT) throw new Error(
    'Usage: node build-manual-tank-steering.cjs "Wip stank steering.brz" [output.brz]');
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

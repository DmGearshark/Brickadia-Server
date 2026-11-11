'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  button: 'Component_Button',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  logicalOr: 'BrickComponentType_Expr_LogicalOR',
  microchip: 'Component_Internal_Microchip',
  text: 'Component_TextDisplay',
};

const PAGE_KEYS = ['textPages', 'imagePagesA', 'imagePagesB', 'imagePagesC', 'imagePagesD'];
const DISPLAY_SCALE = 1.6;
const SIDE_SPECS = [
  { name: 'left', x: -20 },
  { name: 'right', x: 20 },
];
const MUTABLE_DISPLAY_PATHS = [
  'Text',
  'Font',
  'WidthScale',
  'LineHeight',
  'LineOffset',
  'Kerning',
  'Skew',
  'OutlineWidth',
  'Offset.Y',
  'Offset.Z',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function components(scene, type, grid) {
  return scene.bricks.flatMap(brick => {
    if (grid != null && brick.g !== grid) return [];
    return brick.comps
      .filter(component => component.type === type)
      .map(component => ({ brick, component, type }));
  });
}

function linkedGrids(scene, description) {
  const chip = one(components(scene, TYPES.microchip), `${description} root microchip`);
  const link = one(scene.links.filter(item => item.key === chip.brick.key),
    `${description} root microchip link`);
  assert.equal(scene.links.length, 1, `${description} must contain exactly one microchip link`);
  assert.notEqual(chip.brick.g, link.grid, `${description} outer and logic grids must differ`);
  return { outer: chip.brick.g, inner: link.grid, chip, link };
}

function entityForGrid(scene, grid, description) {
  return one([...scene.r.entities()].filter(entity => entity.persistentIndex === grid), description);
}

function entitySnapshot(entity) {
  return {
    typeName: entity.typeName,
    className: entity.className,
    location: entity.location,
    rotation: entity.rotation,
    frozen: entity.frozen,
    sleeping: entity.sleeping,
    linearVelocity: entity.linearVelocity,
    angularVelocity: entity.angularVelocity,
    colors: entity.colors,
    data: entity.data,
  };
}

function geometryMultiset(scene, grid) {
  return scene.bricks
    .filter(brick => brick.g === grid)
    .map(brick => JSON.stringify({
      data: brick.data,
      componentTypes: brick.comps.map(component => component.type).sort(),
    }))
    .sort();
}

function brickAt(scene, grid, position, componentType, description) {
  return one(scene.bricks.filter(brick => brick.g === grid
    && JSON.stringify(brick.data.position) === JSON.stringify(position)
    && brick.comps.some(component => component.type === componentType)), description);
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = structuredClone(value);
}

function assertOnlyDisplayFieldsChanged(before, after, description) {
  const normalized = structuredClone(after);
  for (const path of MUTABLE_DISPLAY_PATHS) setPath(normalized, path, getPath(before, path));
  assert.deepEqual(normalized, before,
    `${description} changed outside display allowlist ${MUTABLE_DISPLAY_PATHS.join(', ')}`);
}

function assertOuterShellPreserved(before, after, beforeGrid, afterGrid) {
  const beforeBricks = before.bricks.filter(brick => brick.g === beforeGrid.outer);
  const afterBricks = after.bricks.filter(brick => brick.g === afterGrid.outer);
  assert.equal(afterBricks.length, beforeBricks.length, 'Outer shell brick count changed');
  assert.deepEqual(geometryMultiset(after, afterGrid.outer), geometryMultiset(before, beforeGrid.outer),
    'Outer shell brick geometry or component inventory changed');

  for (const oldBrick of beforeBricks.filter(brick => brick.comps.length > 0)) {
    const newBrick = brickAt(after, afterGrid.outer, oldBrick.data.position,
      oldBrick.comps[0].type, `output component host at ${oldBrick.data.position}`);
    assert.deepEqual(newBrick.data, oldBrick.data,
      `Host brick geometry changed at ${oldBrick.data.position}`);
    assert.deepEqual(newBrick.comps.map(component => component.type),
      oldBrick.comps.map(component => component.type),
      `Component inventory changed at ${oldBrick.data.position}`);
    for (let index = 0; index < oldBrick.comps.length; index += 1) {
      const oldComponent = oldBrick.comps[index];
      const newComponent = newBrick.comps[index];
      const mutablePageDisplay = oldComponent.type === TYPES.text
        && (/(?:page limit|This is brail)/i.test(oldComponent.data.Text || ''));
      if (mutablePageDisplay) {
        assertOnlyDisplayFieldsChanged(oldComponent.data, newComponent.data,
          `Page display at ${oldBrick.data.position}`);
      } else {
        assert.deepEqual(newComponent.data, oldComponent.data,
          `Unrelated component changed at ${oldBrick.data.position}`);
      }
    }
  }

  assert.deepEqual(
    entitySnapshot(entityForGrid(after, afterGrid.outer, 'output outer-grid entity')),
    entitySnapshot(entityForGrid(before, beforeGrid.outer, 'donor outer-grid entity')),
    'Outer-grid entity transform or settings changed',
  );
  assert.deepEqual(
    entitySnapshot(entityForGrid(after, afterGrid.inner, 'output microchip-grid entity')),
    entitySnapshot(entityForGrid(before, beforeGrid.inner, 'donor microchip-grid entity')),
    'Microchip-grid entity transform, plane, or settings changed',
  );
  assert.deepEqual(after.r.prefabJson(), before.r.prefabJson(), 'Prefab placement metadata changed');
  assert.equal(after.joints.length, 0, 'Output unexpectedly contains joints');
  assert.equal(before.joints.length, 0, 'Donor unexpectedly contains joints');
}

function splitSpreads(pages) {
  const left = [];
  const right = [];
  for (let index = 0; index < pages.length; index += 2) {
    left.push(pages[index]);
    right.push(pages[index + 1] ?? '');
  }
  return { left, right };
}

function sidePages(pages, sideName) {
  return splitSpreads(pages)[sideName];
}

function displayRoles(scene, grid, side) {
  const displays = components(scene, TYPES.text, grid)
    .filter(item => item.brick.data.position[0] === side.x);
  assert.equal(displays.length, 6, `${side.name} physical page must have six displays`);
  const background = one(displays.filter(item => item.component.data.Text === '■'),
    `${side.name} background display`);
  const prose = one(displays.filter(item => /page limit/i.test(item.component.data.Text || '')),
    `${side.name} prose placeholder`);
  const images = displays
    .filter(item => /^This is brail [1-4]$/i.test(item.component.data.Text || ''))
    .sort((left, right) => right.brick.data.position[2] - left.brick.data.position[2]);
  assert.equal(images.length, 4, `${side.name} image placeholder count`);
  return { background, prose, images };
}

function outputDisplayRoles(scene, grid, donorRoles) {
  const outputItem = donorItem => {
    const brick = brickAt(scene, grid, donorItem.brick.data.position, TYPES.text,
      `output display at ${donorItem.brick.data.position}`);
    return {
      brick,
      component: one(brick.comps.filter(component => component.type === TYPES.text),
        `TextDisplay at ${brick.data.position}`),
      type: TYPES.text,
    };
  };
  return {
    background: outputItem(donorRoles.background),
    prose: outputItem(donorRoles.prose),
    images: donorRoles.images.map(outputItem),
  };
}

function edgesTo(scene, item, port) {
  return scene.edges.filter(edge => edge.z === item.brick.key
    && edge.zt === item.type && edge.q === port);
}

function edgesFrom(scene, item, port) {
  return scene.edges.filter(edge => edge.a === item.brick.key
    && edge.at === item.type && edge.p === port);
}

function endpoint(edge) {
  return JSON.stringify([edge.a, edge.at, edge.p]);
}

function itemAtEndpoint(byKey, key, type, description) {
  const brick = byKey.get(key);
  assert(brick, `${description} references missing brick ${key}`);
  const component = one(brick.comps.filter(item => item.type === type),
    `${description} component ${type}`);
  return { brick, component, type };
}

function assertWireIntegrity(scene) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  assert.equal(byKey.size, scene.bricks.length, 'Brick keys are not unique');
  const wires = new Set();
  const targets = new Set();
  for (const edge of scene.edges) {
    const source = byKey.get(edge.a);
    const target = byKey.get(edge.z);
    assert(source, `Wire source brick is missing: ${edge.a}`);
    assert(target, `Wire target brick is missing: ${edge.z}`);
    assert(source.comps.some(component => component.type === edge.at),
      `Wire source component is missing: ${edge.at}`);
    assert(target.comps.some(component => component.type === edge.zt),
      `Wire target component is missing: ${edge.zt}`);
    const signature = JSON.stringify(edge);
    assert(!wires.has(signature), `Duplicate wire ${signature}`);
    wires.add(signature);
    const targetPort = JSON.stringify([edge.z, edge.zt, edge.q]);
    assert(!targets.has(targetPort), `Multiple drivers for ${targetPort}`);
    targets.add(targetPort);
  }
  return byKey;
}

function approx(actual, expected, description) {
  assert(Number.isFinite(actual), `${description} is not finite`);
  assert(Math.abs(actual - expected) < 1e-5, `${description}: ${actual} != ${expected}`);
}

function validateData(data) {
  assert.equal(data.textPages.length, 227, 'Expected the approved 227-page Opticks v27 data');
  for (const key of PAGE_KEYS) {
    assert(Array.isArray(data[key]), `Missing ${key}`);
    assert.equal(data[key].length, data.textPages.length, `${key} page count`);
    for (const [index, value] of data[key].entries()) {
      assert.equal(typeof value, 'string', `${key}[${index}] must be a string`);
      assert(Buffer.byteLength(value, 'utf8') < 32767,
        `${key}[${index}] exceeds Brickadia's string limit`);
    }
  }
  assert.equal(data.layout.imageArrayCount, 4);
  assert.equal(data.layout.imageFont, 'IosevkaTerm');
}

function test(donorPath, outputPath, dataPath) {
  const donorBytes = fs.readFileSync(donorPath);
  const outputBytes = fs.readFileSync(outputPath);
  const donor = read(donorBytes);
  const output = read(outputBytes);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  validateData(data);

  const donorGrid = linkedGrids(donor, 'donor');
  const outputGrid = linkedGrids(output, 'output');
  assert.deepEqual(new Set(output.bricks.map(brick => brick.g)),
    new Set([outputGrid.outer, outputGrid.inner]),
    'Output bricks must belong only to the shell and its logic grid');
  assert.equal(donor.bricks.filter(brick => brick.g === donorGrid.inner).length, 0,
    'Donor microchip must be blank');
  assertOuterShellPreserved(donor, output, donorGrid, outputGrid);

  assert.equal(output.bricks.filter(brick => brick.g === outputGrid.outer).length, 66,
    'Expected the supplied 66-brick outer shell');
  assert.equal(components(output, TYPES.text, outputGrid.outer).length, 12);
  assert.equal(components(output, TYPES.button, outputGrid.outer).length, 2);
  assert.equal(components(output, TYPES.microchip, outputGrid.outer).length, 1);

  const innerBricks = output.bricks.filter(brick => brick.g === outputGrid.inner);
  assert.equal(innerBricks.length, 22, 'Expected 22 page-controller gates');
  assert.equal(output.bricks.length, 88, 'Unexpected brick outside the preserved shell and controller');
  assert(innerBricks.every(brick => brick.comps.length === 1),
    'Each page-controller brick must carry exactly one component');
  const expectedInnerCounts = new Map([
    [TYPES.array, 10],
    [TYPES.get, 10],
    [TYPES.cycle, 1],
    [TYPES.logicalOr, 1],
  ]);
  const actualInnerCounts = new Map();
  for (const brick of innerBricks) {
    const type = brick.comps[0].type;
    actualInnerCounts.set(type, (actualInnerCounts.get(type) || 0) + 1);
  }
  assert.deepEqual(actualInnerCounts, expectedInnerCounts,
    'Unexpected or missing page-controller components');

  assert.equal(output.edges.length, 44, 'Expected the minimal 44-wire spread controller');
  const byKey = assertWireIntegrity(output);
  const cycle = one(components(output, TYPES.cycle, outputGrid.inner), 'spread Cycle');
  const refresh = one(components(output, TYPES.logicalOr, outputGrid.inner), 'spread refresh OR');
  assert.deepEqual(cycle.brick.data.position, [0, 20, 2], 'Cycle must remain inside the chip plane');
  assert.deepEqual(refresh.brick.data.position, [0, -20, 2], 'Refresh OR must remain inside the chip plane');
  const logicEntity = entityForGrid(output, outputGrid.inner, 'output logic-grid entity');
  for (const brick of innerBricks) {
    assert(Math.abs(brick.data.position[0] - logicEntity.data.PlaneCenter.X)
      <= logicEntity.data.PlaneExtent.X,
    `Logic gate exceeds chip X extent at ${brick.data.position}`);
    assert(Math.abs(brick.data.position[1] - logicEntity.data.PlaneCenter.Y)
      <= logicEntity.data.PlaneExtent.Y,
    `Logic gate exceeds chip Y extent at ${brick.data.position}`);
  }
  const arrays = components(output, TYPES.array, outputGrid.inner);
  const getters = components(output, TYPES.get, outputGrid.inner);
  const spreadCount = Math.ceil(data.textPages.length / 2);
  assert.equal(spreadCount, 114);
  assert.equal(cycle.component.data.Count, spreadCount);
  assert.equal(cycle.component.data.Value, spreadCount - 1);
  assert.equal(refresh.component.data.bInputA, false);
  assert.equal(refresh.component.data.bInputB, false);

  const donorSideRoles = new Map();
  const outputSideRoles = new Map();
  for (const side of SIDE_SPECS) {
    const donorRoles = displayRoles(donor, donorGrid.outer, side);
    donorSideRoles.set(side.name, donorRoles);
    outputSideRoles.set(side.name, outputDisplayRoles(output, outputGrid.outer, donorRoles));
  }

  const externalAssets = output.r.externalAssets();
  const proseFont = one(externalAssets
    .map((asset, index) => ({ asset, index }))
    .filter(item => item.asset.type === 'BrickFontDescriptor' && item.asset.name === 'RobotoMono'),
  'RobotoMono asset').index;
  const imageFont = one(externalAssets
    .map((asset, index) => ({ asset, index }))
    .filter(item => item.asset.type === 'BrickFontDescriptor'
      && item.asset.name === data.layout.imageFont),
  `${data.layout.imageFont} asset`).index;

  const usedArrays = new Set();
  const usedGetters = new Set();
  const usedDisplays = new Set();
  for (const side of SIDE_SPECS) {
    const roles = outputSideRoles.get(side.name);
    const boundDisplays = [roles.prose, ...roles.images];
    assert.equal(edgesTo(output, roles.background, 'Text').length, 0,
      `${side.name} background must not receive page text`);
    assert(!output.edges.some(edge => edge.a === roles.background.brick.key
      || edge.z === roles.background.brick.key), `${side.name} background must remain unwired`);

    assert.equal(roles.prose.component.data.Font, proseFont);
    approx(roles.prose.component.data.WidthScale, data.layout.textWidthScale,
      `${side.name} prose WidthScale`);
    approx(roles.prose.component.data.LineHeight, data.layout.textLineHeight * DISPLAY_SCALE,
      `${side.name} prose LineHeight`);
    assert.equal(roles.prose.component.data.OutlineWidth, 2);
    approx(roles.prose.component.data.Offset.Y, -3, `${side.name} prose Offset.Y`);
    approx(roles.prose.component.data.Offset.Z, 1, `${side.name} prose Offset.Z`);

    const commonOrigin = roles.prose.brick.data.position[2]
      + roles.prose.component.data.Offset.Y;
    for (const [index, display] of roles.images.entries()) {
      assert.equal(display.component.data.Font, imageFont);
      approx(display.component.data.WidthScale, data.layout.imageWidthScale,
        `${side.name} image ${index + 1} WidthScale`);
      approx(display.component.data.LineHeight, data.layout.imageLineHeight * DISPLAY_SCALE,
        `${side.name} image ${index + 1} LineHeight`);
      approx(display.component.data.LineOffset, -5.5,
        `${side.name} image ${index + 1} LineOffset`);
      assert.equal(display.component.data.Kerning, data.layout.imageKerning);
      assert.equal(display.component.data.Skew, 0);
      approx(display.component.data.OutlineWidth, data.layout.imageOutlineWidth,
        `${side.name} image ${index + 1} OutlineWidth`);
      approx(display.component.data.Offset.Z, 1,
        `${side.name} image ${index + 1} Offset.Z`);
      approx(display.brick.data.position[2] + display.component.data.Offset.Y,
        commonOrigin, `${side.name} image ${index + 1} common origin`);
    }

    for (let index = 0; index < PAGE_KEYS.length; index += 1) {
      const key = PAGE_KEYS[index];
      const display = boundDisplays[index];
      assert(!usedDisplays.has(display.brick.key), 'Two streams target the same display');
      usedDisplays.add(display.brick.key);

      const displayEdge = one(edgesTo(output, display, 'Text'),
        `${side.name} ${key} getter-to-display wire`);
      assert.equal(displayEdge.at, TYPES.get);
      assert.equal(displayEdge.p, 'Value');
      const getter = itemAtEndpoint(byKey, displayEdge.a, TYPES.get,
        `${side.name} ${key} getter`);
      assert(!usedGetters.has(getter.brick.key), 'One getter drives multiple page streams');
      usedGetters.add(getter.brick.key);
      assert.equal(edgesFrom(output, getter, 'Value').length, 1,
        `${side.name} ${key} getter has extra Value consumers`);

      const arrayEdge = one(edgesTo(output, getter, 'ArrayVarRef'),
        `${side.name} ${key} ArrayVarRef wire`);
      assert.equal(arrayEdge.at, TYPES.array);
      assert.equal(arrayEdge.p, 'ArrayVarRef');
      const array = itemAtEndpoint(byKey, arrayEdge.a, TYPES.array,
        `${side.name} ${key} array`);
      assert(!usedArrays.has(array.brick.key), 'One array is shared by multiple page streams');
      usedArrays.add(array.brick.key);
      assert.equal(edgesFrom(output, array, 'ArrayVarRef').length, 1,
        `${side.name} ${key} array has extra consumers`);

      const expectedPages = sidePages(data[key], side.name);
      assert.equal(expectedPages.length, spreadCount);
      assert.equal(array.component.data.Value.$elementType, 'str');
      assert.deepEqual(array.component.data.Value.$array, expectedPages.slice().reverse(),
        `${side.name} ${key} stored pages`);
      assert(array.component.data.Value.$array.every(value => Buffer.byteLength(value, 'utf8') < 32767),
        `${side.name} ${key} contains an oversized array entry`);
      assert.equal(getter.component.data.Index, spreadCount - 1);
      assert.equal(getter.component.data.Value.$variant, 'str');
      assert.equal(getter.component.data.Value.value, expectedPages[0]);
      assert.equal(getter.component.data.bOutOfBounds, false);
      assert.equal(display.component.data.Text, expectedPages[0]);

      const indexEdge = one(edgesTo(output, getter, 'Index'),
        `${side.name} ${key} cycle-index wire`);
      assert.equal(endpoint(indexEdge), endpoint({
        a: cycle.brick.key,
        at: TYPES.cycle,
        p: 'Output',
      }));
      const execEdge = one(edgesTo(output, getter, 'Exec'),
        `${side.name} ${key} refresh wire`);
      assert.equal(endpoint(execEdge), endpoint({
        a: refresh.brick.key,
        at: TYPES.logicalOr,
        p: 'bOutput',
      }));
    }
  }

  assert.equal(usedArrays.size, arrays.length, 'Unbound page array exists');
  assert.equal(usedGetters.size, getters.length, 'Unbound page getter exists');
  assert.equal(usedDisplays.size, 10, 'Expected ten independently driven content displays');

  for (const key of PAGE_KEYS) {
    const left = sidePages(data[key], 'left');
    const right = sidePages(data[key], 'right');
    const reconstructed = [];
    for (let index = 0; index < spreadCount; index += 1) {
      reconstructed.push(left[index], right[index]);
    }
    assert.deepEqual(reconstructed.slice(0, data[key].length), data[key],
      `${key} does not reconstruct from the two spread streams`);
    assert.equal(left[0], data[key][0], `${key} first left page`);
    assert.equal(right[0], data[key][1], `${key} first right page`);
    assert.equal(left.at(-1), data[key].at(-1), `${key} final left page`);
    assert.equal(right.at(-1), '', `${key} final right page must be blank`);
  }
  assert.match(sidePages(data.textPages, 'left')[0], /^1\r?\n/);
  assert.match(sidePages(data.textPages, 'right')[0], /^2\r?\n/);
  assert.match(sidePages(data.textPages, 'left').at(-1), /^227\r?\n/);

  const buttons = components(output, TYPES.button, outputGrid.outer);
  const turnRight = one(buttons.filter(item => /right/i.test(item.component.data.PromptCustomLabel || '')),
    'Turn page Right button');
  const turnLeft = one(buttons.filter(item => /left/i.test(item.component.data.PromptCustomLabel || '')),
    'Turn page Left button');
  const cycleUp = one(edgesTo(output, cycle, 'Exec'), 'previous-spread Cycle wire');
  const cycleDown = one(edgesTo(output, cycle, 'ExecDown'), 'next-spread Cycle wire');
  assert.equal(endpoint(cycleUp), endpoint({
    a: turnRight.brick.key,
    at: TYPES.button,
    p: 'bHeld',
  }));
  assert.equal(endpoint(cycleDown), endpoint({
    a: turnLeft.brick.key,
    at: TYPES.button,
    p: 'bHeld',
  }));
  const refreshA = one(edgesTo(output, refresh, 'bInputA'), 'refresh input A');
  const refreshB = one(edgesTo(output, refresh, 'bInputB'), 'refresh input B');
  assert.equal(endpoint(refreshA), endpoint(cycleUp));
  assert.equal(endpoint(refreshB), endpoint(cycleDown));
  assert.equal(output.edges.filter(edge => edge.a === turnRight.brick.key).length, 2);
  assert.equal(output.edges.filter(edge => edge.a === turnLeft.brick.key).length, 2);
  assert.equal(edgesFrom(output, cycle, 'Output').length, 10);
  assert.equal(edgesFrom(output, refresh, 'bOutput').length, 10);

  // With reversed arrays, Cycle index 113 is spread 1, index 112 is spread 2,
  // and index 0 is the final 227/blank spread. The native Cycle wraps at both
  // ends, matching the approved single-page controller.
  for (let index = 0; index < spreadCount; index += 1) {
    const logicalSpread = spreadCount - 1 - index;
    assert(logicalSpread >= 0 && logicalSpread < spreadCount);
    for (const key of PAGE_KEYS) {
      assert.notEqual(sidePages(data[key], 'left')[logicalSpread], undefined);
      assert.notEqual(sidePages(data[key], 'right')[logicalSpread], undefined);
    }
  }

  const donorAssets = donor.r.externalAssets();
  assert.deepEqual(externalAssets.slice(0, donorAssets.length), donorAssets,
    'Donor external assets changed or moved');
  const donorBundle = JSON.parse(Buffer.from(donor.r.fs.readFile('Meta/Bundle.json')));
  const outputBundle = JSON.parse(Buffer.from(output.r.fs.readFile('Meta/Bundle.json')));
  assert.equal(outputBundle.name, 'Newton Opticks - Large Two-Page Live Geometry Edition');
  assert.equal(outputBundle.description,
    'Complete Isaac Newton Opticks text and source-derived live-geometry Braille figures in a large synchronized two-page spread. Each page turn advances two source pages.');
  const normalizedBundle = structuredClone(outputBundle);
  normalizedBundle.name = donorBundle.name;
  normalizedBundle.description = donorBundle.description;
  assert.deepEqual(normalizedBundle, donorBundle, 'Donor bundle metadata was not preserved');
  assert.equal(output.r.globalData().GameVersion, donor.r.globalData().GameVersion,
    'Saved game version changed');
  assert.equal(outputBytes[4], donorBytes[4], 'BRZ compression method changed');
  const thumbnailPath = 'Meta/Thumbnail.png';
  const donorHasThumbnail = donor.r.fs.listPaths().includes(thumbnailPath);
  const outputHasThumbnail = output.r.fs.listPaths().includes(thumbnailPath);
  assert.equal(outputHasThumbnail, donorHasThumbnail, 'Thumbnail presence changed');
  if (donorHasThumbnail) {
    assert.deepEqual(Buffer.from(output.r.fs.readFile(thumbnailPath)),
      Buffer.from(donor.r.fs.readFile(thumbnailPath)), 'Donor thumbnail changed');
  }

  const placement = validatePlacement(outputBytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  return {
    sha256: sha256(outputBytes),
    bytes: outputBytes.length,
    sourcePages: data.textPages.length,
    spreads: spreadCount,
    outerBricks: output.bricks.filter(brick => brick.g === outputGrid.outer).length,
    logicGates: innerBricks.length,
    arrays: arrays.length,
    getters: getters.length,
    wires: output.edges.length,
    strictPlacement: placement.strictOk,
    gameVersion: outputBundle.gameVersion,
  };
}

module.exports = test;

if (require.main === module) {
  const [donorPath, outputPath, dataPath] = process.argv.slice(2);
  if (!donorPath || !outputPath || !dataPath) {
    throw new Error('Usage: node test-opticks-two-page-big-book.cjs donor.brz output.brz pages.json');
  }
  console.log(JSON.stringify(test(donorPath, outputPath, dataPath), null, 2));
}

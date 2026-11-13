'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const { read, write } = require('./reskin-loadboard.cjs');

const TYPES = {
  arrayGet: 'BrickComponentType_Exec_ArrayVar_Get',
  button: 'Component_Button',
  cycle: 'BrickComponentType_Exec_Cycle',
  logicalOr: 'BrickComponentType_Expr_LogicalOR',
  text: 'Component_TextDisplay',
};

function component(brick, type) {
  return brick.comps.find(comp => comp.type === type);
}

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function build(input) {
  const scene = read(fs.readFileSync(input));
  const gets = scene.bricks.filter(brick => component(brick, TYPES.arrayGet));
  const displays = scene.bricks.filter(brick => component(brick, TYPES.text));
  const buttons = scene.bricks.filter(brick => component(brick, TYPES.button));
  const cycle = one(scene.bricks.filter(brick => component(brick, TYPES.cycle)), 'page cycle');
  const refresh = one(scene.bricks.filter(brick => component(brick, TYPES.logicalOr)
    && brick.data.position.join() === '0,-20,2'), 'page refresh OR');

  assert.equal(gets.length, 10, 'Opticks reader must have ten page-section getters');
  assert.equal(displays.length, 10, 'New frame must have ten page-section displays');

  const getAt = (x, y) => one(gets.filter(brick => brick.data.position[0] === x
    && brick.data.position[1] === y), `array getter at ${x},${y}`);
  const displayAt = (grid, z) => one(displays.filter(brick => brick.g === grid
    && brick.data.position[2] === z), `display on grid ${grid} at Z ${z}`);
  const leftGrid = one(displays.filter(brick => component(brick, TYPES.text).data.Rotation === 180)
    .map(brick => brick.g).filter((grid, index, all) => all.indexOf(grid) === index), 'left page grid');
  const rightGrid = one(displays.filter(brick => component(brick, TYPES.text).data.Rotation === 0)
    .map(brick => brick.g).filter((grid, index, all) => all.indexOf(grid) === index), 'right page grid');

  const additions = [];
  const ys = [20, 10, 0, -10, -20];
  const leftZs = [-28, -18, -8, 2, 12];
  const rightZs = [28, 18, 8, -2, -12];
  for (let index = 0; index < ys.length; index++) {
    additions.push({ a: getAt(-10, ys[index]).key, at: TYPES.arrayGet, p: 'Value',
      z: displayAt(leftGrid, leftZs[index]).key, zt: TYPES.text, q: 'Text' });
    additions.push({ a: getAt(10, ys[index]).key, at: TYPES.arrayGet, p: 'Value',
      z: displayAt(rightGrid, rightZs[index]).key, zt: TYPES.text, q: 'Text' });
  }

  const leftButton = one(buttons.filter(brick => component(brick, TYPES.button).data.PromptCustomLabel === 'Turn page Left'), 'left page button');
  const rightButton = one(buttons.filter(brick => component(brick, TYPES.button).data.PromptCustomLabel === 'Turn page Right'), 'right page button');
  additions.push(
    { a: rightButton.key, at: TYPES.button, p: 'bHeld', z: cycle.key, zt: TYPES.cycle, q: 'Exec' },
    { a: leftButton.key, at: TYPES.button, p: 'bHeld', z: cycle.key, zt: TYPES.cycle, q: 'ExecDown' },
    { a: rightButton.key, at: TYPES.button, p: 'bHeld', z: refresh.key, zt: TYPES.logicalOr, q: 'bInputA' },
    { a: leftButton.key, at: TYPES.button, p: 'bHeld', z: refresh.key, zt: TYPES.logicalOr, q: 'bInputB' },
  );

  const target = edge => `${edge.z}|${edge.zt}|${edge.q}`;
  const occupied = new Set(scene.edges.map(target));
  for (const edge of additions) {
    assert(!occupied.has(target(edge)), `Input already driven: ${target(edge)}`);
    scene.edges.push(edge);
    occupied.add(target(edge));
  }

  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const output = write(scene, {
    embedded,
    name: 'Newton Opticks - New Book Frame',
    description: 'Existing 119-spread Opticks reader rewired into the supplied articulated two-page frame and its existing page-turn buttons.',
  });
  return { ...output, scene, additions, leftGrid, rightGrid };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node rewire-opticks-book-frame.cjs <input.brz> <output.brz>');
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  const saved = read(result.bytes);
  assert.equal(saved.bricks.length, result.scene.bricks.length);
  assert.equal(saved.edges.length, result.scene.edges.length);
  assert.equal(result.additions.length, 14);
  console.log(JSON.stringify({ output, bricks: saved.bricks.length, wires: saved.edges.length,
    pageDisplayWires: 10, pageButtonWires: 4, spreads: 119 }, null, 2));
}

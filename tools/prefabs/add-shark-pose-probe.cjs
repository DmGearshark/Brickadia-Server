'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {C, B, O} = require('./loadboard-lib.cjs');

const INPUT = '/workspace/attachments/29a059c5-2941-45a1-bddf-4ba3f71f998e/Shark Tail Updated to use crouch.brz';

function component(scene, type, predicate = () => true) {
  const matches = scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type && predicate(brick, comp))
    .map(comp => ({brick, comp, key: brick.key, type: comp.type})));
  assert.equal(matches.length, 1, `Expected one ${type}, found ${matches.length}`);
  return matches[0];
}

function build(input = INPUT) {
  const original = read(fs.readFileSync(input));
  const scene = read(fs.readFileSync(input));

  const getLocation = component(scene, C.Exec_Entity_GetLocation.NAME);
  const getCharacter = component(scene, C.Exec_Character_GetFromController.NAME);
  // Identify the existing capsule comparison by its two incoming entity wires.
  const capsule = scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === C.Expr_CompareEqual.NAME)
    .map(comp => ({brick, comp, key: brick.key, type: comp.type})))
    .find(node => scene.edges.some(e => e.z === node.key && e.zt === node.type && e.q === 'InputB' && e.a === getCharacter.key));
  assert(capsule, 'Existing crouch capsule comparison');

  const sweepTemplate = component(scene, C.Exec_Sweep.NAME);
  const addTemplate = component(scene, C.Expr_MathAdd.NAME, (_brick, comp) =>
    comp.data.InputA?.$variant === 'Vector' && comp.data.InputB?.value?.Z === 20);
  const compareTemplate = capsule;
  const formatTemplate = component(scene, C.Expr_String_FormatText.NAME);
  const displayBrick = scene.bricks.find(brick => brick.g === getLocation.brick.g &&
    brick.comps.some(comp => comp.type === C.TextDisplay.NAME));
  assert(displayBrick, 'Probe display on follower microchip');
  const display = displayBrick.comps.find(comp => comp.type === C.TextDisplay.NAME);
  assert(!scene.edges.some(e => e.z === displayBrick.key && e.zt === C.TextDisplay.NAME && e.q === 'Text'), 'Display Text input is free');

  const grid = getLocation.brick.g;
  const heights = [0, 10, 20, 30, 40, 50];
  const created = [];
  function node(template, suffix, position, data) {
    const key = `pose-probe:${suffix}`;
    const brick = {
      key,
      g: grid,
      data: {
        ...structuredClone(template.brick.data),
        position,
        direction: 4,
        rotation: 0,
        color: [45, 180, 220],
      },
      comps: [{type: template.type, data: {...structuredClone(template.comp.data), ...data}}],
    };
    scene.bricks.push(brick);
    const result = {key, type: template.type, brick, comp: brick.comps[0]};
    created.push(result);
    return result;
  }
  function wire(a, p, z, q) {
    assert(!scene.edges.some(e => e.z === z.key && e.zt === z.type && e.q === q), `Occupied input ${z.key}.${q}`);
    scene.edges.push({a: a.key, at: a.type, p, z: z.key, zt: z.type, q});
  }

  const comparisons = [];
  const sweeps = [];
  for (let i = 0; i < heights.length; i++) {
    const height = heights[i];
    const x = 180 + i * 40;
    const add = node(addTemplate, `origin-${height}`, [x, 20, 2], {
      InputB: {$variant: 'Vector', value: {X: 0, Y: 0, Z: height}},
    });
    const sweep = node(sweepTemplate, `sweep-${height}`, [x, 60, 2], {
      Direction: {X: 1, Y: 0, Z: 0},
      Distance: 10,
      Radius: 0,
      bRelative: false,
      bIgnoreOwningGrid: true,
      CollisionChannel: 8,
      bDetectBricks: false,
      bDetectPlayers1: true,
      bDetectPlayers2: true,
      bDetectPlayers3: true,
      bDetectPlayers4: true,
      bOnlyHitPlayerBodyParts: true,
      bDetectPhysics: false,
      bDetectMap: false,
    });
    const compare = node(compareTemplate, `self-${height}`, [x, 100, 2], {
      InputA: O(null),
      InputB: O(null),
    });
    wire(getLocation, 'Vector', add, 'InputA');
    wire(add, 'Output', sweep, 'Origin');
    wire(sweep, 'HitEntity', compare, 'InputA');
    wire(getCharacter, 'Character', compare, 'InputB');
    if (i === 0) wire(getLocation, 'ExecOut', sweep, 'Exec');
    else wire(sweeps.at(-1), 'ExecOut', sweep, 'Exec');
    sweeps.push(sweep);
    comparisons.push(compare);
  }

  const format = node(formatTemplate, 'report', [300, 150, 2], {
    FormatString: 'BODY-PART POSE PROBE\\nStand, crouch, then use the sit emote.\\nZ+0: {A}   Z+10: {B}\\nZ+20: {C}  Z+30: {D}\\nZ+40: {E}  Z+50: {F}\\nCapsule Z+20: {G}',
    InputA: B(false), InputB: B(false), InputC: B(false), InputD: B(false),
    InputE: B(false), InputF: B(false), InputG: B(false),
  });
  comparisons.forEach((compare, i) => wire(compare, 'bOutput', format, `Input${String.fromCharCode(65 + i)}`));
  wire(capsule, 'bOutput', format, 'InputG');
  wire(format, 'Output', {key: displayBrick.key, type: C.TextDisplay.NAME}, 'Text');

  display.Text = 'BODY-PART POSE PROBE';
  display.LineHeight = 1.25;
  display.LineOffset = 0;
  display.WidthScale = 0.8;
  display.Offset = {X: 0, Y: 0, Z: 0};
  display.bEnabled = true;
  display.bForeground = true;

  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const result = write(scene, {embedded, name: 'Shark Tail - Body Part Pose Probe'});
  const reread = read(result.bytes);
  assert.equal(reread.bricks.length, original.bricks.length + 19);
  assert.equal(reread.edges.length, original.edges.length + 38);
  assert.equal(reread.links.length, original.links.length);
  assert.deepEqual(reread.r.externalAssets(), original.r.externalAssets());
  return {bytes: result.bytes, original, scene: reread, grid, heights, created};
}

module.exports = build;
if (require.main === module) {
  const [input = INPUT, output = 'prefabs/shark-tail-body-part-pose-probe.brz'] = process.argv.slice(2);
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({output, grid: result.grid, heights: result.heights, addedGates: result.created.length}, null, 2));
}

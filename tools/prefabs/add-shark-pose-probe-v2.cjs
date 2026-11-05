'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {C, N} = require('./loadboard-lib.cjs');

const INPUT = '/workspace/attachments/29a059c5-2941-45a1-bddf-4ba3f71f998e/Shark Tail Updated to use crouch.brz';

function one(scene, type, predicate = () => true) {
  const found = scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type && predicate(brick, comp))
    .map(comp => ({brick, comp, key: brick.key, type: comp.type})));
  assert.equal(found.length, 1, `Expected one ${type}, found ${found.length}`);
  return found[0];
}

function build(input = INPUT) {
  const original = read(fs.readFileSync(input));
  const scene = read(fs.readFileSync(input));
  const getLocation = one(scene, C.Exec_Entity_GetLocation.NAME);
  const sweepTemplate = one(scene, C.Exec_Sweep.NAME);
  const addTemplate = one(scene, C.Expr_MathAdd.NAME, (_brick, comp) =>
    comp.data.InputA?.$variant === 'Vector' && comp.data.InputB?.value?.Z === 20);
  const formatTemplate = one(scene, C.Expr_String_FormatText.NAME);
  const displayBrick = scene.bricks.find(brick => brick.g === getLocation.brick.g &&
    brick.comps.some(comp => comp.type === C.TextDisplay.NAME));
  assert(displayBrick, 'Follower chip display');
  const display = displayBrick.comps.find(comp => comp.type === C.TextDisplay.NAME);
  assert(!scene.edges.some(e => e.z === displayBrick.key && e.zt === C.TextDisplay.NAME && e.q === 'Text'));

  const created = [];
  const grid = getLocation.brick.g;
  function node(template, suffix, position, data) {
    const brick = {
      key: `pose-probe-v2:${suffix}`,
      g: grid,
      data: {
        ...structuredClone(template.brick.data),
        position,
        direction: 4,
        rotation: 0,
        color: [230, 135, 35],
      },
      comps: [{type: template.type, data: {...structuredClone(template.comp.data), ...data}}],
    };
    scene.bricks.push(brick);
    const result = {key: brick.key, type: template.type, brick, comp: brick.comps[0]};
    created.push(result);
    return result;
  }
  function wire(a, p, z, q) {
    assert(!scene.edges.some(e => e.z === z.key && e.zt === z.type && e.q === q), `Occupied ${z.key}.${q}`);
    scene.edges.push({a: a.key, at: a.type, p, z: z.key, zt: z.type, q});
  }
  function sweepData(direction, distance) {
    return {
      Direction: direction,
      Distance: distance,
      Radius: 2,
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
    };
  }

  const heights = [0, 10, 20, 30, 40, 50];
  const sweeps = [];
  for (let i = 0; i < heights.length; i++) {
    const height = heights[i], x = 180 + i * 40;
    const origin = node(addTemplate, `horizontal-origin-${height}`, [x, 20, 2], {
      InputB: {$variant: 'Vector', value: {X: -30, Y: 0, Z: height}},
    });
    const sweep = node(sweepTemplate, `horizontal-${height}`, [x, 60, 2], sweepData({X: 1, Y: 0, Z: 0}, 60));
    wire(getLocation, 'Vector', origin, 'InputA');
    wire(origin, 'Output', sweep, 'Origin');
    if (i === 0) wire(getLocation, 'ExecOut', sweep, 'Exec');
    else wire(sweeps.at(-1), 'ExecOut', sweep, 'Exec');
    sweeps.push(sweep);
  }

  const verticalOrigin = node(addTemplate, 'vertical-origin', [420, 20, 2], {
    InputB: {$variant: 'Vector', value: {X: 0, Y: 0, Z: 80}},
  });
  const verticalSweep = node(sweepTemplate, 'vertical', [420, 60, 2], sweepData({X: 0, Y: 0, Z: -1}, 120));
  wire(getLocation, 'Vector', verticalOrigin, 'InputA');
  wire(verticalOrigin, 'Output', verticalSweep, 'Origin');
  wire(sweeps.at(-1), 'ExecOut', verticalSweep, 'Exec');

  const format = node(formatTemplate, 'report', [300, 120, 2], {
    FormatString: 'ANIMATED BODY COLLISION PROBE\\nDistances below the maximum mean HIT.\\nZ+0: {A}   Z+10: {B}\\nZ+20: {C}  Z+30: {D}\\nZ+40: {E}  Z+50: {F}\\nTOP DOWN (max 120): {G}',
    InputA: N(60), InputB: N(60), InputC: N(60), InputD: N(60),
    InputE: N(60), InputF: N(60), InputG: N(120),
  });
  sweeps.forEach((sweep, i) => wire(sweep, 'HitDistance', format, `Input${String.fromCharCode(65 + i)}`));
  wire(verticalSweep, 'HitDistance', format, 'InputG');
  wire(format, 'Output', {key: displayBrick.key, type: C.TextDisplay.NAME}, 'Text');

  display.Text = 'ANIMATED BODY COLLISION PROBE';
  display.LineHeight = 1.15;
  display.LineOffset = 0;
  display.WidthScale = 0.72;
  display.Offset = {X: 0, Y: 0, Z: 0};
  display.bEnabled = true;
  display.bForeground = true;

  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const out = write(scene, {embedded, name: 'Shark Tail - Outside-In Pose Probe'});
  const reread = read(out.bytes);
  assert.equal(reread.bricks.length, original.bricks.length + 15);
  assert.equal(reread.edges.length, original.edges.length + 29);
  assert.equal(reread.links.length, original.links.length);
  assert.deepEqual(reread.r.externalAssets(), original.r.externalAssets());
  return {bytes: out.bytes, original, scene: reread, heights, created};
}

module.exports = build;
if (require.main === module) {
  const [input = INPUT, output = 'prefabs/shark-tail-body-part-pose-probe-v2.brz'] = process.argv.slice(2);
  const result = build(input);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({output, heights: result.heights, outsideInSweeps: 7, addedGates: result.created.length}, null, 2));
}

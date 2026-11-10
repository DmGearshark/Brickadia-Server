'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

module.exports = function testMidiDecodeFunctionProbe(ctx) {
  const scene = read(ctx.bytes);
  const components = scene.bricks.flatMap(brick => brick.comps);

  assert.equal(components.filter(component => component.type === C.Button.NAME).length, 1,
    'Probe must have exactly one run button');
  assert.equal(components.filter(component => component.type === C.FunctionCall.NAME).length, 2,
    'Probe must have exactly two same-tick FunctionCalls');
  assert.equal(components.filter(component => component.type === C.Microchip_FunctionDefinition.NAME).length, 1,
    'Probe must have exactly one FunctionDefinition');
  assert.equal(components.filter(component => component.type === C.FunctionInput.NAME).length, 1,
    'DecodeNote must have exactly one input');
  assert.equal(components.filter(component => component.type === C.FunctionOutput.NAME).length, 4,
    'DecodeNote must have exactly four outputs');
  assert.equal(components.filter(component => component.type === C.Expr_SplitQuaternion.NAME).length, 1,
    'DecodeNote must split its packed note once');
  assert.equal(components.filter(component => component.type === C.Expr_MathPow.NAME).length, 2,
    'DecodeNote must contain pitch and velocity power calculations');

  const calls = components.filter(component => component.type === C.FunctionCall.NAME);
  for (const call of calls) {
    assert.deepEqual(call.data.InputSources, [1, 0, 0, 0, 0, 0, 0, 0],
      'Only the Quaternion call input should override its definition default');
    assert.equal(call.data.Input0.$variant, 'Quat');
  }
  assert.deepEqual(new Set(calls.map(call => JSON.stringify(call.data.Input0.value))),
    new Set(Object.values(ctx.NOTES).map(note => JSON.stringify(note))),
    'FunctionCalls must carry the two intended distinct note records');

  const input = components.find(component => component.type === C.FunctionInput.NAME);
  assert.equal(input.data.DefaultValue.$variant, 'Quat');
  assert.deepEqual(input.data.DefaultValue.value, ctx.NOTES.a);

  const powers = components.filter(component => component.type === C.Expr_MathPow.NAME);
  assert(powers.some(component => component.data.Input === 2),
    'Pitch power must retain raw base 2');
  assert(powers.some(component => component.data.Exponent === 1.4),
    'Velocity power must retain raw exponent 1.4');

  const labels = components
    .filter(component => component.type === C.Interact.NAME && component.data.Message?.startsWith('MDFP1:'))
    .map(component => component.data.Message);
  assert.equal(new Set(labels).size, labels.length, 'Saved-result labels must be unique');
  for (const {label, node} of ctx.records) {
    const brick = scene.bricks.find(candidate => candidate.comps.some(component =>
      component.type === C.Interact.NAME && component.data.Message === `MDFP1:${label}`));
    assert(brick, `Missing saved result ${label}`);
    assert.deepEqual(brick.comps.find(component => component.type === C.Var.NAME).data.Value,
      node.data.Value, `Saved result ${label} changed during serialization`);
  }

  const functionLink = scene.links.find(link => scene.bricks.find(brick => brick.key === link.key)
    ?.comps.some(component => component.type === C.Microchip_FunctionDefinition.NAME));
  assert(functionLink, 'Function definition has no callable grid link');
  assert(!scene.bricks.filter(brick => brick.g === functionLink.grid)
    .some(brick => brick.comps.some(component => component.type === C.Interact.NAME)),
  'Callable grid must not contain attachment annotations rejected by the engine');
  assert(!scene.bricks.filter(brick => brick.g === functionLink.grid)
    .some(brick => brick.comps.some(component => component.type === C.Var.NAME)),
  'Pure DecodeNote callable must not contain shared persistent Vars');

  const callExecEdges = ctx.b.edges.filter(edge =>
    Object.values(ctx.callers).some(caller => caller.call === edge.z) && edge.q === 'Exec');
  assert.equal(callExecEdges.length, 2, 'Both calls need one execution source');
  assert.equal(new Set(callExecEdges.map(edge => `${edge.a.id}|${edge.p}`)).size, 1,
    'Both calls must fan out from the same exact execution output');
  for (const caller of Object.values(ctx.callers)) {
    assert(ctx.b.edges.some(edge => edge.a === ctx.fn.node && edge.p === 'Definition'
      && edge.z === caller.call && edge.q === 'Definition'),
    `${caller.name} does not share the DecodeNote definition`);
  }

  const targets = new Set();
  for (const edge of scene.edges) {
    const source = scene.bricks.find(brick => brick.key === edge.a);
    const target = scene.bricks.find(brick => brick.key === edge.z);
    assert(source?.comps.some(component => component.type === edge.at),
      `Missing source component for ${edge.at}.${edge.p}`);
    assert(target?.comps.some(component => component.type === edge.zt),
      `Missing target component for ${edge.zt}.${edge.q}`);
    const key = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(key), `Duplicate input wire ${key}`);
    targets.add(key);
    const sourceDefinition = Object.values(C).find(definition => definition.NAME === edge.at);
    const targetDefinition = Object.values(C).find(definition => definition.NAME === edge.zt);
    assert(Object.values(sourceDefinition.PORTS).includes(edge.p), `Unknown source port ${edge.p}`);
    assert(Object.values(targetDefinition.PORTS).includes(edge.q), `Unknown target port ${edge.q}`);
  }
  assert.equal(scene.edges.length, ctx.b.edges.length, 'Serialized wire count changed');

  // Direct variable references are confined to their owning grid.  The only
  // callable boundary values are the Definition and ordinary WireValue ports.
  for (const edge of ctx.b.edges) {
    if (edge.q === 'VarRef') {
      assert.equal(edge.a.grid, edge.z.grid, 'VarRef crossed a callable boundary');
    }
  }

  console.log('MIDI DecodeNote probe serialization checks passed: one Quaternion input, '
    + 'four function outputs, two same-tick callers, retained diagnostics, pure callable state, and all wire endpoints. '
    + 'Engine execution and slot ordering remain intentionally unproven until re-export.');
};

'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

const PREFIX = 'MWAP1:';

module.exports = function testMidiWaveformAuditionProbeV1(ctx) {
  const scene = read(ctx.bytes);
  const placement = validatePlacement(ctx.bytes);
  assert.equal(placement.invalidBricks.length, 0,
    `Invalid probe bricks: ${JSON.stringify(placement.invalidBricks)}`);
  assert.equal(placement.confirmedPairs.length, 0,
    `Confirmed probe overlaps: ${JSON.stringify(placement.confirmedPairs)}`);
  assert.equal(placement.uncertainPairs.length, 0,
    `Uncertain probe overlaps: ${JSON.stringify(placement.uncertainPairs)}`);
  assert.equal(placement.warnings.length, 0,
    `Probe placement warnings: ${JSON.stringify(placement.warnings)}`);
  assert.equal(placement.strictOk, true, 'Probe placement must pass strict validation');

  const components = scene.bricks.flatMap(brick => brick.comps
    .map(component => ({brick, component})));
  const ofType = type => components.filter(item => item.component.type === type);
  const marker = (brick, prefix) => brick.comps.find(component =>
    component.type === C.Interact.NAME && component.data.Message?.startsWith(prefix));

  assert.equal(scene.links.length, 0, 'Probe should not rely on hidden microchip-grid wiring');
  assert(scene.bricks.every(brick => brick.g === 1), 'Every probe brick must remain on the visible main grid');
  assert.deepEqual(scene.r.externalAssets(), ctx.EXTERNAL_ASSETS,
    'Font and four synth descriptor assets changed during serialization');

  const buttons = ofType(C.Button.NAME);
  assert.equal(buttons.length, 5, 'Expected four dynamic buttons plus one direct/static Sine button');
  const dynamicButtons = buttons.filter(({brick}) => marker(brick, `${PREFIX}button:dynamic:`));
  const directButtons = buttons.filter(({brick}) => marker(brick, `${PREFIX}button:direct:`));
  assert.equal(dynamicButtons.length, 4, 'Expected four visibly marked dynamic audition buttons');
  assert.equal(directButtons.length, 1, 'Expected one visibly marked direct/static button');
  for (const [index, wave] of ctx.WAVES.entries()) {
    const item = dynamicButtons.find(({brick}) => marker(brick,
      `${PREFIX}button:dynamic:${index}:${wave.label}`));
    assert(item, `Missing ${wave.label} dynamic audition button`);
    assert(item.component.data.PromptCustomLabel.includes(wave.label.toUpperCase()),
      `${wave.label} button prompt is not explicit`);
    const heldEdges = scene.edges.filter(edge => edge.a === item.brick.key
      && edge.at === C.Button.NAME && edge.p === 'bHeld');
    assert.equal(heldEdges.length, 2,
      `${wave.label} button must visibly drive selection and shared-emitter enable logic`);
    assert(heldEdges.some(edge => edge.zt === C.Expr_EdgeDetectorExec.NAME && edge.q === 'Input'),
      `${wave.label} button has no selection edge path`);
    assert(heldEdges.some(edge => edge.zt === C.Expr_LogicalOR.NAME),
      `${wave.label} button has no dynamic audition-enable path`);
  }

  const references = ofType(C.AudioReference.NAME);
  assert.equal(references.length, 4, 'Expected one shared AudioReference for each waveform');
  for (const [index, wave] of ctx.WAVES.entries()) {
    const candidates = references.filter(({component}) => component.data.Asset === index + 1);
    assert.equal(candidates.length, 1, `Expected one ${wave.label} AudioReference`);
    assert.deepEqual(scene.r.externalAssets()[candidates[0].component.data.Asset],
      {type: 'BrickAudioDescriptor', name: wave.asset}, `${wave.label} reference resolves incorrectly`);
    const outputs = scene.edges.filter(edge => edge.a === candidates[0].brick.key
      && edge.at === C.AudioReference.NAME && edge.p === 'Value');
    assert.equal(outputs.length, 1, `${wave.label} AudioReference must feed the selector tree once`);
    assert.equal(outputs[0].zt, C.Expr_Select.NAME);
    assert(['InputA', 'InputB'].includes(outputs[0].q));
  }

  const emitters = ofType(C.AudioEmitter.NAME);
  assert.equal(emitters.length, 2,
    'Expected one dynamically selected emitter and one direct/static diagnostic emitter');
  assert.equal(ofType(C.OneShotAudioEmitter.NAME).length, 0,
    'Probe must use continuous AudioEmitters only');
  for (const {component} of emitters) {
    assert.equal(component.data.bEnabled, false, 'Every emitter must default off');
    assert(Math.abs(component.data.VolumeMultiplier - 0.02) < 1e-6,
      'Every emitter must retain safe volume 0.02');
    assert.equal(component.data.PitchMultiplier, 1, 'Every emitter must retain fixed pitch 1.0');
    assert.equal(component.data.MaxDistance, 800, 'Every emitter must retain local audition range');
    assert.equal(component.data.bSpatialization, true, 'Every emitter must remain spatialized');
  }
  const dynamicEmitter = emitters.find(({component}) => component.data.AudioDescriptor === null);
  const directEmitter = emitters.find(({component}) => component.data.AudioDescriptor === 1);
  assert(dynamicEmitter, 'Missing emitter whose descriptor is supplied entirely by a wire');
  assert(directEmitter, 'Missing direct/static Sine emitter');
  assert.deepEqual(scene.r.externalAssets()[directEmitter.component.data.AudioDescriptor],
    {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'});

  const descriptorInput = scene.edges.filter(edge => edge.z === dynamicEmitter.brick.key
    && edge.zt === C.AudioEmitter.NAME && edge.q === 'AudioDescriptor');
  assert.equal(descriptorInput.length, 1, 'Dynamic emitter needs exactly one descriptor source');
  assert.equal(descriptorInput[0].at, C.Expr_Select.NAME,
    'Dynamic emitter descriptor must come from the final generic Expr_Select');
  const dynamicEnable = scene.edges.filter(edge => edge.z === dynamicEmitter.brick.key
    && edge.zt === C.AudioEmitter.NAME && edge.q === 'bEnabled');
  assert.equal(dynamicEnable.length, 1, 'Dynamic emitter needs one held-button enable path');
  assert.equal(dynamicEnable[0].at, C.Expr_LogicalOR.NAME);

  const directEnable = scene.edges.filter(edge => edge.z === directEmitter.brick.key
    && edge.zt === C.AudioEmitter.NAME && edge.q === 'bEnabled');
  assert.equal(directEnable.length, 1, 'Direct/static emitter needs exactly one control wire');
  assert.equal(directEnable[0].a, directButtons[0].brick.key,
    'Direct/static Sine button must wire straight to the direct emitter');
  assert.equal(directEnable[0].at, C.Button.NAME);
  assert.equal(directEnable[0].p, 'bHeld');

  // Recursively prove that the dynamic emitter's final select has exactly the
  // four AudioReference leaves and no saved direct-descriptor shortcut.
  const seen = new Set();
  function descriptorLeaves(brickKey, type) {
    const key = `${brickKey}|${type}`;
    assert(!seen.has(key), `Cycle in descriptor selector topology at ${key}`);
    seen.add(key);
    const brick = scene.bricks.find(candidate => candidate.key === brickKey);
    assert(brick, `Missing selector source brick ${brickKey}`);
    if (type === C.AudioReference.NAME) {
      const reference = brick.comps.find(component => component.type === type);
      return [scene.r.externalAssets()[reference.data.Asset].name];
    }
    assert.equal(type, C.Expr_Select.NAME, `Unexpected descriptor source type ${type}`);
    const inputs = ['InputA', 'InputB'].map(port => {
      const edges = scene.edges.filter(edge => edge.z === brickKey
        && edge.zt === type && edge.q === port);
      assert.equal(edges.length, 1, `Descriptor select ${brickKey}.${port} needs one source`);
      return edges[0];
    });
    return inputs.flatMap(edge => descriptorLeaves(edge.a, edge.at));
  }
  const leaves = descriptorLeaves(descriptorInput[0].a, descriptorInput[0].at).sort();
  assert.deepEqual(leaves, ctx.WAVES.map(wave => wave.asset).sort(),
    'Dynamic descriptor selector leaves changed');

  const selectedDescriptorFanout = scene.edges.filter(edge => edge.a === descriptorInput[0].a
    && edge.at === C.Expr_Select.NAME && edge.p === 'Output');
  assert(selectedDescriptorFanout.some(edge => edge.z === dynamicEmitter.brick.key
    && edge.q === 'AudioDescriptor'), 'Final descriptor select does not drive the emitter');
  assert(selectedDescriptorFanout.some(edge => edge.zt === C.Expr_ChangeDetectorExec.NAME
    && edge.q === 'Input'), 'Final descriptor select does not drive the change diagnostic');

  const labels = ofType(C.Interact.NAME)
    .map(({component}) => component.data.Message)
    .filter(message => message?.startsWith(PREFIX));
  assert.equal(new Set(labels).size, labels.length, 'Probe state/button labels must be unique');
  for (const {label, node} of ctx.records) {
    const brick = scene.bricks.find(candidate => candidate.comps.some(component =>
      component.type === C.Interact.NAME && component.data.Message === `${PREFIX}${label}`));
    assert(brick, `Missing saved state ${label}`);
    assert.deepEqual(brick.comps.find(component => component.type === C.Var.NAME).data.Value,
      node.data.Value, `Saved state ${label} changed during serialization`);
  }

  const targets = new Set();
  for (const edge of scene.edges) {
    const source = scene.bricks.find(brick => brick.key === edge.a);
    const target = scene.bricks.find(brick => brick.key === edge.z);
    assert(source?.comps.some(component => component.type === edge.at),
      `Missing source component for ${edge.at}.${edge.p}`);
    assert(target?.comps.some(component => component.type === edge.zt),
      `Missing target component for ${edge.zt}.${edge.q}`);
    const targetKey = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(targetKey), `Duplicate input wire ${targetKey}`);
    targets.add(targetKey);
    const sourceDefinition = Object.values(C).find(definition => definition.NAME === edge.at);
    const targetDefinition = Object.values(C).find(definition => definition.NAME === edge.zt);
    assert(Object.values(sourceDefinition.PORTS).includes(edge.p), `Unknown source port ${edge.p}`);
    assert(Object.values(targetDefinition.PORTS).includes(edge.q), `Unknown target port ${edge.q}`);
  }
  assert.equal(scene.edges.length, ctx.b.edges.length, 'Serialized wire count changed');

  console.log('MIDI waveform audition probe V1 checks passed: strict placement, five visibly wired '
    + 'controls, four AudioReferences, a four-leaf object selector, one dynamic emitter, one direct '
    + 'Sine diagnostic emitter, safe defaults, persistent diagnostics, and all wire endpoints.');
};

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const file = process.argv[2];
if (!file) throw new Error('Usage: node read-midi-waveform-audition-probe-v1.cjs <returned.brz>');

const bytes = fs.readFileSync(file);
const scene = read(bytes);
const assets = scene.r.externalAssets();
const expectedWaves = [
  'BA_Synth_Basic_Sine',
  'BA_Synth_Basic_Triangle',
  'BA_Synth_Basic_Square',
  'BA_Synth_Basic_Sawtooth',
];
const PREFIX = 'MWAP1:';

function value(wireValue) {
  if (typeof wireValue === 'number' || typeof wireValue === 'boolean') return wireValue;
  return wireValue && typeof wireValue === 'object' && 'value' in wireValue
    ? wireValue.value : wireValue;
}

const state = {};
const buttonLabels = [];
const references = [];
const emitters = [];
for (const brick of scene.bricks) {
  const markers = brick.comps.filter(component => component.type === C.Interact.NAME
    && component.data.Message?.startsWith(PREFIX));
  const variable = brick.comps.find(component => component.type === C.Var.NAME);
  for (const marker of markers) {
    const label = marker.data.Message.slice(PREFIX.length);
    if (variable && !label.startsWith('button:')) state[label] = value(variable.data.Value);
    if (label.startsWith('button:')) buttonLabels.push(label);
  }
  const reference = brick.comps.find(component => component.type === C.AudioReference.NAME);
  if (reference) references.push({
    index: reference.data.Asset,
    asset: assets[reference.data.Asset] || null,
  });
  const emitter = brick.comps.find(component => component.type === C.AudioEmitter.NAME);
  if (emitter) emitters.push({brick, component: emitter});
}

// A fresh procedural save retains null in a wired AudioDescriptor field. A
// live Brickadia re-export snapshots the currently resolved asset index into
// that same field while preserving the wire. Identify the dynamic emitter by
// topology rather than by its local fallback value so both forms read alike.
const descriptorWires = ({brick}) => scene.edges.filter(edge =>
  edge.z === brick.key && edge.zt === C.AudioEmitter.NAME
    && edge.q === 'AudioDescriptor');
const dynamicCandidates = emitters.filter(emitter => descriptorWires(emitter).length > 0);
const directCandidates = emitters.filter(emitter => descriptorWires(emitter).length === 0);
const dynamicEmitter = dynamicCandidates.length === 1 ? dynamicCandidates[0] : null;
const directEmitter = directCandidates.length === 1 ? directCandidates[0] : null;
const dynamicDescriptorWires = dynamicEmitter ? descriptorWires(dynamicEmitter) : [];
const dynamicEnableWires = dynamicEmitter ? scene.edges.filter(edge =>
  edge.z === dynamicEmitter.brick.key && edge.zt === C.AudioEmitter.NAME
    && edge.q === 'bEnabled') : [];
const directEnableWires = directEmitter ? scene.edges.filter(edge =>
  edge.z === directEmitter.brick.key && edge.zt === C.AudioEmitter.NAME
    && edge.q === 'bEnabled') : [];

const referenceNames = references.map(item => item.asset?.name).sort();
const expectedNames = expectedWaves.slice().sort();
const structureIntact = references.length === 4
  && JSON.stringify(referenceNames) === JSON.stringify(expectedNames)
  && emitters.length === 2
  && dynamicCandidates.length === 1
  && directCandidates.length === 1
  && directEmitter?.component.data.AudioDescriptor != null
  && assets[directEmitter.component.data.AudioDescriptor]?.name === 'BA_Synth_Basic_Sine'
  && dynamicDescriptorWires.length === 1
  && dynamicDescriptorWires[0].at === C.Expr_Select.NAME
  && dynamicEnableWires.length === 1
  && directEnableWires.length === 1
  && buttonLabels.filter(label => label.startsWith('button:dynamic:')).length === 4
  && buttonLabels.filter(label => label.startsWith('button:direct:')).length === 1;

const selectedIndex = Number(state.selectedIndex);
const presses = Number(state.auditionPresses);
const changes = Number(state.descriptorChanges);
const selectedName = ['Sine', 'Triangle', 'Square', 'Sawtooth'][selectedIndex] ?? null;
const exactProcedureObserved = Number.isFinite(presses) && presses >= 5
  && Number.isFinite(changes) && changes >= 4
  && selectedIndex === 0;
const objectSwitchingObserved = Number.isFinite(changes) && changes >= 4;

let interpretation;
if (!structureIntact) {
  interpretation = 'Returned save no longer contains the complete direct/dynamic diagnostic structure.';
} else if (exactProcedureObserved) {
  interpretation = 'The exact five-press dynamic sequence ran, finished on Sine, and the object-valued descriptor selector changed at least four times. Combine this with the audible report: direct Sine and dynamic Sine should match, while Triangle, Square and Sawtooth should differ.';
} else if (Number.isFinite(presses) && presses >= 5 && !objectSwitchingObserved) {
  interpretation = 'Buttons executed, but the post-selector object change counter did not establish descriptor switching. If direct Sine sounded and dynamic buttons did not, treat AudioReference/Expr_Select object selection as the failing boundary.';
} else if (objectSwitchingObserved && selectedIndex === 0) {
  interpretation = `The selector changed at least four times and finished on Sine, but only ${presses} dynamic presses were retained instead of the requested five. Run Dynamic Sine, Triangle, Square, Sawtooth, Sine again with a full release between buttons, then report which controls were audible and whether Direct Sine matched Dynamic Sine.`;
} else {
  interpretation = 'The exact dynamic test sequence is incomplete. Hold direct Sine, then dynamic Sine, Triangle, Square, Sawtooth and Sine, releasing each before the next; export the whole assembly again.';
}

console.log(JSON.stringify({
  passed: structureIntact && exactProcedureObserved,
  structureIntact,
  exactProcedureObserved,
  objectSwitchingObserved,
  state: {...state, selectedName},
  buttons: buttonLabels.sort(),
  references,
  emitters: emitters.map((emitter) => ({
    role: emitter === dynamicEmitter ? 'dynamic' : emitter === directEmitter ? 'direct' : 'unknown',
    component: emitter.component,
  })).map(({role, component}) => ({
    role,
    descriptorIndex: component.data.AudioDescriptor,
    descriptor: Number.isInteger(component.data.AudioDescriptor)
      ? assets[component.data.AudioDescriptor] : 'wired Expr_Select output',
    enabledFallback: component.data.bEnabled,
    volume: component.data.VolumeMultiplier,
    pitch: component.data.PitchMultiplier,
  })),
  dynamicDescriptorWires: dynamicDescriptorWires.length,
  dynamicEnableWires: dynamicEnableWires.length,
  directEnableWires: directEnableWires.length,
  bricks: scene.bricks.length,
  wires: scene.edges.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  interpretation,
}, null, 2));

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const assembleExpandedShell = require('./assemble-sqm1-expanded-ui-shell-v1.cjs');
const patchControls = require('./patch-sqm1-user-player-controls-v1.cjs');
const pianoEnvelope = require('./apply-sqm1-piano-envelope-v1.cjs');
const pianoRelease = require('./apply-sqm1-piano-release-v1.cjs');
const pianoDecay = require('./apply-sqm1-piano-decay-v2.cjs');
const pianoSingleSource = require('./apply-sqm1-piano-single-source-v1.cjs');
const denseProfilePolicy = require('./apply-sqm1-dense-profile-source-policy-v1.cjs');
const {C} = require('./loadboard-lib.cjs');

const MAX_VOICES = 24;
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v8-24.brz');

function build(options = {}) {
  const maxVoices = options.maxVoices ?? MAX_VOICES;
  assert.equal(maxVoices, MAX_VOICES, 'Production V8 is the verified 24-lane build');
  const assembly = assembleExpandedShell({
    maxVoices,
    shellFile: options.shellFile,
    frameFile: options.frameFile,
  });
  const context = patchControls(Buffer.from(assembly.bytes), {
    maxVoices,
    sourceName: 'in-memory preserved-UI 24-lane assembly',
    beforeOptimize(scene) {
      const pianoPreparation = pianoEnvelope.prepare(scene);
      assert.equal(pianoPreparation.voices.length, maxVoices,
        'V8 discovered all expanded lanes');
      const releasePreparation = pianoRelease.prepare(scene, pianoPreparation);
      const singleSourcePreparation = pianoSingleSource.prepare(scene, pianoPreparation);
      const denseProfilePreparation = denseProfilePolicy.prepare(scene, maxVoices);
      return {pianoPreparation, releasePreparation, singleSourcePreparation,
        denseProfilePreparation};
    },
    afterOptimize(scene, preparation) {
      const pianoPatch = pianoEnvelope.apply(scene, preparation.pianoPreparation);
      const releasePatch = pianoRelease.apply(scene, preparation.releasePreparation, pianoPatch);
      const decayPatch = pianoDecay.apply(scene, pianoPatch, releasePatch);
      const singleSourcePatch = pianoSingleSource.apply(scene,
        preparation.singleSourcePreparation, pianoPatch, releasePatch, decayPatch);
      const denseProfilePatch = denseProfilePolicy.apply(scene,
        preparation.denseProfilePreparation, singleSourcePatch);
      return {pianoPatch, releasePatch, decayPatch, singleSourcePatch, denseProfilePatch};
    },
    name: 'SQM1 Auto-Zone Music Player - 24-Lane Protected Piano V8',
    description: 'The exact preserved player UI with a regenerated 24-lane format-1 scheduler. '
      + 'Piano uses one continuously decaying Sine body per lane. Songs with at most 18 encoded '
      + 'voices preserve every non-Piano layer; denser songs disable H3 while retaining body and '
      + 'H2, capping those profiles at 48 enabled sources. V7 bass-aware attack, V6 decay, V5 '
      + 'zero-cut release, controls, automatic cartridge loading and visible UI remain intact.',
  });
  return {
    ...context,
    assembly,
    pianoPatch: context.extension.pianoPatch,
    releasePatch: context.extension.releasePatch,
    decayPatch: context.extension.decayPatch,
    singleSourcePatch: context.extension.singleSourcePatch,
    denseProfilePatch: context.extension.denseProfilePatch,
    constants: {...context.constants, MAX_VOICES, OUTPUT_DEFAULT},
  };
}

build.constants = {MAX_VOICES, OUTPUT_DEFAULT};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v8.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      voices: context.constants.MAX_VOICES,
      emitters: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.AudioEmitter.NAME)).length,
      dampens: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.Dampen.NAME)).length,
      denseProfileGates: context.denseProfilePatch.addedBricks,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const patchControls = require('./patch-sqm1-user-player-controls-v1.cjs');
const pianoEnvelope = require('./apply-sqm1-piano-envelope-v1.cjs');
const pianoRelease = require('./apply-sqm1-piano-release-v1.cjs');
const pianoDecay = require('./apply-sqm1-piano-decay-v2.cjs');
const buildV5 = require('./build-sqm1-piano-player-v5.cjs');
const {C} = require('./loadboard-lib.cjs');

const SOURCE_DEFAULT = path.join(__dirname, 'sources', 'sqm1-working-as-intended-ui.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v6.brz');

function build(sourceFile = SOURCE_DEFAULT) {
  assert(fs.existsSync(sourceFile), `Player source not found: ${sourceFile}`);
  const v5Context = buildV5(sourceFile);
  const context = patchControls(sourceFile, {
    beforeOptimize(scene) {
      const pianoPreparation = pianoEnvelope.prepare(scene);
      const releasePreparation = pianoRelease.prepare(scene, pianoPreparation);
      return {pianoPreparation, releasePreparation};
    },
    afterOptimize(scene, preparation) {
      const pianoPatch = pianoEnvelope.apply(scene, preparation.pianoPreparation);
      const releasePatch = pianoRelease.apply(scene, preparation.releasePreparation, pianoPatch);
      const decayPatch = pianoDecay.apply(scene, pianoPatch, releasePatch);
      return {pianoPatch, releasePatch, decayPatch};
    },
    name: 'SQM1 Auto-Zone Music Player - Pedal-Decay Piano V6',
    description: 'The verified zero-cut Piano V5 with a natural two-stage held-note body and '
      + 'floorless strike partials. The initial hard strike remains exact while sustained and '
      + 'pedal-lengthened notes continuously decay instead of accumulating into a fixed hum. '
      + 'V5 key-off smoothing, exact-zero release, silent post-roll, all three Sine layers, '
      + 'scheduler, controls, cartridge loader and non-Piano profiles remain intact.',
  });
  return {
    ...context,
    v5Context,
    pianoPatch: context.extension.pianoPatch,
    releasePatch: context.extension.releasePatch,
    decayPatch: context.extension.decayPatch,
    constants: {...context.constants, SOURCE_DEFAULT, OUTPUT_DEFAULT},
  };
}

module.exports = build;

if (require.main === module) {
  const [sourceFile = SOURCE_DEFAULT, outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(sourceFile);
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v6.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      sourceFile,
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      addedDecayBricks: context.decayPatch.addedBricks,
      removedFloorBricks: context.decayPatch.removedBricks,
      netDecayBricks: context.decayPatch.netBricks,
      dampens: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.Dampen.NAME)).length,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

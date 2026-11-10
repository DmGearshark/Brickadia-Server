'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const patchControls = require('./patch-sqm1-user-player-controls-v1.cjs');
const pianoEnvelope = require('./apply-sqm1-piano-envelope-v1.cjs');
const pianoRelease = require('./apply-sqm1-piano-release-v1.cjs');
const pianoDecay = require('./apply-sqm1-piano-decay-v2.cjs');
const pianoSingleSource = require('./apply-sqm1-piano-single-source-v1.cjs');
const buildV6 = require('./build-sqm1-piano-player-v6.cjs');
const {C} = require('./loadboard-lib.cjs');

const SOURCE_DEFAULT = path.join(__dirname, 'sources', 'sqm1-working-as-intended-ui.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v7.brz');

function build(sourceFile = SOURCE_DEFAULT) {
  assert(fs.existsSync(sourceFile), `Player source not found: ${sourceFile}`);
  const v6Context = buildV6(sourceFile);
  const context = patchControls(sourceFile, {
    beforeOptimize(scene) {
      const pianoPreparation = pianoEnvelope.prepare(scene);
      const releasePreparation = pianoRelease.prepare(scene, pianoPreparation);
      const singleSourcePreparation = pianoSingleSource.prepare(scene, pianoPreparation);
      return {pianoPreparation, releasePreparation, singleSourcePreparation};
    },
    afterOptimize(scene, preparation) {
      const pianoPatch = pianoEnvelope.apply(scene, preparation.pianoPreparation);
      const releasePatch = pianoRelease.apply(scene, preparation.releasePreparation, pianoPatch);
      const decayPatch = pianoDecay.apply(scene, pianoPatch, releasePatch);
      const singleSourcePatch = pianoSingleSource.apply(scene,
        preparation.singleSourcePreparation, pianoPatch, releasePatch, decayPatch);
      return {pianoPatch, releasePatch, decayPatch, singleSourcePatch};
    },
    name: 'SQM1 Auto-Zone Music Player - Single-Source Piano V7',
    description: 'The verified pedal-decay Piano V6 with one enabled Piano emitter per active '
      + 'lane, protecting all 18 fundamentals from dense-song source pressure. Its former partial '
      + 'loudness is folded into a short body attack, while raw note pitch adds a continuously '
      + 'decaying low-register tail. Non-Piano emitter, volume and pitch paths remain exact. V5 '
      + 'zero-cut release smoothing and silent post-roll, the scheduler, controls, cartridge '
      + 'loader, and UI remain intact.',
  });
  return {
    ...context,
    v6Context,
    pianoPatch: context.extension.pianoPatch,
    releasePatch: context.extension.releasePatch,
    decayPatch: context.extension.decayPatch,
    singleSourcePatch: context.extension.singleSourcePatch,
    constants: {...context.constants, SOURCE_DEFAULT, OUTPUT_DEFAULT},
  };
}

module.exports = build;

if (require.main === module) {
  const [sourceFile = SOURCE_DEFAULT, outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(sourceFile);
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v7.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      sourceFile,
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      addedSingleSourceBricks: context.singleSourcePatch.addedBricks,
      removedSingleSourceBricks: context.singleSourcePatch.removedBricks,
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

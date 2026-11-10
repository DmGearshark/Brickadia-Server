'use strict';

const fs = require('fs');
const path = require('path');
const buildV9 = require('./build-sqm1-piano-player-v9.cjs');
const adaptiveHeadroom = require('./apply-sqm1-piano-adaptive-headroom-v1.cjs');
const continuousBody = require('./apply-sqm1-piano-continuous-body-v1.cjs');
const silentFlush = require('./apply-sqm1-piano-silent-flush-v1.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v10-stable.brz');

function build(options = {}) {
  const v9Context = buildV9(options);
  const v9Bytes = Buffer.from(v9Context.bytes);
  const adaptiveHeadroomPatch = adaptiveHeadroom.apply(v9Context.scene,
    v9Context.headroomPatch, v9Context.singleSourcePatch);
  const continuousBodyPatch = continuousBody.apply(v9Context.scene,
    v9Context.singleSourcePatch, v9Context.releasePatch);
  const silentFlushPatch = silentFlush.apply(v9Context.scene,
    v9Context.pianoPatch, v9Context.releasePatch);
  const result = write(v9Context.scene, {
    name: 'SQM1 Auto-Zone Music Player - Stable Piano V10',
    description: 'The exact V9 player with stable Piano body oscillators, exact-zero hidden '
      + 'retuning, a six-millisecond inaudible Dampen flush and energy-aware peak headroom. '
      + 'Dense peaks attenuate immediately toward a 0.70 RMS ceiling and recover over 120 ms; '
      + 'sparse notes retain V9 gain. The score, scheduler, audible envelope, non-Piano profiles, '
      + 'controls, automatic cartridge intake, UI and geometry remain intact.',
  });
  return {
    ...v9Context,
    bytes: result.bytes,
    scene: v9Context.scene,
    outputScene: read(result.bytes),
    v9Bytes,
    adaptiveHeadroomPatch,
    continuousBodyPatch,
    silentFlushPatch,
    constants: {
      ...v9Context.constants,
      OUTPUT_DEFAULT,
      ...adaptiveHeadroom.constants,
      SILENT_FLUSH_SECONDS: silentFlush.constants.SILENT_FLUSH_SECONDS,
    },
  };
}

build.constants = {
  OUTPUT_DEFAULT,
  ...adaptiveHeadroom.constants,
  SILENT_FLUSH_SECONDS: silentFlush.constants.SILENT_FLUSH_SECONDS,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v10.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      components: context.outputScene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
      voices: context.singleSourcePatch.voices.length,
      emitters: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.AudioEmitter.NAME)).length,
      pianoSourceCeiling: context.singleSourcePatch.voices.length,
      adaptiveHeadroom: {
        fixedMaximum: context.constants.MAX_HEADROOM,
        denseRmsCeiling: context.constants.RMS_CEILING,
        recoverySeconds: context.constants.RECOVERY_SMOOTH_SECONDS,
      },
      silentFlushSeconds: context.constants.SILENT_FLUSH_SECONDS,
      visibleVolumeRange: [1, 2],
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

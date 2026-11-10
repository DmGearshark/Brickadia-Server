'use strict';

const fs = require('fs');
const path = require('path');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const schedulerPrune = require('./apply-sqm1-scheduler-prune-v1.cjs');
const inactivePartialPrune = require('./apply-sqm1-piano-inactive-partial-prune-v1.cjs');
const compactHeadroom = require('./apply-sqm1-piano-adaptive-headroom-compact-v1.cjs');
const exactExpressionCse = require('./apply-sqm1-exact-expression-cse-v1.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v10-1-lean.brz');

function build(options = {}) {
  const v10Context = buildV10(options);
  const v10Bytes = Buffer.from(v10Context.bytes);
  const schedulerPrunePatch = schedulerPrune.apply(v10Context.scene, v10Context);
  const inactivePartialPatch = inactivePartialPrune.apply(v10Context.scene,
    v10Context.pianoPatch, v10Context.releasePatch);
  const compactHeadroomPatch = compactHeadroom.apply(v10Context.scene,
    v10Context.adaptiveHeadroomPatch, v10Context.headroomPatch,
    v10Context.singleSourcePatch);
  const csePatch = exactExpressionCse.apply(v10Context.scene, {
    hiddenLogicGrids: [v10Context.releasePatch.logicGrid],
  });
  const result = write(v10Context.scene, {
    name: 'SQM1 Auto-Zone Music Player - Lean Stable Piano V10.1',
    description: 'The approved stable Piano V10 sound with write-only decoder diagnostics, '
      + 'inaudible disabled-partial synthesis, redundant scalar limiter work and exact duplicate '
      + 'expressions removed. Stable body oscillators, six-millisecond hidden-state flushing, '
      + 'energy-aware headroom, all audible envelopes, all instrument profiles, controls, '
      + 'automatic cartridge intake, UI and geometry retain V10 behavior.',
  });
  return {
    ...v10Context,
    bytes: result.bytes,
    scene: v10Context.scene,
    outputScene: read(result.bytes),
    v10Bytes,
    schedulerPrunePatch,
    inactivePartialPatch,
    compactHeadroomPatch,
    csePatch,
    constants: {
      ...v10Context.constants,
      OUTPUT_DEFAULT,
      ...compactHeadroom.constants,
    },
  };
}

build.constants = {
  OUTPUT_DEFAULT,
  ...compactHeadroom.constants,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v10-1.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      components: context.outputScene.bricks.reduce((sum, brick) =>
        sum + brick.comps.length, 0),
      voices: context.singleSourcePatch.voices.length,
      emitters: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.AudioEmitter.NAME)).length,
      dampens: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.Dampen.NAME)).length,
      normalDecodeExecutionsRemoved: context.schedulerPrunePatch.constants
        .NORMAL_DECODE_EXECUTIONS_REMOVED,
      removedWriteOnlySchedulerBricks: context.schedulerPrunePatch.constants.REMOVED_BRICKS,
      removedInactivePartialBricks: context.inactivePartialPatch.constants.REMOVED_BRICKS,
      compactLimiterBricks: context.compactHeadroomPatch.addedBricks,
      exactExpressionsCommoned: context.csePatch.constants.REMOVED_BRICKS,
      visibleVolumeRange: [1, 2],
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

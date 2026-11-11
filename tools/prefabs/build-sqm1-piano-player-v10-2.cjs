'use strict';

const fs = require('fs');
const path = require('path');
const buildV101 = require('./build-sqm1-piano-player-v10-1.cjs');
const hammerImpact = require('./apply-sqm1-piano-hammer-impact-v1.cjs');
const compactHeadroom = require('./apply-sqm1-piano-adaptive-headroom-compact-v1.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v10-2-hammer.brz');

function build(options = {}) {
  const v10_1Context = buildV101(options);
  const v10_1Bytes = Buffer.from(v10_1Context.bytes);
  const hammerImpactPatch = hammerImpact.apply(v10_1Context.scene,
    v10_1Context.singleSourcePatch);
  const result = write(v10_1Context.scene, {
    name: 'SQM1 Auto-Zone Music Player - Rounded Hammer Piano V10.2',
    description: 'The lean stable V10.1 Piano with a tighter folded hammer impact. The same '
      + 'continuous Sine body, six-millisecond attack, exact-zero retune mask, silent state '
      + 'flush, adaptive headroom and 24-source Piano ceiling are retained. Only the existing '
      + 'velocity-aware strike term changes from 0.30*exp(-6t) to 0.38*exp(-10t), adding a '
      + 'shorter, firmer key impact without another emitter, pulse, gate or sound slot.',
  });
  return {
    ...v10_1Context,
    bytes: result.bytes,
    scene: v10_1Context.scene,
    outputScene: read(result.bytes),
    v10_1Bytes,
    hammerImpactPatch,
    constants: {
      ...v10_1Context.constants,
      OUTPUT_DEFAULT,
      ...compactHeadroom.constants,
      ...hammerImpact.constants,
    },
  };
}

build.constants = {
  OUTPUT_DEFAULT,
  ...compactHeadroom.constants,
  ...hammerImpact.constants,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v10-2.cjs');
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
      strike: {gain: context.constants.STRIKE_GAIN, rate: context.constants.STRIKE_RATE,
        attackSeconds: context.constants.ATTACK_SMOOTH_SECONDS},
      addedStrikeBricks: context.hammerImpactPatch.addedBricks,
      addedStrikeEdges: context.hammerImpactPatch.addedEdges,
      visibleVolumeRange: [1, 2],
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/')
        && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

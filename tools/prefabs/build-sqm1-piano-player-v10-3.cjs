'use strict';

const fs = require('fs');
const path = require('path');
const buildV102 = require('./build-sqm1-piano-player-v10-2.cjs');
const velocityImpact = require('./apply-sqm1-piano-velocity-impact-v1.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v10-3-dynamic-hammer.brz');

function build(options = {}) {
  const v10_2Context = buildV102(options);
  const v10_2Bytes = Buffer.from(v10_2Context.bytes);
  const velocityImpactPatch = velocityImpact.apply(v10_2Context.scene, v10_2Context);
  const result = write(v10_2Context.scene, {
    name: 'SQM1 Auto-Zone Music Player - Dynamic Hammer Piano V10.3',
    description: 'The complete V10.2 player with a true 0.1-to-1 per-note Piano hit range, '
      + 'independent 1-to-2 master volume, and a hard-hit-biased hammer transient. Hard notes '
      + 'receive a faster folded body strike plus a short velocity-dependent H2 Sine from the '
      + 'existing emitter. H2 is enabled only above its inaudible threshold, H3 remains disabled '
      + 'for Piano, exact two-frequency energy feeds the adaptive limiter, and a full 24-note '
      + 'Piano onset uses at most 48 of Brickadia\'s 64 sound slots.',
  });
  return {
    ...v10_2Context,
    bytes: result.bytes,
    scene: v10_2Context.scene,
    outputScene: read(result.bytes),
    v10_2Bytes,
    velocityImpactPatch,
    constants: {
      ...v10_2Context.constants,
      OUTPUT_DEFAULT,
      ...velocityImpact.constants,
    },
  };
}

build.constants = {
  ...buildV102.constants,
  OUTPUT_DEFAULT,
  ...velocityImpact.constants,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v10-3.cjs');
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
      voices: context.velocityImpactPatch.voices.length,
      emitters: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.AudioEmitter.NAME)).length,
      dampens: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.Dampen.NAME)).length,
      oneShots: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.OneShotAudioEmitter.NAME)).length,
      hitRange: [context.constants.HIT_MIN, context.constants.HIT_MAX],
      strike: {bodyGain: context.constants.BODY_STRIKE_GAIN,
        h2Gain: context.constants.H2_STRIKE_GAIN,
        rate: context.constants.STRIKE_RATE,
        smoothSeconds: context.constants.ATTACK_SMOOTH_SECONDS},
      maxPianoSources: context.velocityImpactPatch.constants.MAX_PIANO_SOURCES,
      addedPureGates: context.velocityImpactPatch.addedBricks,
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

'use strict';

const fs = require('fs');
const path = require('path');
const buildV8 = require('./build-sqm1-piano-player-v8.cjs');
const pianoHeadroom = require('./apply-sqm1-piano-headroom-v1.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v9-headroom.brz');

function build(options = {}) {
  const v8Context = buildV8(options);
  const v8Bytes = Buffer.from(v8Context.bytes);
  const headroomPatch = pianoHeadroom.apply(v8Context.scene, v8Context.pianoPatch);
  const result = write(v8Context.scene, {
    name: 'SQM1 Auto-Zone Music Player - Piano Headroom V9',
    description: 'The exact 24-lane protected Piano V8 with a shared 0.35 Piano-only headroom '
      + 'scale. Visible volume 1..2 maps to internal Piano gain 0.35..0.70, matching the '
      + 'approved hard-strike audition at volume 1 while retaining a louder option at volume 2. '
      + 'Non-Piano synthesis, scheduler, release, cartridge intake, controls and UI remain intact.',
  });
  return {
    ...v8Context,
    bytes: result.bytes,
    scene: v8Context.scene,
    outputScene: read(result.bytes),
    v8Bytes,
    headroomPatch,
    constants: {
      ...v8Context.constants,
      OUTPUT_DEFAULT,
      HEADROOM_SCALE: pianoHeadroom.constants.HEADROOM_SCALE,
    },
  };
}

build.constants = {
  OUTPUT_DEFAULT,
  HEADROOM_SCALE: pianoHeadroom.constants.HEADROOM_SCALE,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build();
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v9.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      voices: context.headroomPatch.voices.length,
      emitters: context.outputScene.bricks.filter(brick => brick.comps.some(item =>
        item.type === C.AudioEmitter.NAME)).length,
      pianoHeadroomScale: context.constants.HEADROOM_SCALE,
      visibleVolumeRange: [1, 2],
      internalPianoGainRange: [context.constants.HEADROOM_SCALE,
        context.constants.HEADROOM_SCALE * 2],
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

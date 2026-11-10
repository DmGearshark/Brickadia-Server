'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const patchControls = require('./patch-sqm1-user-player-controls-v1.cjs');
const pianoEnvelope = require('./apply-sqm1-piano-envelope-v1.cjs');

const SOURCE_DEFAULT = path.join(__dirname, 'sources', 'sqm1-working-as-intended-ui.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-piano-v4.brz');

function build(sourceFile = SOURCE_DEFAULT) {
  assert(fs.existsSync(sourceFile), `Player source not found: ${sourceFile}`);
  const context = patchControls(sourceFile, {
    beforeOptimize: pianoEnvelope.prepare,
    afterOptimize: pianoEnvelope.apply,
    name: 'SQM1 Auto-Zone Music Player - Hard-Strike Piano V4',
    description: 'The proven optimized custom-UI V3 player with its automatic cartridge loader, '
      + 'eighteen-voice scheduler, controls, spatial settings and six non-piano instruments preserved. '
      + 'Piano alone uses the selected hard-strike Sine envelope: a 6 ms attack, decaying body, '
      + 'independent exact 2x/3x partials and 70/50 ms releases. Reserved score lanes let repeated '
      + 'notes start on a fresh voice while the preceding voice completes its release.',
  });
  return {...context, pianoPatch: context.extension,
    constants: {...context.constants, SOURCE_DEFAULT, OUTPUT_DEFAULT}};
}

module.exports = build;

if (require.main === module) {
  const [sourceFile = SOURCE_DEFAULT, outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(sourceFile);
    const testFile = path.join(__dirname, 'test-sqm1-piano-player-v4.cjs');
    if (fs.existsSync(testFile)) require(testFile)(context);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      sourceFile,
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      addedPianoBricks: context.pianoPatch.addedBricks,
      dampens: context.outputScene.bricks.filter(brick => brick.comps.some(component =>
        component.type === require('./loadboard-lib.cjs').C.Dampen.NAME)).length,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

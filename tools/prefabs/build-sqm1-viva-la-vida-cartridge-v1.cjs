'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {Build, C, R, metadata} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const SCORE_DEFAULT = path.join(__dirname, 'viva-la-vida-single-quat-score.json');
const TEMPLATE_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-test-cartridge-v1.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-viva-la-vida-cartridge-v1.brz');
const TITLE = 'Viva La Vida - Piano and Violin Duet';
const SOURCE_MIDI_SHA256 = 'a4f6ac10e617b39d89ff478ff1c6b88aabd08d561e592d5d30486112f54c2e06';

const clone = value => structuredClone(value);

function unfinished(builder) {
  const original = Build.prototype.finish;
  Build.prototype.finish = function deferredFinish() { return Buffer.alloc(0); };
  try {
    return {context: builder(), finish: original};
  } finally {
    Build.prototype.finish = original;
  }
}

function edgeFromVar(build, variable, targetType) {
  const edge = build.edges.find(candidate => candidate.a === variable
    && candidate.p === 'VarRef' && candidate.q === 'VarRef'
    && (!targetType || candidate.z.type === targetType));
  assert(edge, `Variable consumer for ${variable.id}`);
  return edge.z;
}

function component(brick, type) {
  return brick?.comps.find(candidate => candidate.type === type);
}

function loadScore(scoreFile) {
  const document = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
  assert.equal(document.schema, 'brickadia-midi-single-quat-array', 'Score schema');
  assert.equal(document.version, 1, 'Score version');
  assert.equal(document.source.sha256, SOURCE_MIDI_SHA256, 'Source MIDI SHA-256');
  assert.equal(document.activeVoices, 18, 'Viva active voices');
  assert.equal(document.statistics.notes, 3430, 'Viva note count');
  assert.equal(document.statistics.arrayEntries, 3464, 'Viva array length');
  assert.equal(document.statistics.durationSeconds, 239.998867144, 'Viva duration');
  assert.equal(document.array.elementType, 'Quat', 'Score element type');
  assert.equal(document.array.values.length, document.statistics.arrayEntries,
    'Score array length matches statistics');
  return {document, values: document.array.values};
}

function automaticCartridgeLogic(score) {
  const baseBuilder = require('./build-midi-wireless-integration-cartridge-v1.cjs');
  const options = {
    score,
    title: TITLE,
    preferredMode: 0,
    buildName: 'SQM1 Viva La Vida Cartridge V1',
    sendLabel: `Send ${TITLE}`,
    description: 'Full four-minute Viva La Vida piano-and-violin SQM1 cartridge. '
      + 'It carries 3,430 notes in one 3,464-Quaternion array and requires an '
      + '18-voice format-1 player.',
  };
  const {context, finish} = unfinished(() => baseBuilder(options));
  const {b, disk} = context;

  // Match the proven auto-zone cartridge protocol: both receivers are scoped
  // to the exact physics root and an accepted request offers automatically on
  // the following tick. The original manual send button is intentionally not
  // part of the packaged cartridge.
  context.request.data.bIsObjectEvent = true;
  context.ack.data.bIsObjectEvent = true;
  const acceptedCounter = edgeFromVar(b, context.requestAccepted, C.Exec_Var_Increment.NAME);
  const sendTrigger = b.edges.find(edge => edge.a === context.sendEdge
    && edge.p === 'OnRisingEdge' && edge.q === 'Exec');
  assert(sendTrigger, 'Manual-send branch');
  const canSend = sendTrigger.z;
  b.edges = b.edges.filter(edge => edge !== sendTrigger);
  const requestPublished = disk.wait(acceptedCounter, 1);
  disk.link(requestPublished, canSend, 'Output', 'Exec');

  const bytes = finish.call(b, {x: 180, y: 170, z: 130}, options.description);
  return {context, bytes, acceptedCounter, canSend, requestPublished};
}

function build(scoreFile = SCORE_DEFAULT, templateFile = TEMPLATE_DEFAULT) {
  assert(fs.existsSync(scoreFile), `Score not found: ${scoreFile}`);
  assert(fs.existsSync(templateFile), `Physics-root cartridge template not found: ${templateFile}`);
  const score = loadScore(scoreFile);
  const logic = automaticCartridgeLogic(score.values);
  const logicScene = read(logic.bytes);
  const template = read(fs.readFileSync(templateFile));

  const rootBricks = template.bricks.filter(brick => brick.g === 1).map(clone);
  assert.equal(rootBricks.length, 2, 'Template plate and root chip');
  const titleBrick = rootBricks.find(brick => component(brick, C.TextDisplay.NAME));
  assert(titleBrick, 'Template title display');
  component(titleBrick, C.TextDisplay.NAME).data.Text = TITLE;

  const logicBricks = logicScene.bricks.filter(brick => brick.g === 2).map(clone);
  const logicKeys = new Set(logicBricks.map(brick => brick.key));
  const logicEdges = logicScene.edges
    .filter(edge => logicKeys.has(edge.a) && logicKeys.has(edge.z)).map(clone);
  const rootLinks = template.links.filter(link => link.grid === 2).map(clone);
  assert.equal(rootLinks.length, 1, 'Template root-chip link');

  const outputScene = {
    ...template,
    bricks: [...rootBricks, ...logicBricks],
    edges: logicEdges,
    links: rootLinks,
  };
  const assets = clone(template.r.externalAssets());
  for (const asset of logicScene.r.externalAssets()) {
    if (!assets.some(candidate => JSON.stringify(candidate) === JSON.stringify(asset))) {
      assets.push(clone(asset));
    }
  }
  const prefab = metadata({x: 20, y: 20, z: 10});
  prefab.bIsPhysicsGrid = true;
  prefab.bFreezePhysicsGrid = false;
  const output = write(outputScene, {
    assets,
    prefab,
    name: 'SQM1 Viva La Vida Cartridge V1',
    description: 'Physics-root automatic cartridge containing the complete 3,430-note '
      + 'Viva La Vida piano-and-violin duet. It offers one 3,464-Quaternion, 18-voice '
      + 'SQM1 score and is consumed only after the compatible player commits it.',
  });
  const scene = read(output.bytes);
  return {bytes: output.bytes, scene, score, logic, constants: {
    TITLE, SOURCE_MIDI_SHA256, SCORE_DEFAULT, TEMPLATE_DEFAULT,
  }};
}

module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT, scoreFile = SCORE_DEFAULT,
    templateFile = TEMPLATE_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(scoreFile, templateFile);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.scene.bricks.length,
      wires: context.scene.edges.length,
      title: TITLE,
      notes: context.score.document.statistics.notes,
      scoreQuaternions: context.score.values.length,
      activeVoices: context.score.document.activeVoices,
      durationSeconds: context.score.document.statistics.durationSeconds,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

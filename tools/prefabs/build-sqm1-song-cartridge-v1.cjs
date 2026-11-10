'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {Build, C, metadata} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const SCORE_SCHEMA = 'brickadia-midi-single-quat-array';
const SCORE_VERSION = 1;
const SCORE_MAGIC = 7701001;
const SCORE_FORMAT = 1;
const HEADER_LENGTH = 34;
const VOICE_TABLE_LENGTH = 32;
const PLAYER_MAX_VOICES = 18;
const ARRAY_CAPACITY = 65536;
const TEMPLATE_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-test-cartridge-v1.brz');

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

function component(brick, type) {
  return brick?.comps.find(candidate => candidate.type === type);
}

function edgeFromVar(build, variable, targetType) {
  const edge = build.edges.find(candidate => candidate.a === variable
    && candidate.p === 'VarRef' && candidate.q === 'VarRef'
    && (!targetType || candidate.z.type === targetType));
  assert(edge, `Variable consumer for ${variable.id}`);
  return edge.z;
}

function exactExpectation(actual, expected, label) {
  if (expected !== undefined) assert.equal(actual, expected, label);
}

/**
 * Validate the complete SQM1 format-1 contract consumed by the current player.
 * This intentionally goes beyond checking the magic and header length: a bad
 * offset or overlapping release tail can otherwise build a valid-looking
 * cartridge that fails only after it has been consumed in game.
 */
function validateScoreDocument(document, options = {}) {
  const maxActiveVoices = options.maxActiveVoices ?? PLAYER_MAX_VOICES;
  const maxArrayEntries = options.maxArrayEntries ?? ARRAY_CAPACITY;
  const expected = options.expected ?? {};
  assert(Number.isInteger(maxActiveVoices) && maxActiveVoices >= 1
    && maxActiveVoices <= VOICE_TABLE_LENGTH, 'Maximum active voices must be 1..32');
  assert(Number.isInteger(maxArrayEntries) && maxArrayEntries >= HEADER_LENGTH,
    'Array capacity must fit the SQM1 header');

  assert(document && typeof document === 'object', 'Score document');
  assert.equal(document.schema, SCORE_SCHEMA, 'Score schema');
  assert.equal(document.version, SCORE_VERSION, 'Score version');
  assert(document.source && typeof document.source === 'object', 'Score source metadata');
  assert.equal(typeof document.source.filename, 'string', 'Source MIDI filename');
  assert.match(document.source.sha256, /^[0-9a-f]{64}$/i, 'Source MIDI SHA-256');
  assert(document.array && typeof document.array === 'object', 'Score array');
  assert.equal(document.array.elementType, 'Quat', 'Score element type');
  assert(Array.isArray(document.array.values), 'Score Quaternion values');
  assert(document.array.values.length >= HEADER_LENGTH, 'Complete SQM1 header');
  assert(document.array.values.length <= maxArrayEntries,
    `Score exceeds player array capacity ${maxArrayEntries}`);

  const values = document.array.values.map((value, index) => {
    assert(value && ['X', 'Y', 'Z', 'W'].every(field => Number.isFinite(value[field])),
      `Score q${index} must contain finite X/Y/Z/W fields`);
    return Object.freeze({X: value.X, Y: value.Y, Z: value.Z, W: value.W});
  });
  const global = values[0];
  const format = values[1];
  assert.equal(global.X, SCORE_MAGIC, 'SQM1 magic');
  assert.equal(global.Y, SCORE_FORMAT, 'SQM1 format');
  assert(Number.isInteger(global.Z) && global.Z >= 1 && global.Z <= maxActiveVoices,
    `SQM1 active voice count must be 1..${maxActiveVoices}`);
  assert(global.W > 0, 'SQM1 duration must be positive');
  assert.equal(format.X, HEADER_LENGTH, 'SQM1 header length');
  assert(format.Y >= 0 && format.Y <= 5, 'SQM1 release tail must be 0..5 seconds');
  assert(Number.isInteger(format.Z) && Number.isInteger(format.W)
    && format.Z >= 0 && format.W <= 127 && format.Z <= format.W,
  'SQM1 declared MIDI pitch range');

  let cursor = HEADER_LENGTH;
  let totalNotes = 0;
  let minimumPitch = Infinity;
  let maximumPitch = -Infinity;
  let maximumEnd = 0;
  for (let voice = 0; voice < VOICE_TABLE_LENGTH; voice++) {
    const header = values[2 + voice];
    assert(Number.isInteger(header.X), `Voice ${voice} note offset`);
    assert(Number.isInteger(header.Y) && header.Y >= 0, `Voice ${voice} note count`);
    assert.equal(header.X, cursor, `Voice ${voice} contiguous note offset`);
    if (voice < global.Z) {
      assert(header.Y > 0, `Active voice ${voice} must contain notes`);
      assert(Number.isInteger(header.Z) && header.Z >= 0 && header.Z <= 255,
        `Voice ${voice} instrument code`);
      assert(Number.isInteger(header.W) && header.W >= 0,
        `Voice ${voice} channel/track code`);
      assert(cursor + header.Y <= values.length, `Voice ${voice} note range`);
      let priorEnd = -Infinity;
      for (let index = cursor; index < cursor + header.Y; index++) {
        const note = values[index];
        assert(note.X >= 0 && note.Y > note.X, `Voice ${voice} q${index} note times`);
        assert(note.Y <= global.W + 1e-9, `Voice ${voice} q${index} exceeds duration`);
        assert(note.X + 1e-9 >= priorEnd + format.Y,
          `Voice ${voice} q${index} overlaps the reserved release tail`);
        assert(Number.isInteger(note.Z) && note.Z >= format.Z && note.Z <= format.W,
          `Voice ${voice} q${index} MIDI pitch`);
        assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127,
          `Voice ${voice} q${index} MIDI velocity`);
        priorEnd = note.Y;
        maximumEnd = Math.max(maximumEnd, note.Y);
        minimumPitch = Math.min(minimumPitch, note.Z);
        maximumPitch = Math.max(maximumPitch, note.Z);
      }
      cursor += header.Y;
      totalNotes += header.Y;
    } else {
      assert.equal(header.Y, 0, `Inactive voice ${voice} note count`);
      assert.equal(header.Z, -1, `Inactive voice ${voice} instrument sentinel`);
      assert.equal(header.W, -1, `Inactive voice ${voice} channel/track sentinel`);
    }
  }
  assert.equal(cursor, values.length, 'Voice table accounts for every score entry');
  assert.equal(totalNotes, values.length - HEADER_LENGTH, 'SQM1 note count');
  assert(Math.abs(maximumEnd - global.W) <= 1e-9,
    'SQM1 duration equals the final note end');
  assert.equal(minimumPitch, format.Z, 'SQM1 minimum pitch header');
  assert.equal(maximumPitch, format.W, 'SQM1 maximum pitch header');

  exactExpectation(document.activeVoices, global.Z, 'Metadata active voices');
  exactExpectation(document.releaseTailSeconds, format.Y, 'Metadata release tail');
  if (document.maximumVoices !== undefined) {
    assert.equal(document.maximumVoices, VOICE_TABLE_LENGTH, 'Metadata maximum voices');
  }
  if (document.voiceLimit !== undefined) {
    assert(document.voiceLimit >= global.Z && document.voiceLimit <= VOICE_TABLE_LENGTH,
      'Metadata voice limit');
  }
  if (document.playableMidiRange !== undefined) {
    assert(Array.isArray(document.playableMidiRange)
      && document.playableMidiRange.length === 2
      && Number.isInteger(document.playableMidiRange[0])
      && Number.isInteger(document.playableMidiRange[1])
      && document.playableMidiRange[0] >= 0
      && document.playableMidiRange[1] <= 127
      && document.playableMidiRange[0] <= format.Z
      && document.playableMidiRange[1] >= format.W,
    'Metadata playable MIDI range contains the score pitch range');
  }
  if (document.statistics !== undefined) {
    exactExpectation(document.statistics.notes, totalNotes, 'Metadata note count');
    exactExpectation(document.statistics.arrayEntries, values.length,
      'Metadata array entries');
    exactExpectation(document.statistics.durationSeconds, global.W,
      'Metadata duration');
    exactExpectation(document.statistics.minimumPitch, minimumPitch,
      'Metadata minimum pitch');
    exactExpectation(document.statistics.maximumPitch, maximumPitch,
      'Metadata maximum pitch');
    exactExpectation(document.statistics.allocatedVoices, global.Z,
      'Metadata allocated voices');
  }
  if (document.voices !== undefined) {
    assert.equal(document.voices.length, global.Z, 'Metadata voice rows');
    for (let voice = 0; voice < global.Z; voice++) {
      const row = document.voices[voice];
      const header = values[2 + voice];
      assert.equal(row.voice, voice, `Metadata voice ${voice} index`);
      assert.equal(row.offset, header.X, `Metadata voice ${voice} offset`);
      assert.equal(row.count, header.Y, `Metadata voice ${voice} count`);
      assert.equal(row.instrumentCode, header.Z, `Metadata voice ${voice} instrument`);
      assert.equal(row.channelTrackCode, header.W,
        `Metadata voice ${voice} channel/track`);
    }
  }

  exactExpectation(document.source.sha256, expected.sourceSha256,
    'Expected source MIDI SHA-256');
  exactExpectation(global.Z, expected.activeVoices, 'Expected active voices');
  exactExpectation(totalNotes, expected.notes, 'Expected note count');
  exactExpectation(values.length, expected.arrayEntries, 'Expected array entries');
  exactExpectation(global.W, expected.durationSeconds, 'Expected duration');
  exactExpectation(format.Y, expected.releaseTailSeconds, 'Expected release tail');
  exactExpectation(minimumPitch, expected.minimumPitch, 'Expected minimum pitch');
  exactExpectation(maximumPitch, expected.maximumPitch, 'Expected maximum pitch');

  return Object.freeze({
    document,
    values: Object.freeze(values),
    statistics: Object.freeze({
      notes: totalNotes,
      arrayEntries: values.length,
      activeVoices: global.Z,
      durationSeconds: global.W,
      releaseTailSeconds: format.Y,
      minimumPitch,
      maximumPitch,
    }),
  });
}

function loadScore(scoreFile, options = {}) {
  assert.equal(typeof scoreFile, 'string', 'Score file path');
  assert(fs.existsSync(scoreFile), `Score not found: ${scoreFile}`);
  return validateScoreDocument(JSON.parse(fs.readFileSync(scoreFile, 'utf8')), options);
}

function automaticCartridgeLogic(score, options) {
  const baseBuilder = require('./build-midi-wireless-integration-cartridge-v1.cjs');
  const baseOptions = {
    score,
    title: options.title,
    preferredMode: options.preferredMode,
    buildName: options.buildName,
    sendLabel: `Send ${options.title}`,
    description: options.description,
  };
  const {context, finish} = unfinished(() => baseBuilder(baseOptions));
  const {b, disk} = context;

  // Object-scoped receivers bind the transaction to this physics root. After
  // an accepted player request, offer automatically on the following tick.
  // The player deletes this root only after it has copied and acknowledged the
  // score, so a rejected/incomplete transfer cannot consume the cartridge.
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

function buildSongCartridge(options = {}) {
  const title = options.title;
  assert.equal(typeof title, 'string', 'Song title');
  assert(title.trim().length > 0, 'Song title must not be empty');
  const scoreFile = options.scoreFile;
  const templateFile = options.templateFile ?? TEMPLATE_DEFAULT;
  assert(fs.existsSync(templateFile), `Physics-root cartridge template not found: ${templateFile}`);
  const buildName = options.buildName ?? `SQM1 ${title} Cartridge V1`;
  const preferredMode = options.preferredMode ?? 0;
  assert(Number.isInteger(preferredMode) && preferredMode >= 0 && preferredMode <= 2,
    'Preferred mode must be 0, 1 or 2');
  const description = options.description
    ?? `Physics-root automatic SQM1 cartridge containing ${title}.`;
  const score = options.scoreDocument
    ? validateScoreDocument(options.scoreDocument, options)
    : loadScore(scoreFile, options);
  const logic = automaticCartridgeLogic(score.values, {
    title, preferredMode, buildName, description,
  });
  const logicScene = read(logic.bytes);
  const template = read(fs.readFileSync(templateFile));

  const rootBricks = template.bricks.filter(brick => brick.g === 1).map(clone);
  assert.equal(rootBricks.length, 2, 'Template plate and root chip');
  const titleBrick = rootBricks.find(brick => component(brick, C.TextDisplay.NAME));
  assert(titleBrick, 'Template title display');
  component(titleBrick, C.TextDisplay.NAME).data.Text = title;

  const logicBricks = logicScene.bricks.filter(brick => brick.g === 2).map(clone);
  assert(logicBricks.length > 0, 'Generated cartridge logic grid');
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
  const output = write(outputScene, {assets, prefab, name: buildName, description});
  const scene = read(output.bytes);
  return {
    bytes: output.bytes,
    scene,
    score,
    logic,
    options: Object.freeze({
      title, scoreFile, templateFile, buildName, preferredMode, description,
    }),
    constants: {
      SCORE_SCHEMA, SCORE_VERSION, SCORE_MAGIC, SCORE_FORMAT, HEADER_LENGTH,
      VOICE_TABLE_LENGTH, PLAYER_MAX_VOICES, ARRAY_CAPACITY, TEMPLATE_DEFAULT,
    },
  };
}

module.exports = buildSongCartridge;
module.exports.validateScoreDocument = validateScoreDocument;
module.exports.loadScore = loadScore;
module.exports.automaticCartridgeLogic = automaticCartridgeLogic;
module.exports.constants = {
  SCORE_SCHEMA, SCORE_VERSION, SCORE_MAGIC, SCORE_FORMAT, HEADER_LENGTH,
  VOICE_TABLE_LENGTH, PLAYER_MAX_VOICES, ARRAY_CAPACITY, TEMPLATE_DEFAULT,
};

if (require.main === module) {
  const [configFile, outputFile] = process.argv.slice(2);
  assert(configFile && outputFile,
    'Usage: node build-sqm1-song-cartridge-v1.cjs <config.json> <output.brz>');
  try {
    const absoluteConfig = path.resolve(configFile);
    const configDirectory = path.dirname(absoluteConfig);
    const config = JSON.parse(fs.readFileSync(absoluteConfig, 'utf8'));
    for (const key of ['scoreFile', 'templateFile']) {
      if (config[key] && !path.isAbsolute(config[key])) {
        config[key] = path.resolve(configDirectory, config[key]);
      }
    }
    const context = buildSongCartridge(config);
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.scene.bricks.length,
      wires: context.scene.edges.length,
      title: context.options.title,
      sourceSha256: context.score.document.source.sha256,
      ...context.score.statistics,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

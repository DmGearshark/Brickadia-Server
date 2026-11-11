'use strict';

const assert = require('assert/strict');
const {Build, C, metadata} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const SCORE_MAGIC = 7701001;
const SCORE_FORMAT = 1;
const HEADER_LENGTH = 34;
const VOICE_TABLE_LENGTH = 32;
const PLAYER_MAX_VOICES = 24;
const ARRAY_CAPACITY = 65536;

const clone = value => structuredClone(value);
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function unfinished(builder) {
  const original = Build.prototype.finish;
  Build.prototype.finish = function deferredFinish() { return new Uint8Array(); };
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

function normalizeScoreValues(source, options = {}) {
  const maximumVoices = options.maximumVoices ?? PLAYER_MAX_VOICES;
  const maximumEntries = options.maximumEntries ?? ARRAY_CAPACITY;
  assert(Array.isArray(source), 'SQM1 score values must be an array');
  assert(source.length >= HEADER_LENGTH, 'SQM1 score requires the 34-Quaternion header');
  assert(source.length <= maximumEntries,
    `SQM1 score exceeds the ${maximumEntries}-Quaternion player capacity`);
  const values = source.map((value, index) => {
    assert(value && ['X', 'Y', 'Z', 'W'].every(field => Number.isFinite(value[field])),
      `SQM1 score q${index} must contain finite X/Y/Z/W fields`);
    return Object.freeze({X: value.X, Y: value.Y, Z: value.Z, W: value.W});
  });
  const global = values[0];
  const format = values[1];
  assert.equal(global.X, SCORE_MAGIC, 'SQM1 score magic');
  assert.equal(global.Y, SCORE_FORMAT, 'SQM1 score format');
  assert(Number.isInteger(global.Z) && global.Z >= 1 && global.Z <= maximumVoices,
    `SQM1 active voice count must be 1..${maximumVoices}`);
  assert(global.W > 0, 'SQM1 duration must be positive');
  assert.equal(format.X, HEADER_LENGTH, 'SQM1 header length');
  assert(format.Y >= 0 && format.Y <= 5, 'SQM1 release reservation must be 0..5 seconds');
  assert(Number.isInteger(format.Z) && Number.isInteger(format.W)
    && format.Z >= 0 && format.W <= 127 && format.Z <= format.W,
  'SQM1 pitch range');

  let cursor = HEADER_LENGTH;
  let maximumEnd = 0;
  let minimumPitch = Infinity;
  let maximumPitch = -Infinity;
  for (let voice = 0; voice < VOICE_TABLE_LENGTH; voice++) {
    const header = values[2 + voice];
    assert(Number.isInteger(header.X) && Number.isInteger(header.Y) && header.Y >= 0,
      `SQM1 voice ${voice} header`);
    assert.equal(header.X, cursor, `SQM1 voice ${voice} contiguous offset`);
    if (voice < global.Z) {
      assert(header.Y > 0, `SQM1 active voice ${voice} note count`);
      assert(Number.isInteger(header.Z) && header.Z >= 0 && header.Z <= 255,
        `SQM1 voice ${voice} instrument`);
      assert(Number.isInteger(header.W) && header.W >= 0,
        `SQM1 voice ${voice} channel/track`);
      assert(cursor + header.Y <= values.length, `SQM1 voice ${voice} range`);
      let priorEnd = -Infinity;
      for (let index = cursor; index < cursor + header.Y; index++) {
        const note = values[index];
        assert(note.X >= 0 && note.Y > note.X && note.Y <= global.W + 1e-9,
          `SQM1 voice ${voice} q${index} times`);
        assert(note.X + 1e-9 >= priorEnd + format.Y,
          `SQM1 voice ${voice} q${index} overlaps its release reservation`);
        assert(Number.isInteger(note.Z) && note.Z >= format.Z && note.Z <= format.W,
          `SQM1 voice ${voice} q${index} pitch`);
        assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127,
          `SQM1 voice ${voice} q${index} velocity`);
        priorEnd = note.Y;
        maximumEnd = Math.max(maximumEnd, note.Y);
        minimumPitch = Math.min(minimumPitch, note.Z);
        maximumPitch = Math.max(maximumPitch, note.Z);
      }
      cursor += header.Y;
    } else {
      assert.equal(header.Y, 0, `SQM1 inactive voice ${voice} count`);
      assert.equal(header.Z, -1, `SQM1 inactive voice ${voice} instrument sentinel`);
      assert.equal(header.W, -1, `SQM1 inactive voice ${voice} channel sentinel`);
    }
  }
  assert.equal(cursor, values.length, 'SQM1 voice table accounts for every record');
  assert(Math.abs(maximumEnd - global.W) <= 1e-9,
    'SQM1 duration equals the final note end');
  assert.equal(minimumPitch, format.Z, 'SQM1 minimum pitch header');
  assert.equal(maximumPitch, format.W, 'SQM1 maximum pitch header');
  return Object.freeze(values);
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

function buildAutomaticCartridge(options = {}) {
  const title = String(options.title ?? '').trim();
  assert(title.length > 0, 'Song title must not be empty');
  const preferredMode = options.preferredMode ?? 0;
  assert(Number.isInteger(preferredMode) && preferredMode >= 0 && preferredMode <= 2,
    'Preferred mode must be 0, 1 or 2');
  const templateBytes = options.templateBytes;
  assert(templateBytes instanceof Uint8Array,
    'Cartridge template must be supplied as Uint8Array bytes');
  const score = normalizeScoreValues(options.scoreValues, {
    maximumVoices: options.maximumVoices,
    maximumEntries: options.maximumEntries,
  });
  const buildName = options.buildName ?? `SQM1 ${title} Cartridge`;
  const description = options.description
    ?? `Physics-root automatic SQM1 cartridge containing ${title}.`;
  const logic = automaticCartridgeLogic(score, {
    title, preferredMode, buildName, description,
  });
  const logicScene = read(logic.bytes);
  const template = read(templateBytes);

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
  return {
    bytes: output.bytes,
    scene: read(output.bytes),
    score,
    title,
    buildName,
    description,
    preferredMode,
  };
}

module.exports = {
  buildAutomaticCartridge,
  normalizeScoreValues,
  constants: {
    SCORE_MAGIC, SCORE_FORMAT, HEADER_LENGTH, VOICE_TABLE_LENGTH,
    PLAYER_MAX_VOICES, ARRAY_CAPACITY,
  },
};

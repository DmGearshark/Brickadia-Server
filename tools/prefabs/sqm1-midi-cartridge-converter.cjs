'use strict';

// End-to-end, byte-only MIDI -> SQM1 score -> automatic cartridge adapter.
// The conversion path has no filesystem dependency, so this module can be
// bundled into the offline browser application.  Filesystem access exists
// only in runCli(), reached through module.require at runtime in Node.

const midi = require('./sqm1-midi-converter-core.cjs');
const arranger = require('./sqm1-pitch-continuity-arranger.cjs');
const cartridgeCore = require('./sqm1-browser-cartridge-core.cjs');

const DEFAULT_PRESET = 'v4-quality';
const DEFAULT_MAX_VOICES = 24;
const DEFAULT_RELEASE_TAIL_SECONDS = 0.2;
const MAX_TITLE_LENGTH = 120;

class ConversionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConversionError';
  }
}

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ConversionError(`${label} must be supplied as Uint8Array bytes`);
}

function titleFromFilename(filename) {
  const stem = String(filename || '')
    .replace(/\.(?:midi?|smf)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stem) return 'Untitled Song';
  return stem.replace(/\b[a-z]/g, character => character.toUpperCase());
}

function outputStem(title) {
  const stem = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return stem || 'sqm1-song';
}

function normalizePreset(value) {
  const preset = String(value ?? DEFAULT_PRESET).trim().toLowerCase();
  if (['v4-quality', 'quality', 'dense-piano', 'continuity-v4', 'cot-v4'].includes(preset)) {
    return DEFAULT_PRESET;
  }
  if (['strict', 'canonical', 'strict-canonical'].includes(preset)) return 'strict';
  throw new ConversionError(`Unknown conversion preset: ${value}`);
}

function option(source, names, fallback) {
  for (const container of [source, source?.options]) {
    if (!container) continue;
    for (const name of names) if (container[name] !== undefined) return container[name];
  }
  return fallback;
}

function normalizedSettings(options = {}) {
  const filename = String(options.filename || 'song.mid');
  const title = String(options.title ?? titleFromFilename(filename)).trim();
  if (!title) throw new ConversionError('Song title must not be empty');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ConversionError(`Song title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  const maxVoices = Number(option(options,
    ['maxVoices', 'maximumVoices', 'voiceLimit'], DEFAULT_MAX_VOICES));
  if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > DEFAULT_MAX_VOICES) {
    throw new ConversionError(`Voice limit must be an integer from 1 to ${DEFAULT_MAX_VOICES}`);
  }
  const releaseTailSeconds = Number(option(options,
    ['releaseTailSeconds', 'releaseTail'], DEFAULT_RELEASE_TAIL_SECONDS));
  if (!Number.isFinite(releaseTailSeconds)
    || releaseTailSeconds < 0 || releaseTailSeconds > 5) {
    throw new ConversionError('Release tail must be a finite number from 0 to 5 seconds');
  }
  const preferredMode = Number(option(options, ['preferredMode'], 0));
  if (!Number.isInteger(preferredMode) || preferredMode < 0 || preferredMode > 2) {
    throw new ConversionError('Preferred mode must be 0, 1 or 2');
  }
  const maxInputBytes = Number(option(options,
    ['maxInputBytes'], midi.constants.DEFAULT_MAX_INPUT_BYTES));
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 14
    || maxInputBytes > midi.constants.DEFAULT_MAX_INPUT_BYTES) {
    throw new ConversionError(`MIDI input limit must be an integer from 14 to ${midi.constants.DEFAULT_MAX_INPUT_BYTES} bytes`);
  }
  const maxArrayEntries = Number(option(options,
    ['maxArrayEntries'], midi.constants.ARRAY_CAPACITY));
  if (!Number.isInteger(maxArrayEntries)
    || maxArrayEntries < midi.constants.HEADER_LENGTH
    || maxArrayEntries > midi.constants.ARRAY_CAPACITY) {
    throw new ConversionError(`Array capacity must be an integer from ${midi.constants.HEADER_LENGTH} to ${midi.constants.ARRAY_CAPACITY}`);
  }
  const instrumentCode = Number(option(options, ['instrumentCode'], 0));
  const channel = Number(option(options, ['channel'], 0));
  const track = Number(option(options, ['track'], 0));
  if (!Number.isInteger(instrumentCode) || instrumentCode < 0 || instrumentCode > 255) {
    throw new ConversionError('Instrument code must be an integer from 0 to 255');
  }
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new ConversionError('Output channel must be an integer from 0 to 15');
  }
  if (!Number.isSafeInteger(track) || track < 0) {
    throw new ConversionError('Output track must be a non-negative safe integer');
  }
  return {
    filename,
    title,
    maxVoices,
    releaseTailSeconds,
    preferredMode,
    preset: normalizePreset(options.preset),
    maxInputBytes,
    maxArrayEntries,
    strictUnsupported: Boolean(option(options, ['strictUnsupported'], false)),
    outOfRange: option(options, ['outOfRange'], 'error'),
    percussionPolicy: option(options, ['percussionPolicy'], 'error'),
    instrumentCode,
    channel,
    track,
  };
}

// CPython's round(value, 9) uses the exact binary value and round-half-even.
// Existing approved V4 scores were produced by that path.  Reconstructing raw
// tick time and applying the same rounding retains nanosecond-exact score
// compatibility instead of allowing Math.round to move half cases by 1 ns.
function pythonRound9(value) {
  if (!Number.isFinite(value)) throw new ConversionError('MIDI time must be finite');
  if (value === 0) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value), false);
  const bits = view.getBigUint64(0, false);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  let numerator = significand * 1_000_000_000n;
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) {
    quotient++;
  }
  const rounded = Number(quotient) / 1_000_000_000;
  return value < 0 ? -rounded : rounded;
}

function rawTimeMapper(parsed) {
  if (parsed.division & 0x8000) {
    let signedFrames = (parsed.division >> 8) & 0xff;
    if (signedFrames >= 128) signedFrames -= 256;
    const frameCode = -signedFrames;
    const framesPerSecond = frameCode === 29 ? 30_000 / 1_001 : frameCode;
    const ticksPerFrame = parsed.division & 0xff;
    return tick => tick / (framesPerSecond * ticksPerFrame);
  }
  const ordered = [...parsed.tempoEvents].sort((a, b) =>
    a.tick - b.tick || a.track - b.track || a.order - b.order);
  const byTick = new Map([[0, 500_000]]);
  for (const event of ordered) byTick.set(event.tick, event.microsecondsPerQuarter);
  let cumulative = 0;
  let previousTick = 0;
  let previousRate = byTick.get(0);
  const segments = [];
  for (const [tick, rate] of [...byTick].sort((a, b) => a[0] - b[0])) {
    if (tick) {
      cumulative += (tick - previousTick) * previousRate / 1_000_000 / parsed.division;
    }
    segments.push({tick, seconds: cumulative, rate});
    previousTick = tick;
    previousRate = rate;
  }
  return tick => {
    let index = segments.length - 1;
    while (index > 0 && segments[index].tick > tick) index--;
    const segment = segments[index];
    return segment.seconds + (tick - segment.tick) * segment.rate
      / 1_000_000 / parsed.division;
  };
}

function canonicalTiming(parsed, timing) {
  const result = structuredClone(timing);
  if (Array.isArray(result.tempoMap)) {
    const seconds = rawTimeMapper(parsed);
    result.tempoMap = result.tempoMap.map(point => ({
      ...point,
      seconds: pythonRound9(seconds(point.tick)),
    }));
  }
  return result;
}

function canonicalNotes(parsed, notes) {
  const seconds = rawTimeMapper(parsed);
  return notes.map(note => ({
    ...note,
    startSeconds: pythonRound9(seconds(note.startTick)),
    endSeconds: pythonRound9(seconds(note.endTick)),
  }));
}

function warningMessages(warnings = {}) {
  const messages = [];
  const labels = {
    unmatchedNoteOffs: 'unmatched note-off events',
    danglingNotesClosedAtEnd: 'notes closed at end of file',
    zeroLengthNotesExtendedOneTick: 'zero-length notes extended by one tick',
  };
  for (const [key, label] of Object.entries(labels)) {
    if (warnings[key]) messages.push(`${warnings[key]} ${label}`);
  }
  if (warnings.unsupportedEvents?.total) {
    messages.push(`${warnings.unsupportedEvents.total} unsupported expressive MIDI event(s) ignored`);
  }
  return messages;
}

function sourceMetadata(bytes, filename, parsed) {
  return {
    filename,
    sha256: midi.sha256Hex(bytes),
    midiFormat: parsed.midiFormat,
    trackCount: parsed.trackCount,
    trackNames: [...parsed.trackNames],
  };
}

function baseReport(report, document, settings, warnings) {
  return {
    ...report,
    preset: settings.preset,
    maximumVoices: DEFAULT_MAX_VOICES,
    voiceLimit: settings.maxVoices,
    source: structuredClone(document.source),
    timing: structuredClone(document.timing),
    warnings: warningMessages(warnings),
    warningDetails: structuredClone(warnings),
    validation: 'passed',
  };
}

function convertMidiToScore(options = {}) {
  const bytes = asBytes(options.midiBytes ?? options.bytes ?? options.source ?? options.midi,
    'MIDI input');
  const settings = normalizedSettings(options);
  const parsed = midi.parseMidi(bytes, {maxInputBytes: settings.maxInputBytes});
  const resolved = midi.resolveNotes(parsed, {strictUnsupported: settings.strictUnsupported});
  if (!resolved.notes.length) throw new ConversionError('MIDI file contains no notes');
  const notes = canonicalNotes(parsed, resolved.notes);
  const timing = canonicalTiming(parsed, resolved.resolution.timing);
  const warnings = resolved.resolution.warnings;
  const source = sourceMetadata(bytes, settings.filename, parsed);

  let document;
  let report;
  let arrangement = null;
  if (settings.preset === DEFAULT_PRESET) {
    if (settings.maxArrayEntries !== midi.constants.ARRAY_CAPACITY) {
      if (notes.length + arranger.constants.HEADER_LENGTH > settings.maxArrayEntries) {
        throw new ConversionError(`Score requires ${notes.length + arranger.constants.HEADER_LENGTH} array entries; capacity is ${settings.maxArrayEntries}`);
      }
    }
    const quality = arranger.buildScore(notes, source, {
      maxVoices: settings.maxVoices,
      releaseTailSeconds: settings.releaseTailSeconds,
      instrumentCode: settings.instrumentCode,
      channel: settings.channel,
      track: settings.track,
      timing,
      warnings,
      percussionPolicy: settings.percussionPolicy,
    });
    document = quality.document;
    arrangement = quality.arrangement;
    report = baseReport(quality.report, document, settings, warnings);
  } else {
    const filtered = midi.filterPlayableNotes(notes, settings.outOfRange);
    if (!filtered.notes.length) {
      throw new ConversionError('No playable notes remain after the pitch-range policy');
    }
    document = midi.buildScore(bytes, settings.filename, parsed, filtered.notes,
      settings.maxVoices, settings.releaseTailSeconds,
      {timing, warnings}, filtered.dropped,
      {maxArrayEntries: settings.maxArrayEntries});
    report = baseReport({
      ...document.statistics,
      activeVoices: document.activeVoices,
      releaseTailSeconds: settings.releaseTailSeconds,
      shortenedHeldNotes: 0,
      totalHeldSecondsRemoved: 0,
      octaveFoldedNotes: 0,
      qualityLabel: 'strict-canonical',
      qualityFlags: [],
      playerSelectedInstrument: false,
    }, document, settings, warnings);
  }

  arranger.validateDocument(document, {maxVoices: settings.maxVoices});
  cartridgeCore.normalizeScoreValues(document.array.values, {
    maximumVoices: DEFAULT_MAX_VOICES,
    maximumEntries: settings.maxArrayEntries,
  });
  return {
    preset: settings.preset,
    score: document,
    scoreDocument: document,
    report,
    parsed,
    resolvedNotes: notes,
    arrangement,
    settings,
    source: structuredClone(document.source),
    timing: structuredClone(document.timing),
    warnings: [...report.warnings],
  };
}

function convertMidiToCartridge(options = {}) {
  const templateBytes = asBytes(options.templateBytes, 'Cartridge template');
  const converted = convertMidiToScore(options);
  const {settings, score} = converted;
  const description = String(options.description
    ?? `Physics-root automatic SQM1 cartridge containing ${settings.title}; converted with ${settings.preset}.`);
  const buildName = String(options.buildName ?? `SQM1 ${settings.title} Cartridge`);
  const cartridge = cartridgeCore.buildAutomaticCartridge({
    title: settings.title,
    scoreValues: score.array.values,
    templateBytes,
    maximumVoices: DEFAULT_MAX_VOICES,
    maximumEntries: settings.maxArrayEntries,
    preferredMode: settings.preferredMode,
    buildName,
    description,
  });
  return {
    bytes: cartridge.bytes,
    brzBytes: cartridge.bytes,
    filename: `${outputStem(settings.title)}-sqm1-cartridge.brz`,
    title: settings.title,
    preset: settings.preset,
    score,
    scoreDocument: score,
    report: converted.report,
    source: structuredClone(score.source),
    timing: structuredClone(score.timing),
    warnings: [...converted.report.warnings],
    scene: cartridge.scene,
    cartridge: {
      buildName: cartridge.buildName,
      description: cartridge.description,
      preferredMode: cartridge.preferredMode,
      bytes: cartridge.bytes.length,
    },
  };
}

function createConverterAdapter(defaults = {}) {
  const templateBytes = defaults.templateBytes === undefined
    ? undefined : asBytes(defaults.templateBytes, 'Cartridge template');
  return Object.freeze({
    convertMidiToScore: options => convertMidiToScore({...defaults, ...options}),
    convertMidiToCartridge: options => convertMidiToCartridge({
      ...defaults,
      ...options,
      templateBytes: options?.templateBytes ?? templateBytes,
    }),
  });
}

function cliHelp() {
  return `Usage: node sqm1-midi-cartridge-converter.cjs input.mid output.brz [options]\n\n`
    + `Options:\n`
    + `  --title TITLE          Cartridge title (defaults to the input filename)\n`
    + `  --preset PRESET        v4-quality (default) or strict\n`
    + `  --max-voices COUNT     1..24 (default 24)\n`
    + `  --release-tail SEC     0..5 (default 0.2)\n`
    + `  --template FILE        Cartridge appearance template\n`
    + `  --report FILE          Write a JSON conversion report\n`
    + `  --include-percussion   Flatten channel-10 percussion into the selected instrument\n`
    + `  --strict-unsupported   Reject expressive MIDI events that cannot be represented\n`
    + `  --help                 Show this help\n`;
}

function parseCliArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const take = name => {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) {
        throw new ConversionError(`${name} requires a value`);
      }
      return value;
    };
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--title') options.title = take('--title');
    else if (argument === '--preset') options.preset = take('--preset');
    else if (argument === '--max-voices') options.maxVoices = Number(take('--max-voices'));
    else if (argument === '--release-tail') {
      options.releaseTailSeconds = Number(take('--release-tail'));
    } else if (argument === '--template') options.templateFile = take('--template');
    else if (argument === '--report') options.reportFile = take('--report');
    else if (argument === '--include-percussion') options.percussionPolicy = 'include';
    else if (argument === '--strict-unsupported') options.strictUnsupported = true;
    else if (argument.startsWith('-')) throw new ConversionError(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (!options.help && positional.length !== 2) {
    throw new ConversionError('Expected input.mid and output.brz');
  }
  return {...options, inputFile: positional[0], outputFile: positional[1]};
}

function nodeModule(name) {
  if (typeof module === 'undefined' || typeof module.require !== 'function') {
    throw new ConversionError('The command-line interface is available only in Node.js');
  }
  return module.require(name);
}

function runCli(argv = typeof process === 'undefined' ? [] : process.argv.slice(2)) {
  const fs = nodeModule('fs');
  const path = nodeModule('path');
  const cli = parseCliArguments(argv);
  if (cli.help) {
    if (typeof process !== 'undefined') process.stdout.write(cliHelp());
    return {help: true};
  }
  const inputFile = path.resolve(cli.inputFile);
  const outputFile = path.resolve(cli.outputFile);
  const templateFile = path.resolve(cli.templateFile || path.join(__dirname, '..', '..',
    'prefabs', 'sqm1-auto-zone-test-cartridge-v1.brz'));
  const result = convertMidiToCartridge({
    bytes: new Uint8Array(fs.readFileSync(inputFile)),
    templateBytes: new Uint8Array(fs.readFileSync(templateFile)),
    filename: path.basename(inputFile),
    title: cli.title ?? titleFromFilename(path.basename(inputFile)),
    preset: cli.preset,
    maxVoices: cli.maxVoices,
    releaseTailSeconds: cli.releaseTailSeconds,
    percussionPolicy: cli.percussionPolicy,
    strictUnsupported: cli.strictUnsupported,
  });
  fs.mkdirSync(path.dirname(outputFile), {recursive: true});
  fs.writeFileSync(outputFile, result.bytes);
  const summary = {
    inputFile,
    outputFile,
    templateFile,
    outputBytes: result.bytes.length,
    title: result.title,
    preset: result.preset,
    source: result.source,
    report: result.report,
  };
  if (cli.reportFile) {
    const reportFile = path.resolve(cli.reportFile);
    fs.mkdirSync(path.dirname(reportFile), {recursive: true});
    fs.writeFileSync(reportFile, `${JSON.stringify(summary, null, 2)}\n`);
    summary.reportFile = reportFile;
  }
  if (typeof process !== 'undefined') process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

module.exports = {
  ConversionError,
  convertMidiToScore,
  convertMidiToCartridge,
  createConverterAdapter,
  normalizePreset,
  pythonRound9,
  titleFromFilename,
  outputStem,
  cliHelp,
  parseCliArguments,
  runCli,
  constants: {
    DEFAULT_PRESET,
    DEFAULT_MAX_VOICES,
    DEFAULT_RELEASE_TAIL_SECONDS,
    MAX_TITLE_LENGTH,
  },
};

if (typeof require !== 'undefined' && require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const HERE = __dirname;
const DEFAULT_ADAPTER = path.join(HERE, 'sqm1-midi-cartridge-converter.cjs');
const PLACEHOLDER_ADAPTER = path.join(HERE, 'sqm1-midi-converter-adapter-placeholder.cjs');
const DEFAULT_TEMPLATE = path.join(HERE, '..', '..', 'prefabs',
  'sqm1-auto-zone-test-cartridge-v1.brz');
const DEFAULT_OUTPUT = path.join(HERE, '..', '..', 'outputs', 'sqm1-midi-converter.html');
const UI_MODULE = path.join(HERE, 'sqm1-midi-converter-ui.cjs');
const CSS_FILE = path.join(HERE, 'sqm1-midi-converter-ui.css');
const NOTICES_FILE = path.join(HERE, 'sqm1-midi-cartridge-converter',
  'THIRD-PARTY-NOTICES.txt');
const FS_SHIM = path.join(HERE, 'sqm1-browser-fs-shim.cjs');
const ASSERT_SHIM = path.join(HERE, 'sqm1-browser-assert-shim.cjs');

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function escapeHtml(source) {
  return source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function makeOfflineOnly(source) {
  const dynamicNativeLoader = 'Function("specifier","return import(specifier)")';
  const disabledNativeLoader = '(specifier=>Promise.reject(new Error('
    + '"Native database modules are unavailable in this offline converter")))';
  const scrubbed = source
    .replaceAll(dynamicNativeLoader, disabledNativeLoader)
    .replace(/https?:\/\/[^\s"'<>\\]+/g, 'offline-reference-removed');
  if (/\bimport\s*\(/.test(scrubbed)) {
    throw new Error('Browser bundle still contains a dynamic import path');
  }
  if (/https?:\/\//i.test(scrubbed)) {
    throw new Error('Browser bundle still contains an external network URL');
  }
  return scrubbed;
}

async function build(options = {}) {
  const adapterFile = path.resolve(options.adapterFile || DEFAULT_ADAPTER);
  const templateFile = path.resolve(options.templateFile || DEFAULT_TEMPLATE);
  const outputFile = path.resolve(options.outputFile || DEFAULT_OUTPUT);
  if (!fs.existsSync(adapterFile)) throw new Error(`Adapter not found: ${adapterFile}`);
  if (!fs.existsSync(templateFile)) throw new Error(`Cartridge template not found: ${templateFile}`);
  const templateBase64 = fs.readFileSync(templateFile).toString('base64');
  const entry = `
    const adapterModule = require(${JSON.stringify(adapterFile)});
    const {mountSqm1MidiConverter} = require(${JSON.stringify(UI_MODULE)});
    const binary = atob(${JSON.stringify(templateBase64)});
    const templateBytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) templateBytes[index] = binary.charCodeAt(index);
    const adapter = typeof adapterModule.createConverterAdapter === 'function'
      ? adapterModule.createConverterAdapter({templateBytes})
      : {convertMidiToCartridge: options => {
          const convert = typeof adapterModule === 'function'
            ? adapterModule : adapterModule.convertMidiToCartridge;
          if (typeof convert !== 'function') throw new TypeError(
            'Adapter must provide convertMidiToCartridge(options)');
          return convert({...options, templateBytes});
        }};
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mountSqm1MidiConverter(adapter));
    } else mountSqm1MidiConverter(adapter);
  `;
  const bundle = await esbuild.build({
    stdin: {contents: entry, resolveDir: HERE, sourcefile: 'sqm1-midi-converter-entry.cjs'},
    bundle: true,
    minify: options.minify !== false,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    write: false,
    sourcemap: false,
    legalComments: 'none',
    alias: {
      fs: FS_SHIM,
      'assert/strict': ASSERT_SHIM,
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });
  const bundledSource = Buffer.from(bundle.outputFiles[0].contents).toString('utf8');
  const script = escapeInlineScript(makeOfflineOnly(bundledSource));
  const css = fs.readFileSync(CSS_FILE, 'utf8');
  const notices = escapeHtml(fs.readFileSync(NOTICES_FILE, 'utf8')
    .replace(/https?:\/\/[^\s]+/g, 'offline-reference-removed'));
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>SQM1 MIDI Cartridge Converter</title>
  <style>${css}</style>
</head>
<body>
  <main class="app">
    <p class="eyebrow">Brickadia · SQM1</p>
    <h1>MIDI Cartridge Converter</h1>
    <p class="intro">Turn a Standard MIDI file into an automatic cartridge for the SQM1 music
      player. Conversion happens entirely on this computer.</p>
    <p class="offline">Offline application — your MIDI never leaves this device</p>

    <section class="panel" aria-label="MIDI conversion form">
      <div id="drop-zone" class="drop-zone" role="button" tabindex="0"
        aria-label="Choose or drop a MIDI file">
        <div>
          <span class="drop-title" id="selected-name">Drop a MIDI file here</span>
          <span class="drop-help">or choose one from this computer</span>
          <span class="file-size" id="selected-size"></span>
        </div>
        <span class="choose">Choose MIDI</span>
        <input id="midi-file" type="file" accept=".mid,.midi,.smf,audio/midi,audio/x-midi">
      </div>

      <div class="form-grid">
        <label>Song name
          <input id="song-title" type="text" maxlength="120" placeholder="Shown on the cartridge">
        </label>
        <label>Conversion quality
          <select id="quality-preset">
            <option value="v4-quality" selected>V4 Pitch Continuity (recommended)</option>
            <option value="strict">Strict / preserve every note end</option>
          </select>
        </label>
      </div>

      <details>
        <summary>Advanced settings</summary>
        <div class="advanced">
          <label>Voice limit
            <input id="voice-limit" type="number" min="1" max="24" step="1" value="24">
            <span class="hint">The current SQM1 player supports up to 24 lanes.</span>
          </label>
          <label>Release reservation (seconds)
            <input id="release-tail" type="number" min="0" max="5" step="0.01" value="0.20">
            <span class="hint">0.20 seconds matches the approved V4 cartridges.</span>
          </label>
        </div>
      </details>

      <div class="action-row">
        <button id="convert-button" type="button" disabled>Build &amp; Download Cartridge</button>
        <p id="status" role="status" aria-live="polite">Choose a MIDI file to begin.</p>
      </div>

      <section id="results" hidden aria-label="Conversion report">
        <h2>Conversion report</h2>
        <dl class="report-grid">
          <div class="metric"><dt>Quality</dt><dd id="report-quality">—</dd></div>
          <div class="metric"><dt>Notes</dt><dd id="report-notes">—</dd></div>
          <div class="metric"><dt>Voices</dt><dd id="report-voices">—</dd></div>
          <div class="metric"><dt>Duration</dt><dd id="report-duration">—</dd></div>
          <div class="metric"><dt>Array entries</dt><dd id="report-array">—</dd></div>
          <div class="metric"><dt>Pitch range</dt><dd id="report-pitch">—</dd></div>
          <div class="metric"><dt>Shortened notes</dt><dd id="report-cuts">—</dd></div>
          <div class="metric"><dt>Sustain removed</dt><dd id="report-sustain">—</dd></div>
          <div class="metric"><dt>Octave folds</dt><dd id="report-folds">—</dd></div>
        </dl>
        <div id="warning-block" class="warning-block" hidden>
          <strong>Warnings</strong>
          <ul id="warning-list"></ul>
        </div>
      </section>
    </section>
    <p class="footer">Designed for the 24-lane SQM1 V10.1 music player. Generated cartridges
      should be placed through a Prefab Spawner for automatic loading and deletion.</p>
    <details class="licenses">
      <summary>Third-party licenses</summary>
      <pre>${notices}</pre>
    </details>
  </main>
  <script>${script}</script>
</body>
</html>\n`;
  fs.mkdirSync(path.dirname(outputFile), {recursive: true});
  fs.writeFileSync(outputFile, html);
  return {outputFile, adapterFile, templateFile, bytes: Buffer.byteLength(html), html};
}

module.exports = build;
module.exports.makeOfflineOnly = makeOfflineOnly;
module.exports.constants = Object.freeze({
  DEFAULT_ADAPTER,
  PLACEHOLDER_ADAPTER,
  DEFAULT_TEMPLATE,
  DEFAULT_OUTPUT,
  NOTICES_FILE,
});

if (require.main === module) {
  const argumentsList = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < argumentsList.length; index++) {
    if (argumentsList[index] === '--adapter') options.adapterFile = argumentsList[++index];
    else if (argumentsList[index] === '--template') options.templateFile = argumentsList[++index];
    else if (argumentsList[index] === '--output') options.outputFile = argumentsList[++index];
    else if (argumentsList[index] === '--no-minify') options.minify = false;
    else throw new Error(`Unknown argument: ${argumentsList[index]}`);
  }
  build(options).then(result => {
    console.log(JSON.stringify({outputFile: result.outputFile, bytes: result.bytes,
      adapterFile: result.adapterFile, templateFile: result.templateFile,
      selfContained: true}, null, 2));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

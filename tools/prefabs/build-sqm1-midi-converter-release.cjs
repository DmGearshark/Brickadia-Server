'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const buildApp = require('./build-sqm1-midi-converter-app.cjs');

const HERE = __dirname;
const RELEASE_DIRECTORY = path.join(HERE, 'sqm1-midi-cartridge-converter');
const HTML_NAME = 'SQM1-MIDI-Cartridge-Converter.html';
const CLI_NAME = 'sqm1-midi-cartridge-converter.cjs';
const ZIP_NAME = 'SQM1-MIDI-Cartridge-Converter.zip';
const README_NAME = 'README.md';
const NOTICE_NAME = 'THIRD-PARTY-NOTICES.txt';
const CHECKSUM_NAME = 'SHA256SUMS.txt';
const DOS_TIME = 0;
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const ADAPTER = path.join(HERE, 'sqm1-midi-cartridge-converter.cjs');
const TEMPLATE = path.join(HERE, '..', '..', 'prefabs',
  'sqm1-auto-zone-test-cartridge-v1.brz');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, data) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(name, data, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function storedZip(entries) {
  const ordered = [...entries].sort((left, right) => Buffer.compare(
    Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of ordered) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const local = localHeader(name, data);
    localParts.push(local, name, data);
    centralParts.push(centralHeader(name, data, offset), name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function writeAtomic(filename, value) {
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  const temporary = `${filename}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, value, {mode: 0o644});
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function buildCliBundle(options = {}) {
  const adapterFile = path.resolve(options.adapterFile || ADAPTER);
  const templateFile = path.resolve(options.templateFile || TEMPLATE);
  if (!fs.existsSync(adapterFile)) throw new Error(`CLI adapter not found: ${adapterFile}`);
  if (!fs.existsSync(templateFile)) throw new Error(`CLI template not found: ${templateFile}`);
  const template = fs.readFileSync(templateFile);
  const templateBase64 = template.toString('base64');
  const templateSha256 = sha256(template);
  const entry = `
    'use strict';
    const fs = require('fs');
    const path = require('path');
    const converter = require(${JSON.stringify(adapterFile)});
    const templateBase64 = ${JSON.stringify(templateBase64)};
    const embeddedTemplateSha256 = ${JSON.stringify(templateSha256)};
    function embeddedTemplate() {
      return new Uint8Array(Buffer.from(templateBase64, 'base64'));
    }
    function main(argv) {
      const cli = converter.parseCliArguments(argv);
      if (cli.help) {
        process.stdout.write(converter.cliHelp());
        return;
      }
      const inputFile = path.resolve(cli.inputFile);
      const outputFile = path.resolve(cli.outputFile);
      const templateFile = cli.templateFile ? path.resolve(cli.templateFile) : null;
      const templateBytes = templateFile
        ? new Uint8Array(fs.readFileSync(templateFile)) : embeddedTemplate();
      const result = converter.convertMidiToCartridge({
        bytes: new Uint8Array(fs.readFileSync(inputFile)),
        templateBytes,
        filename: path.basename(inputFile),
        title: cli.title ?? converter.titleFromFilename(path.basename(inputFile)),
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
        templateFile: templateFile || ('embedded:' + embeddedTemplateSha256),
        outputBytes: result.bytes.length,
        title: result.title,
        preset: result.preset,
        source: result.source,
        report: result.report,
      };
      if (cli.reportFile) {
        const reportFile = path.resolve(cli.reportFile);
        fs.mkdirSync(path.dirname(reportFile), {recursive: true});
        fs.writeFileSync(reportFile, JSON.stringify(summary, null, 2) + '\\n');
        summary.reportFile = reportFile;
      }
      process.stdout.write(JSON.stringify(summary, null, 2) + '\\n');
    }
    try { main(process.argv.slice(2)); }
    catch (error) {
      console.error(error && (error.stack || error.message) || String(error));
      process.exitCode = 1;
    }
  `;
  const built = await esbuild.build({
    stdin: {contents: entry, resolveDir: HERE, sourcefile: 'sqm1-release-cli-entry.cjs'},
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    write: false,
    sourcemap: false,
    legalComments: 'none',
    define: {'process.env.NODE_ENV': '"production"'},
  });
  const bytes = Buffer.from(built.outputFiles[0].contents);
  if (bytes.includes(Buffer.from('/workspace/'))) {
    throw new Error('Bundled CLI contains an absolute build-machine path');
  }
  return Object.freeze({bytes, adapterFile, templateFile, templateSha256});
}

async function buildRelease(options = {}) {
  const outputFile = path.resolve(options.outputFile
    || path.join(RELEASE_DIRECTORY, ZIP_NAME));
  const htmlOutputFile = path.resolve(options.htmlOutputFile
    || path.join(path.dirname(outputFile), HTML_NAME));
  const readmeFile = path.resolve(options.readmeFile
    || path.join(RELEASE_DIRECTORY, README_NAME));
  const noticeFile = path.resolve(options.noticeFile
    || path.join(RELEASE_DIRECTORY, NOTICE_NAME));
  for (const input of [readmeFile, noticeFile]) {
    if (!fs.existsSync(input)) throw new Error(`Release input not found: ${input}`);
  }

  const app = await buildApp({outputFile: htmlOutputFile});
  const cli = await buildCliBundle({
    adapterFile: options.adapterFile,
    templateFile: options.templateFile,
  });
  const payload = [
    {name: HTML_NAME, data: fs.readFileSync(app.outputFile)},
    {name: CLI_NAME, data: cli.bytes},
    {name: README_NAME, data: fs.readFileSync(readmeFile)},
    {name: NOTICE_NAME, data: fs.readFileSync(noticeFile)},
  ].sort((left, right) => left.name.localeCompare(right.name));
  const checksums = Buffer.from(payload
    .map(entry => `${sha256(entry.data)}  ${entry.name}\n`).join(''), 'utf8');
  const checksumFile = path.join(path.dirname(outputFile), CHECKSUM_NAME);
  await writeAtomic(checksumFile, checksums);
  const zipBytes = storedZip([...payload, {name: CHECKSUM_NAME, data: checksums}]);
  await writeAtomic(outputFile, zipBytes);

  return Object.freeze({
    outputFile,
    htmlOutputFile,
    checksumFile,
    cli: {
      name: CLI_NAME,
      bytes: cli.bytes.length,
      sha256: sha256(cli.bytes),
      templateSha256: cli.templateSha256,
    },
    bytes: zipBytes.length,
    sha256: sha256(zipBytes),
    files: Object.fromEntries([...payload, {name: CHECKSUM_NAME, data: checksums}]
      .map(entry => [entry.name, {bytes: entry.data.length, sha256: sha256(entry.data)}])),
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--output') options.outputFile = argv[++index];
    else if (argument === '--html-output') options.htmlOutputFile = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
    if (!argv[index]) throw new Error(`${argument} requires a filename`);
  }
  return options;
}

module.exports = buildRelease;
module.exports.storedZip = storedZip;
module.exports.buildCliBundle = buildCliBundle;
module.exports.constants = Object.freeze({
  RELEASE_DIRECTORY, HTML_NAME, CLI_NAME, ZIP_NAME, README_NAME, NOTICE_NAME, CHECKSUM_NAME,
  ADAPTER, TEMPLATE,
});

if (require.main === module) {
  buildRelease(parseArguments(process.argv.slice(2))).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

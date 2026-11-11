'use strict';

const MAX_MIDI_BYTES = 32 * 1024 * 1024;

function titleFromFilename(filename) {
  const stem = String(filename || '')
    .replace(/\.(?:midi?|smf)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stem) return 'Untitled Song';
  return stem.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function safeOutputStem(title) {
  const stem = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return stem || 'sqm1-song';
}

function finite(value, fallback = 0) {
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : fallback;
}

function normalizeWarnings(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([label, count]) => {
      if (Array.isArray(count)) return count.map(item => `${label}: ${item}`);
      if (!count) return [];
      return [`${label}: ${count}`];
    });
  }
  return [String(value)];
}

function normalizeReport(result) {
  const report = result?.report || result?.statistics || {};
  const source = report.statistics || report;
  const preset = source.preset ?? report.preset ?? result?.preset;
  const pitchMin = source.minimumPitch ?? source.minPitch;
  const pitchMax = source.maximumPitch ?? source.maxPitch;
  return {
    notes: finite(source.notes ?? source.noteCount),
    activeVoices: finite(source.activeVoices ?? source.allocatedVoices ?? source.voices),
    durationSeconds: finite(source.durationSeconds ?? source.duration),
    arrayEntries: finite(source.arrayEntries ?? source.scoreQuaternions),
    pitchRange: Number.isFinite(Number(pitchMin)) && Number.isFinite(Number(pitchMax))
      ? `${pitchMin}–${pitchMax}` : '—',
    shortenedNotes: finite(source.shortenedNotes ?? source.shortenedHeldNotes),
    removedSustainSeconds: finite(source.removedSustainSeconds
      ?? source.totalHeldSecondsRemoved),
    foldedNotes: finite(source.foldedNotes ?? source.octaveFoldedNotes),
    quality: preset === 'v4-quality' ? 'V4 Pitch Continuity'
      : preset === 'strict' ? 'Strict canonical'
        : String(source.quality || source.qualityLabel || result?.preset || 'Converted'),
    warnings: normalizeWarnings(source.warnings ?? report.warnings ?? result?.warnings),
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, finite(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('Converter did not return cartridge bytes');
}

function mountSqm1MidiConverter(adapter, root = globalThis.document) {
  if (!root) throw new Error('A browser document is required');
  const convertMidiToCartridge = typeof adapter === 'function'
    ? adapter : adapter?.convertMidiToCartridge;
  if (typeof convertMidiToCartridge !== 'function') {
    throw new TypeError('Adapter must provide convertMidiToCartridge(options)');
  }

  const byId = id => root.getElementById(id);
  const dropZone = byId('drop-zone');
  const fileInput = byId('midi-file');
  const titleInput = byId('song-title');
  const presetInput = byId('quality-preset');
  const voicesInput = byId('voice-limit');
  const tailInput = byId('release-tail');
  const convertButton = byId('convert-button');
  const selectedName = byId('selected-name');
  const selectedSize = byId('selected-size');
  const status = byId('status');
  const results = byId('results');
  const warningList = byId('warning-list');
  let selectedFile = null;
  let titleWasEdited = false;
  let busy = false;

  function setStatus(message, state = 'idle') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function showFile(file) {
    if (!file) return;
    if (!/\.(?:mid|midi|smf)$/i.test(file.name || '')) {
      selectedFile = null;
      selectedName.textContent = 'Drop a MIDI file here';
      selectedSize.textContent = '';
      convertButton.disabled = true;
      results.hidden = true;
      setStatus('Choose a Standard MIDI file ending in .mid, .midi, or .smf.', 'error');
      return;
    }
    if (file.size > MAX_MIDI_BYTES) {
      selectedFile = null;
      selectedName.textContent = file.name;
      selectedSize.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
      convertButton.disabled = true;
      results.hidden = true;
      setStatus('MIDI files must be 32 MB or smaller.', 'error');
      return;
    }
    selectedFile = file;
    selectedName.textContent = file.name;
    selectedSize.textContent = `${(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB`;
    if (!titleWasEdited || !titleInput.value.trim()) {
      titleInput.value = titleFromFilename(file.name);
      titleWasEdited = false;
    }
    convertButton.disabled = false;
    results.hidden = true;
    setStatus('Ready to build an automatic SQM1 cartridge.', 'ready');
  }

  function setDropActive(active) {
    dropZone.classList.toggle('dragging', active);
  }

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      setDropActive(true);
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      setDropActive(false);
    });
  }
  dropZone.addEventListener('drop', event => showFile(event.dataTransfer?.files?.[0]));
  dropZone.addEventListener('click', event => {
    if (event.target !== fileInput) fileInput.click();
  });
  dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => showFile(fileInput.files?.[0]));
  titleInput.addEventListener('input', () => { titleWasEdited = true; });

  function renderReport(report) {
    const fields = {
      'report-notes': report.notes.toLocaleString(),
      'report-voices': String(report.activeVoices),
      'report-duration': formatDuration(report.durationSeconds),
      'report-array': report.arrayEntries.toLocaleString(),
      'report-pitch': report.pitchRange,
      'report-cuts': report.shortenedNotes.toLocaleString(),
      'report-sustain': `${report.removedSustainSeconds.toFixed(3)} s`,
      'report-folds': report.foldedNotes.toLocaleString(),
      'report-quality': report.quality,
    };
    for (const [id, value] of Object.entries(fields)) byId(id).textContent = value;
    warningList.replaceChildren();
    for (const warning of report.warnings) {
      const item = root.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    }
    byId('warning-block').hidden = report.warnings.length === 0;
    results.hidden = false;
  }

  function download(bytes, filename) {
    const blob = new Blob([bytes], {type: 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const link = root.createElement('a');
    link.href = url;
    link.download = filename;
    root.body.append(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  convertButton.addEventListener('click', async () => {
    if (!selectedFile || busy) return;
    const title = titleInput.value.trim();
    if (!title) {
      setStatus('Enter the song name that should appear on the cartridge.', 'error');
      titleInput.focus();
      return;
    }
    const voiceLimit = Number(voicesInput.value);
    const releaseTailSeconds = Number(tailInput.value);
    if (!Number.isInteger(voiceLimit) || voiceLimit < 1 || voiceLimit > 24) {
      setStatus('Voice limit must be a whole number from 1 through 24.', 'error');
      return;
    }
    if (!Number.isFinite(releaseTailSeconds)
      || releaseTailSeconds < 0 || releaseTailSeconds > 5) {
      setStatus('Release reservation must be between 0 and 5 seconds.', 'error');
      return;
    }

    busy = true;
    convertButton.disabled = true;
    convertButton.classList.add('busy');
    results.hidden = true;
    setStatus('Reading MIDI and assigning its notes…', 'working');
    try {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      const result = await convertMidiToCartridge({
        bytes,
        filename: selectedFile.name,
        title,
        preset: presetInput.value,
        options: {voiceLimit, releaseTailSeconds},
      });
      const cartridge = asUint8Array(result?.bytes ?? result?.brzBytes);
      const report = normalizeReport(result);
      const outputName = result?.filename || `${safeOutputStem(title)}-sqm1-cartridge.brz`;
      renderReport(report);
      download(cartridge, outputName);
      setStatus(`Built ${outputName}. Your browser should be downloading it now.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message || 'Conversion failed.', 'error');
    } finally {
      busy = false;
      convertButton.disabled = !selectedFile;
      convertButton.classList.remove('busy');
    }
  });

  return Object.freeze({showFile, setStatus});
}

module.exports = {
  mountSqm1MidiConverter,
  titleFromFilename,
  safeOutputStem,
  normalizeReport,
  formatDuration,
};

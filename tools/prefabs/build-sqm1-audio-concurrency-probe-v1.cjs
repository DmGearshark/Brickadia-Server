'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {Build, C, R, N, S} = require('./loadboard-lib.cjs');

const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-audio-concurrency-probe-v1.brz');
const PREFIX = 'SQM1ACP1';
const LOW_GAIN = 0.035;
const PULSE_SECONDS = 0.06;
const HARD_VELOCITY = (120 / 127) ** 1.4;
const SHAPED_VELOCITY = 0.5 * (HARD_VELOCITY + Math.sqrt(HARD_VELOCITY));
const BRIGHTNESS = 0.35 + 0.65 * SHAPED_VELOCITY;
const REALISTIC_GAINS = Object.freeze([
  SHAPED_VELOCITY * 0.35,
  SHAPED_VELOCITY * BRIGHTNESS * 0.05,
  SHAPED_VELOCITY * BRIGHTNESS * 0.015,
]);
const NOTE_MIDI = Object.freeze([
  48, 50, 52, 53, 55, 57, 59, 60, 62,
  64, 65, 67, 69, 71, 72, 74, 76, 77,
]);
const MODES = Object.freeze([
  Object.freeze({id: 0, label: 'STOP / RESET', sources: 0, kind: 'stop',
    status: 'STOPPED | 0 commanded audio sources'}),
  Object.freeze({id: 1, label: 'STATIC LOW | 18 SOURCES', sources: 18, kind: 'low',
    status: 'STATIC LOW | 18 sources | 6 notes x 3 equal layers'}),
  Object.freeze({id: 2, label: 'STATIC LOW | 30 SOURCES', sources: 30, kind: 'low',
    status: 'STATIC LOW | 30 sources | 10 notes x 3 equal layers'}),
  Object.freeze({id: 3, label: 'STATIC LOW | 33 SOURCES', sources: 33, kind: 'low',
    status: 'STATIC LOW | 33 sources | 11 notes x 3 equal layers'}),
  Object.freeze({id: 4, label: 'STATIC LOW | 36 SOURCES', sources: 36, kind: 'low',
    status: 'STATIC LOW | 36 sources | 12 notes x 3 equal layers'}),
  Object.freeze({id: 5, label: 'STATIC LOW | 48 SOURCES', sources: 48, kind: 'low',
    status: 'STATIC LOW | 48 sources | 16 notes x 3 equal layers'}),
  Object.freeze({id: 6, label: 'STATIC LOW | 54 SOURCES', sources: 54, kind: 'low',
    status: 'STATIC LOW | 54 sources | 18 notes x 3 equal layers'}),
  Object.freeze({id: 7, label: 'REALISTIC SUSTAIN | 54', sources: 54, kind: 'realistic',
    status: 'STATIC REALISTIC SUSTAIN | 54 sources | full internal gain'}),
  Object.freeze({id: 8, label: 'REALISTIC 25% | 54', sources: 54, kind: 'quarter',
    status: 'STATIC REALISTIC SUSTAIN | 54 sources | 25% internal gain'}),
  Object.freeze({id: 9, label: 'PULSED LOW | 54 SOURCES', sources: 54, kind: 'pulse',
    status: 'PULSED LOW | 54 sources | 60 ms on / 60 ms off'}),
]);
const EXTERNAL_ASSETS = Object.freeze([
  Object.freeze({type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}),
  Object.freeze({type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'}),
]);

function addButton(build, id, label, position, color) {
  const node = {id, type: C.Button.NAME, pos: position, data: {
    PromptCustomLabel: label,
    bAllowNearbyInteraction: true,
    bHiddenInteraction: false,
  }};
  build.add(node, {
    asset: 'B_Button_Square',
    size: [20, 20, 6],
    position,
    direction: 4,
    rotation: 2,
    color,
    components: [
      {type: node.type, data: node.data},
      {type: C.Interact.NAME, data: {
        Message: `${PREFIX}:button.${id}`,
        bHiddenInteraction: true,
      }},
    ],
  });
  return node;
}

function addDisplay(build, id, position, size, text, color) {
  const node = {id, type: C.TextDisplay.NAME, pos: position, data: {
    Text: text,
    Font: 0,
    Face: 0,
    LineHeight: 1.08,
    WidthScale: 0.72,
    bEnabled: true,
    Color: {R: color[0], G: color[1], B: color[2], A: 255},
    bOverrideColor: true,
  }};
  build.add(node, {
    asset: 'PB_DefaultMicroBrick',
    size,
    position,
    direction: 4,
    rotation: 2,
    color: [15, 19, 28],
    components: [{type: node.type, data: node.data}],
  });
  return node;
}

module.exports = function buildSqm1AudioConcurrencyProbeV1() {
  const build = new Build('SQM1 Audio Concurrency Probe V1', EXTERNAL_ASSETS);
  const chip = build.w.addMicrochip({position: [0, -170, 4], color: [58, 105, 155]});
  const circuit = build.circuit(chip.grid, 'audio_limit');

  const title = addDisplay(build, 'title', [0, 0, 205], [1, 175, 10],
    'SQM1 AUDIO LIMIT PROBE | STATIC SOURCE COUNT / MIX LEVEL / RESTART CHURN',
    [130, 220, 255]);
  const instructions = addDisplay(build, 'instructions', [0, 0, 160], [1, 175, 20],
    'Use one mode at a time. Start at 18 and step upward. Listen for abrupt missing tones, '
      + 'cycling voices, pumping, or breakup. Compare REALISTIC with REALISTIC 25%, then PULSED.\r\n'
      + 'Press STOP between comparisons. Keep game volume and listening position unchanged.',
    [225, 235, 250]);
  const status = addDisplay(build, 'status', [0, 0, 112], [1, 175, 13],
    MODES[0].status, [255, 220, 115]);

  const buttonPositions = [
    [-260, -70, 6], [-130, -70, 6], [0, -70, 6], [130, -70, 6], [260, -70, 6],
    [-260, 70, 6], [-130, 70, 6], [0, 70, 6], [130, 70, 6], [260, 70, 6],
  ];
  const buttonColors = [
    [175, 65, 65],
    [55, 125, 205], [55, 140, 205], [55, 155, 205], [55, 170, 205],
    [65, 185, 190], [65, 195, 165],
    [215, 145, 60], [205, 185, 65], [185, 85, 205],
  ];
  const buttons = MODES.map((mode, index) => addButton(build, `mode_${mode.id}`,
    mode.label, buttonPositions[index], buttonColors[index]));

  const mode = circuit.v(0);
  const controls = buttons.map((button, index) => {
    const edge = circuit.edge(R(button, 'bHeld'));
    const setter = circuit.set(mode, MODES[index].id);
    circuit.link(edge, setter, 'OnRisingEdge');
    return {button, edge, setter, mode: MODES[index]};
  });
  const modeChecks = MODES.map(specification => circuit.n('Expr_CompareEqual', {
    InputA: R(mode), InputB: N(specification.id),
  }));

  let statusText = S(MODES[0].status);
  for (let index = 1; index < MODES.length; index++) {
    statusText = circuit.sel(R(modeChecks[index], 'bOutput'), statusText, S(MODES[index].status));
  }
  circuit.bind(status, 'Text', statusText);

  const lowModes = MODES.filter(specification => specification.kind === 'low')
    .map(specification => R(modeChecks[specification.id], 'bOutput'));
  lowModes.push(R(modeChecks[9], 'bOutput'));
  const lowVolumeMode = circuit.or(...lowModes);

  const pulseClock = circuit.n('Clock', {
    IntervalSeconds: PULSE_SECONDS,
    bEnabled: R(modeChecks[9], 'bOutput'),
  });
  const pulseToggle = circuit.n('Exec_Toggle');
  circuit.link(pulseClock, pulseToggle, 'Pulse');
  const pulsedEnabled = circuit.and(R(modeChecks[9], 'bOutput'), R(pulseToggle, 'Output'));

  const emitters = [];
  for (let note = 0; note < NOTE_MIDI.length; note++) {
    const fundamental = 2 ** ((NOTE_MIDI[note] - 69) / 12);
    for (let layer = 0; layer < 3; layer++) {
      const sourceIndex = note * 3 + layer;
      const enabledTerms = [];
      for (const specification of MODES) {
        if (specification.kind === 'low' && sourceIndex < specification.sources) {
          enabledTerms.push(R(modeChecks[specification.id], 'bOutput'));
        }
      }
      enabledTerms.push(R(modeChecks[7], 'bOutput'), R(modeChecks[8], 'bOutput'), pulsedEnabled);
      const enabled = circuit.or(...enabledTerms);

      const lowVolume = circuit.n('Expr_Select', {
        InputA: N(0), InputB: N(LOW_GAIN), bSelectB: lowVolumeMode,
      });
      const realisticVolume = circuit.n('Expr_Select', {
        InputA: R(lowVolume, 'Output'), InputB: N(REALISTIC_GAINS[layer]),
        bSelectB: R(modeChecks[7], 'bOutput'),
      });
      const finalVolume = circuit.n('Expr_Select', {
        InputA: R(realisticVolume, 'Output'), InputB: N(REALISTIC_GAINS[layer] * 0.25),
        bSelectB: R(modeChecks[8], 'bOutput'),
      });
      const ratio = layer === 0 ? 1 : layer === 1 ? 2 : 3;
      const pitch = Math.max(0.1, Math.min(4, fundamental * ratio));
      const emitter = circuit.n('AudioEmitter', {
        bEnabled: enabled,
        AudioDescriptor: 1,
        VolumeMultiplier: R(finalVolume, 'Output'),
        PitchMultiplier: pitch,
        InnerRadius: 400,
        MaxDistance: 4000,
        bSpatialization: false,
        FocusAzimuth: 360,
        NonFocusAzimuth: 360,
        NonFocusVolumeAttenuation: 1,
      });
      emitters.push({note, layer, sourceIndex, midi: NOTE_MIDI[note], ratio, pitch,
        enabledModes: MODES.filter(specification => (specification.kind === 'low'
          && sourceIndex < specification.sources)
          || ['realistic', 'quarter', 'pulse'].includes(specification.kind))
          .map(specification => specification.id),
        enabled, lowVolume, realisticVolume, finalVolume, emitter});
    }
  }

  const bytes = build.finish({x: 360, y: 210, z: 230},
    'Scheduler-free continuous Sine probe for separating Brickadia audio-source concurrency, '
      + 'mix headroom and AudioEmitter restart churn from SQM1 MIDI/player logic. Static low-gain '
      + 'modes command 18, 30, 33, 36, 48 or 54 sources; three 54-source modes compare realistic '
      + 'sustain, quarter gain and 60 ms pulsing. The visible count is configured, not engine feedback.');

  return {
    bytes, build, chip, circuit, title, instructions, status, buttons, controls, mode,
    modeChecks, statusText, lowVolumeMode, pulseClock, pulseToggle, pulsedEnabled, emitters,
    constants: {
      OUTPUT_DEFAULT, PREFIX, LOW_GAIN, PULSE_SECONDS, HARD_VELOCITY,
      SHAPED_VELOCITY, BRIGHTNESS, REALISTIC_GAINS, NOTE_MIDI, MODES, EXTERNAL_ASSETS,
    },
  };
};

if (require.main === module) {
  const output = process.argv[2] ?? OUTPUT_DEFAULT;
  try {
    const context = module.exports();
    require('./test-sqm1-audio-concurrency-probe-v1.cjs')(context);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, context.bytes);
    console.log(JSON.stringify({
      output,
      bytes: context.bytes.length,
      modes: MODES.length,
      emitters: context.emitters.length,
      gates: context.build.nodes.length,
      wires: context.build.edges.length,
      sha256: require('crypto').createHash('sha256').update(context.bytes).digest('hex'),
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

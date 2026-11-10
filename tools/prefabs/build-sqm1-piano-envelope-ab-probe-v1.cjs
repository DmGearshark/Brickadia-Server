'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N} = require('./loadboard-lib.cjs');

const PREFIX = 'SPEAB1';
const EXTERNAL_ASSETS = Object.freeze([
  Object.freeze({type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}),
  Object.freeze({type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'}),
]);
const NOTE_SECONDS = 1.35;
const RELEASE_SECONDS = 0.13;
const PROBE_LIMIT = NOTE_SECONDS + RELEASE_SECONDS;
const MASTER_GAIN = 0.35;
const SOFT_VELOCITY = (48 / 127) ** 1.4;
const HARD_VELOCITY = (120 / 127) ** 1.4;

module.exports = function buildSqm1PianoEnvelopeAbProbeV1() {
  const b = new Build('SQM1 Piano Envelope A-B Probe V1', EXTERNAL_ASSETS);
  const c = b.circuit('main', 'piano_ab');

  function addButton(id, label, position, color, marker) {
    const node = {
      id,
      type: C.Button.NAME,
      pos: position,
      data: {
        PromptCustomLabel: label,
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
      },
    };
    b.add(node, {
      asset: C.Button.BRICK,
      size: [10, 10, 6],
      position,
      direction: 4,
      rotation: 2,
      color,
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {
          Message: `${PREFIX}:button.${marker}`,
          bHiddenInteraction: true,
        }},
      ],
    });
    return node;
  }

  function addDisplay(id, position, size, text, color = [235, 240, 250]) {
    const node = {
      id,
      type: C.TextDisplay.NAME,
      pos: position,
      data: {
        Text: text,
        Font: 0,
        Face: 0,
        LineHeight: 1.12,
        WidthScale: 0.78,
        bEnabled: true,
        Color: {R: color[0], G: color[1], B: color[2], A: 255},
        bOverrideColor: true,
      },
    };
    b.add(node, {
      asset: 'PB_DefaultMicroBrick',
      size,
      position,
      direction: 4,
      rotation: 2,
      color: [16, 20, 30],
      components: [{type: node.type, data: node.data}],
    });
    return node;
  }

  const currentSoft = addButton('current_soft', 'CURRENT piano - soft strike',
    [-210, -65, 5], [75, 135, 215], 'current.soft');
  const currentHard = addButton('current_hard', 'CURRENT piano - hard strike',
    [-210, 65, 5], [35, 85, 190], 'current.hard');
  const punchySoft = addButton('punchy_soft', 'PUNCHY piano - soft strike',
    [-70, -65, 5], [75, 205, 130], 'punchy.soft');
  const punchyHard = addButton('punchy_hard', 'PUNCHY piano - hard strike',
    [-70, 65, 5], [25, 155, 75], 'punchy.hard');

  addDisplay('title', [0, 0, 180], [1, 135, 11],
    'PIANO ATTACK A/B  |  CURRENT (BLUE) vs PUNCHY (GREEN)', [135, 225, 255]);
  addDisplay('instructions', [0, 0, 140], [1, 135, 16],
    'Press once, then let the note finish. Compare SOFT against SOFT and HARD against HARD.\r\n'
      + 'Listen for the initial key impact, body decay, and final release. A4 / Sine only.');
  addDisplay('current_label', [-210, 0, 105], [1, 60, 10],
    'CURRENT\r\n28 ms symmetric smoothing\r\nflat held body + fixed 2x/3x partials',
    [125, 185, 255]);
  addDisplay('punchy_label', [-70, 0, 105], [1, 60, 10],
    'PUNCHY CANDIDATE\r\n5 ms attack / 70 ms release\r\ndecaying body + velocity-sensitive strike',
    [125, 255, 175]);

  function triggerPair(name, softButton, hardButton) {
    const velocity = c.v(SOFT_VELOCITY);
    const audible = c.v(false);
    const clock = c.n('Stopwatch', {Time: 0, Limit: PROBE_LIMIT, bRunning: false});
    const softEdge = c.edge(R(softButton, 'bHeld'));
    const hardEdge = c.edge(R(hardButton, 'bHeld'));
    const setSoft = c.set(velocity, SOFT_VELOCITY);
    const setHard = c.set(velocity, HARD_VELOCITY);
    c.link(softEdge, setSoft, 'OnRisingEdge');
    c.link(hardEdge, setHard, 'OnRisingEdge');
    const softAudible = c.set(audible, true);
    const hardAudible = c.set(audible, true);
    c.link(setSoft, softAudible);
    c.link(setHard, hardAudible);
    const restart = c.n('Exec_Union');
    c.link(softAudible, restart, 'ExecOut', 'ExecA');
    c.link(hardAudible, restart, 'ExecOut', 'ExecB');
    c.link(restart, clock, 'ExecOut', 'Restart');
    const clearAudible = c.set(audible, false);
    c.link(clock, clearAudible, 'Expired');
    const beforeRelease = c.cmp('Less', R(clock, 'Time'), N(NOTE_SECONDS));
    const noteActive = c.and(R(audible), beforeRelease);
    return {
      velocity, audible, clock, softEdge, hardEdge, setSoft, setHard,
      restart, clearAudible, beforeRelease, noteActive,
    };
  }

  function emitter(enabled, volume, pitch) {
    const node = c.n('AudioEmitter', {
      bEnabled: false,
      AudioDescriptor: 1,
      VolumeMultiplier: 0,
      PitchMultiplier: pitch,
      InnerRadius: 180,
      MaxDistance: 1400,
      bSpatialization: false,
      FocusAzimuth: 360,
      NonFocusAzimuth: 360,
      NonFocusVolumeAttenuation: 1,
    });
    c.bind(node, 'bEnabled', enabled);
    c.bind(node, 'VolumeMultiplier', volume);
    return node;
  }

  const current = triggerPair('current', currentSoft, currentHard);
  const currentTarget = c.sel(current.noteActive, N(0), R(current.velocity));
  const currentMaster = c.n('Expr_MathMultiply', {
    InputA: currentTarget, InputB: N(MASTER_GAIN),
  });
  const currentEnvelope = c.n('Dampen', {
    Target: R(currentMaster, 'Output'), SmoothTime: 0.028,
  });
  const currentLayers = [
    {ratio: 1, gain: 1},
    {ratio: 2, gain: 0.18},
    {ratio: 3, gain: 0.06},
  ].map((layer, index) => {
    const gain = c.n('Expr_MathMultiply', {
      InputA: R(currentEnvelope, 'Value'), InputB: N(layer.gain),
    });
    return {
      ...layer,
      gainNode: gain,
      emitter: emitter(R(current.audible), R(gain, 'Output'), layer.ratio),
    };
  });

  const punchy = triggerPair('punchy', punchySoft, punchyHard);
  const age = c.n('Expr_MathMax', {InputA: R(punchy.clock, 'Time'), InputB: N(0)});
  const bodyExponent = c.n('Expr_MathMultiply', {
    InputA: R(age, 'Output'), InputB: N(-2.2),
  });
  const bodyDecay = c.n('Expr_MathExp', {Input: R(bodyExponent, 'Output')});
  const bodyScaled = c.n('Expr_MathMultiply', {
    InputA: R(bodyDecay, 'Output'), InputB: N(0.8),
  });
  const bodyCurve = c.n('Expr_MathAdd', {
    InputA: R(bodyScaled, 'Output'), InputB: N(0.2),
  });
  const bodyVelocity = c.n('Expr_MathMultiply', {
    InputA: R(bodyCurve, 'Output'), InputB: R(punchy.velocity),
  });
  const bodyActive = c.sel(punchy.noteActive, N(0), R(bodyVelocity, 'Output'));
  const bodyMaster = c.n('Expr_MathMultiply', {
    InputA: bodyActive, InputB: N(MASTER_GAIN),
  });
  const bodySmooth = c.sel(punchy.noteActive, N(0.07), N(0.005));
  const bodyEnvelope = c.n('Dampen', {
    Target: R(bodyMaster, 'Output'), SmoothTime: bodySmooth,
  });

  const brightnessScale = c.n('Expr_MathMultiply', {
    InputA: R(punchy.velocity), InputB: N(0.75),
  });
  const brightness = c.n('Expr_MathAdd', {
    InputA: R(brightnessScale, 'Output'), InputB: N(0.25),
  });
  const velocityBrightness = c.n('Expr_MathMultiply', {
    InputA: R(punchy.velocity), InputB: R(brightness, 'Output'),
  });
  const transientSmooth = c.sel(punchy.noteActive, N(0.05), N(0.003));
  const punchyLayers = [{ratio: 2.01, gain: 0.30, rate: -9},
    {ratio: 3.03, gain: 0.12, rate: -13}].map((layer, index) => {
    const exponent = c.n('Expr_MathMultiply', {
      InputA: R(age, 'Output'), InputB: N(layer.rate),
    });
    const decay = c.n('Expr_MathExp', {Input: R(exponent, 'Output')});
    const decayGain = c.n('Expr_MathMultiply', {
      InputA: R(decay, 'Output'), InputB: N(layer.gain),
    });
    const withVelocity = c.n('Expr_MathMultiply', {
      InputA: R(decayGain, 'Output'), InputB: R(velocityBrightness, 'Output'),
    });
    const active = c.sel(punchy.noteActive, N(0), R(withVelocity, 'Output'));
    const master = c.n('Expr_MathMultiply', {
      InputA: active, InputB: N(MASTER_GAIN),
    });
    const envelope = c.n('Dampen', {
      Target: R(master, 'Output'), SmoothTime: transientSmooth,
    });
    return {
      ...layer,
      exponent, decay, decayGain, withVelocity, active, master, envelope,
      emitter: emitter(R(punchy.audible), R(envelope, 'Value'), layer.ratio),
    };
  });
  const punchyBodyEmitter = emitter(R(punchy.audible), R(bodyEnvelope, 'Value'), 1);

  const bytes = b.finish(
    {x: 310, y: 210, z: 205},
    'A/B audition of the current SQM1 piano envelope and a proposed percussive '
      + 'Sine-only piano. Four one-press soft/hard buttons play the same A4 note; '
      + 'the candidate adds fast attack, body decay, velocity-sensitive transient '
      + 'partials and asymmetric release.',
  );
  return {
    bytes, b,
    buttons: {currentSoft, currentHard, punchySoft, punchyHard},
    current, punchy, currentEnvelope, currentLayers,
    age, bodyDecay, bodyCurve, bodySmooth, bodyEnvelope, punchyBodyEmitter,
    brightness, velocityBrightness, transientSmooth, punchyLayers,
    constants: {
      PREFIX, NOTE_SECONDS, RELEASE_SECONDS, PROBE_LIMIT, MASTER_GAIN,
      SOFT_VELOCITY, HARD_VELOCITY, EXTERNAL_ASSETS,
    },
  };
};

if (require.main === module) {
  const output = process.argv[2];
  assert(output,
    'Usage: node build-sqm1-piano-envelope-ab-probe-v1.cjs <output.brz>');
  try {
    const context = module.exports();
    require('./test-sqm1-piano-envelope-ab-probe-v1.cjs')(context);
    fs.writeFileSync(output, context.bytes);
    console.log(JSON.stringify({
      output,
      bytes: context.bytes.length,
      components: context.b.nodes.length,
      wires: context.b.edges.length,
      emitters: 6,
      buttons: 4,
    }, null, 2));
  } catch (error) {
    console.error(String(error.message).slice(0, 2500));
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/')
        && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

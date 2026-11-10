'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N, S, B} = require('./loadboard-lib.cjs');

const PREFIX = 'MWAP1';
const WAVES = Object.freeze([
  Object.freeze({label: 'Sine', asset: 'BA_Synth_Basic_Sine', color: [45, 155, 235]}),
  Object.freeze({label: 'Triangle', asset: 'BA_Synth_Basic_Triangle', color: [65, 205, 135]}),
  Object.freeze({label: 'Square', asset: 'BA_Synth_Basic_Square', color: [230, 175, 45]}),
  Object.freeze({label: 'Sawtooth', asset: 'BA_Synth_Basic_Sawtooth', color: [215, 80, 105]}),
]);

const EXTERNAL_ASSETS = Object.freeze([
  Object.freeze({type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}),
  ...WAVES.map(wave => Object.freeze({type: 'BrickAudioDescriptor', name: wave.asset})),
]);

module.exports = function buildMidiWaveformAuditionProbeV1() {
  const b = new Build('MIDI waveform audition probe V1', EXTERNAL_ASSETS);
  const c = b.circuit('main', 'wave_probe');
  const records = [];

  function saved(label, value, position) {
    const wireValue = typeof value === 'boolean' ? B(value)
      : typeof value === 'string' ? S(value) : N(value);
    const node = {
      id: `saved_${label}`,
      type: C.Var.NAME,
      pos: position,
      data: {Value: wireValue},
    };
    b.add(node, {
      asset: C.Var.BRICK,
      position,
      color: [190, 135, 45],
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:${label}`, bHiddenInteraction: true}},
      ],
    });
    records.push({label, node});
    return node;
  }

  function addButton(id, label, position, color, marker) {
    const node = {
      id,
      type: C.Button.NAME,
      pos: position,
      data: {
        PromptCustomLabel: label,
        bAllowNearbyInteraction: false,
        bHiddenInteraction: false,
      },
    };
    b.add(node, {
      asset: 'PB_DefaultMicroBrick',
      size: [7, 11, 7],
      position,
      direction: 4,
      rotation: 2,
      color,
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:button:${marker}`,
          bHiddenInteraction: true}},
      ],
    });
    return node;
  }

  function addDisplay(id, position, size, text, color = [225, 235, 245]) {
    const node = {
      id,
      type: C.TextDisplay.NAME,
      pos: position,
      data: {
        Text: typeof text === 'string' ? text : 'Waiting for runtime values',
        Font: 0,
        Face: 0,
        LineHeight: 1.15,
        WidthScale: 0.76,
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
      color: [13, 18, 28],
      components: [{type: node.type, data: node.data}],
    });
    if (Array.isArray(text)) c.bind(node, 'Text', text);
    return node;
  }

  const selected = saved('selectedIndex', 0, [48, -288, 2]);
  const auditionPresses = saved('auditionPresses', 0, [96, -288, 2]);
  const descriptorChanges = saved('descriptorChanges', 0, [144, -288, 2]);

  const ys = [-216, -72, 72, 216];
  const buttons = WAVES.map((wave, index) => addButton(
    `audition_${wave.label.toLowerCase()}`,
    `Hold DYNAMIC ${wave.label.toUpperCase()}`,
    [-96, ys[index], 4],
    wave.color,
    `dynamic:${index}:${wave.label}`,
  ));
  const directButton = addButton(
    'audition_direct_sine',
    'Hold DIRECT STATIC SINE control',
    [-96, 336, 4],
    [235, 235, 245],
    'direct:Sine',
  );

  const edges = buttons.map((button, index) => c.n('Expr_EdgeDetectorExec', {
    Input: R(button, 'bHeld'),
  }, [-48, ys[index], 2]));
  const setters = edges.map((edge, index) => {
    const setter = c.n('Exec_Var_Set', {
      VarRef: R(selected, 'VarRef'),
      Value: N(index),
    }, [0, ys[index], 2]);
    c.link(edge, setter, 'OnRisingEdge');
    return setter;
  });

  // Every dynamic audition button has two visible functional paths: its rising
  // edge selects a descriptor and its held state contributes to the one shared
  // continuous emitter's enable signal.
  const held01 = c.n('Expr_LogicalOR', {
    bInputA: R(buttons[0], 'bHeld'), bInputB: R(buttons[1], 'bHeld'),
  }, [-48, -144, 2]);
  const held23 = c.n('Expr_LogicalOR', {
    bInputA: R(buttons[2], 'bHeld'), bInputB: R(buttons[3], 'bHeld'),
  }, [-48, 144, 2]);
  const heldAny = c.n('Expr_LogicalOR', {
    bInputA: R(held01, 'bOutput'), bInputB: R(held23, 'bOutput'),
  }, [0, 0, 2]);

  const pressUnion01 = c.n('Exec_Union', {}, [48, -144, 2]);
  c.link(setters[0], pressUnion01, 'ExecOut', 'ExecA');
  c.link(setters[1], pressUnion01, 'ExecOut', 'ExecB');
  const pressUnion23 = c.n('Exec_Union', {}, [48, 144, 2]);
  c.link(setters[2], pressUnion23, 'ExecOut', 'ExecA');
  c.link(setters[3], pressUnion23, 'ExecOut', 'ExecB');
  const pressUnion = c.n('Exec_Union', {}, [96, 0, 2]);
  c.link(pressUnion01, pressUnion, 'ExecOut', 'ExecA');
  c.link(pressUnion23, pressUnion, 'ExecOut', 'ExecB');
  const countPress = c.n('Exec_Var_Increment', {
    VarRef: R(auditionPresses, 'VarRef'), Value: N(1),
  }, [144, 0, 2]);
  c.link(pressUnion, countPress);

  const references = WAVES.map((wave, index) => c.n('AudioReference', {
    Asset: index + 1,
  }, [96, ys[index], 2]));
  const isOne = c.n('Expr_CompareEqual', {
    InputA: R(selected), InputB: N(1),
  }, [144, -72, 2]);
  const isThree = c.n('Expr_CompareEqual', {
    InputA: R(selected), InputB: N(3),
  }, [144, 216, 2]);
  const isUpperPair = c.n('Expr_CompareGreater', {
    InputA: R(selected), InputB: N(1),
  }, [144, 72, 2]);

  const descriptor01 = c.n('Expr_Select', {
    InputA: R(references[0]), InputB: R(references[1]), bSelectB: R(isOne, 'bOutput'),
  }, [192, -144, 2]);
  const descriptor23 = c.n('Expr_Select', {
    InputA: R(references[2]), InputB: R(references[3]), bSelectB: R(isThree, 'bOutput'),
  }, [192, 144, 2]);
  const descriptor = c.n('Expr_Select', {
    InputA: R(descriptor01, 'Output'), InputB: R(descriptor23, 'Output'),
    bSelectB: R(isUpperPair, 'bOutput'),
  }, [240, 0, 2]);

  const speaker = c.n('AudioEmitter', {
    bEnabled: false,
    AudioDescriptor: R(descriptor, 'Output'),
    VolumeMultiplier: 0.02,
    PitchMultiplier: 1,
    InnerRadius: 100,
    MaxDistance: 800,
    bSpatialization: true,
    FocusAzimuth: 360,
    NonFocusAzimuth: 360,
    NonFocusVolumeAttenuation: 1,
  }, [288, 0, 2]);
  c.bind(speaker, 'bEnabled', R(heldAny, 'bOutput'));

  // A separately labeled direct/static Sine path distinguishes a missing/bad
  // asset from failure of the object-valued Expr_Select chain in the game.
  const directSpeaker = c.n('AudioEmitter', {
    bEnabled: false,
    AudioDescriptor: 1,
    VolumeMultiplier: 0.02,
    PitchMultiplier: 1,
    InnerRadius: 100,
    MaxDistance: 800,
    bSpatialization: true,
    FocusAzimuth: 360,
    NonFocusAzimuth: 360,
    NonFocusVolumeAttenuation: 1,
  }, [0, 336, 2]);
  c.bind(directSpeaker, 'bEnabled', R(directButton, 'bHeld'));

  // This counter is deliberately downstream of the object-valued select. It
  // distinguishes working selector output changes from mere button execution.
  const changed = c.n('Expr_ChangeDetectorExec', {
    Input: R(descriptor, 'Output'), bSeeded: false,
  }, [288, 72, 2]);
  const countChanged = c.n('Exec_Var_Increment', {
    VarRef: R(descriptorChanges, 'VarRef'), Value: N(1),
  }, [336, 72, 2]);
  c.link(changed, countChanged, 'OnChanged');

  const name01 = c.n('Expr_Select', {
    InputA: S(WAVES[0].label), InputB: S(WAVES[1].label), bSelectB: R(isOne, 'bOutput'),
  }, [192, -216, 2]);
  const name23 = c.n('Expr_Select', {
    InputA: S(WAVES[2].label), InputB: S(WAVES[3].label), bSelectB: R(isThree, 'bOutput'),
  }, [192, 216, 2]);
  const selectedName = c.n('Expr_Select', {
    InputA: R(name01, 'Output'), InputB: R(name23, 'Output'),
    bSelectB: R(isUpperPair, 'bOutput'),
  }, [240, -216, 2]);
  const statusText = c.n('Expr_String_FormatText', {
    FormatString: 'Selected: {A} (index {B})\r\nAudition presses: {C} | descriptor changes: {D}',
    InputA: R(selectedName, 'Output'),
    InputB: R(selected),
    InputC: R(auditionPresses),
    InputD: R(descriptorChanges),
  }, [288, -216, 2]);

  addDisplay('title', [0, 0, 190], [1, 145, 10],
    'MIDI CONTINUOUS-WAVE DESCRIPTOR PROBE V1', [115, 225, 255]);
  addDisplay('wave_labels', [0, 0, 155], [1, 145, 10],
    'DYNAMIC SELECT:  SINE  |  TRIANGLE  |  SQUARE  |  SAWTOOTH    +    DIRECT STATIC SINE',
    [255, 225, 125]);
  addDisplay('status', [0, 0, 120], [1, 145, 10], R(statusText, 'Output'), [170, 255, 180]);
  addDisplay('instructions', [0, 0, 80], [1, 145, 14],
    'First hold white DIRECT STATIC SINE, then blue DYNAMIC SINE: they should match.\r\n'
      + 'Then hold Triangle > Square > Sawtooth > Sine, releasing fully each time.\r\n'
      + 'All emitters use fixed pitch 1.0 and safe volume 0.02. Export the WHOLE assembly.');

  const bytes = b.finish(
    {x: 380, y: 400, z: 215},
    'Runtime probe for four BrickAudioDescriptor references selected through generic Expr_Select '
      + 'gates into one safe continuous AudioEmitter. Four visibly wired dynamic hold-to-audition '
      + 'buttons, one direct/static Sine control, and saved selection/change diagnostics.',
  );
  return {
    bytes, b, records, buttons, directButton, edges, setters, references, descriptor,
    speaker, directSpeaker, selected, auditionPresses, descriptorChanges, WAVES, EXTERNAL_ASSETS,
  };
};

if (require.main === module) {
  const output = process.argv[2];
  assert(output, 'Usage: node build-midi-waveform-audition-probe-v1.cjs <output.brz>');
  try {
    const ctx = module.exports();
    require('./test-midi-waveform-audition-probe-v1.cjs')(ctx);
    fs.writeFileSync(output, ctx.bytes);
    console.log(JSON.stringify({
      output,
      bytes: ctx.bytes.length,
      components: ctx.b.nodes.length,
      wires: ctx.b.edges.length,
      audioReferences: ctx.references.length,
    }, null, 2));
  } catch (error) {
    console.error(String(error.message).slice(0, 2500));
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

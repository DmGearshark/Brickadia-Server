'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N, B, S} = require('./loadboard-lib.cjs');

const FONT = [{type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}];
const PREFIX = 'MDFP2';
const NOTES = Object.freeze({
  a: Object.freeze({X: 3.125, Y: 7.875, Z: 81, W: 127}),
  b: Object.freeze({X: 13.25, Y: 16.625, Z: 57, W: 64}),
});
const decodeExpected = note => Object.freeze({
  start: note.X,
  end: note.Y,
  pitch: 2 ** ((note.Z - 69) / 12),
  velocity: (note.W / 127) ** 1.4,
});
const EXPECTED = Object.freeze({a: decodeExpected(NOTES.a), b: decodeExpected(NOTES.b)});

const Q = value => ({$variant: 'Quat', value: {...value}});

module.exports = function buildMidiDecodeFunctionProbe() {
  const b = new Build('MIDI DecodeNote function probe V2', FONT);
  const ordinary = b.w.addMicrochip({position: [0, -120, 4], color: [55, 125, 185]});
  const c = b.circuit(ordinary.grid, 'probe');
  const records = [];

  function saved(label, value) {
    const i = c.i++;
    // Keep the exact same allocator as Circuit.n. Both helpers advance c.i, so
    // differing column counts would assign distinct IDs to identical positions.
    const pos = [(i % 16) * 48, Math.floor(i / 16) * 48, 2];
    const wireValue = typeof value === 'boolean' ? B(value)
      : typeof value === 'string' ? S(value) : N(value);
    const node = {id: `saved_${label}`, type: C.Var.NAME, pos, grid: c.grid, data: {Value: wireValue}};
    b.add(node, {
      asset: C.Var.BRICK,
      position: pos,
      color: [210, 155, 45],
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:${label}`, bHiddenInteraction: true}},
      ],
    }, c.grid);
    records.push({label, node});
    return node;
  }

  function addDisplay(id, position, size, text, color = [225, 235, 245]) {
    const node = {
      id,
      type: C.TextDisplay.NAME,
      pos: position,
      data: {
        Text: typeof text === 'string' ? text : 'Not run',
        Font: 0,
        Face: 0,
        LineHeight: 1.15,
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
      color: [13, 18, 28],
      components: [{type: node.type, data: node.data}],
    });
    if (Array.isArray(text)) c.bind(node, 'Text', text);
    return node;
  }

  function callableShell(position) {
    const def = C.Microchip_FunctionDefinition;
    const node = {
      id: 'decode_function',
      type: def.NAME,
      pos: position,
      data: {},
    };
    b.add(node, {
      asset: def.BRICK,
      position,
      color: [145, 95, 195],
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:chip:DecodeNote`, bHiddenInteraction: true}},
      ],
    });
    const grid = b.w.addBrickGrid({
      type: 'Entity_MicrochipDynamicBrickGrid',
      location: {X: position[0], Y: position[1], Z: 40},
      data: {
        bCollapsed: true,
        PlaneCenter: {X: 0, Y: 0, Z: 0},
        PlaneExtent: {X: 14, Y: 14, Z: 2},
      },
    });
    b.w.registerMicrochipLink(node.handle, grid);
    return {node, circuit: b.circuit(grid, 'decode')};
  }

  // The exact candidate for the production player: one packed note record in,
  // four scalar values out.  Stateful voice logic and ArrayVar references stay
  // outside this callable.
  const fn = callableShell([48, -120, 4]);
  const fc = fn.circuit;
  const entry = fc.n('CallableEntry_Function');
  const input = fc.n('FunctionInput', {
    PortLabel: 'Note Quaternion',
    PortOrder: 1,
    DefaultValue: Q(NOTES.a),
  });
  const split = fc.n('Expr_SplitQuaternion', {Input: R(input)});
  const semitone = fc.n('Expr_MathSubtract', {InputA: R(split, 'Z'), InputB: N(69)});
  const octave = fc.n('Expr_MathDivide', {InputA: R(semitone, 'Output'), InputB: N(12)});
  // MathPow stores these two fields as raw f64 rather than WireValue variants.
  const pitch = fc.n('Expr_MathPow', {Input: 2, Exponent: R(octave, 'Output')});
  const velocityUnit = fc.n('Expr_MathDivide', {InputA: R(split, 'W'), InputB: N(127)});
  const velocity = fc.n('Expr_MathPow', {Input: R(velocityUnit, 'Output'), Exponent: 1.4});
  fc.n('FunctionOutput', {
    PortLabel: 'Start Seconds', PortOrder: 1, DefaultValue: N(-101), Value: R(split, 'X'),
  });
  fc.n('FunctionOutput', {
    PortLabel: 'End Seconds', PortOrder: 2, DefaultValue: N(-102), Value: R(split, 'Y'),
  });
  fc.n('FunctionOutput', {
    PortLabel: 'Pitch Ratio', PortOrder: 3, DefaultValue: N(-103), Value: R(pitch, 'Output'),
  });
  fc.n('FunctionOutput', {
    PortLabel: 'Velocity Curve', PortOrder: 4, DefaultValue: N(-104), Value: R(velocity, 'Output'),
  });
  // The intended production helper is pure.  A terminal Union gives its Body
  // execution a real no-op path without introducing shared persistent state.
  const terminal = fc.n('Exec_Union');
  fc.link(entry, terminal, 'Body', 'ExecA');

  const runs = saved('runs', 0);

  const button = {
    id: 'run_button',
    type: C.Button.NAME,
    pos: [-48, -120, 4],
    data: {PromptCustomLabel: 'Run DecodeNote probe once', bAllowNearbyInteraction: false},
  };
  b.add(button, {
    asset: 'PB_DefaultMicroBrick',
    size: [7, 9, 7],
    position: button.pos,
    direction: 4,
    rotation: 2,
    color: [35, 135, 205],
    components: [{type: button.type, data: button.data}],
  });

  const edge = c.n('Expr_EdgeDetectorExec', {Input: R(button, 'bHeld')});
  const countRun = c.n('Exec_Var_Increment', {VarRef: R(runs, 'VarRef'), Value: N(1)});
  c.link(edge, countRun, 'OnRisingEdge');

  function addCaller(name, note, wanted) {
    const completed = saved(`${name}.completed`, 0);
    const iterations = saved(`${name}.iterations`, -1);
    const aborted = saved(`${name}.aborted`, false);
    const rawImmediate = [0, 1, 2, 3]
      .map(index => saved(`${name}.immediate.output${index}`, -900 - index));
    const rawAfter1Tick = [0, 1, 2, 3]
      .map(index => saved(`${name}.after1tick.output${index}`, -950 - index));
    const expected = Object.fromEntries(Object.entries(wanted)
      .map(([field, value]) => [field, saved(`${name}.expected.${field}`, value)]));
    const call = c.n('FunctionCall', {
      Definition: R(fn.node, 'Definition'),
      Input0: Q(note),
      InputSources: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    // Both callers are fanned from this exact same execution output. This is
    // the production-relevant same-tick shared-definition test.
    c.link(countRun, call);

    let tail = call;
    let port = 'Completed';
    for (let index = 0; index < rawImmediate.length; index++) {
      const capture = c.set(rawImmediate[index], R(call, `Output${index}`));
      c.link(tail, capture, port);
      tail = capture;
      port = 'ExecOut';
    }
    const captureIterations = c.set(iterations, R(call, 'IterationsExecuted'));
    c.link(tail, captureIterations, port);
    const captureAborted = c.set(aborted, R(call, 'bAborted'));
    c.link(captureIterations, captureAborted);
    const countCompleted = c.n('Exec_Var_Increment', {VarRef: R(completed, 'VarRef'), Value: N(1)});
    c.link(captureAborted, countCompleted);
    const delay = c.wait(countCompleted, 1);
    tail = delay;
    port = 'Output';
    for (let index = 0; index < rawAfter1Tick.length; index++) {
      const capture = c.set(rawAfter1Tick[index], R(call, `Output${index}`));
      c.link(tail, capture, port);
      tail = capture;
      port = 'ExecOut';
    }
    return {name, note, wanted, call, completed, iterations, aborted,
      rawImmediate, rawAfter1Tick, expected};
  }

  const callers = {
    a: addCaller('a', NOTES.a, EXPECTED.a),
    b: addCaller('b', NOTES.b, EXPECTED.b),
  };

  // Four deliberately distinct expected values make the observed output-slot
  // permutation unambiguous after the in-game re-export.
  addDisplay('title', [0, 0, 100], [1, 78, 10],
    'MIDI DecodeNote FUNCTION PROBE', [115, 225, 255]);
  addDisplay('instructions', [0, 0, 76], [1, 78, 13],
    'Click the blue button exactly once, wait 3 seconds, then export/copy this WHOLE assembly.\r\nSend the exported .brz back. No rewiring or opening chips is needed.');
  addDisplay('values_a', [0, 0, 47], [1, 61, 15], c.fmt(
    'CALL A input (3.125, 7.875, 81, 127)\r\nExpected: Start 3.125 | End 7.875 | Pitch 2 | Velocity 1\r\nImmediate raw: O0 {A} | O1 {B} | O2 {C} | O3 {D}',
    ...callers.a.rawImmediate.map(node => R(node))));
  addDisplay('values_b', [0, 0, 16], [1, 61, 15], c.fmt(
    'CALL B input (13.25, 16.625, 57, 64)\r\nExpected: Start 13.25 | End 16.625 | Pitch 0.5 | Velocity 0.3831128812\r\nImmediate raw: O0 {A} | O1 {B} | O2 {C} | O3 {D}',
    ...callers.b.rawImmediate.map(node => R(node))));
  addDisplay('status', [0, 0, -10], [1, 61, 10], c.fmt(
    'Runs {A} | A: done {B}, iter {C}, abort {D} | B: done {E}, iter {F}, abort {G}',
    R(runs), R(callers.a.completed), R(callers.a.iterations), R(callers.a.aborted),
    R(callers.b.completed), R(callers.b.iterations), R(callers.b.aborted)), [255, 225, 125]);

  const bytes = b.finish(
    {x: 80, y: 145, z: 125},
    'One-button in-game probe for two same-tick callers sharing a pure MIDI DecodeNote '
      + 'Quaternion function. Retains immediate and +1 tick raw output slots.',
  );
  return {bytes, b, records, callers, fn, input, split, pitch, velocity, NOTES, EXPECTED};
};

if (require.main === module) {
  const output = process.argv[2];
  assert(output, 'Usage: node build-midi-decode-function-probe.cjs <output.brz>');
  try {
    const ctx = module.exports();
    require('./test-midi-decode-function-probe.cjs')(ctx);
    fs.writeFileSync(output, ctx.bytes);
    console.log(JSON.stringify({
      output,
      components: ctx.b.nodes.length,
      wires: ctx.b.edges.length,
      recordedVariables: ctx.records.length,
    }));
  } catch (error) {
    console.error(String(error.message).slice(0, 2500));
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}

'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const SAX_MODE = 8;
const RMS_CEILING = 0.65;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const RECOVERY_SMOOTH_SECONDS = 0.12;

// All non-Piano profiles use the existing fundamental, H2 and H3 Sine
// emitters.  Headroom is applied to all three layers before the shared dense
// limiter, so the values below describe timbre and solo loudness together.
const PROFILES = Object.freeze({
  // Piano uses the untouched InputB side of the final volume Selects.  Its
  // unused legacy branch must be silent so it cannot contribute phantom
  // energy to the non-Piano limiter in mixed-instrument Auto songs.
  1: Object.freeze({name: 'Piano', smooth: 0.025, h2Gain: 0.30, h2Ratio: 2,
    h3Gain: 0, h3Ratio: 0, headroom: 0}),
  2: Object.freeze({name: 'Bell', smooth: 0.012, h2Gain: 0.22, h2Ratio: 2.5,
    h3Gain: 0.08, h3Ratio: 4, headroom: 0.30}),
  3: Object.freeze({name: 'Organ', smooth: 0.035, h2Gain: 0.30, h2Ratio: 2,
    h3Gain: 0.14, h3Ratio: 3, headroom: 0.28}),
  4: Object.freeze({name: 'Strings', smooth: 0.09, h2Gain: 0.28, h2Ratio: 2,
    h3Gain: 0.14, h3Ratio: 3, headroom: 0.28}),
  5: Object.freeze({name: 'Bass', smooth: 0.025, h2Gain: 0.16, h2Ratio: 2,
    h3Gain: 0.05, h3Ratio: 3, headroom: 0.32}),
  6: Object.freeze({name: 'Flute', smooth: 0.055, h2Gain: 0.08, h2Ratio: 2,
    h3Gain: 0.02, h3Ratio: 3, headroom: 0.33}),
  7: Object.freeze({name: 'Synth', smooth: 0.015, h2Gain: 0.22, h2Ratio: 2,
    h3Gain: 0.12, h3Ratio: 3, headroom: 0.29}),
  8: Object.freeze({name: 'Saxophone', smooth: 0.03, h2Gain: 0.32, h2Ratio: 2,
    h3Gain: 0.14, h3Ratio: 3, headroom: 0.27}),
});

const PARAMETER_NAMES = Object.freeze(['smooth', 'h2Gain', 'h2Ratio', 'h3Gain', 'h3Ratio']);

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const number = value => value?.$variant === 'f64' ? value.value : value;

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

function source(edgeOrBrick, port, type) {
  if (edgeOrBrick?.a && edgeOrBrick.at && edgeOrBrick.p && port === undefined) {
    return {a: edgeOrBrick.a, at: edgeOrBrick.at, p: edgeOrBrick.p};
  }
  const brick = edgeOrBrick;
  return {a: brick.key, at: type ?? primaryType(brick), p: port};
}

function apply(scene) {
  const before = {bricks: scene.bricks.length, edges: scene.edges.length};
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (port === undefined || edge.p === port));

  const finalVolumeEdges = scene.edges.filter(edge => edge.zt === C.AudioEmitter.NAME
    && edge.q === 'VolumeMultiplier');
  assert.equal(finalVolumeEdges.length, 72, '24 lanes with three audio layers');
  const finalVolumeSelects = finalVolumeEdges.map(edge => {
    const brick = byKey.get(edge.a);
    assert(component(brick, C.Expr_Select.NAME), `emitter volume Select ${edge.a}`);
    return brick;
  });
  assert.equal(new Set(finalVolumeSelects.map(brick => brick.key)).size, 72,
    'one final volume Select per emitter');

  // Group the three final volume selectors by their shared is-Piano check.
  const groupMap = new Map();
  for (const finalSelect of finalVolumeSelects) {
    const condition = one(incoming(finalSelect, C.Expr_Select.NAME, 'bSelectB'),
      `${finalSelect.key} profile condition`);
    const check = byKey.get(condition.a);
    assert(component(check, C.Expr_CompareEqual.NAME), `${finalSelect.key} equality condition`);
    assert.equal(number(component(check, C.Expr_CompareEqual.NAME).data.InputB), 1,
      `${finalSelect.key} Piano profile condition`);
    if (!groupMap.has(check.key)) groupMap.set(check.key, {isPiano: check, finalSelects: []});
    groupMap.get(check.key).finalSelects.push(finalSelect);
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    const ap = a.isPiano.data.position;
    const bp = b.isPiano.data.position;
    return ap[1] - bp[1] || ap[0] - bp[0];
  });
  assert.equal(groups.length, 24, '24 resolved instrument profiles');
  assert(groups.every(group => group.finalSelects.length === 3),
    'three final audio layers per profile');

  for (const [voice, group] of groups.entries()) {
    group.voice = voice;
    const profileEdge = one(incoming(group.isPiano, C.Expr_CompareEqual.NAME, 'InputA'),
      `voice ${voice} resolved profile source`);
    group.resolvedProfile = byKey.get(profileEdge.a);
    assert(component(group.resolvedProfile, C.Expr_Select.NAME),
      `voice ${voice} resolved profile Select`);
    group.profileSource = source(profileEdge);
    const checks = scene.edges.filter(edge => edge.a === profileEdge.a && edge.p === profileEdge.p
      && edge.zt === C.Expr_CompareEqual.NAME && edge.q === 'InputA')
      .map(edge => byKey.get(edge.z));
    group.checks = new Map(checks.map(check => [
      number(component(check, C.Expr_CompareEqual.NAME).data.InputB), check,
    ]));
    assert.deepEqual([...group.checks.keys()].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7], `voice ${voice} profile checks 1..7`);
    assert.equal(group.checks.get(1).key, group.isPiano.key,
      `voice ${voice} shared Piano check`);
  }

  const logicGrid = groups[0].isPiano.g;
  assert(groups.every(group => group.isPiano.g === logicGrid), 'one instrument logic grid');
  const gridBricks = scene.bricks.filter(brick => brick.g === logicGrid);
  const expressionTemplate = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  const dampenTemplate = gridBricks.find(brick => component(brick, C.Dampen.NAME));
  assert(expressionTemplate && dampenTemplate, 'expression and Dampen placement templates');
  const firstY = Math.ceil((Math.max(...gridBricks.map(brick => brick.data.position[1])) + 48)
    / 48) * 48;
  let slot = 0;
  let addedBrickCount = 0;
  const sections = [];

  function alignSection(name) {
    if (slot % 16) slot += 16 - (slot % 16);
    sections.push({name, firstSlot: slot, firstBrick: addedBrickCount});
  }

  function coerce(type, port, value) {
    const field = schema.structs.get(brdb.COMPONENT_TYPE_STRUCTS.get(type))?.get(port);
    assert(field, `${type}.${port} field`);
    if (field.type !== 'WireValue'
      || (value && typeof value === 'object' && '$variant' in value)) return value;
    if (typeof value === 'number') return N(value);
    if (typeof value === 'string') return S(value);
    return value;
  }

  function add(kind, data, label, color = [50, 110, 150]) {
    const definition = C[kind];
    assert(definition, `known component ${kind}`);
    const placementTemplate = kind === 'Dampen' ? dampenTemplate : expressionTemplate;
    const componentData = {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p11:${label}`,
      g: logicGrid,
      data: {
        ...structuredClone(placementTemplate.data),
        asset: definition.BRICK,
        size: [10, 5, 2],
        position: [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2],
        color,
      },
      comps: [{type: definition.NAME, data: kind === 'Dampen'
        ? {...structuredClone(component(dampenTemplate, C.Dampen.NAME).data), ...componentData}
        : componentData}],
    };
    slot++;
    addedBrickCount++;
    assert(!byKey.has(brick.key), `unique ${brick.key}`);
    scene.bricks.push(brick);
    byKey.set(brick.key, brick);
    return brick;
  }

  function connect(input, target, port) {
    assert(input?.a && input.at && input.p, `source for ${target.key}.${port}`);
    const targetType = primaryType(target);
    assert(brdb.COMPONENT_WIRE_PORTS.get(input.at)?.outputs.includes(input.p),
      `valid output ${input.at}.${input.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(targetType)?.inputs.includes(port),
      `valid input ${targetType}.${port}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === port), `unwired ${target.key}.${port}`);
    scene.edges.push({...input, z: target.key, zt: targetType, q: port});
  }

  function replaceInput(oldEdge, input, target, port) {
    assert(scene.edges.includes(oldEdge), `existing edge for ${target.key}.${port}`);
    scene.edges = scene.edges.filter(edge => edge !== oldEdge);
    connect(input, target, port);
  }

  // The shared user selector is the Var feeding Equal checks 0..7, an Add and
  // a Subtract.  Extend both wrap directions and append the Saxophone label.
  const modeVars = scene.bricks.filter(brick => component(brick, C.Var.NAME)).filter(brick => {
    const edges = outgoing(brick, C.Var.NAME, 'Value');
    const values = edges.filter(edge => edge.zt === C.Expr_CompareEqual.NAME
      && edge.q === 'InputA').map(edge => number(component(byKey.get(edge.z),
      C.Expr_CompareEqual.NAME).data.InputB)).sort((a, b) => a - b);
    return JSON.stringify(values) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7])
      && edges.some(edge => edge.zt === C.Expr_MathAdd.NAME && edge.q === 'InputA')
      && edges.some(edge => edge.zt === C.Expr_MathSubtract.NAME && edge.q === 'InputA');
  });
  const modeVar = one(modeVars, 'shared instrument mode Var');
  const modeValueSource = source(modeVar, 'Value', C.Var.NAME);
  const modeChecks = new Map(outgoing(modeVar, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_CompareEqual.NAME && edge.q === 'InputA')
    .map(edge => {
      const check = byKey.get(edge.z);
      return [number(component(check, C.Expr_CompareEqual.NAME).data.InputB), check];
    }));

  const subtract = one(outgoing(modeVar, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_MathSubtract.NAME && edge.q === 'InputA')
    .map(edge => byKey.get(edge.z)), 'instrument previous subtract');
  const previousWrap = one(outgoing(subtract, C.Expr_MathSubtract.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'InputA')
    .map(edge => byKey.get(edge.z)), 'instrument previous wrap Select');
  assert.equal(number(component(previousWrap, C.Expr_Select.NAME).data.InputB), 7,
    'old previous wrap maximum');
  component(previousWrap, C.Expr_Select.NAME).data.InputB = N(SAX_MODE);

  const addMode = one(outgoing(modeVar, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_MathAdd.NAME && edge.q === 'InputA')
    .map(edge => byKey.get(edge.z)), 'instrument next add');
  const nextLimit = one(outgoing(addMode, C.Expr_MathAdd.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_CompareGreater.NAME && edge.q === 'InputA')
    .map(edge => byKey.get(edge.z)), 'instrument next limit');
  assert.equal(number(component(nextLimit, C.Expr_CompareGreater.NAME).data.InputB), 7,
    'old next maximum');
  component(nextLimit, C.Expr_CompareGreater.NAME).data.InputB = N(SAX_MODE);

  alignSection('selector');
  const modeCheck8 = add('Expr_CompareEqual', {InputB: SAX_MODE}, 'selector:mode8',
    [220, 150, 40]);
  connect(modeValueSource, modeCheck8, 'InputA');
  modeChecks.set(SAX_MODE, modeCheck8);

  const synthName = one(scene.bricks.filter(brick => {
    const select = component(brick, C.Expr_Select.NAME);
    return select && select.data.InputB?.$variant === 'str'
      && select.data.InputB.value === 'Synth';
  }), 'Synth display-name Select');
  const synthNameOutput = one(outgoing(synthName, C.Expr_Select.NAME, 'Output')
    .filter(edge => edge.zt === C.Expr_String_FormatText.NAME && edge.q === 'InputB'),
  'Synth name to status formatter');
  const saxName = add('Expr_Select', {InputB: 'Saxophone'}, 'selector:saxophone-name',
    [220, 150, 40]);
  connect(source(synthName, 'Output', C.Expr_Select.NAME), saxName, 'InputA');
  connect(source(modeCheck8, 'bOutput', C.Expr_CompareEqual.NAME), saxName, 'bSelectB');
  replaceInput(synthNameOutput, source(saxName, 'Output', C.Expr_Select.NAME),
    byKey.get(synthNameOutput.z), synthNameOutput.q);

  function terminalFrom(stage, allowedStageKeys) {
    let current = stage;
    const seen = new Set();
    while (true) {
      assert(!seen.has(current.key), `acyclic profile chain at ${current.key}`);
      seen.add(current.key);
      const nextEdges = outgoing(current, C.Expr_Select.NAME, 'Output')
        .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'InputA'
          && allowedStageKeys.has(edge.z));
      if (!nextEdges.length) return current;
      current = byKey.get(one(nextEdges, `${current.key} one next profile stage`).z);
    }
  }

  function parameterName(terminal) {
    const value = number(component(terminal, C.Expr_Select.NAME).data.InputB);
    if (Math.abs(value - 0.025) < 1e-12) return 'smooth';
    if (Math.abs(value - 0.24) < 1e-12) return 'h2Gain';
    if (Math.abs(value - 1.5) < 1e-12) return 'h2Ratio';
    if (Math.abs(value - 0.16) < 1e-12) return 'h3Gain';
    if (Math.abs(value - 2) < 1e-12) return 'h3Ratio';
    throw new Error(`Unknown legacy profile endpoint ${terminal.key}=${value}`);
  }

  function bottomFrom(terminal) {
    let current = terminal;
    const seen = new Set();
    while (true) {
      assert(!seen.has(current.key), `acyclic reverse profile chain at ${current.key}`);
      seen.add(current.key);
      const previous = incoming(current, C.Expr_Select.NAME, 'InputA')
        .filter(edge => edge.at === C.Expr_Select.NAME);
      if (!previous.length) return current;
      current = byKey.get(one(previous, `${current.key} one prior profile stage`).a);
    }
  }

  // Retune the six legacy modes and install Saxophone as the unmatched
  // fallback after explicit profile 7.  This avoids 120 redundant per-lane
  // Selects while retaining explicit Synth behavior.
  const retuned = [];
  for (const group of groups) {
    const legacyStageKeys = new Set();
    for (let mode = 2; mode <= 7; mode++) {
      for (const edge of outgoing(group.checks.get(mode), C.Expr_CompareEqual.NAME, 'bOutput')
        .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB')) {
        legacyStageKeys.add(edge.z);
      }
    }
    group.legacyStageKeys = legacyStageKeys;
    const terminals = new Map();
    for (const edge of outgoing(group.checks.get(7), C.Expr_CompareEqual.NAME, 'bOutput')
      .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB')) {
      const terminal = byKey.get(edge.z);
      terminals.set(parameterName(terminal), terminal);
    }
    assert.deepEqual([...terminals.keys()].sort(), [...PARAMETER_NAMES].sort(),
      `voice ${group.voice} five profile parameters`);
    group.terminals = terminals;

    for (let mode = 2; mode <= 7; mode++) {
      const stages = outgoing(group.checks.get(mode), C.Expr_CompareEqual.NAME, 'bOutput')
        .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB')
        .map(edge => byKey.get(edge.z));
      assert.equal(stages.length, 5, `voice ${group.voice} profile ${mode} stages`);
      const found = new Set();
      for (const stage of stages) {
        const parameter = parameterName(terminalFrom(stage, legacyStageKeys));
        assert(!found.has(parameter), `voice ${group.voice} unique profile ${mode} ${parameter}`);
        found.add(parameter);
        const select = component(stage, C.Expr_Select.NAME);
        retuned.push({voice: group.voice, mode, parameter,
          oldValue: number(select.data.InputB), newValue: PROFILES[mode][parameter]});
        select.data.InputB = N(PROFILES[mode][parameter]);
      }
      assert.equal(found.size, 5, `voice ${group.voice} complete profile ${mode}`);
    }

    group.saxFallbacks = new Map();
    for (const [parameter, terminal] of terminals) {
      const bottom = bottomFrom(terminal);
      const select = component(bottom, C.Expr_Select.NAME);
      group.saxFallbacks.set(parameter, bottom);
      select.data.InputA = N(PROFILES[SAX_MODE][parameter]);
    }
  }
  assert.equal(retuned.length, 24 * 6 * 5, 'all six legacy profiles retuned on 24 lanes');

  // Build one per-lane headroom profile. Mode 8 is the fallback, while
  // explicit checks preserve individual scales for modes 1..7. Mode 1 is
  // deliberately zero here: Piano uses the separate, preserved InputB path.
  alignSection('profile-headroom');
  for (const group of groups) {
    let previous = null;
    group.headroomStages = [];
    for (let mode = 1; mode <= 7; mode++) {
      const stage = add('Expr_Select', {
        ...(mode === 1 ? {InputA: PROFILES[SAX_MODE].headroom} : {}),
        InputB: PROFILES[mode].headroom,
      }, `voice${group.voice}:headroom:${mode}`, [145, 85, 200]);
      if (previous) connect(source(previous, 'Output', C.Expr_Select.NAME), stage, 'InputA');
      connect(source(group.checks.get(mode), 'bOutput', C.Expr_CompareEqual.NAME),
        stage, 'bSelectB');
      group.headroomStages.push(stage);
      previous = stage;
    }
    group.profileHeadroom = previous;
  }

  // Extend Auto with the General MIDI reed family (64..71).  The existing
  // auto result remains InputA, so all old program mappings are unchanged.
  alignSection('auto-reed');
  for (const group of groups) {
    const autoEdge = one(incoming(group.resolvedProfile, C.Expr_Select.NAME, 'InputB'),
      `voice ${group.voice} old Auto profile`);
    const ancestors = new Set();
    const pending = [autoEdge.a];
    const programSources = [];
    while (pending.length) {
      const key = pending.pop();
      if (ancestors.has(key)) continue;
      ancestors.add(key);
      for (const edge of scene.edges.filter(candidate => candidate.z === key)) {
        if (edge.at === C.Expr_SplitQuaternion.NAME && edge.p === 'Z') {
          programSources.push(source(edge));
        } else if (byKey.has(edge.a)) pending.push(edge.a);
      }
    }
    const uniqueProgramSources = [...new Map(programSources.map(item =>
      [JSON.stringify(item), item])).values()];
    const programSource = one(uniqueProgramSources, `voice ${group.voice} GM program source`);
    const atLeast64 = add('Expr_CompareGreaterOrEqual', {InputB: 64},
      `voice${group.voice}:reed-min`, [40, 150, 150]);
    const below72 = add('Expr_CompareLess', {InputB: 72},
      `voice${group.voice}:reed-max`, [40, 150, 150]);
    const reed = add('Expr_LogicalAND', {}, `voice${group.voice}:reed-range`, [40, 150, 150]);
    const autoSax = add('Expr_Select', {InputB: SAX_MODE},
      `voice${group.voice}:auto-sax`, [40, 150, 150]);
    connect(programSource, atLeast64, 'InputA');
    connect(programSource, below72, 'InputA');
    connect(source(atLeast64, 'bOutput', C.Expr_CompareGreaterOrEqual.NAME), reed, 'bInputA');
    connect(source(below72, 'bOutput', C.Expr_CompareLess.NAME), reed, 'bInputB');
    connect(source(autoEdge), autoSax, 'InputA');
    connect(source(reed, 'bOutput', C.Expr_LogicalAND.NAME), autoSax, 'bSelectB');
    replaceInput(autoEdge, source(autoSax, 'Output', C.Expr_Select.NAME),
      group.resolvedProfile, 'InputB');
    group.autoReed = {atLeast64, below72, reed, autoSax, programSource};
  }

  // Scale the three legacy layers per lane before measuring energy.  Piano is
  // the untouched InputB side of every final volume Select.
  alignSection('pre-limit-volumes');
  const originalPianoEdges = [];
  const originalPianoInputs = [];
  const originalLegacyEdges = [];
  const baseVolumes = [];
  const detectorVolumes = [];
  for (const group of groups) {
    group.baseVolumes = [];
    const ordered = [...group.finalSelects].sort((a, b) => {
      const ap = a.data.position;
      const bp = b.data.position;
      return ap[1] - bp[1] || ap[0] - bp[0];
    });
    for (const [layer, finalSelect] of ordered.entries()) {
      const legacyEdge = one(incoming(finalSelect, C.Expr_Select.NAME, 'InputA'),
        `voice ${group.voice} layer ${layer} legacy volume`);
      const pianoEdges = incoming(finalSelect, C.Expr_Select.NAME, 'InputB');
      assert(pianoEdges.length <= 1,
        `voice ${group.voice} layer ${layer} at most one Piano volume wire`);
      originalLegacyEdges.push(structuredClone(legacyEdge));
      originalPianoInputs.push({key: finalSelect.key,
        value: structuredClone(component(finalSelect, C.Expr_Select.NAME).data.InputB)});
      if (pianoEdges.length) originalPianoEdges.push(structuredClone(pianoEdges[0]));
      scene.edges = scene.edges.filter(edge => edge !== legacyEdge);
      const base = add('Expr_MathMultiply', {},
        `voice${group.voice}:layer${layer}:base-volume`, [60, 125, 190]);
      connect(source(legacyEdge), base, 'InputA');
      connect(source(group.profileHeadroom, 'Output', C.Expr_Select.NAME), base, 'InputB');
      group.baseVolumes.push(base);
      baseVolumes.push(base);
    }
  }
  assert.equal(baseVolumes.length, 72, 'all legacy layer volumes receive profile headroom');

  // Detector inputs are gated by the exact emitter-enable signals. This keeps
  // disabled H3 layers (the 19..24-lane source policy) and silent post-rolls
  // out of the energy estimate without altering their audio/output wiring.
  alignSection('audible-energy-inputs');
  for (const group of groups) {
    group.detectorVolumes = [];
    const ordered = [...group.finalSelects].sort((a, b) => {
      const ap = a.data.position;
      const bp = b.data.position;
      return ap[1] - bp[1] || ap[0] - bp[0];
    });
    for (const [layer, finalSelect] of ordered.entries()) {
      const emitterEdge = one(outgoing(finalSelect, C.Expr_Select.NAME, 'Output')
        .filter(edge => edge.zt === C.AudioEmitter.NAME && edge.q === 'VolumeMultiplier'),
      `voice ${group.voice} layer ${layer} emitter`);
      const emitter = byKey.get(emitterEdge.z);
      const enableEdge = one(incoming(emitter, C.AudioEmitter.NAME, 'bEnabled'),
        `voice ${group.voice} layer ${layer} emitter enable`);
      const audible = add('Expr_Select', {InputA: 0},
        `voice${group.voice}:layer${layer}:audible-energy`, [45, 160, 145]);
      connect(source(group.baseVolumes[layer], 'Output', C.Expr_MathMultiply.NAME),
        audible, 'InputB');
      connect(source(enableEdge), audible, 'bSelectB');
      group.detectorVolumes.push(audible);
      detectorVolumes.push(audible);
    }
  }
  assert.equal(detectorVolumes.length, 72, 'all detector inputs follow emitter enable state');

  alignSection('energy-detector');
  const magnitudeGroups = [];
  for (const group of groups) {
    const magnitude = add('Expr_VecMagnitudeSquared', {},
      `voice${group.voice}:energy`, [45, 160, 145]);
    for (let layer = 0; layer < 3; layer++) {
      connect(source(group.detectorVolumes[layer], 'Output', C.Expr_Select.NAME),
        magnitude, ['Input.X', 'Input.Y', 'Input.Z'][layer]);
    }
    magnitudeGroups.push(magnitude);
  }

  let level = [...magnitudeGroups];
  let sumDepth = 0;
  const energyAdders = [];
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      if (index + 1 === level.length) {
        next.push(level[index]);
        continue;
      }
      const sum = add('Expr_MathAdd', {}, `energy-sum${sumDepth}:${index / 2}`,
        [45, 160, 145]);
      connect(source(level[index], 'Output'), sum, 'InputA');
      connect(source(level[index + 1], 'Output'), sum, 'InputB');
      energyAdders.push(sum);
      next.push(sum);
    }
    level = next;
    sumDepth++;
  }
  const energy = one(level, 'one combined legacy energy');
  const rootEnergy = add('Expr_MathSqrt', {}, 'limiter:root-energy', [45, 160, 145]);
  connect(source(energy, 'Output'), rootEnergy, 'Input');
  const safeDenominator = add('Expr_MathMax', {InputB: RMS_NUMERATOR},
    'limiter:safe-denominator', [45, 160, 145]);
  connect(source(rootEnergy, 'Output'), safeDenominator, 'InputA');
  const adaptiveScale = add('Expr_MathDivide', {InputA: RMS_NUMERATOR},
    'limiter:adaptive-scale', [45, 160, 145]);
  connect(source(safeDenominator, 'Output'), adaptiveScale, 'InputB');
  const recovery = add('Dampen', {Target: 1, Value: 1, SmoothTime: RECOVERY_SMOOTH_SECONDS,
    Velocity: {X: 0, Y: 0, Z: 0, W: 0}},
    'limiter:recovery', [45, 160, 145]);
  connect(source(adaptiveScale, 'Output'), recovery, 'Target');
  const finalScale = add('Expr_MathMin', {}, 'limiter:final-scale', [45, 160, 145]);
  connect(source(adaptiveScale, 'Output'), finalScale, 'InputA');
  connect(source(recovery, 'Value', C.Dampen.NAME), finalScale, 'InputB');

  alignSection('limited-outputs');
  const limitedVolumes = [];
  for (const group of groups) {
    group.limitedVolumes = [];
    const ordered = [...group.finalSelects].sort((a, b) => {
      const ap = a.data.position;
      const bp = b.data.position;
      return ap[1] - bp[1] || ap[0] - bp[0];
    });
    for (const [layer, finalSelect] of ordered.entries()) {
      const limited = add('Expr_MathMultiply', {},
        `voice${group.voice}:layer${layer}:limited-volume`, [190, 75, 145]);
      connect(source(group.baseVolumes[layer], 'Output', C.Expr_MathMultiply.NAME),
        limited, 'InputA');
      connect(source(finalScale, 'Output', C.Expr_MathMin.NAME), limited, 'InputB');
      connect(source(limited, 'Output', C.Expr_MathMultiply.NAME), finalSelect, 'InputA');
      group.limitedVolumes.push(limited);
      limitedVolumes.push(limited);
    }
  }
  assert.equal(limitedVolumes.length, 72, 'all legacy layers receive adaptive limit');

  // Every original Piano input and every emitter enable path remains exact.
  for (const pianoEdge of originalPianoEdges) {
    assert(scene.edges.some(edge => JSON.stringify(edge) === JSON.stringify(pianoEdge)),
      `unchanged Piano edge ${pianoEdge.z}`);
  }
  const after = {bricks: scene.bricks.length, edges: scene.edges.length};
  for (const section of sections) {
    section.bricks = (sections[sections.indexOf(section) + 1]?.firstBrick ?? addedBrickCount)
      - section.firstBrick;
  }

  return {
    before,
    after,
    addedBricks: after.bricks - before.bricks,
    addedEdges: after.edges - before.edges,
    logicGrid,
    firstY,
    slots: slot,
    sections,
    modeVar,
    previousWrap,
    nextLimit,
    modeChecks,
    modeCheck8,
    saxName,
    groups,
    retuned,
    baseVolumes,
    detectorVolumes,
    magnitudeGroups,
    energyAdders,
    energy,
    rootEnergy,
    safeDenominator,
    adaptiveScale,
    recovery,
    finalScale,
    limitedVolumes,
    originalLegacyEdges,
    originalPianoEdges,
    originalPianoInputs,
    constants: {
      SAX_MODE,
      PROFILES,
      RMS_CEILING,
      RMS_NUMERATOR,
      RECOVERY_SMOOTH_SECONDS,
      VOICES: groups.length,
      LAYERS_PER_VOICE: 3,
      MAX_ACTIVE_SOURCES_DENSE: 48,
      MAX_ACTIVE_SOURCES_SPARSE: 54,
    },
  };
}

module.exports = {apply, constants: {
  SAX_MODE, PROFILES, RMS_CEILING, RMS_NUMERATOR, RECOVERY_SMOOTH_SECONDS,
}};

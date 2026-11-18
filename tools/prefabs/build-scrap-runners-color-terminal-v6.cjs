'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, S, B, O } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || '/workspace/attachments/bcdfc39d-2306-4e9a-8022-16b52e64aab0/Updated Frame.brz');
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz'));

const clone = value => structuredClone(value);
const I = value => ({ $variant: 'i64', value });

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  if (index < 0) return undefined;
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function build(input = INPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  const owner = ownerFrom(scene);
  let sequence = 0;

  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(savedComponent => ({ brick, savedComponent })));
  const component = (brick, type) => {
    const result = brick?.comps.find(savedComponent => savedComponent.type === type);
    assert(result, `Missing ${type} on ${brick?.key || 'unknown brick'}`);
    return result;
  };
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(
    rows().filter(item => item.savedComponent.type === type
      && predicate(item.savedComponent.data, item.brick)), label,
  );
  const brickFor = key => {
    const result = scene.bricks.find(brick => brick.key === key);
    assert(result, `Missing brick ${key}`);
    return result;
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const typeOf = brick => {
    const savedComponent = brick.comps.find(item => item.type.startsWith('BrickComponentType_'))
      || brick.comps.find(item => item.type.startsWith('Component_Internal_'))
      || brick.comps[0];
    assert(savedComponent, `Brick ${brick.key} has no component`);
    return savedComponent.type;
  };

  const zoneEntered = row(C.EntityZoneEvent_Entered.NAME, () => true, 'vehicle zone entered').brick;
  const terminalGrid = zoneEntered.g;
  const sessionHeader = row(C.Expr_String_FormatText.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.FormatString), 'session formatter').brick;
  const configGrid = sessionHeader.g;
  const completeMenu = row(C.Expr_String_FormatText.NAME,
    data => /^\{G\}\r\n\r\n\{A\}/.test(data.FormatString), 'combined menu formatter').brick;
  const priceAndBuy = row(C.Expr_String_FormatText.NAME,
    data => /^Price: 🔩Scrap \{A\}/.test(data.FormatString), 'price and BUY formatter').brick;
  const buyRow = row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === '{A}BUY{B}', 'BUY row formatter').brick;

  const mainDisplays = rows().filter(item => item.savedComponent.type === C.TextDisplay.NAME
    && item.brick.g === 1
    && item.brick.data.size[0] === 1 && item.brick.data.size[1] === 8 && item.brick.data.size[2] === 12
    && item.savedComponent.data.Anchor?.X === 0 && item.savedComponent.data.Anchor?.Y === 0);
  assert.equal(mainDisplays.length, 2, 'Expected the user-provided two-column monitor displays');
  const wiredDisplayEdge = one(outgoing(completeMenu, C.Expr_String_FormatText.NAME, 'Output')
    .filter(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'Text'), 'existing left display wire');
  const leftDisplay = brickFor(wiredDisplayEdge.z);
  const rightDisplay = one(mainDisplays.filter(item => item.brick.key !== leftDisplay.key), 'unwired right display').brick;
  assert.equal(incoming(rightDisplay, C.TextDisplay.NAME, 'Text').length, 0, 'Right display should be the unwired user placeholder');
  const displayEnable = one(incoming(leftDisplay, C.TextDisplay.NAME, 'bEnabled'), 'left display enable source');

  const failedOutput = row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Failed Buy', 'Failed Buy output').brick;
  const successfulOutput = row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Successful Buy', 'Successful Buy output').brick;
  const failedOutputDriver = one(incoming(failedOutput, C.MicrochipOutput.NAME, 'RER_Input'), 'Failed Buy driver');
  const failedUnionB = brickFor(failedOutputDriver.a);
  assert.equal(failedOutputDriver.at, C.Exec_Union.NAME, 'Failed Buy must be driven by the existing failure union');
  const failedUnionAEdge = one(incoming(failedUnionB, C.Exec_Union.NAME, 'ExecA'), 'first failure union');
  const sameBranchEdge = one(incoming(failedUnionB, C.Exec_Union.NAME, 'ExecB'), 'same-color branch');
  const failedUnionA = brickFor(failedUnionAEdge.a);
  const changedBranch = brickFor(sameBranchEdge.a);
  assert.equal(failedUnionAEdge.at, C.Exec_Union.NAME);
  assert.equal(sameBranchEdge.at, C.Exec_Branch.NAME);
  const noVehicleBranchEdge = one(incoming(failedUnionA, C.Exec_Union.NAME, 'ExecA'), 'no-vehicle branch');
  const fundsBranchEdge = one(incoming(failedUnionA, C.Exec_Union.NAME, 'ExecB'), 'funds branch');
  const purchaseVehicleBranch = brickFor(noVehicleBranchEdge.a);
  const fundsBranch = brickFor(fundsBranchEdge.a);
  assert.equal(noVehicleBranchEdge.at, C.Exec_Branch.NAME);
  assert.equal(fundsBranchEdge.at, C.Exec_Branch.NAME);
  const successfulOutputDriver = one(incoming(successfulOutput, C.MicrochipOutput.NAME, 'RER_Input'), 'Successful Buy driver');
  const chargeScrap = brickFor(successfulOutputDriver.a);
  assert.equal(successfulOutputDriver.at, C.Exec_Gamemode_IncrementLeaderboardValue.NAME);

  const purchaseMessages = rows().filter(item => item.brick.g === terminalGrid
    && item.savedComponent.type === C.Exec_PlayerState_ShowStatusMessage.NAME);
  assert.equal(purchaseMessages.length, 3, 'Expected exactly the three purchase pop-up messages');
  const purchaseMessageFormatters = new Set();
  for (const message of purchaseMessages) for (const edge of incoming(
    message.brick, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Message')) {
    if (edge.at === C.Expr_String_FormatText.NAME) purchaseMessageFormatters.add(brickFor(edge.a));
  }
  assert.equal(purchaseMessageFormatters.size, 2, 'Expected success and affordability pop-up formatters');

  const baseGate = clone(scene.bricks.find(brick => brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const baseLabel = row(C.TextDisplay.NAME,
    (_data, brick) => brick.g === terminalGrid && /^5\. SESSION/.test(component(brick, C.TextDisplay.NAME).data.Text),
    'terminal organization label').brick;

  function gate(kind, position, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate ${kind}`);
    const brickData = clone(baseGate);
    brickData.asset = definition.BRICK;
    brickData.position = position;
    brickData.direction = options.direction ?? 4;
    brickData.rotation = options.rotation ?? 0;
    brickData.size = [0, 0, 0];
    brickData.color = options.color || [67, 122, 163];
    brickData.material_intensity = options.materialIntensity ?? 5;
    const brick = {
      key: `v6:${terminalGrid}:${options.name || kind}:${sequence++}`,
      g: terminalGrid,
      data: brickData,
      comps: [{ type: definition.NAME, data: clone(data) }],
    };
    scene.bricks.push(brick);
    return brick;
  }

  function label(position, text, options = {}) {
    const brick = clone(baseLabel);
    brick.key = `v6:${terminalGrid}:${options.name || 'label'}:${sequence++}`;
    brick.g = terminalGrid;
    brick.data.position = position;
    brick.data.size = options.size || [300, 10, 2];
    brick.data.color = options.brickColor || [35, 35, 35];
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = text;
    display.data.LineHeight = options.lineHeight ?? 1.35;
    display.data.WidthScale = options.widthScale ?? 1;
    display.data.Color = options.textColor || { B: 255, G: 220, R: 110, A: 255 };
    display.data.Anchor = { X: 0, Y: 0.5 };
    display.data.Offset = { X: 1, Y: 0, Z: 0 };
    scene.bricks.push(brick);
    return brick;
  }

  function addEdge(source, sourceType, sourcePort, target, targetType, targetPort) {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType && edge.q === targetPort),
      `Duplicate driver for ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  }

  function removeIncoming(target, targetType, targetPort) {
    const removed = incoming(target, targetType, targetPort);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key && edge.zt === targetType && edge.q === targetPort));
    return removed;
  }

  function removeBrick(brick) {
    scene.edges = scene.edges.filter(edge => edge.a !== brick.key && edge.z !== brick.key);
    scene.links = scene.links.filter(link => link.key !== brick.key);
    scene.bricks = scene.bricks.filter(candidate => candidate !== brick);
  }

  function makeSetter(variable, value, position, name, source, options = {}) {
    const setter = gate('Exec_Var_Set', position, { bChangeType: false, Value: clone(value) }, {
      name, color: options.color,
    });
    addEdge(variable, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    if (source) addEdge(source.brick, source.type, source.port, setter, C.Exec_Var_Set.NAME, 'Value');
    return setter;
  }

  // Keep the user's collapsed chip layout, but add a clearly separated feedback
  // section below the v5 session logic.
  scene.entityOverrides = new Map();
  const terminalEntity = [...scene.r.entities()].find(entity => entity.persistentIndex === terminalGrid);
  assert(terminalEntity, 'Missing terminal microchip entity');
  const terminalOverride = clone(terminalEntity);
  terminalOverride.data = clone(terminalEntity.data);
  terminalOverride.data.PlaneCenter = { X: 360, Y: 700, Z: 2 };
  terminalOverride.data.PlaneExtent = { X: 420, Y: 820, Z: 8 };
  scene.entityOverrides.set(terminalGrid, terminalOverride);

  label([300, 1060, 2], '6. SCREEN RESPONSE + FAILED-BUY FLASH\r\nPersistent action result and three finite 0.2-second affordability blinks.', {
    name: 'screen_response_label', size: [300, 10, 2],
  });

  // Remove only purchase pop-ups. The core invalid-hex message remains because
  // it belongs to text-entry validation, not the buy transaction.
  for (const message of purchaseMessages) removeBrick(message.brick);
  for (const formatter of purchaseMessageFormatters) removeBrick(formatter);

  // Split the live display into the user's two physical columns.
  removeIncoming(leftDisplay, C.TextDisplay.NAME, 'Text');
  removeIncoming(completeMenu, C.Expr_String_FormatText.NAME, 'InputG');
  addEdge(sessionHeader, C.Expr_String_FormatText.NAME, 'Output', leftDisplay, C.TextDisplay.NAME, 'Text');
  addEdge(completeMenu, C.Expr_String_FormatText.NAME, 'Output', rightDisplay, C.TextDisplay.NAME, 'Text');
  addEdge(brickFor(displayEnable.a), displayEnable.at, displayEnable.p,
    rightDisplay, C.TextDisplay.NAME, 'bEnabled');

  const headerData = component(sessionHeader, C.Expr_String_FormatText.NAME).data;
  headerData.FormatString = 'PROCESS: COLOR_CUSTOMIZER\r\nSTATUS: RUNNING\r\n\r\nUSER: {B}\r\nID: {A}\r\nSCRAP: 🔩{C}\r\n\r\nVEHICLE: {D}\r\nCURRENT COLOR: {E}\r\nPREVIEW COLOR: #{F}\r\n\r\n{G}';
  component(completeMenu, C.Expr_String_FormatText.NAME).data.FormatString = 'COLOR SETTINGS\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n{E}\r\n\r\n{F}\r\n\r\nW/S SELECT\r\nA/D TAP: 1 | HOLD: REPEAT\r\nC ENTER HEX | SPACE ACTIVATE';
  component(priceAndBuy, C.Expr_String_FormatText.NAME).data.FormatString = 'PRICE: 🔩{A}\r\n{B}';

  // Existing fixed-width row markers now open/close an orange rich-text span.
  // The arrows stay green and the selected setting/value becomes orange.
  const settingRows = rows().filter(item => item.savedComponent.type === C.Expr_String_FormatText.NAME
    && /^\{A\}(HUE|SATURATION|BRIGHTNESS|MATERIAL|INTENSITY)/.test(item.savedComponent.data.FormatString))
    .map(item => item.brick);
  assert.equal(settingRows.length, 5, 'Expected five adjustable setting rows');
  for (const formatter of [...settingRows, buyRow]) {
    const suffixPort = formatter === buyRow ? 'InputB' : 'InputC';
    const prefixEdge = one(incoming(formatter, C.Expr_String_FormatText.NAME, 'InputA'), 'row prefix selector');
    const suffixEdge = one(incoming(formatter, C.Expr_String_FormatText.NAME, suffixPort), 'row suffix selector');
    assert.equal(prefixEdge.at, C.Expr_Select.NAME);
    assert.equal(suffixEdge.at, C.Expr_Select.NAME);
    component(brickFor(prefixEdge.a), C.Expr_Select.NAME).data.InputB = S('> <color="ff8700">');
    component(brickFor(suffixEdge.a), C.Expr_Select.NAME).data.InputB = S('</> <');
  }

  // Persistent response state. It resets for every seat transition, success is
  // green, and each actionable failure is red until the next action.
  const responseVar = gate('Var', [0, 1104, 2], { Value: S('SYSTEM RESPONSE: READY') }, {
    name: 'system_response', color: [75, 210, 125],
  });
  const readyResponse = makeSetter(responseVar, S('SYSTEM RESPONSE: READY'), [48, 1104, 2],
    'system_response_ready', null, { color: [75, 210, 125] });
  const successResponse = makeSetter(responseVar,
    S('<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED</>'), [96, 1104, 2],
    'system_response_success', null, { color: [75, 210, 125] });
  const noVehicleResponse = makeSetter(responseVar,
    S('<color="ff3030">SYSTEM RESPONSE: NO VEHICLE</>'), [144, 1104, 2],
    'system_response_no_vehicle', null, { color: [255, 95, 95] });
  const cannotAffordResponse = makeSetter(responseVar,
    S('<color="ff3030">SYSTEM RESPONSE: CANNOT AFFORD</>'), [192, 1104, 2],
    'system_response_cannot_afford', null, { color: [255, 95, 95] });
  const sameColorResponse = makeSetter(responseVar,
    S('<color="ff3030">SYSTEM RESPONSE: COLOR ALREADY APPLIED</>'), [240, 1104, 2],
    'system_response_same_color', null, { color: [255, 95, 95] });
  addEdge(responseVar, C.Var.NAME, 'Value', sessionHeader, C.Expr_String_FormatText.NAME, 'InputG');

  const seat = row(C.Seat.NAME, () => true, 'terminal seat').brick;
  const seatEdge = row(C.Expr_EdgeDetectorExec.NAME,
    (_data, brick) => brick.g === terminalGrid
      && incoming(brick, C.Expr_EdgeDetectorExec.NAME, 'Input')
        .some(edge => edge.a === seat.key && edge.p === 'bIsOccupied'), 'seat occupancy edge').brick;
  const seatActivityEdge = one(outgoing(seatEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge')
    .filter(edge => edge.zt === C.Exec_Union.NAME), 'seat activity union');
  const seatActivity = brickFor(seatActivityEdge.z);
  assert(outgoing(seatEdge, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge')
    .some(edge => edge.z === seatActivity.key), 'Seat activity union must cover exit');
  addEdge(seatActivity, C.Exec_Union.NAME, 'ExecOut', readyResponse, C.Exec_Var_Set.NAME, 'Exec');

  // Restore BUY to a selected-row guard, then validate vehicle support inside
  // the transaction so a selected BUY can report NO VEHICLE instead of doing
  // nothing. Unsupported old vehicles intentionally use the same response.
  const splitter = row(C.InputSplitter.NAME, () => true, 'seat input splitter').brick;
  const buyGuardEdge = one(outgoing(splitter, C.InputSplitter.NAME, 'InputUp'), 'Space BUY guard');
  const buyGuard = brickFor(buyGuardEdge.z);
  assert.equal(buyGuardEdge.zt, C.Exec_Branch.NAME);
  const readyBEdge = one(incoming(buyGuard, C.Exec_Branch.NAME, 'bCond'), 'v5 combined BUY readiness');
  const readyB = brickFor(readyBEdge.a);
  assert.equal(readyBEdge.at, C.Expr_LogicalAND.NAME);
  const readyAEdge = one(incoming(readyB, C.Expr_LogicalAND.NAME, 'bInputA'), 'v5 selected/session readiness');
  const vehicleSupportedEdge = one(incoming(readyB, C.Expr_LogicalAND.NAME, 'bInputB'), 'retained vehicle support');
  const readyA = brickFor(readyAEdge.a);
  const vehicleSupported = brickFor(vehicleSupportedEdge.a);
  assert.equal(readyAEdge.at, C.Expr_LogicalAND.NAME);
  assert.equal(vehicleSupportedEdge.at, C.Var.NAME);
  const selectedEdge = one(incoming(readyA, C.Expr_LogicalAND.NAME, 'bInputA')
    .filter(edge => edge.at === C.Expr_CompareEqual.NAME), 'BUY selected leaf');
  const buySelected = brickFor(selectedEdge.a);
  removeBrick(readyB);
  removeBrick(readyA);
  addEdge(buySelected, C.Expr_CompareEqual.NAME, 'bOutput', buyGuard, C.Exec_Branch.NAME, 'bCond');

  const operatorEdge = one(outgoing(purchaseVehicleBranch, C.Exec_Branch.NAME, 'ExecOutA'), 'purchase operator path');
  const getOperator = brickFor(operatorEdge.z);
  removeIncoming(getOperator, operatorEdge.zt, operatorEdge.q);
  const supportedBranch = gate('Exec_Branch', [288, 1104, 2], { bCond: false }, {
    name: 'purchase_supported_vehicle_guard', color: [70, 190, 255],
  });
  const noVehicleUnion = gate('Exec_Union', [336, 1104, 2], {}, {
    name: 'purchase_no_vehicle_union', color: [255, 95, 95],
  });
  addEdge(purchaseVehicleBranch, C.Exec_Branch.NAME, 'ExecOutA', supportedBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(vehicleSupported, C.Var.NAME, 'Value', supportedBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(supportedBranch, C.Exec_Branch.NAME, 'ExecOutA', getOperator, operatorEdge.zt, operatorEdge.q);
  addEdge(purchaseVehicleBranch, C.Exec_Branch.NAME, 'ExecOutB', noVehicleUnion, C.Exec_Union.NAME, 'ExecA');
  addEdge(supportedBranch, C.Exec_Branch.NAME, 'ExecOutB', noVehicleUnion, C.Exec_Union.NAME, 'ExecB');

  removeIncoming(failedUnionA, C.Exec_Union.NAME, 'ExecA');
  removeIncoming(failedUnionA, C.Exec_Union.NAME, 'ExecB');
  removeIncoming(failedUnionB, C.Exec_Union.NAME, 'ExecB');
  removeIncoming(successfulOutput, C.MicrochipOutput.NAME, 'RER_Input');
  addEdge(noVehicleUnion, C.Exec_Union.NAME, 'ExecOut', noVehicleResponse, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(noVehicleResponse, C.Exec_Var_Set.NAME, 'ExecOut', failedUnionA, C.Exec_Union.NAME, 'ExecA');
  addEdge(fundsBranch, C.Exec_Branch.NAME, 'ExecOutB', cannotAffordResponse, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(cannotAffordResponse, C.Exec_Var_Set.NAME, 'ExecOut', failedUnionA, C.Exec_Union.NAME, 'ExecB');
  addEdge(changedBranch, C.Exec_Branch.NAME, 'ExecOutB', sameColorResponse, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(sameColorResponse, C.Exec_Var_Set.NAME, 'ExecOut', failedUnionB, C.Exec_Union.NAME, 'ExecB');
  addEdge(chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut', successResponse, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(successResponse, C.Exec_Var_Set.NAME, 'ExecOut', successfulOutput, C.MicrochipOutput.NAME, 'RER_Input');

  // Three finite red blinks for insufficient Scrap: 0.2 seconds on/off. A busy
  // guard prevents repeated presses from interleaving two animation chains.
  const flashBusy = gate('Var', [0, 1152, 2], { Value: B(false) }, {
    name: 'affordability_flash_busy', color: [255, 95, 95],
  });
  const flashVisible = gate('Var', [48, 1152, 2], { Value: B(false) }, {
    name: 'affordability_flash_visible', color: [255, 95, 95],
  });
  const notFlashBusy = gate('Expr_LogicalNOT', [96, 1152, 2], { bInput: false }, {
    name: 'affordability_flash_idle', color: [255, 95, 95],
  });
  const flashGuard = gate('Exec_Branch', [144, 1152, 2], { bCond: false }, {
    name: 'affordability_flash_guard', color: [255, 95, 95],
  });
  const setFlashBusy = makeSetter(flashBusy, B(true), [192, 1152, 2],
    'affordability_flash_start', null, { color: [255, 95, 95] });
  addEdge(flashBusy, C.Var.NAME, 'Value', notFlashBusy, C.Expr_LogicalNOT.NAME, 'bInput');
  addEdge(notFlashBusy, C.Expr_LogicalNOT.NAME, 'bOutput', flashGuard, C.Exec_Branch.NAME, 'bCond');
  addEdge(cannotAffordResponse, C.Exec_Var_Set.NAME, 'ExecOut', flashGuard, C.Exec_Branch.NAME, 'Exec');
  addEdge(flashGuard, C.Exec_Branch.NAME, 'ExecOutA', setFlashBusy, C.Exec_Var_Set.NAME, 'Exec');

  let flashTail = setFlashBusy;
  let flashTailType = C.Exec_Var_Set.NAME;
  let flashTailPort = 'ExecOut';
  let flashX = 0;
  for (let index = 0; index < 3; index++) {
    const on = makeSetter(flashVisible, B(true), [flashX, 1200, 2],
      `affordability_flash_${index + 1}_on`, null, { color: [255, 95, 95] });
    flashX += 48;
    const hold = gate('BufferSeconds', [flashX, 1200, 2], {
      SecondsToWait: 0.2, ZeroSecondsToWait: 0,
    }, { name: `affordability_flash_${index + 1}_hold`, color: [255, 95, 95] });
    flashX += 48;
    const off = makeSetter(flashVisible, B(false), [flashX, 1200, 2],
      `affordability_flash_${index + 1}_off`, null, { color: [255, 95, 95] });
    flashX += 48;
    addEdge(flashTail, flashTailType, flashTailPort, on, C.Exec_Var_Set.NAME, 'Exec');
    addEdge(on, C.Exec_Var_Set.NAME, 'ExecOut', hold, C.BufferSeconds.NAME, 'Input');
    addEdge(hold, C.BufferSeconds.NAME, 'Output', off, C.Exec_Var_Set.NAME, 'Exec');
    flashTail = off;
    flashTailType = C.Exec_Var_Set.NAME;
    flashTailPort = 'ExecOut';
    if (index < 2) {
      const gap = gate('BufferSeconds', [flashX, 1200, 2], {
        SecondsToWait: 0.2, ZeroSecondsToWait: 0,
      }, { name: `affordability_flash_${index + 1}_gap`, color: [255, 95, 95] });
      flashX += 48;
      addEdge(flashTail, flashTailType, flashTailPort, gap, C.BufferSeconds.NAME, 'Input');
      flashTail = gap;
      flashTailType = C.BufferSeconds.NAME;
      flashTailPort = 'Output';
    }
  }
  const clearFlashBusy = makeSetter(flashBusy, B(false), [flashX, 1200, 2],
    'affordability_flash_complete', null, { color: [255, 95, 95] });
  addEdge(flashTail, flashTailType, flashTailPort, clearFlashBusy, C.Exec_Var_Set.NAME, 'Exec');

  const priceSource = one(incoming(priceAndBuy, C.Expr_String_FormatText.NAME, 'InputA'), 'purchase cost source');
  const redPriceAndBuy = gate('Expr_String_FormatText', [0, 1248, 2], {
    FormatString: '<color="ff3030">PRICE: 🔩{A}</>\r\n> <color="ff3030">BUY</> <',
    InputA: I(100), InputB: N(0), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'affordability_flash_block', color: [255, 95, 95] });
  const flashedPriceSelect = gate('Expr_Select', [144, 1248, 2], {
    bSelectB: false, InputA: S(''), InputB: S(''),
  }, { name: 'affordability_flash_select', color: [255, 95, 95] });
  addEdge(brickFor(priceSource.a), priceSource.at, priceSource.p,
    redPriceAndBuy, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(priceAndBuy, C.Expr_String_FormatText.NAME, 'Output', flashedPriceSelect, C.Expr_Select.NAME, 'InputA');
  addEdge(redPriceAndBuy, C.Expr_String_FormatText.NAME, 'Output', flashedPriceSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(flashVisible, C.Var.NAME, 'Value', flashedPriceSelect, C.Expr_Select.NAME, 'bSelectB');
  removeIncoming(completeMenu, C.Expr_String_FormatText.NAME, 'InputF');
  addEdge(flashedPriceSelect, C.Expr_Select.NAME, 'Output', completeMenu, C.Expr_String_FormatText.NAME, 'InputF');

  const name = 'Scrap Runners - Color Terminal v6';
  const description = 'Two-column color terminal using the user-updated frame. Adds orange selection, screen-only persistent system responses, a finite triple red affordability flash, and removes purchase pop-up messages while preserving configured sounds and vehicle/session behavior.';
  const generated = write(scene, { name, description, owner }).bytes;
  const bytes = repack(generated, inputBytes, { name, description });
  return {
    bytes,
    scene,
    input,
    output: OUTPUT,
    grids: { terminal: terminalGrid, config: configGrid },
    added: {
      responseVar, readyResponse, successResponse, noVehicleResponse,
      cannotAffordResponse, sameColorResponse, supportedBranch, noVehicleUnion,
      flashBusy, flashVisible, flashGuard, redPriceAndBuy, flashedPriceSelect,
      leftDisplay, rightDisplay, sessionHeader, completeMenu, priceAndBuy,
    },
  };
}

if (require.main === module) {
  const context = build(INPUT);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, context.bytes);
  require('./test-scrap-runners-color-terminal-v6.cjs')({ input: INPUT, output: OUTPUT });
  console.log(JSON.stringify({
    input: INPUT,
    output: OUTPUT,
    bytes: context.bytes.length,
    bricks: context.scene.bricks.length,
    wires: context.scene.edges.length,
  }, null, 2));
}

module.exports = build;

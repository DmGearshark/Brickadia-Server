'use strict';

const assert = require('assert/strict');

// Runtime records are deliberately fixed-width. Brickadia's string-split gates
// can therefore read the same fields for every category/part without a second
// set of hand-maintained lookup arrays.
const VEHICLES = [
  ['Truck1', 'FlatbedTruck1|HEAVY TRUCK|Truck1Owned|6|1'],
];

// Saved Truck1Engine scores index this array directly on the vehicle.
const ENGINE_PROFILES = [
  { X: 250, Y: 1, Z: 1, W: 1 },
  { X: 300, Y: 1.5, Z: 1, W: 0.8 },
  { X: 350, Y: 1.5, Z: 1.5, W: 0.7 },
  { X: 400, Y: 2, Z: 1, W: 0.6 },
  { X: 225, Y: 5, Z: 1, W: 1.2 },
];

// Vehicle.Order = CategoryID|DisplayName|LeaderboardKey|PartCount|Stat1..Stat4
// Stat = Label^Unit^Decimals^Direction. Direction: H higher, L lower, N neutral.
const CATEGORIES = [
  ['Truck1.0', 'Engine|ENGINE|Truck1Engine|5|TOP SPEED^^0^H|TORQUE^^1^H|ACCELERATION^^1^L|FUEL USE^/S^1^L'],
  ['Truck1.1', 'FuelTank|FUEL TANK|Truck1Fueltank|3|CAPACITY^^0^H|-|-|-'],
  ['Truck1.2', 'Suspension|SUSPENSION|Truck1Suspension|5|STRENGTH^^0^N|-|-|-'],
  ['Truck1.3', 'WheelSpacing|WHEEL SPACING|Truck1Wheelspacing|5|SPACING^^1^N|-|-|-'],
  ['Truck1.4', 'SteerAngle|STEER ANGLE|Truck1Steerangle|7|ANGLE^°^0^N|-|-|-'],
  ['Truck1.5', 'SteerTurnSpeed|STEER TURN SPEED|Truck1Steerturnspeed|3|TURN SPEED^^2^N|-|-|-'],
];

// Vehicle.Category.Position = Name|SavedValue|Price|Description|Stat1..Stat4
const PARTS = [
  ['Truck1.Engine.0', 'Stock Shitter|0|0|The original factory engine.|250|1|1|1'],
  ['Truck1.Engine.1', 'RedNeck Engine|1|2500|A homemade alternative assembled for working trucks.|300|1.5|1|0.8'],
  ['Truck1.Engine.2', 'Backyard Engine|2|5000|A stronger backyard-built engine profile.|350|1.5|1.5|0.7'],
  ['Truck1.Engine.3', 'The Slow Turtle Engine|4|10000|A low-speed, high-torque engine for heavy pulling.|225|5|1|1.2'],
  ['Truck1.Engine.4', 'A Real Engine|3|15000|A proper balanced engine for regular road use.|400|2|1|0.6'],

  ['Truck1.FuelTank.0', 'Starter 20000|0|0|The original twenty-thousand-unit fuel tank.|20000|0|0|0'],
  ['Truck1.FuelTank.1', 'Mid 25000|1|5000|A medium tank for longer routes between stops.|25000|0|0|0'],
  ['Truck1.FuelTank.2', 'Large 30000|2|10000|The largest available tank for long-distance work.|30000|0|0|0'],

  ['Truck1.Suspension.0', '500|0|1000|The softest available suspension profile.|500|0|0|0'],
  ['Truck1.Suspension.1', '1000|1|2000|A light suspension upgrade.|1000|0|0|0'],
  ['Truck1.Suspension.2', '1500|2|2000|A medium suspension profile.|1500|0|0|0'],
  ['Truck1.Suspension.3', '2000|3|2000|A firm suspension profile.|2000|0|0|0'],
  ['Truck1.Suspension.4', '2500|4|2000|The firmest available suspension profile.|2500|0|0|0'],

  ['Truck1.WheelSpacing.0', '0|0|0|Factory wheel spacing.|0|0|0|0'],
  ['Truck1.WheelSpacing.1', '2.5|1|500|A small increase in wheel spacing.|2.5|0|0|0'],
  ['Truck1.WheelSpacing.2', '5|2|1500|A moderate increase in wheel spacing.|5|0|0|0'],
  ['Truck1.WheelSpacing.3', '7.5|3|3000|A wide wheel-spacing profile.|7.5|0|0|0'],
  ['Truck1.WheelSpacing.4', '10|4|10000|The widest available wheel-spacing profile.|10|0|0|0'],

  ['Truck1.SteerAngle.0', '30°|0|0|Thirty degrees of steering angle.|30|0|0|0'],
  ['Truck1.SteerAngle.1', '35°|1|0|Thirty-five degrees of steering angle.|35|0|0|0'],
  ['Truck1.SteerAngle.2', '40°|2|0|Forty degrees of steering angle.|40|0|0|0'],
  ['Truck1.SteerAngle.3', '45°|3|0|Forty-five degrees of steering angle.|45|0|0|0'],
  ['Truck1.SteerAngle.4', '50°|4|0|Fifty degrees of steering angle.|50|0|0|0'],
  ['Truck1.SteerAngle.5', '55°|5|0|Fifty-five degrees of steering angle.|55|0|0|0'],
  ['Truck1.SteerAngle.6', '60°|6|0|Sixty degrees of steering angle.|60|0|0|0'],

  ['Truck1.SteerTurnSpeed.0', '0.05|0|0|A slow and precise steering response.|0.05|0|0|0'],
  ['Truck1.SteerTurnSpeed.1', '0.1|1|0|A medium steering response.|0.1|0|0|0'],
  ['Truck1.SteerTurnSpeed.2', '0.2|2|0|The fastest available steering response.|0.2|0|0|0'],
];

function fields(value, count, label) {
  const result = value.split('|');
  assert.equal(result.length, count, `${label}: expected ${count} fields`);
  return result;
}

function validate({ vehicles = VEHICLES, categories = CATEGORIES, parts = PARTS } = {}) {
  const vehicleMap = new Map(vehicles);
  const categoryMap = new Map(categories);
  const partMap = new Map(parts);
  assert.equal(vehicleMap.size, vehicles.length, 'duplicate vehicle IDs');
  assert.equal(categoryMap.size, categories.length, 'duplicate category rows');
  assert.equal(partMap.size, parts.length, 'duplicate part rows');
  const referencedCategories = new Set();
  const referencedParts = new Set();

  for (const [vehicleId, record] of vehicles) {
    assert(vehicleId && !vehicleId.includes('.'), `legal vehicle ID: ${vehicleId}`);
    const [display, vehicleClass, ownershipKey, countText, revisionText] =
      fields(record, 5, vehicleId);
    assert(display && vehicleClass && ownershipKey, `${vehicleId}: complete metadata`);
    const count = Number(countText);
    const revision = Number(revisionText);
    assert(Number.isInteger(count) && count > 0, `${vehicleId}: category count`);
    assert(Number.isInteger(revision) && revision > 0, `${vehicleId}: profile revision`);

    const categoryIds = new Set();
    const leaderboardKeys = new Set();
    for (let order = 0; order < count; order++) {
      const key = `${vehicleId}.${order}`;
      assert(categoryMap.has(key), `missing category ${key}`);
      referencedCategories.add(key);
      const [categoryId, categoryName, leaderboardKey, partCountText, ...specs] =
        fields(categoryMap.get(key), 8, key);
      assert(categoryId && !categoryId.includes('.'), `${key}: legal category ID`);
      assert(categoryName, `${key}: display name`);
      assert(leaderboardKey && leaderboardKey !== 'Scrap', `${key}: leaderboard key`);
      assert(!categoryIds.has(categoryId), `${vehicleId}: duplicate category ${categoryId}`);
      assert(!leaderboardKeys.has(leaderboardKey),
        `${vehicleId}: duplicate leaderboard key ${leaderboardKey}`);
      categoryIds.add(categoryId);
      leaderboardKeys.add(leaderboardKey);
      const partCount = Number(partCountText);
      assert(Number.isInteger(partCount) && partCount > 0, `${key}: part count`);
      assert.equal(specs.length, 4, `${key}: four comparison specs`);
      for (const [index, spec] of specs.entries()) {
        if (spec === '-') continue;
        const [label, unit, decimalsText, direction] = spec.split('^');
        assert(label, `${key}: stat ${index} label`);
        assert(unit !== undefined, `${key}: stat ${index} unit`);
        const decimals = Number(decimalsText);
        assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 3,
          `${key}: stat ${index} decimals`);
        assert(['H', 'L', 'N'].includes(direction), `${key}: stat ${index} direction`);
      }

      const saved = new Set();
      let previousPrice = -Infinity;
      for (let position = 0; position < partCount; position++) {
        const partKey = `${vehicleId}.${categoryId}.${position}`;
        assert(partMap.has(partKey), `missing part ${partKey}`);
        referencedParts.add(partKey);
        const [name, savedText, priceText, description, ...stats] =
          fields(partMap.get(partKey), 8, partKey);
        assert(name && description, `${partKey}: name and description`);
        assert(description.length <= 100, `${partKey}: description length`);
        const savedValue = Number(savedText);
        const price = Number(priceText);
        assert(Number.isInteger(savedValue) && savedValue >= 0,
          `${partKey}: nonnegative integer saved value`);
        assert(!saved.has(savedValue), `${partKey}: duplicate saved value`);
        saved.add(savedValue);
        assert(Number.isInteger(price) && price >= 0, `${partKey}: nonnegative price`);
        assert(price >= previousPrice, `${partKey}: prices increase from left to right`);
        previousPrice = price;
        assert.equal(stats.length, 4, `${partKey}: four stat values`);
        stats.forEach((stat, statIndex) => assert(Number.isFinite(Number(stat)),
          `${partKey}: finite stat ${statIndex}`));
      }
    }
  }
  assert.equal(referencedCategories.size, categoryMap.size,
    'orphan or unreferenced category rows');
  assert.equal(referencedParts.size, partMap.size,
    'orphan or unreferenced part rows');
  return { vehicles: vehicleMap, categories: categoryMap, parts: partMap };
}

function quote({ selectedPrice, installedPrice, scrap, tradeInRate = 0.75,
  selectedSaved, installedSaved }) {
  if (selectedSaved === installedSaved) return { status: 'installed', net: 0 };
  const tradeIn = Math.floor(installedPrice * tradeInRate);
  const net = selectedPrice - tradeIn;
  if (net > 0 && scrap < net) return {
    status: 'insufficient', tradeIn, net, missing: net - scrap,
  };
  return { status: net > 0 ? 'pay' : net < 0 ? 'receive' : 'free', tradeIn, net };
}

validate();

module.exports = { VEHICLES, CATEGORIES, PARTS, ENGINE_PROFILES, validate, quote };

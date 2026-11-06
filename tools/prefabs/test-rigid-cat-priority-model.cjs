'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const A = Object.freeze({
  ROAM: 0,
  HUNGRY: 1,
  EATING: 2,
  SLEEPING: 3,
  SLEEPY: 4,
  CHASING: 5,
  STALKING: 6,
  PETTED: 7,
  FOLLOWING: 8,
  RELAXING: 9,
});

const cap = value => Math.max(0, Math.min(100, value));

class SequenceRng {
  constructor(values = []) {
    this.values = [...values];
  }

  integer(min, max) {
    assert(this.values.length, `Missing deterministic RNG value for [${min}, ${max}]`);
    const value = this.values.shift();
    assert(Number.isInteger(value) && value >= min && value <= max,
      `RNG value ${value} is outside [${min}, ${max}]`);
    return value;
  }
}

// A deliberately small executable model of the production WireScript. It
// models priority, need/timer, and target-presence semantics; spatial steering
// and serialized gate timing are covered by the integration test.
class CatModel {
  constructor(rng = new SequenceRng()) {
    this.rng = rng;
    this.seconds = 0;
    this.action = A.ROAM;
    this.needs = {hunger: 0, sleep: 0, chase: 0, stalk: 0, follow: 0, relax: 0};
    this.playerNearby = false;
    this.toyVisible = false;
    this.targetValid = false;
    this.targetDistance = Infinity;
    this.mouthFood = null;
    this.eatingTarget = null;
    this.eatUntil = 0;
    this.relaxUntil = 0;
    this.pettedTicks = 0;
    this.nextPetAt = 0;
    this.chaseUntil = 0;
    this.deletedFoods = [];
  }

  get playAvailable() {
    return this.playerNearby || this.toyVisible;
  }

  clearTarget() {
    this.targetValid = false;
    this.targetDistance = Infinity;
  }

  beginHungry() {
    this.action = A.HUNGRY;
    this.clearTarget();
  }

  beginSleep() {
    this.action = A.SLEEPING;
    this.clearTarget();
  }

  beginDirectChase() {
    if (!this.playAvailable) return;
    this.action = A.CHASING;
    this.needs.chase = 0;
    this.targetValid = true;
    this.chaseUntil = this.seconds + 10;
  }

  beginForcedChase() {
    if (!this.targetValid) return;
    this.action = A.CHASING;
    this.needs.chase = 0;
    this.chaseUntil = this.seconds + 10;
  }

  beginStalk() {
    if (!this.playAvailable) return;
    this.action = A.STALKING;
    this.needs.stalk = this.rng.integer(0, 50);
    this.targetValid = true;
  }

  beginFollow() {
    if (!this.playerNearby) return;
    this.action = A.FOLLOWING;
    this.targetValid = true;
  }

  beginRelax() {
    this.action = A.RELAXING;
    this.relaxUntil = this.seconds + this.rng.integer(5, 25);
    this.clearTarget();
  }

  arbitrate() {
    const n = this.needs;
    if (n.sleep >= 100) this.beginSleep();
    else if (n.hunger >= 100) this.beginHungry();
    else if (n.chase >= 100 && this.playAvailable) this.beginDirectChase();
    else if (n.stalk >= 100 && this.playAvailable) this.beginStalk();
    else if (n.follow >= 100 && this.playerNearby) this.beginFollow();
    else if (n.relax >= 100 && n.hunger < 100 && n.sleep < 100
      && n.chase < 100 && n.stalk < 100 && n.follow < 100) this.beginRelax();
    else if (n.sleep >= 75) {
      this.action = A.SLEEPY;
      this.clearTarget();
    } else {
      this.action = A.ROAM;
      this.clearTarget();
    }
  }

  pet() {
    if (this.seconds < this.nextPetAt) return false;
    this.nextPetAt = this.seconds + 1;
    this.needs.follow = cap(this.needs.follow + 4);
    this.action = A.PETTED;
    this.pettedTicks = 10;
    this.clearTarget();
    return true;
  }

  callCat(callerDistance) {
    if (callerDistance > 900) return false;
    this.needs.follow = 100;
    this.playerNearby = true;
    // The chat event only publishes the caller and fills FollowNeed. It does
    // not directly arbitrate or break the state currently holding the cat.
    return true;
  }

  tickNeeds() {
    const n = this.needs;
    if (this.action === A.SLEEPING) {
      n.sleep = cap(n.sleep - 1);
      return;
    }
    n.hunger = cap(n.hunger + 1);
    n.sleep = cap(n.sleep + 1);
    n.chase = cap(n.chase + 1);
    n.stalk = cap(n.stalk + 1);
    n.follow = cap(n.follow + 1);
    n.relax = this.action === A.RELAXING ? cap(n.relax - 4) : cap(n.relax + 1);
  }

  tick() {
    this.seconds += 1;
    const started = this.action;
    this.tickNeeds();
    let reroll = false;

    if (started === A.SLEEPING) {
      if (this.needs.sleep <= 0) {
        this.action = A.ROAM;
        reroll = true;
      }
    } else if (started === A.EATING) {
      if (this.mouthFood == null || this.mouthFood !== this.eatingTarget) {
        this.eatingTarget = null;
        this.beginHungry();
      } else if (this.seconds >= this.eatUntil) {
        this.deletedFoods.push(this.eatingTarget);
        const reduction = this.rng.integer(0, 3) < 2 ? 25 : 100;
        this.needs.hunger = cap(this.needs.hunger - reduction);
        this.eatingTarget = null;
        this.action = A.ROAM;
        reroll = true;
      }
    } else if (started === A.HUNGRY) {
      if (this.needs.sleep >= 100) {
        reroll = true;
      } else if (this.mouthFood != null) {
        this.action = A.EATING;
        this.eatingTarget = this.mouthFood;
        this.eatUntil = this.seconds + 5;
        this.clearTarget();
      } else {
        this.beginHungry();
      }
    } else if (started === A.PETTED) {
      // The production movement clock owns this short timer.
    } else if (started === A.RELAXING) {
      if (this.seconds >= this.relaxUntil) {
        this.action = A.ROAM;
        reroll = true;
      }
    } else if (started === A.CHASING) {
      if (this.needs.hunger >= 100 || this.needs.sleep >= 100) reroll = true;
      else if (!this.targetValid || this.targetDistance <= 35
        || this.seconds >= this.chaseUntil) {
        this.action = A.ROAM;
        this.clearTarget();
        reroll = true;
      }
    } else if (started === A.STALKING) {
      if (this.needs.hunger >= 100 || this.needs.sleep >= 100
        || (this.needs.chase >= 100 && this.playAvailable)) reroll = true;
      else if (!this.targetValid) {
        this.action = A.ROAM;
        reroll = true;
      } else if (this.targetDistance <= 180) this.beginForcedChase();
    } else if (started === A.FOLLOWING) {
      if (this.needs.hunger >= 100 || this.needs.sleep >= 100
        || (this.needs.chase >= 100 && this.playAvailable)
        || (this.needs.stalk >= 100 && this.playAvailable)) reroll = true;
      else if (!this.targetValid) {
        this.action = A.ROAM;
        reroll = true;
      } else if (this.targetDistance <= 90) {
        this.needs.follow = 0;
        this.action = A.ROAM;
        this.clearTarget();
        reroll = true;
      }
    } else reroll = true;

    if (reroll) this.arbitrate();
  }

  motionTick() {
    if (this.action !== A.PETTED) return;
    if (this.pettedTicks > 0) this.pettedTicks -= 1;
    if (this.pettedTicks <= 0) {
      this.action = A.ROAM;
      this.arbitrate();
    }
  }
}

function withNeeds(values, rng = []) {
  const model = new CatModel(new SequenceRng(rng));
  Object.assign(model.needs, values);
  return model;
}

// Priority and eligibility.
{
  const m = withNeeds({hunger: 100, sleep: 100, chase: 100, stalk: 100,
    follow: 100, relax: 100});
  m.playerNearby = true;
  m.arbitrate();
  assert.equal(m.action, A.SLEEPING, 'Sleep is absolute first priority');
}
{
  const m = withNeeds({hunger: 100, sleep: 99, chase: 100, stalk: 100, follow: 100});
  m.playerNearby = true;
  m.arbitrate();
  assert.equal(m.action, A.HUNGRY, 'Hunger is second priority');
}
{
  const m = withNeeds({chase: 100, stalk: 100, follow: 100});
  m.toyVisible = true;
  m.targetDistance = 400;
  m.arbitrate();
  assert.equal(m.action, A.CHASING, 'Direct Chase outranks Stalk and Follow');
  assert.equal(m.needs.chase, 0, 'Direct Chase consumes ChaseNeed');
}
{
  const m = withNeeds({chase: 99, stalk: 100, follow: 100}, [23]);
  m.playerNearby = true;
  m.arbitrate();
  assert.equal(m.action, A.STALKING, 'Stalk outranks Follow');
  assert.equal(m.needs.stalk, 23, 'Stalk reset uses inclusive 0-50 result');
}
{
  const m = withNeeds({follow: 100});
  m.playerNearby = true;
  m.arbitrate();
  assert.equal(m.action, A.FOLLOWING);
}
{
  const m = withNeeds({relax: 100}, [5]);
  m.arbitrate();
  assert.equal(m.action, A.RELAXING);
  assert.equal(m.relaxUntil, 5);
}
{
  const m = withNeeds({follow: 100, relax: 100});
  m.arbitrate();
  assert.equal(m.action, A.ROAM,
    'Relax is blocked by another 100 need even when that need is ineligible');
}
{
  const sleepy = withNeeds({sleep: 75});
  sleepy.arbitrate();
  assert.equal(sleepy.action, A.SLEEPY);
  const awake = withNeeds({sleep: 74});
  awake.arbitrate();
  assert.equal(awake.action, A.ROAM);
}

// Normal growth and caps.
{
  const m = withNeeds({hunger: 99.5, sleep: 99.5, chase: 99.5,
    stalk: 99.5, follow: 99.5, relax: 99.5});
  m.tick();
  assert.deepEqual(m.needs,
    {hunger: 100, sleep: 100, chase: 100, stalk: 100, follow: 100, relax: 100});
  assert.equal(m.action, A.SLEEPING);
}

// Sleeping decreases only SleepNeed and freezes every other priority.
{
  const m = withNeeds({hunger: 10, sleep: 3, chase: 20, stalk: 30, follow: 40, relax: 50});
  m.action = A.SLEEPING;
  m.tick();
  assert.deepEqual(m.needs,
    {hunger: 10, sleep: 2, chase: 20, stalk: 30, follow: 40, relax: 50});
  m.tick();
  m.tick();
  assert.equal(m.needs.sleep, 0);
  assert.equal(m.action, A.ROAM);
}

// Sleep can mature while Hungry is active and must preempt it on that tick.
{
  const m = withNeeds({hunger: 100, sleep: 99});
  m.action = A.HUNGRY;
  m.tick();
  assert.equal(m.needs.sleep, 100);
  assert.equal(m.action, A.SLEEPING,
    'Hungry rerolls when SleepNeed reaches 100 so Sleep remains first priority');
}

// Petting is +4 exactly, interrupts sleep, and owns the state for two seconds.
{
  const m = withNeeds({sleep: 100, follow: 95});
  m.action = A.SLEEPING;
  assert.equal(m.pet(), true);
  assert.equal(m.needs.follow, 99, 'Petting adds four, not five');
  assert.equal(m.needs.sleep, 100, 'Petting does not change SleepNeed');
  assert.equal(m.action, A.PETTED);
  assert.equal(m.pettedTicks, 10);
  assert.equal(m.pet(), false, 'Same-second held interaction is debounced');
  m.tick();
  assert.equal(m.action, A.PETTED, 'One-second need tick does not own pet expiry');
  for (let tick = 1; tick <= 9; tick++) {
    m.motionTick();
    assert.equal(m.action, A.PETTED, `Petted state ended before motion tick ${tick}`);
  }
  m.motionTick();
  assert.equal(m.action, A.SLEEPING,
    'Ten 0.2-second movement ticks reroll and resume unchanged top-priority Sleep');
}
{
  const m = withNeeds({follow: 98});
  m.pet();
  assert.equal(m.needs.follow, 100, 'Petting caps FollowNeed at 100');
}

// /cat fills FollowNeed for an in-range caller, but does not directly break a
// locked state. The next ordinary arbitration opportunity applies priority.
{
  const m = withNeeds({relax: 100}, [5]);
  m.arbitrate();
  assert.equal(m.action, A.RELAXING);
  assert.equal(m.callCat(899), true);
  assert.equal(m.needs.follow, 100);
  assert.equal(m.action, A.RELAXING, '/cat must not break an active Relax lock');
  m.tick();
  assert.equal(m.action, A.RELAXING);
}
{
  const m = withNeeds({sleep: 100, follow: 0});
  m.action = A.SLEEPING;
  assert.equal(m.callCat(100), true);
  assert.equal(m.needs.follow, 100);
  assert.equal(m.action, A.SLEEPING, '/cat must not interrupt Sleeping');
}
{
  const m = withNeeds({follow: 12});
  assert.equal(m.callCat(901), false);
  assert.equal(m.needs.follow, 12, 'Out-of-range /cat caller is ignored');
  assert.equal(m.playerNearby, false);
}
{
  const m = withNeeds({follow: 0});
  assert.equal(m.callCat(500), true);
  assert.equal(m.action, A.ROAM, '/cat waits for normal arbitration');
  m.tick();
  assert.equal(m.action, A.FOLLOWING,
    'Normal arbitration starts Following for an eligible /cat caller');
}

// Eating requires five full seconds of uninterrupted same-food mouth contact.
{
  const m = withNeeds({hunger: 100}, [0]);
  m.action = A.HUNGRY;
  m.mouthFood = 'food-a';
  m.tick();
  assert.equal(m.action, A.EATING);
  assert.equal(m.eatUntil, 6);
  for (let second = 2; second <= 5; second++) {
    m.tick();
    assert.equal(m.action, A.EATING, `Eating ended early at second ${second}`);
    assert.equal(m.deletedFoods.length, 0);
  }
  m.tick();
  assert.deepEqual(m.deletedFoods, ['food-a']);
  assert.equal(m.needs.hunger, 75, 'Low food roll subtracts 25');
}
{
  const m = withNeeds({hunger: 100}, [3]);
  m.action = A.HUNGRY;
  m.mouthFood = 'food-b';
  m.tick();
  for (let i = 0; i < 5; i++) m.tick();
  assert.deepEqual(m.deletedFoods, ['food-b']);
  assert.equal(m.needs.hunger, 0, 'High food roll subtracts 100 and clamps');
}
{
  const m = withNeeds({hunger: 100});
  m.action = A.HUNGRY;
  m.mouthFood = 'food-c';
  m.tick();
  m.mouthFood = null;
  m.tick();
  assert.equal(m.action, A.HUNGRY);
  assert.equal(m.deletedFoods.length, 0, 'Food leaving the mouth is not deleted');
  assert.equal(m.needs.hunger, 100, 'Cancelled eating does not reduce HungerNeed');
}

// Stalk and both Chase entry paths consume only their own priorities.
{
  const m = withNeeds({stalk: 100, chase: 40}, [17]);
  m.playerNearby = true;
  m.targetDistance = 300;
  m.arbitrate();
  assert.equal(m.action, A.STALKING);
  assert.equal(m.needs.stalk, 17);
  m.targetDistance = 179;
  m.tick();
  assert.equal(m.action, A.CHASING, 'Successful stalking forces Chase');
  assert.equal(m.needs.chase, 0, 'Forced Chase consumes ChaseNeed');
}
{
  const m = withNeeds({chase: 100});
  m.playerNearby = true;
  m.targetDistance = 200;
  m.arbitrate();
  assert.equal(m.action, A.CHASING);
  assert.equal(m.needs.chase, 0);
  for (let i = 0; i < 9; i++) {
    m.tick();
    assert.equal(m.action, A.CHASING);
  }
  m.tick();
  assert.notEqual(m.action, A.CHASING, 'Chase has a ten-second maximum');
}
{
  const m = withNeeds({chase: 100, relax: 100});
  m.arbitrate();
  assert.equal(m.action, A.ROAM,
    'Unavailable Chase is skipped, and its 100 still blocks Relax');
  assert.equal(m.needs.chase, 100, 'Unavailable Chase is not consumed');
}

// Following completes at close range and consumes FollowNeed.
{
  const m = withNeeds({follow: 100});
  m.playerNearby = true;
  m.targetDistance = 200;
  m.arbitrate();
  assert.equal(m.action, A.FOLLOWING);
  m.targetDistance = 90;
  m.tick();
  assert.equal(m.needs.follow, 0);
  assert.equal(m.action, A.ROAM);
}

// Relax is locked through its selected duration, drains four per second, and
// rerolls immediately afterward. Higher needs may mature during the lock.
{
  const m = withNeeds({hunger: 0, relax: 100}, [5]);
  m.arbitrate();
  m.needs.hunger = 99;
  for (let second = 1; second <= 4; second++) {
    m.tick();
    assert.equal(m.action, A.RELAXING, `Relax ended early at second ${second}`);
  }
  m.tick();
  assert.equal(m.needs.relax, 80, 'Five seconds of Relax removes twenty points');
  assert.equal(m.action, A.HUNGRY, 'Matured higher priority wins after Relax completes');
}

// Link the executable model to the production source contract.
const sourcePath = path.join(__dirname, 'rigid-cat-priority-brain.ws');
const source = fs.readFileSync(sourcePath, 'utf8');
for (const [label, pattern] of [
  ['+4 pet reward', /followNeed = capNeed\(followNeed \+ 4\.0\)/],
  ['two-second Petted state', /pettedTicks = 10/],
  ['movement-clock Petted countdown', /if pettedTicks > 0 \{ pettedTicks -= 1 \}/],
  ['five-second eating', /eatUntil = seconds \+ 5/],
  ['25-or-100 eating reduction', /Random\(0, 3\) < 2 then 25\.0 else 100\.0/],
  ['ten-second Chase', /chaseUntil = seconds \+ 10/],
  ['0-50 Stalk reset', /stalkNeed = Random\(0, 50\)/],
  ['Follow completion reset', /distance <= FOLLOW_RANGE[\s\S]*followNeed = 0\.0/],
  ['Relax duration', /relaxUntil = seconds \+ Random\(5, 25\)/],
  ['Relax drain', /action == RELAXING then capNeed\(relaxNeed - 4\.0\)/],
  ['Hungry yields to Sleep', /action == HUNGRY[\s\S]*?if sleepNeed >= 100\.0[\s\S]*?reroll = true/],
  ['/cat command', /on ChatCommand\("cat", "Call a nearby cat"\)/],
  ['/cat social fill', /on ChatCommand\([\s\S]*?followNeed = 100\.0/],
]) assert.match(source, pattern, `Production source is missing ${label}`);

const petHandler = source.slice(source.indexOf('on WholeGridInteracted()'), source.length);
assert.doesNotMatch(petHandler, /sleepNeed\s*=/,
  'Petting must interrupt the action without changing SleepNeed');

const arbitration = source.slice(source.indexOf('mod arbitrate('),
  source.indexOf('on Loaded()'));
const priorityMarkers = [
  'if sleepNeed >= 100.0',
  'else if hungerNeed >= 100.0',
  'else if chaseNeed >= 100.0',
  'else if stalkNeed >= 100.0',
  'else if followNeed >= 100.0',
  'else if relaxNeed >= 100.0',
  'else if sleepNeed >= 75.0',
];
let previous = -1;
for (const marker of priorityMarkers) {
  const index = arbitration.indexOf(marker);
  assert(index > previous, `Production priority order is wrong at: ${marker}`);
  previous = index;
}

console.log(JSON.stringify({
  model: 'passed',
  priorityOrder: ['Sleeping', 'Hungry', 'Chasing', 'Stalking', 'Following',
    'Relaxing', 'Sleepy', 'Roam'],
  petFollowIncrease: 4,
  pettedSeconds: 2,
  eatingSeconds: 5,
  chaseSeconds: 10,
  chatCommand: 'cat',
  sourceContract: sourcePath,
}, null, 2));

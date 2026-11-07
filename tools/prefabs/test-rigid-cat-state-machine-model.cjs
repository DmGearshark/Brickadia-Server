'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const S = Object.freeze({
  ROAM: 0, RELAX: 1, FOLLOW: 2, STALK: 3, CHASE: 4,
  HUNGRY: 5, EATING: 6, SLEEPY: 7, SLEEP: 8, PETTED: 9,
});

class Rng {
  constructor(values) { this.values = [...values]; }
  int(min, max) {
    assert(this.values.length, `Missing RNG value for ${min}..${max}`);
    const value = this.values.shift();
    assert(value >= min && value <= max, `${value} outside ${min}..${max}`);
    return value;
  }
}

class Cat {
  constructor(values = []) {
    this.rng = new Rng(values);
    this.seconds = 0;
    this.state = S.ROAM;
    this.stateUntil = 0;
    this.awakeSeconds = 0;
    this.sleepAfter = 480;
    this.player = false;
    this.toy = false;
    this.target = false;
    this.distance = Infinity;
    this.food = null;
    this.mouthFood = null;
    this.eatingTarget = null;
    this.pettedTicks = 0;
    this.deleted = [];
  }

  get playAvailable() { return this.player || this.toy; }

  chooseNext() {
    this.target = false;
    const roll = this.rng.int(0, 99);
    if (roll < 45) {
      this.state = S.ROAM;
      this.stateUntil = this.seconds + this.rng.int(6, 18);
    } else if (roll < 70) {
      this.state = S.RELAX;
      this.stateUntil = this.seconds + this.rng.int(5, 20);
    } else if (roll < 85 && this.player) {
      this.state = S.FOLLOW;
      this.stateUntil = this.seconds + this.rng.int(8, 18);
      this.target = true;
    } else if (this.playAvailable) {
      this.state = S.STALK;
      this.stateUntil = this.seconds + 30;
      this.target = true;
    } else {
      this.state = S.ROAM;
      this.stateUntil = this.seconds + this.rng.int(6, 18);
    }
  }

  tick() {
    this.seconds++;
    if (this.state === S.SLEEP) {
      if (this.seconds >= this.stateUntil) {
        this.awakeSeconds = 0;
        this.sleepAfter = this.rng.int(300, 600);
        this.chooseNext();
      }
      return;
    }
    if (this.state === S.EATING) {
      if (this.mouthFood == null || this.mouthFood !== this.eatingTarget) {
        this.eatingTarget = null;
        this.state = S.HUNGRY;
        this.stateUntil = this.seconds + 60;
      } else if (this.seconds >= this.stateUntil) {
        this.deleted.push(this.eatingTarget);
        this.eatingTarget = null;
        this.food = null;
        this.chooseNext();
      }
      return;
    }
    if (this.state === S.PETTED) return;
    if (this.state === S.SLEEPY) {
      if (this.seconds >= this.stateUntil) {
        this.state = S.SLEEP;
        this.stateUntil = this.seconds + this.rng.int(30, 60);
        this.target = false;
      }
      return;
    }

    this.awakeSeconds++;
    if (this.state === S.STALK) {
      if (!this.target || this.seconds >= this.stateUntil) this.chooseNext();
      else if (this.distance <= 180) {
        this.state = S.CHASE;
        this.stateUntil = this.seconds + this.rng.int(1, 3);
      }
    } else if (this.state === S.CHASE) {
      if (!this.target || this.distance <= 35 || this.seconds >= this.stateUntil) {
        this.chooseNext();
      }
    } else if (this.state === S.HUNGRY) {
      if (this.mouthFood != null) {
        this.state = S.EATING;
        this.eatingTarget = this.mouthFood;
        this.stateUntil = this.seconds + 5;
      } else if (this.seconds >= this.stateUntil) this.chooseNext();
    } else if (this.food != null) {
      this.state = S.HUNGRY;
      this.stateUntil = this.seconds + 60;
      this.target = true;
    } else if (this.awakeSeconds >= this.sleepAfter) {
      this.state = S.SLEEPY;
      this.stateUntil = this.seconds + this.rng.int(4, 8);
      this.target = false;
    } else if (this.state === S.FOLLOW) {
      if (!this.target || this.distance <= 90 || this.seconds >= this.stateUntil) {
        this.chooseNext();
      }
    } else if (this.seconds >= this.stateUntil) this.chooseNext();
  }

  motionTick() {
    if (this.state !== S.PETTED) return;
    if (this.pettedTicks > 0) this.pettedTicks--;
    if (this.pettedTicks <= 0) this.chooseNext();
  }

  pet() {
    this.state = S.PETTED;
    this.pettedTicks = 10;
    this.target = false;
  }
}

// Weighted successor boundaries and eligibility fallbacks.
for (const [roll, expected, duration] of [
  [0, S.ROAM, 6], [44, S.ROAM, 18], [45, S.RELAX, 5], [69, S.RELAX, 20],
]) {
  const cat = new Cat([roll, duration]);
  cat.chooseNext();
  assert.equal(cat.state, expected);
  assert.equal(cat.stateUntil, duration);
}
{
  const cat = new Cat([70, 8]);
  cat.player = true;
  cat.chooseNext();
  assert.equal(cat.state, S.FOLLOW);
  assert.equal(cat.target, true);
}
{
  const cat = new Cat([99]);
  cat.toy = true;
  cat.chooseNext();
  assert.equal(cat.state, S.STALK);
}
{
  const cat = new Cat([99, 12]);
  cat.chooseNext();
  assert.equal(cat.state, S.ROAM, 'Unavailable Follow/Stalk falls back to Roam');
}

// Stalk commits until close, then Chase lasts its rolled 1–3 seconds.
{
  const cat = new Cat([3, 0, 6]);
  cat.state = S.STALK;
  cat.target = true;
  cat.distance = 179;
  cat.stateUntil = 30;
  cat.food = 'food-waits';
  cat.sleepAfter = 0;
  cat.tick();
  assert.equal(cat.state, S.CHASE, 'Food and sleep timers do not interrupt committed Stalk');
  assert.equal(cat.stateUntil, 4);
  cat.distance = 100;
  cat.tick();
  cat.tick();
  assert.equal(cat.state, S.CHASE);
  cat.tick();
  assert.equal(cat.state, S.ROAM);
}

// Visible food triggers Hungry; the same mouth target must persist for 5 sec.
{
  const cat = new Cat([10, 6]);
  cat.food = 'food-a';
  cat.tick();
  assert.equal(cat.state, S.HUNGRY);
  cat.mouthFood = 'food-a';
  cat.tick();
  assert.equal(cat.state, S.EATING);
  for (let i = 0; i < 4; i++) cat.tick();
  assert.deepEqual(cat.deleted, []);
  cat.tick();
  assert.deepEqual(cat.deleted, ['food-a']);
}
{
  const cat = new Cat([]);
  cat.state = S.EATING;
  cat.eatingTarget = 'food-a';
  cat.mouthFood = 'food-b';
  cat.stateUntil = 5;
  cat.tick();
  assert.equal(cat.state, S.HUNGRY);
  assert.deepEqual(cat.deleted, []);
}

// Awake timer produces a short Sleepy state and a 30–60 second Sleep.
{
  const cat = new Cat([4, 30]);
  cat.sleepAfter = 1;
  cat.tick();
  assert.equal(cat.state, S.SLEEPY);
  assert.equal(cat.stateUntil, 5);
  for (let i = 0; i < 4; i++) cat.tick();
  assert.equal(cat.state, S.SLEEP);
  assert.equal(cat.stateUntil, 35);
}

// Petting owns ten 0.2-second ticks, then returns to the weighted state pool.
{
  const cat = new Cat([45, 5]);
  cat.pet();
  for (let i = 0; i < 9; i++) {
    cat.motionTick();
    assert.equal(cat.state, S.PETTED);
  }
  cat.motionTick();
  assert.equal(cat.state, S.RELAX);
}

const sourcePath = path.join(__dirname, 'rigid-cat-state-machine-brain.ws');
const source = fs.readFileSync(sourcePath, 'utf8');
for (const [label, pattern] of [
  ['weighted transition roll', /let roll = Random\(0, 99\)/],
  ['roam duration', /Random\(6, 18\)/],
  ['relax duration', /Random\(5, 20\)/],
  ['stalk to chase', /distance <= STALK_TO_CHASE_RANGE[\s\S]*state = CHASE/],
  ['one-to-three second chase', /stateUntil = seconds \+ Random\(1, 3\)/],
  ['five-second eating', /stateUntil = seconds \+ 5/],
  ['sleepy delay', /Random\(4, 8\)/],
  ['sleep duration', /Random\(30, 60\)/],
  ['awake duration', /Random\(300, 600\)/],
  ['two-second pet display', /pettedTicks = 10/],
  ['cat command', /on ChatCommand\("cat"/],
  ['short wall sweep', /const WALL_SWEEP_DISTANCE = 65\.0/],
  ['narrow wall sweep', /const WALL_SWEEP_RADIUS = 5\.0/],
  ['two-tick reverse burst', /const WALL_REVERSE_TICKS = 2/],
  ['no sweep retrigger while reversing', /if avoidTicks > 0 \{[\s\S]*?\} else \{[\s\S]*?let obstacle = Sweep/],
]) assert.match(source, pattern, `Missing production contract: ${label}`);

console.log(JSON.stringify({
  model: 'passed',
  states: Object.keys(S),
  chaseSeconds: [1, 3],
  eatingSeconds: 5,
  sleepySeconds: [4, 8],
  sleepingSeconds: [30, 60],
  awakeSeconds: [300, 600],
  source: sourcePath,
}, null, 2));

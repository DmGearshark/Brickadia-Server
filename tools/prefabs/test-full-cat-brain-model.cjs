'use strict';

// Independent executable model for the full cat brain. This intentionally
// shares no implementation with the WireScript program: it encodes the
// behavior contract at a higher level so regressions in state transitions,
// target identity, learning, recovery, and presentation are caught without
// merely repeating individual gates.

const assert = require('assert/strict');

const S = Object.freeze({
  RELAX: 'RELAX',
  ROAM: 'ROAM',
  FOLLOW: 'FOLLOW',
  SEEK_FOOD: 'SEEK FOOD',
  EAT: 'EATING',
  SEEK_TREAT: 'SEEK TREAT',
  SEEK_PETS: 'WANTS PETS',
  WAIT_PETS: 'WAITING FOR PETS',
  PETTED: 'GETTING PETTED',
  STALK: 'STALKING',
  CHASE: 'CHASING',
  SEEK_BED: 'SEEKING BED',
  SLEEP: 'SLEEPING',
  FLEE: 'SCARED',
  ANGRY: 'ANGRY',
  STRETCH: 'STRETCHING',
  GROOM: 'GROOMING',
  RETURN_HOME: 'RETURNING HOME',
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class SequenceRng {
  constructor(values = []) { this.values = values.slice(); }
  int(min, max) {
    if (!this.values.length) return min;
    const value = this.values.shift();
    assert(Number.isInteger(value) && value >= min && value <= max,
      `RNG ${value} outside [${min}, ${max}]`);
    return value;
  }
}

const PRESENTATION = Object.freeze({
  [S.RELAX]:       {face: '>⩊<',       color: 'green'},
  [S.ROAM]:        {face: '◈W◈',       color: 'green'},
  [S.FOLLOW]:      {face: 'o⩊o',       color: 'pink'},
  [S.SEEK_FOOD]:   {face: '⟐⩊⟐',       color: 'lime'},
  [S.EAT]:         {face: '♢W♢',       color: 'orange'},
  [S.SEEK_TREAT]:  {face: '⟐⩊⟐',       color: 'lime'},
  [S.SEEK_PETS]:   {face: 'o⩊o',       color: 'pink'},
  [S.WAIT_PETS]:   {face: 'o⩊o',       color: 'pink'},
  [S.PETTED]:      {face: '^⩊^',       color: 'pink'},
  [S.STALK]:       {face: '◉⩊◉',       color: 'orange'},
  [S.CHASE]:       {face: '(⧫⩊⧫)',     color: 'yellow'},
  [S.SEEK_BED]:    {face: 'o)⩊(o',     color: 'cyan'},
  [S.SLEEP]:       {face: '-⩊-',       color: 'dark-blue'},
  [S.FLEE]:        {face: 'ಥ⩊ಥ',       color: 'blue'},
  [S.ANGRY]:       {face: 'ಠ⩊ಠ',       color: 'red'},
  [S.STRETCH]:     {face: '🐈',         color: 'amber'},
  [S.GROOM]:       {face: '≧⩊≦',       color: 'purple'},
  [S.RETURN_HOME]: {face: '◈W◈',       color: 'green'},
});

class CatModel {
  constructor(rng = new SequenceRng()) {
    this.rng = rng;
    this.time = 0;
    this.state = S.ROAM;
    this.stateUntil = 6;
    this.needs = {hunger: 0, sleep: 0, boredom: 0, social: 0, fear: 0, annoyance: 0};
    this.preferences = {food: 0, play: 0, pet: 0, bed: 0, follow: 0, roam: 0};
    this.relations = new Map();
    this.targets = [];
    this.target = null;
    this.cooldownUntil = new Map();
    this.mouthEntity = null;
    this.eatSeconds = 0;
    this.deleted = [];
    this.treatTimes = [];
    this.failureCount = 0;
    this.homeDistance = 0;
    this.petOverlayUntil = 0;
    this.petOverlayReturn = S.ROAM;
    this.rewardPending = null;
    this.recoveryTicks = 0;
    this.recoveryDirection = 0;
    this.lastProgressDistance = Infinity;
    this.noProgressSeconds = 0;
    this.statesVisited = new Set([this.state]);
    this.driveHistory = [];
  }

  relation(player) {
    if (!this.relations.has(player)) this.relations.set(player, {affection: 0, irritation: 0});
    return this.relations.get(player);
  }

  learn(key, amount) {
    this.preferences[key] = clamp(this.preferences[key] + amount, -20, 20);
  }

  reward(key, amount, player = null) {
    this.learn(key, amount);
    if (player) {
      const r = this.relation(player);
      r.affection = clamp(r.affection + amount, -20, 20);
      r.irritation = clamp(r.irritation - Math.max(0, amount) * 0.5, 0, 20);
    }
  }

  punish(key, amount, player = null) {
    this.learn(key, -Math.abs(amount));
    if (player) {
      const r = this.relation(player);
      r.irritation = clamp(r.irritation + Math.abs(amount), 0, 20);
    }
  }

  visible(type) {
    return this.targets.filter(t => t.type === type
      && (this.cooldownUntil.get(t.id) || 0) <= this.time);
  }

  nearest(types) {
    return this.targets
      .filter(t => types.includes(t.type) && (this.cooldownUntil.get(t.id) || 0) <= this.time)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  setState(state, duration = 0, target = null) {
    this.state = state;
    this.stateUntil = this.time + duration;
    this.target = target;
    this.statesVisited.add(state);
  }

  committed() {
    return [S.STALK, S.CHASE, S.EAT, S.SLEEP, S.FLEE, S.ANGRY, S.STRETCH, S.PETTED]
      .includes(this.state) && this.time < this.stateUntil;
  }

  canTakeTreat() {
    this.treatTimes = this.treatTimes.filter(t => this.time - t < 180);
    return this.treatTimes.length < 5;
  }

  selectGoal() {
    const player = this.nearest(['player']);
    const food = this.nearest(['food']);
    const treat = this.nearest(['treat']);
    const toy = this.nearest(['toy']);
    const bed = this.nearest(['bed']);

    // Safety priorities are deliberately independent of learned preferences.
    if (this.needs.fear >= 85 && player) return this.setState(S.FLEE, this.rng.int(8, 12), player);
    if (this.needs.sleep >= 100) {
      if (bed) return this.setState(S.SEEK_BED, 45, bed);
      return this.setState(S.SLEEP, this.rng.int(30, 60));
    }
    if (this.needs.hunger >= 100) {
      if (food) return this.setState(S.SEEK_FOOD, 60, food);
      if (treat && this.canTakeTreat()) return this.setState(S.SEEK_TREAT, 45, treat);
      if (player) return this.setState(S.FOLLOW, 30, player);
      return this.setState(S.ROAM, this.rng.int(6, 18));
    }
    if (treat && this.canTakeTreat()) return this.setState(S.SEEK_TREAT, 45, treat);
    if (this.needs.annoyance >= 80 && player) return this.setState(S.ANGRY, this.rng.int(6, 10), player);
    if (this.needs.boredom >= 100 && (toy || player)) return this.setState(S.STALK, 30, toy || player);
    if (this.needs.social >= 100 && player) return this.setState(S.SEEK_PETS, 30, player);
    if (this.homeDistance > 900) return this.setState(S.RETURN_HOME, 60, {id: 'home', type: 'home', distance: this.homeDistance});
    if (player && this.preferences.follow >= 5) return this.setState(S.FOLLOW, 20, player);

    if (this.rng.int(0, 99) < 45) return this.setState(S.RELAX, this.rng.int(5, 25));
    return this.setState(S.ROAM, this.rng.int(6, 18));
  }

  pet(player) {
    const returning = this.state === S.SLEEP ? S.ROAM : this.state;
    this.petOverlayReturn = returning;
    this.petOverlayUntil = this.time + 2;
    this.setState(S.PETTED, 2, {id: player, type: 'player', distance: 0});
    const r = this.relation(player);
    if (this.needs.social >= 50 && r.irritation < 10) {
      this.needs.social = clamp(this.needs.social - 20, 0, 100);
      this.reward('pet', 1, player);
      this.reward('follow', 0.5, player);
    } else {
      this.needs.annoyance = clamp(this.needs.annoyance + 15, 0, 100);
      this.punish('pet', 0.5, player);
    }
  }

  call(player) {
    const target = this.targets.find(t => t.type === 'player' && t.id === player && t.distance <= 1200);
    if (!target || this.state === S.FLEE) return false;
    this.setState(S.FOLLOW, 30, target);
    return true;
  }

  startEating(entity) {
    assert(entity && ['food', 'treat'].includes(entity.type));
    if (entity.type === 'treat' && !this.canTakeTreat()) return false;
    this.eatSeconds = 0;
    this.setState(S.EAT, 8, entity);
    return true;
  }

  failTarget() {
    if (this.target) this.cooldownUntil.set(this.target.id, this.time + 30);
    this.failureCount++;
    this.punish(this.target?.type === 'toy' ? 'play' : 'roam', 0.25);
    this.setState(S.ROAM, 6);
  }

  tickSecond() {
    this.time++;

    // Petting is a short presentation overlay and wakes a sleeping cat.
    if (this.state === S.PETTED) {
      if (this.time >= this.petOverlayUntil) {
        this.setState(this.petOverlayReturn, 1);
        this.selectGoal();
      }
      return;
    }

    if (this.state === S.SLEEP) {
      this.needs.sleep = clamp(this.needs.sleep - 3, 0, 100);
      if (this.needs.sleep === 0 || this.time >= this.stateUntil)
        this.setState(S.STRETCH, 4);
      return; // Other needs are frozen while asleep.
    }

    this.needs.hunger = clamp(this.needs.hunger + 1, 0, 100);
    this.needs.sleep = clamp(this.needs.sleep + 1, 0, 100);
    this.needs.boredom = clamp(this.needs.boredom + 1, 0, 100);
    this.needs.social = clamp(this.needs.social + 1, 0, 100);
    this.needs.fear = clamp(this.needs.fear - 2, 0, 100);
    this.needs.annoyance = clamp(this.needs.annoyance - 1, 0, 100);

    // Preferences drift slowly toward neutral so finite experiences cannot
    // permanently dominate the cat's behavior.
    if (this.time % 30 === 0) for (const key of Object.keys(this.preferences)) {
      const p = this.preferences[key];
      this.preferences[key] = Math.abs(p) < 0.1 ? 0 : p - Math.sign(p) * 0.1;
    }

    if (this.state === S.EAT) {
      if (!this.mouthEntity || this.mouthEntity.id !== this.target?.id) {
        this.eatSeconds = 0;
        if (this.time >= this.stateUntil) this.failTarget();
        return;
      }
      this.eatSeconds++;
      if (this.eatSeconds >= 5) {
        const eaten = this.target;
        if (!this.deleted.includes(eaten.id)) this.deleted.push(eaten.id);
        if (eaten.type === 'treat') this.treatTimes.push(this.time);
        const relief = eaten.type === 'food' && this.rng.int(0, 3) >= 2 ? 100 : 25;
        this.needs.hunger = clamp(this.needs.hunger - relief, 0, 100);
        this.reward('food', eaten.type === 'food' ? 1 : 0.5);
        this.setState(S.ROAM, 2);
      }
      return;
    }

    // Critical needs may interrupt ordinary goals but do not corrupt an exact
    // eat, chase, recovery, or other committed target partway through.
    if (!this.committed() && (this.needs.sleep >= 100 || this.needs.hunger >= 100)) {
      this.selectGoal();
      return;
    }

    if (this.state === S.STALK) {
      if (!this.target || !this.targets.some(t => t.id === this.target.id)) return this.failTarget();
      const live = this.targets.find(t => t.id === this.target.id);
      this.target = live;
      if (live.distance <= 180) this.setState(S.CHASE, this.rng.int(1, 3), live);
      else if (this.time >= this.stateUntil) this.failTarget();
      return;
    }

    if (this.state === S.CHASE) {
      if (!this.target || !this.targets.some(t => t.id === this.target.id) || this.time >= this.stateUntil) {
        this.needs.boredom = clamp(this.needs.boredom - (this.rng.int(0, 1) ? 100 : 50), 0, 100);
        this.reward('play', 1);
        this.setState(S.ROAM, 2);
      }
      return;
    }

    if (this.state === S.SEEK_BED && this.target?.distance <= 50) {
      this.setState(S.SLEEP, this.rng.int(30, 60));
      this.reward('bed', 1);
      return;
    }

    if ([S.SEEK_FOOD, S.SEEK_TREAT].includes(this.state)) {
      if (!this.target || !this.targets.some(t => t.id === this.target.id)) return this.failTarget();
      const live = this.targets.find(t => t.id === this.target.id);
      this.target = live;
      if (this.mouthEntity?.id === live.id) this.startEating(live);
      else if (this.time >= this.stateUntil) this.failTarget();
      return;
    }

    if (this.state === S.SEEK_PETS && this.target?.distance <= 75)
      return this.setState(S.WAIT_PETS, 15, this.target);
    if (this.state === S.WAIT_PETS && this.time >= this.stateUntil) {
      this.needs.annoyance = clamp(this.needs.annoyance + 30, 0, 100);
      this.punish('pet', 1, this.target?.id);
      return this.setState(S.ANGRY, 8, this.target);
    }

    if ([S.RELAX, S.ROAM, S.FOLLOW, S.RETURN_HOME, S.GROOM, S.STRETCH, S.FLEE, S.ANGRY]
      .includes(this.state) && this.time >= this.stateUntil) this.selectGoal();
  }

  motionTick(sensors = {}) {
    const center = !!sensors.center;
    const left = !!sensors.left;
    const right = !!sensors.right;
    const rear = !!sensors.rear;

    if (this.recoveryTicks > 0) {
      this.recoveryTicks--;
      const drive = rear ? 0 : -0.35;
      const out = this.outputs({drive, steer: this.recoveryDirection});
      this.driveHistory.push(out.drive);
      return out;
    }
    if (center || left && right) {
      this.recoveryTicks = rear ? 0 : 2;
      this.recoveryDirection = left && !right ? 0.65 : right && !left ? -0.65 : 0.65;
      const out = this.outputs({drive: rear ? 0 : -0.35, steer: this.recoveryDirection});
      this.driveHistory.push(out.drive);
      return out;
    }
    const steerBias = left ? 0.55 : right ? -0.55 : 0;
    const out = this.outputs({steerBias});
    this.driveHistory.push(out.drive);
    return out;
  }

  outputs(overrides = {}) {
    let drive = 0, steer = 0, brake = false, speed = 100;
    let front = 500, rear = 500;
    const moving = [S.ROAM, S.FOLLOW, S.SEEK_FOOD, S.SEEK_TREAT, S.SEEK_PETS,
      S.STALK, S.CHASE, S.SEEK_BED, S.FLEE, S.RETURN_HOME].includes(this.state);
    if (moving) drive = this.state === S.STALK ? 0.22 : this.state === S.CHASE || this.state === S.FLEE ? 1 : 0.55;
    if ([S.RELAX, S.SLEEP, S.WAIT_PETS, S.EAT, S.ANGRY, S.GROOM].includes(this.state)) brake = true;
    if (this.state === S.STALK) { front = 100; rear = 500; speed = 50; }
    if (this.state === S.CHASE || this.state === S.FLEE) speed = 280;
    if (this.state === S.ANGRY) { front = 100; rear = 100; }
    if (this.state === S.SLEEP) { front = 100; rear = 100; }
    if (this.state === S.STRETCH) { drive = -0.15; front = 100; rear = 500; speed = 30; }
    if (overrides.steerBias != null) steer += overrides.steerBias;
    if (overrides.drive != null) drive = overrides.drive;
    if (overrides.steer != null) steer = overrides.steer;
    const p = PRESENTATION[this.state];
    return {
      drive: clamp(drive, -1, 1),
      steer: clamp(steer, -1, 1),
      brake,
      speed: clamp(speed, 0, 300),
      frontSuspension: clamp(front, 0, 1000),
      rearSuspension: clamp(rear, 0, 1000),
      headAngle: clamp(this.target ? 20 : 0, -55, 55),
      face: p.face,
      stateText: this.state,
      color: p.color,
      purr: this.state === S.PETTED || this.state === S.RELAX,
    };
  }
}

let tests = 0;
const test = (name, fn) => {
  try { fn(); tests++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};

test('critical sleep and hunger cannot be learned away', () => {
  const m = new CatModel(new SequenceRng([30]));
  m.preferences.bed = -20;
  m.preferences.food = -20;
  m.needs.sleep = 100;
  m.needs.hunger = 100;
  m.targets = [{id: 'bed', type: 'bed', distance: 100}, {id: 'food', type: 'food', distance: 60}];
  m.selectGoal();
  assert.equal(m.state, S.SEEK_BED);
  m.needs.sleep = 0;
  m.selectGoal();
  assert.equal(m.state, S.SEEK_FOOD);
});

test('committed stalk keeps exact target despite nearer replacement', () => {
  const m = new CatModel(new SequenceRng([2]));
  const first = {id: 'toy-a', type: 'toy', distance: 300};
  m.targets = [first];
  m.setState(S.STALK, 30, first);
  m.targets = [{id: 'toy-a', type: 'toy', distance: 170}, {id: 'toy-b', type: 'toy', distance: 5}];
  m.tickSecond();
  assert.equal(m.state, S.CHASE);
  assert.equal(m.target.id, 'toy-a');
  assert.equal(m.stateUntil, 3);
});

test('eating requires the same mouth entity continuously for five seconds', () => {
  const m = new CatModel(new SequenceRng([3]));
  const food = {id: 'food-a', type: 'food', distance: 0};
  m.targets = [food, {id: 'food-b', type: 'food', distance: 0}];
  assert(m.startEating(food));
  m.mouthEntity = food;
  for (let i = 0; i < 4; i++) m.tickSecond();
  assert.deepEqual(m.deleted, []);
  m.mouthEntity = m.targets[1];
  m.tickSecond();
  assert.deepEqual(m.deleted, []);
  assert.equal(m.eatSeconds, 0);
  m.mouthEntity = food;
  for (let i = 0; i < 5; i++) m.tickSecond();
  assert.deepEqual(m.deleted, ['food-a']);
  assert.equal(m.needs.hunger, 0);
});

test('eating deletes exactly once even if mouth continues reporting entity', () => {
  const m = new CatModel(new SequenceRng([0]));
  const food = {id: 'food-a', type: 'food', distance: 0};
  m.targets = [food]; m.mouthEntity = food; m.startEating(food);
  for (let i = 0; i < 10; i++) m.tickSecond();
  assert.deepEqual(m.deleted, ['food-a']);
});

test('treat rolling quota allows five and blocks the sixth for three minutes', () => {
  const m = new CatModel();
  m.treatTimes = [1, 2, 3, 4, 5]; m.time = 100;
  assert.equal(m.canTakeTreat(), false);
  m.time = 185;
  assert.equal(m.canTakeTreat(), true, 'oldest treats age out of the rolling window');
});

test('failed target is cooled down and another target can be selected', () => {
  const m = new CatModel();
  const a = {id: 'food-a', type: 'food', distance: 20};
  const b = {id: 'food-b', type: 'food', distance: 40};
  m.targets = [a, b]; m.target = a; m.failTarget();
  assert.equal(m.nearest(['food']).id, 'food-b');
  m.time += 30;
  assert.equal(m.nearest(['food']).id, 'food-a');
});

test('automatic learning stays bounded and decays toward neutral', () => {
  const m = new CatModel();
  for (let i = 0; i < 100; i++) m.reward('play', 2);
  assert.equal(m.preferences.play, 20);
  for (let i = 0; i < 100; i++) m.punish('food', 2);
  assert.equal(m.preferences.food, -20);
  m.time = 29; m.setState(S.RELAX, 100);
  m.tickSecond();
  assert.equal(m.preferences.play, 19.9);
  assert.equal(m.preferences.food, -19.9);
});

test('relationships are isolated per player', () => {
  const m = new CatModel();
  m.needs.social = 80;
  m.pet('alice');
  assert(m.relation('alice').affection > 0);
  assert.deepEqual(m.relation('bob'), {affection: 0, irritation: 0});
  m.time = 10; m.needs.social = 0; m.pet('bob');
  assert(m.relation('bob').irritation > 0);
  assert.equal(m.relation('alice').irritation, 0);
});

test('petting wakes sleep, presents for two seconds, and purrs', () => {
  const m = new CatModel();
  m.setState(S.SLEEP, 50);
  m.needs.social = 80;
  m.pet('alice');
  assert.equal(m.state, S.PETTED);
  assert.equal(m.outputs().purr, true);
  m.tickSecond(); assert.equal(m.state, S.PETTED);
  m.tickSecond(); assert.notEqual(m.state, S.PETTED);
});

test('/cat follows the actual caller in range and ignores distant caller', () => {
  const m = new CatModel();
  m.targets = [{id: 'alice', type: 'player', distance: 600}, {id: 'bob', type: 'player', distance: 1300}];
  assert.equal(m.call('bob'), false);
  assert.equal(m.call('alice'), true);
  assert.equal(m.state, S.FOLLOW);
  assert.equal(m.target.id, 'alice');
});

test('obstacle recovery preserves goal and cannot reverse into rear wall', () => {
  const m = new CatModel();
  const target = {id: 'food', type: 'food', distance: 200};
  m.setState(S.SEEK_FOOD, 60, target);
  let out = m.motionTick({center: true});
  assert.equal(out.drive, -0.35);
  assert.equal(m.target.id, 'food');
  out = m.motionTick({rear: true});
  assert.equal(out.drive, 0);
  assert.equal(m.target.id, 'food');
  m.motionTick(); m.motionTick(); m.motionTick();
  assert.equal(m.recoveryTicks, 0);
  assert(m.motionTick().drive > 0, 'normal pursuit resumes after bounded recovery');
});

test('side-only obstacle steers away without unnecessary reverse', () => {
  const m = new CatModel();
  m.setState(S.ROAM, 10);
  const left = m.motionTick({left: true});
  const right = m.motionTick({right: true});
  assert(left.drive > 0 && right.drive > 0);
  assert(left.steer > 0 && right.steer < 0);
});

test('sleep freezes other needs and leads to stretch', () => {
  const m = new CatModel();
  Object.assign(m.needs, {hunger: 40, sleep: 6, boredom: 20, social: 30});
  m.setState(S.SLEEP, 50);
  m.tickSecond();
  assert.equal(m.needs.hunger, 40);
  assert.equal(m.needs.boredom, 20);
  m.tickSecond();
  assert.equal(m.state, S.STRETCH);
  const o = m.outputs();
  assert(o.drive < 0 && o.frontSuspension < o.rearSuspension);
});

test('ignored pet request causes irritation and anger', () => {
  const m = new CatModel();
  const player = {id: 'alice', type: 'player', distance: 20};
  m.setState(S.WAIT_PETS, 1, player);
  m.tickSecond();
  assert.equal(m.state, S.ANGRY);
  assert(m.relation('alice').irritation > 0);
  const o = m.outputs();
  assert.equal(o.color, 'red');
  assert.equal(o.frontSuspension, 100);
  assert.equal(o.rearSuspension, 100);
});

test('all states publish coherent bounded outputs', () => {
  const m = new CatModel();
  for (const state of Object.values(S)) {
    m.setState(state, 10, state.includes('SEEK') || [S.FOLLOW, S.STALK, S.CHASE, S.FLEE, S.RETURN_HOME]
      .includes(state) ? {id: 'target', type: 'player', distance: 100} : null);
    const o = m.outputs();
    assert(o.face.length > 0 && o.stateText === state && o.color.length > 0, state);
    assert(o.drive >= -1 && o.drive <= 1, state);
    assert(o.steer >= -1 && o.steer <= 1, state);
    assert(o.speed >= 0 && o.speed <= 300, state);
    assert(o.headAngle >= -55 && o.headAngle <= 55, state);
    assert(o.frontSuspension >= 0 && o.frontSuspension <= 1000, state);
    assert(o.rearSuspension >= 0 && o.rearSuspension <= 1000, state);
  }
});

test('long no-target soak moves, changes state, and never parks permanently', () => {
  const sequence = [];
  for (let i = 0; i < 200; i++) sequence.push(i % 2 ? 99 : 0, 6);
  const m = new CatModel(new SequenceRng(sequence));
  // Keep safety needs below threshold so the soak exercises the ordinary pool.
  for (let i = 0; i < 180; i++) {
    if (m.needs.hunger >= 95) m.needs.hunger = 20;
    if (m.needs.sleep >= 95) m.needs.sleep = 20;
    m.tickSecond();
    for (let j = 0; j < 5; j++) m.motionTick();
  }
  assert(m.statesVisited.has(S.ROAM));
  assert(m.statesVisited.has(S.RELAX));
  assert(m.driveHistory.some(v => v > 0));
  let longestZero = 0, run = 0;
  for (const v of m.driveHistory) {
    run = v === 0 ? run + 1 : 0;
    longestZero = Math.max(longestZero, run);
  }
  assert(longestZero <= 25 * 5 + 5, `unexpected permanent park: ${longestZero} motion ticks`);
});

console.log(JSON.stringify({
  ok: true,
  tests,
  contract: 'full autonomous learning cat behavior model',
  covered: [
    'critical priorities', 'goal commitment', 'exact eating identity', 'treat quota',
    'target cooldown', 'bounded learning', 'per-player memory', 'pet overlay',
    'chat caller', 'obstacle recovery', 'sleep freeze/stretch', 'anger',
    'presentation/output bounds', 'long-run liveness',
  ],
}, null, 2));

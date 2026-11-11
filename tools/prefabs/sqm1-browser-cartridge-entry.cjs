'use strict';

const core = require('./sqm1-browser-cartridge-core.cjs');

globalThis.SQM1Cartridge = Object.freeze({
  buildAutomaticCartridge: core.buildAutomaticCartridge,
  normalizeScoreValues: core.normalizeScoreValues,
  constants: core.constants,
});

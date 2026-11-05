'use strict';
const assert=require('assert/strict'),fs=require('fs'),validate=require('./validate-placement.cjs');
const p1=require('./build-placement-probe.cjs')(),r1=validate(p1.bytes);assert.equal(r1.confirmedPairs.length,24);assert.equal(r1.uncertainPairs.length,0);assert.equal(r1.components.length,24);
const returned=process.argv[2];if(returned){const rr=validate(fs.readFileSync(returned));assert.equal(rr.confirmedPairs.length,0,'Returned Probe 1 contains no box overlaps');}
const p2=require('./build-placement-probe-v2.cjs')(),r2=validate(p2.bytes);assert(r2.confirmedPairs.length>=48);assert(r2.uncertainPairs.length>=10);assert(r2.components.some(c=>c.members.length===3),'Detect overlap graph chains');
console.log(JSON.stringify({probe1:{confirmed:r1.confirmedPairs.length,components:r1.components.length},probe2:{confirmed:r2.confirmedPairs.length,uncertain:r2.uncertainPairs.length,components:r2.components.length},nativeAssets:r2.catalogue.assets},null,2));

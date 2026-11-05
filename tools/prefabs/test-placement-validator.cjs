'use strict';
const assert=require('assert/strict'),fs=require('fs'),validate=require('./validate-placement.cjs');
const {makeConvex,convexIntersects}=require('./brick-shapes.cjs');
const p1=require('./build-placement-probe.cjs')(),r1=validate(p1.bytes);assert.equal(r1.confirmedPairs.length,24);assert.equal(r1.uncertainPairs.length,0);assert.equal(r1.components.length,24);
const returned=process.argv[2];if(returned){const rr=validate(fs.readFileSync(returned));assert.equal(rr.confirmedPairs.length,0,'Returned Probe 1 contains no box overlaps');}
const p2=require('./build-placement-probe-v2.cjs')(),r2=validate(p2.bytes);assert(r2.confirmedPairs.length>=48);assert(r2.uncertainPairs.length>=10);assert(r2.components.some(c=>c.members.length===3),'Detect overlap graph chains');
console.log(JSON.stringify({probe1:{confirmed:r1.confirmedPairs.length,components:r1.components.length},probe2:{confirmed:r2.confirmedPairs.length,uncertain:r2.uncertainPairs.length,components:r2.components.length},nativeAssets:r2.catalogue.assets},null,2));
const ramp=makeConvex({asset:'PB_DefaultRamp',size:[10,5,6],position:[0,0,0],direction:4,rotation:0});
const aboveLowEnd=makeConvex({asset:'PB_DefaultBrick',size:[2,2,2],position:[-7,0,4],direction:4,rotation:0});
const inHighEnd=makeConvex({asset:'PB_DefaultBrick',size:[2,2,2],position:[7,0,0],direction:4,rotation:0});
assert.equal(convexIntersects(ramp,aboveLowEnd),false,'box inside the empty half of a ramp envelope is separate');
assert.equal(convexIntersects(ramp,inHighEnd),true,'box cutting the solid half of a ramp intersects');
const inverted=makeConvex({asset:'PB_DefaultRampInverted',size:[10,5,6],position:[0,0,0],direction:4,rotation:0});
assert.equal(convexIntersects(ramp,inverted),false,'matching ramp and inverted ramp only share their slope plane');
for(let direction=0;direction<6;direction++)for(let rotation=0;rotation<4;rotation++){
 const a=makeConvex({asset:'PB_DefaultRamp',size:[10,5,6],position:[20,-30,40],direction,rotation});
 const b=makeConvex({asset:'PB_DefaultRamp',size:[10,5,6],position:[20,-30,40],direction,rotation});
 assert.equal(convexIntersects(a,b),true,`rotated ramp ${direction}/${rotation} intersects itself`);
}

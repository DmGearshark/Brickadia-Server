// Brickadia's discrete orientation maps, cross-checked against Omegga 1.21.1
// util/brick/constants.js (https://github.com/brickadia-community/omegga).
// This module intentionally does NOT invent native-asset or wedge collision meshes.
'use strict';
const transforms=[
 ([x,y,z])=>[z,-y,x],([x,y,z])=>[z,-x,-y],([x,y,z])=>[z,y,-x],([x,y,z])=>[z,x,y],
 ([x,y,z])=>[-z,y,x],([x,y,z])=>[-z,x,-y],([x,y,z])=>[-z,-y,-x],([x,y,z])=>[-z,-x,y],
 ([x,y,z])=>[y,z,x],([x,y,z])=>[x,z,-y],([x,y,z])=>[-y,z,-x],([x,y,z])=>[-x,z,y],
 ([x,y,z])=>[-y,-z,x],([x,y,z])=>[-x,-z,-y],([x,y,z])=>[y,-z,-x],([x,y,z])=>[x,-z,y],
 ([x,y,z])=>[x,y,z],([x,y,z])=>[-y,x,z],([x,y,z])=>[-x,-y,z],([x,y,z])=>[y,-x,z],
 ([x,y,z])=>[-x,y,-z],([x,y,z])=>[y,x,-z],([x,y,z])=>[x,-y,-z],([x,y,z])=>[-y,-x,-z],
];
function orient(vector,direction=4,rotation=0){
 if(!Number.isInteger(direction)||direction<0||direction>5||!Number.isInteger(rotation)||rotation<0||rotation>3)throw Error('Invalid brick orientation');
 return transforms[direction*4+rotation](vector);
}
function orientedHalfExtents(size,direction=4,rotation=0){return orient(size,direction,rotation).map(Math.abs);}
const exactCuboids=new Set(['PB_DefaultMicroBrick','PB_DefaultBrick']);
function envelope(brick){
 if(!Array.isArray(brick.size)||brick.size.length!==3||brick.size.every(v=>v===0))throw Error(`Intrinsic asset bounds unavailable: ${brick.asset}`);
 return {position:brick.position,size:orientedHalfExtents(brick.size,brick.direction??4,brick.rotation??0),exact:exactCuboids.has(brick.asset)};
}
function intersectsEnvelopes(a,b){return a.position.every((p,i)=>Math.abs(p-b.position[i])<a.size[i]+b.size[i]);}
function contact(a,b){
 const overlap=a.position.map((p,i)=>a.size[i]+b.size[i]-Math.abs(p-b.position[i]));
 return overlap.every(v=>v>=0)&&overlap.filter(v=>v>0).length>=2;
}
function relation(a,b){
 const x=envelope(a),y=envelope(b);
 if(!intersectsEnvelopes(x,y))return contact(x,y)?'contact':'separate';
 return x.exact&&y.exact?'solid-overlap':'envelope-overlap-shape-unknown';
}
module.exports={orient,orientedHalfExtents,envelope,intersectsEnvelopes,contact,relation};

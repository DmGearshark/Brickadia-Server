// Brickadia's discrete orientation maps, cross-checked against Omegga 1.21.1
// util/brick/constants.js (https://github.com/brickadia-community/omegga).
// Convex ramp geometry follows Brickadia's cooked PB_DefaultRamp asset and its
// BRS half-extents. Assets whose cooked mesh is not yet decoded stay envelopes.
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
const cuboids=new Set(['PB_DefaultMicroBrick','PB_DefaultBrick','PB_DefaultTile','PB_DefaultSmoothTile']);
const rampAssets=new Set(['PB_DefaultRamp','PB_DefaultRampInverted']);
const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function makeConvex(brick){
 const {asset,size,position,direction=4,rotation=0}=brick;if(!size?.some(Boolean))return null;let vertices,faces;
 const [x,y,z]=size;
 if(cuboids.has(asset)){
  vertices=[[-x,-y,-z],[-x,-y,z],[-x,y,-z],[-x,y,z],[x,-y,-z],[x,-y,z],[x,y,-z],[x,y,z]];
  faces=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
 }else if(rampAssets.has(asset)){
  vertices=[[-x,-y,-z],[-x,y,-z],[x,-y,-z],[x,y,-z],[x,-y,z],[x,y,z]];
  // The inverted ramp keeps the visible slope direction while moving the
  // solid volume above it, which mirrors both the local run and height axes.
  if(asset==='PB_DefaultRampInverted')vertices=vertices.map(([a,b,c])=>[-a,b,-c]);
  faces=[[0,2,3,1],[2,4,5,3],[0,1,5,4],[0,4,2],[1,3,5]];
 }else return null;
 vertices=vertices.map(v=>orient(v,direction,rotation).map((n,i)=>n+position[i]));
 const normals=faces.map(f=>cross(sub(vertices[f[1]],vertices[f[0]]),sub(vertices[f[2]],vertices[f[0]])));
 const edgeKeys=new Set(),edges=[];for(const face of faces)for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],key=a<b?`${a}:${b}`:`${b}:${a}`;if(!edgeKeys.has(key)){edgeKeys.add(key);edges.push(sub(vertices[b],vertices[a]));}}
 return {vertices,normals,edges};
}
function convexIntersects(a,b){
 const axes=[...a.normals,...b.normals];for(const x of a.edges)for(const y of b.edges)axes.push(cross(x,y));
 for(const axis of axes){if(dot(axis,axis)<1e-12)continue;let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;for(const v of a.vertices){const p=dot(v,axis);amin=Math.min(amin,p);amax=Math.max(amax,p);}for(const v of b.vertices){const p=dot(v,axis);bmin=Math.min(bmin,p);bmax=Math.max(bmax,p);}if(amax<=bmin+1e-9||bmax<=amin+1e-9)return false;}
 return true;
}
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
module.exports={orient,orientedHalfExtents,envelope,intersectsEnvelopes,contact,relation,makeConvex,convexIntersects};

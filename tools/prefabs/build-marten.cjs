'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {World,WorldReader}=require('brs-js');
const shapes=require('./brick-shapes.cjs');
const {addMechanics}=require('./rally-mechanics.cjs');

const output=process.argv[2];
if(!output)throw Error('Usage: node build-marten.cjs output.brz');
const w=new World(), mechanical=addMechanics(w);
const IVORY=[207,203,183],RED=[135,35,43],DARK=[28,33,38];
const GLASS=[65,108,125],CHROME=[153,163,167],LAMP=[255,231,166];
const body=[];
function part(tag,position,size,color=IVORY,opts={}){
 const record={tag,asset:'PB_DefaultMicroBrick',position,size,color,material:'BMC_Plastic',direction:4,rotation:0,...opts};
 assert(size.every(v=>Number.isInteger(v)&&v>0),tag+' has invalid half-size');
 assert(position.every(Number.isInteger),tag+' is off the 0.1 placement grid');
 body.push(record);return record;
}
function box(tag,x,y,z,sx,sy,sz,color=IVORY,opts={}){return part(tag,[x,y,z],[sx,sy,sz],color,opts);}
function slope(tag,x,y,z,depth,width,height,rotation,color=IVORY,asset='PB_DefaultWedge'){
 return part(tag,[x,y,z],[depth,width,height],color,{asset,rotation});
}
for(const s of [-1,1]){
 // Proven adjacency to the reference seats; do not add a floor beneath them.
 box('lower side rail',s*20,0,-14,5,25,6,DARK);
 box('structural door',s*23,0,0,2,15,8);
 box('door skin',s*26,0,0,1,15,8,IVORY,{collision:{player:true,weapon:true,interaction:true,physics:false}});
 box('door cap',s*24,-3,10,3,18,2);
 box('door handle',s*28,0,6,1,4,1,DARK);
 for(const y of [-19,19])box('sill transition',s*25,y,2,2,4,2,DARK);
 for(const y of [-40,40]){
  box('black arch lip',s*27,y,1,3,17,1,DARK);
  box('flared fender',s*26,y,3,3,17,1);
 }
 // Native pillar templates, shifted outwards to widen the cabin.
 box('front pillar foot',s*24,25,8,3,10,4);
 slope('sloping A pillar',s*24,25,22,10,3,10,1,IVORY,'PB_DefaultRamp');
 box('rear pillar foot',s*24,-30,8,3,8,4);
 slope('sloping C pillar',s*24,-30,22,8,3,10,3,RED,'PB_DefaultRamp');
 box('side glazing',s*25,-3,22,1,18,10,GLASS,{material:'BMC_Glass'});
 box('window top seal',s*25,-4,33,1,18,1,DARK);
 box('mirror stem',s*28,18,10,1,2,1,DARK);
 box('mirror housing',s*31,18,10,2,3,2,RED);
 box('mirror face',s*31,14,10,1,1,1,CHROME,{material:'BMC_Metallic'});
 box('front mud flap',s*28,21,-12,3,1,12,DARK);
 box('rear mud flap bracket',s*26,-59,2,3,1,2,DARK);
 box('rear mud flap',s*26,-59,-12,3,1,12,DARK);
}
// Five flush strips form each sloping deck; stripes replace material rather
// than intersecting it. Depth is local X, rotated onto the vehicle's Y axis.
for(const [x,halfWidth,color]of [[-24,5,IVORY],[-11,8,IVORY],[0,3,DARK],[11,8,IVORY],[24,5,IVORY]]){
 slope('sloped bonnet',x,55,8,18,halfWidth,4,1,color);
 slope('rear hatch deck',x,-55,8,17,halfWidth,4,3,color);
}
box('front fascia',0,74,-2,29,3,6);
box('rear fascia',0,-74,-2,29,3,6);
box('front bumper',0,78,-9,30,2,1,DARK);
box('rear bumper',0,-78,-9,30,2,1,DARK);
box('grille surround',0,78,0,13,1,2,DARK);
for(const x of [-9,-6,-3,0,3,6,9])box('grille blade',x,80,0,1,1,2,CHROME,{material:'BMC_Metallic'});
for(const x of [-21,21]){
 box('headlamp',x,78,0,5,1,2,LAMP,{material:'BMC_Glow',material_intensity:8});
 box('tail lamp',x,-78,0,5,1,2,[220,35,35],{material:'BMC_Glow',material_intensity:6});
}
box('front accent line',0,78,3,29,1,1,RED);
box('rear plate',0,-78,-2,8,1,3,[225,225,210]);
// Thin stepped glazing follows the slanted pillars. Consecutive strips share
// a face, not volume; no synthetic wedge collision mesh is assumed.
for(let z=13;z<=31;z+=2){
 box('windscreen',0,48-z,z,21,2,1,GLASS,{material:'BMC_Glass'});
 box('rear window',0,Math.round(-38+0.8*(z-12)),z,21,2,1,GLASS,{material:'BMC_Glass'});
}
box('front roof header',0,16,33,27,2,1,RED);
box('rear roof header',0,-24,33,27,2,1,RED);
for(const [x,sx,color]of [[-14,11,RED],[0,3,IVORY],[14,11,RED]])box('roof',x,-5,35,sx,21,1,color);
slope('roof intake',0,0,38,8,7,2,1,DARK);
// A dashboard is forward of the seats, not inserted into their occupied space.
box('dashboard',0,20,9,21,2,2,DARK);
for(const x of [-10,10])box('instrument pod',x,17,10,3,1,1,CHROME);
for(const x of [-12,12]){
 for(const dx of [-2,2])box('tow loop side',x+dx,81,-7,1,1,2,RED);
 box('tow loop base',x,81,-10,1,1,1,RED);
}
// Classify every pair honestly: cuboids are exact, unknown slope meshes are
// not silently considered collision-free merely because our library reads them.
const uncertain=[];
for(let i=0;i<body.length;i++)for(let j=0;j<i;j++){
 const rel=shapes.relation(body[i],body[j]);
 assert.notEqual(rel,'solid-overlap',`Body overlap ${i} ${body[i].tag} / ${j} ${body[j].tag}`);
 if(rel==='envelope-overlap-shape-unknown')uncertain.push([i,j]);
}
// No novel geometry is allowed inside the central chassis, engine, or the
// conservative seated cockpit region. Native side rails are the explicit
// original-working exception, retained with their exact geometry.
const reserved=[
 {asset:'PB_DefaultMicroBrick',position:[0,-5,-14],size:[15,50,6]},
 {asset:'PB_DefaultMicroBrick',position:[0,40,-6],size:[5,5,2]},
 ...[-10,10].map(x=>({asset:'PB_DefaultMicroBrick',position:[x,0,3],size:[10,15,11]})),
];
const clearanceUnknown=[];
for(const p of body)for(const z of reserved){
 const rel=shapes.relation(p,z);
 assert.notEqual(rel,'solid-overlap',`Mechanical clearance: ${p.tag}`);
 if(rel==='envelope-overlap-shape-unknown')clearanceUnknown.push(p.tag);
}
const envelopes=body.map(shapes.envelope);
envelopes.push(shapes.envelope(reserved[0]));
const connected=new Set([body.length]);let grew=true;
while(grew){grew=false;for(let i=0;i<body.length;i++)if(!connected.has(i)&&[...connected].some(j=>shapes.contact(envelopes[i],envelopes[j]))){connected.add(i);grew=true;}}
assert.equal(connected.size,body.length+1,'Disconnected body pieces: '+body.filter((_,i)=>!connected.has(i)).map(p=>p.tag).join(', '));
for(const p of body){const {tag,...brick}=p;w.addBrick(brick);}
// Explicit native-style bounds include the wheel entities below the body.
// A main-grid-only automatic box would omit the tyres' lower radius.
const pivot=()=>({center:{x:0,y:0,z:0},halfExtent:{x:40,y:90,z:40}});
const prefab={pivots:{bottomStudsPivot:pivot(),studsExpandedPivot:pivot(),topStudsPivot:pivot(),boundsPivot:pivot(),bottomStudsDirection:'Z_Negative',topStudsDirection:'Z_Positive',bBottomStudsValid:true,bTopStudsValid:true},addedGlobalGridOffset:{x:0,y:0,z:0},bIsPhysicsGrid:true,bFreezePhysicsGrid:false,bFreezeGlobalGrid:false,bIsMicrochipPrefab:false};
let bytes=w.toBrz({bundle:{name:'Marten R4 Rally Coupe',description:'Original ivory and burgundy rally coupe, sloped bonnet and hatch, flared fenders, glazed cabin, mud flaps and tow loops.'},externalAssets:mechanical.externalAssets||[],prefab});
if(mechanical.finalizeArchive)bytes=mechanical.finalizeArchive(bytes);
const r=WorldReader.from(bytes);
const bs=[...r.bricks()];assert.equal(bs.length,body.length+mechanical.brickCount);
const counts={};for(const ch of r.brickChunkIndex())if(ch.numComponents)for(const c of r.componentChunk(1,ch.index).components)counts[c.typeName]=(counts[c.typeName]||0)+1;
assert.equal(counts.Component_Internal_Seat,2);assert.equal(counts.Component_Internal_WheelEngine,1);
assert.equal(r.prefabJson().bIsPhysicsGrid,true);
const canonical=br=>JSON.stringify({asset:br.asset,position:br.position,size:br.size,color:br.color,direction:br.direction??4,rotation:br.rotation??0,material:br.material??'BMC_Plastic'});
const actual=new Map();
for(const br of bs){const key=canonical({...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index]});actual.set(key,(actual.get(key)||0)+1);}
for(const br of body){const key=canonical(br);assert((actual.get(key)||0)>0,'Body readback mismatch: '+br.tag);actual.set(key,actual.get(key)-1);}
fs.writeFileSync(output,bytes);
console.log(JSON.stringify({output,bodyBricks:body.length,mainGridBricks:bs.length,totalEntities:[...r.entities()].length,components:counts,shapeEnvelopePairsNeedingGameValidation:uncertain,clearanceUnknown,bytes:bytes.length},null,2));

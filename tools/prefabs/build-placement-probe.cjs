'use strict';
const fs=require('fs'),{World,brdb:b}=require('brs-js');
const {metadata}=require('./loadboard-lib.cjs');
const C=b.COMPONENTS;
const tests=[];
const w=new World();
const mat='BMC_Plastic';
const baseColor=[42,78,112],probeColor=[230,120,35],labelColor=[18,25,38];
const font={Font:0,Face:0,LineHeight:1.6,WidthScale:.8,Color:{R:240,G:245,B:255,A:255},bOverrideColor:true,Material:2,Outline:1,OutlineWidth:1,Anchor:{X:.5,Y:.5}};
function addBrick(asset,size,position,color,direction=4,rotation=0,extra={}){
 return w.addBrick({asset,size,position,color,material:mat,direction,rotation,...extra});
}
function addCase(id,description,a,b){
 const col=tests.length%6,row=Math.floor(tests.length/6),ox=col*90,oy=row*92;
 const origin=[ox,oy,16];
 const A={asset:'PB_DefaultMicroBrick',size:[10,10,10],position:[0,0,0],direction:4,rotation:0,...a};
 const B={asset:'PB_DefaultMicroBrick',size:[10,10,10],position:[20,0,0],direction:4,rotation:0,...b};
 const tag=part=>({type:C.TextDisplay.NAME,data:{...font,Text:`PP|${id}|${part}`,bEnabled:false}});
 const ah=addBrick(A.asset,A.size,origin.map((v,i)=>v+A.position[i]),baseColor,A.direction,A.rotation,{components:[tag('Base')]});
 const bh=addBrick(B.asset,B.size,origin.map((v,i)=>v+B.position[i]),probeColor,B.direction,B.rotation,{components:[tag('Probe')]});
 addBrick('PB_DefaultMicroBrick',[28,2,5],[ox+10,oy-28,7],labelColor,4,0,{components:[{type:C.TextDisplay.NAME,data:{...font,Text:`${id}\r\n${description}`}}]});
 tests.push({id,description,base:{...A,worldPosition:origin.map((v,i)=>v+A.position[i])},probe:{...B,worldPosition:origin.map((v,i)=>v+B.position[i])}});
 return {ah,bh};
}
// Axis-aligned cubes: Brickadia units are 0.1 studs and size values are half-extents.
for(const d of [22,21,20,19,18,15,10,1,0])addCase(`X${String(d).padStart(2,'0')}`,`cubes X separation ${d}`,{}, {position:[d,0,0]});
for(const d of [22,21,20,19,18,15,10,1,0])addCase(`Z${String(d).padStart(2,'0')}`,`cubes Z separation ${d}`,{}, {position:[0,0,d]});
// Thin plates establish whether face contact and sub-brick overlap differ by thickness.
for(const d of [4,3,2,1,0])addCase(`PZ${d}`,`plates Z separation ${d}`,{size:[10,10,1]},{size:[10,10,1],position:[0,0,d]});
for(const d of [4,3,2,1,0])addCase(`PX${d}`,`thin walls X separation ${d}`,{size:[1,10,10]},{size:[1,10,10],position:[d,0,0]});
// Rectangles rotated in plane. These expose whether collision uses oriented or unrotated bounds.
for(const [id,d,rot]of [['R20',20,1],['R16',16,1],['R12',12,1],['R08',8,1],['R00',0,1]])addCase(id,`20x4 bars; probe rot 90; X ${d}`,{size:[10,2,2]},{size:[10,2,2],position:[d,0,0],rotation:rot});
// Direction changes put the long axis on another plane.
for(const [i,d]of [22,20,18,12,0].entries())addCase(`D${String(d).padStart(2,'0')}`,`bar direction 0; X ${d}`,{size:[10,2,2]},{size:[10,2,2],position:[d,0,0],direction:0,rotation:0});
// Containment and partial intersection with unequal shapes.
addCase('C00','small cube fully inside large',{size:[12,12,12]},{size:[2,2,2],position:[0,0,0]});
addCase('C10','small cube inside near edge',{size:[12,12,12]},{size:[2,2,2],position:[10,0,0]});
addCase('C14','small cube face contact outside',{size:[12,12,12]},{size:[2,2,2],position:[14,0,0]});
addCase('C13','small cube overlaps edge by 1',{size:[12,12,12]},{size:[2,2,2],position:[13,0,0]});
addCase('REV','large probe over small base',{size:[2,2,2]},{size:[12,12,12],position:[0,0,0]});
// Non-default assets test whether collision behavior differs from the default microbrick.
for(const [i,d]of [22,20,19,0].entries())addCase(`G${String(d).padStart(2,'0')}`,`gate brick vs cube X ${d}`,{}, {asset:C.Var.BRICK,size:[10,5,2],position:[d,0,0]});
// A large instruction board is intentionally remote from every specimen.
addBrick('PB_DefaultMicroBrick',[150,3,12],[225,-70,14],[12,18,28],4,0,{components:[{type:C.TextDisplay.NAME,data:{...font,LineHeight:2,Text:'BRICK PLACEMENT PROBE\r\nPaste once into an empty area. Do not move individual bricks.\r\nCopy the placed result and return that .brz file.'}}]});
const maxRow=Math.ceil(tests.length/6);
const bytes=w.toBrz({prefab:metadata({x:280,y:maxRow*48+90,z:40}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Brick Placement Probe',description:`${tests.length} isolated two-brick collision cases. Orange is always inserted after blue. Return the pasted result for automated comparison.`}});
function build(){return {bytes,tests};}
module.exports=build;
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-placement-probe.cjs output.brz [manifest.json]');fs.writeFileSync(out,bytes);if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({version:1,tests},null,2));console.log(JSON.stringify({output:out,cases:tests.length,bricks:tests.length*3+1},null,2));}

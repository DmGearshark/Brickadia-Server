'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),wood1=[77,43,31],wood2=[96,52,35],wood3=[60,33,28],leaf1=[35,75,47],leaf2=[48,94,55],leaf3=[67,112,63],leaf4=[29,63,42];let count=0;
function add(size,position,color,rotation=0){w.addBrick({asset:'PB_DefaultMicroBrick',size,position,direction:4,rotation,color,material:'BMC_Plastic'});count++;}
// Tapered, color-varied central trunk.
for(const [size,z,c]of [[[6,6,10],10,wood3],[[6,6,10],30,wood1],[[5,5,10],50,wood2],[[5,5,10],70,wood1],[[4,4,8],88,wood2],[[3,3,5],101,wood3]])add(size,[0,0,z],c);
// Four broad roots with narrower tips; all meet at exact faces.
for(const s of [-1,1]){add([14,3,3],[s*20,0,3],s>0?wood2:wood1);add([8,2,2],[s*42,0,2],wood3);add([3,14,3],[0,s*20,3],s>0?wood1:wood2);add([2,8,2],[0,s*42,2],wood3);}
// Corner buttresses add an irregular grounded base without intersecting roots.
for(const [x,y,c]of [[9,9,wood2],[-9,9,wood1],[9,-9,wood1],[-9,-9,wood3]])add([3,3,5],[x,y,5],c);
// Primary branches below the canopy, staggered vertically.
const branches=[
 {size:[20,3,3],p:[25,0,59],c:wood2,end:[45,0]},
 {size:[18,3,3],p:[-23,0,67],c:wood1,end:[-41,0]},
 {size:[3,19,3],p:[0,24,51],c:wood3,end:[0,43]},
 {size:[3,17,3],p:[0,-22,69],c:wood2,end:[0,-39]},
];
for(const b of branches)add(b.size,b.p,b.c);
add([3,3,7],[45,0,69],wood2); add([3,3,3],[-41,0,73],wood1);
add([3,3,11],[0,43,65],wood3); add([3,3,2],[0,-39,74],wood2);
// Secondary branches form visible forks beneath the leaves.
add([3,12,2],[45,15,65],wood1); add([3,10,2],[45,-13,61],wood3);
add([3,11,2],[-41,14,69],wood2); add([3,9,2],[-41,-12,65],wood3);
add([11,3,2],[14,43,53],wood1); add([9,3,2],[-12,43,49],wood2);
add([10,3,2],[13,-39,67],wood3); add([8,3,2],[-11,-39,71],wood1);
// Irregular tiled canopy. Layers touch vertically, so horizontal offsets and
// gaps can change the silhouette without creating intersections.
const layers=[
 {z:82,cells:[[-2,-1],[-2,0],[-2,1],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[0,-2],[0,-1],[0,1],[0,2],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,-1],[2,0]]},
 {z:92,cells:[[-2,0],[-2,1],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[0,-2],[0,-1],[0,1],[0,2],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,-1],[2,0],[2,1]]},
 {z:102,cells:[[-2,0],[-1,-1],[-1,0],[-1,1],[0,-2],[0,-1],[0,1],[0,2],[1,-1],[1,0],[1,1],[2,0]]},
 {z:112,cells:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1]]},
 {z:122,cells:[[-1,0],[0,-1],[0,0],[0,1],[1,0]]},
];
const palette=[leaf1,leaf2,leaf3,leaf4];
for(const [li,layer]of layers.entries())for(const [i,[gx,gy]]of layer.cells.entries())add([10,10,5],[gx*20+(li%2?3:-2),gy*20+(li===2?2:0),layer.z],palette[(i+li+Math.abs(gx)+Math.abs(gy))%palette.length]);
// Edge extensions meet the canopy at side faces; hanging tips meet its lower
// face. They alter the outline without intersecting the tiled crown.
for(const [size,p,c]of [
 [[5,10,5],[-57,0,82],leaf4],[[5,10,5],[53,0,82],leaf2],[[10,5,5],[-2,-55,82],leaf1],[[10,5,5],[-2,55,82],leaf3],
 [[5,10,5],[-52,20,92],leaf2],[[5,10,5],[58,-20,92],leaf4],[[10,5,5],[3,-55,92],leaf3],[[10,5,5],[3,55,92],leaf1],
 [[7,7,5],[-42,-20,72],leaf4],[[7,7,5],[38,20,72],leaf1],[[7,7,5],[-22,40,72],leaf2],[[7,7,5],[38,-20,72],leaf3]
])add(size,p,c);
const bytes=w.toBrz({prefab:metadata({x:68,y:68,z:130}),bundle:{name:'Mature Garden Tree',description:`A ${count}-brick mature tree with roots, tapered trunk, visible branch structure, layered irregular foliage, gaps, overhangs, and four foliage tones. Placement-preflight validated.`}});
module.exports=()=>({bytes,count});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-reference-tree.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:count},null,2));}

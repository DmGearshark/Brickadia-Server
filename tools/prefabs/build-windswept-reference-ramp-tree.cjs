'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),bark=[[69,36,24],[80,43,27],[91,50,30],[103,59,35]],leaves=[[31,67,38],[38,78,42],[45,89,44],[53,98,48],[62,106,51]];
let count=0,ramps=0,inverted=0;
function add(asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,color,material:'BMC_Plastic',direction,rotation});count++;ramps+=asset==='PB_DefaultRamp';inverted+=asset==='PB_DefaultRampInverted';}
const wood=i=>bark[i%bark.length],green=i=>leaves[i%leaves.length];

// One tapered trunk mass replaces the colliding opposed ramp shell.
add('PB_DefaultMicroBrick',[10,10,18],[0,0,18],wood(0));
add('PB_DefaultMicroBrick',[10,9,17],[0,0,53],wood(1));
add('PB_DefaultMicroBrick',[8,8,14],[1,0,84],wood(2));

// Short unequal root flares avoid the wagon-wheel footprint of the first tree.
const roots=[
 ['PB_DefaultRamp',[20,5,6],[30,0,6],0],['PB_DefaultRampInverted',[15,5,6],[-25,0,6],2],
 ['PB_DefaultRamp',[15,5,6],[0,25,6],1],['PB_DefaultRampInverted',[10,5,6],[0,-20,6],3]
];roots.forEach((r,i)=>add(r[0],r[1],r[2],wood(i+1),4,r[3]));

// Compact major limbs terminate beneath the crown and fork into leaf masses.
const limbs=[
 {axis:0,sign:1,z:66,parts:[20,15],fork:10,side:1},{axis:0,sign:-1,z:74,parts:[20,15],fork:10,side:-1},
 {axis:1,sign:1,z:82,parts:[15,15],fork:10,side:-1},{axis:1,sign:-1,z:88,parts:[15,10],fork:10,side:1},
 {axis:0,sign:1,z:94,parts:[15,10],fork:10,side:-1},{axis:0,sign:-1,z:98,parts:[15,10],fork:10,side:1}
];
let wi=10;
for(const [li,L] of limbs.entries()){
 const rot=L.axis===0?(L.sign>0?0:2):(L.sign>0?1:3),crossPositive=L.axis===0?1:0,crossNegative=L.axis===0?3:2;
 let edge=10;
 for(const [pi,half] of L.parts.entries()){
  const along=L.sign*(edge+half),p=L.axis===0?[along,0,L.z]:[0,along,L.z];
  add((li+pi)%3===0?'PB_DefaultRampInverted':'PB_DefaultRamp',[half,5,6-pi*2],p,wood(wi++),4,rot);edge+=half*2;
 }
 const end=L.sign*edge,offset=5+L.fork;
 const a=L.axis===0?[end,L.side*offset,L.z+2]:[L.side*offset,end,L.z+2];
 const b=L.axis===0?[end,-L.side*offset,L.z-2]:[-L.side*offset,end,L.z-2];
 add('PB_DefaultRamp',[L.fork,5,4],a,wood(wi++),4,L.side>0?crossPositive:crossNegative);
 add('PB_DefaultRampInverted',[L.fork,5,4],b,wood(wi++),4,L.side>0?crossNegative:crossPositive);
}

// Four thin offset layers form one broad asymmetric crown. The outline changes
// at every height, with no decorative spikes or repeated vertical columns.
const crown=[
 {z:110,dx:-4,dy:2,cells:[[-1,-2],[0,-2],[1,-2],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-3,0],[-2,0],[-1,0],[0,0],[1,0],[2,0],[3,0],[-2,1],[-1,1],[0,1],[1,1],[2,1],[-1,2],[0,2],[1,2]]},
 {z:118,dx:2,dy:-2,cells:[[-1,-2],[0,-2],[1,-2],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[3,0],[-2,1],[-1,1],[0,1],[1,1],[2,1],[-1,2],[0,2],[1,2]]},
 {z:126,dx:7,dy:1,cells:[[0,-2],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-1,1],[0,1],[1,1],[2,1],[0,2],[1,2]]},
 {z:134,dx:4,dy:4,cells:[[-1,-1],[0,-1],[1,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-1,1],[0,1],[1,1],[0,2]]}
];
let gi=0;
for(const [layer,L] of crown.entries())for(const [x,y] of L.cells){
 const edge=Math.abs(x)>=2||Math.abs(y)>=2,sx=edge?(gi%2?18:20):20,sy=edge?(gi%3?19:20):20;
 add('PB_DefaultMicroBrick',[sx,sy,4],[x*40+L.dx,y*40+L.dy,L.z],green(gi++ + layer*2));
}

const bytes=w.toBrz({prefab:metadata({x:140,y:115,z:140}),bundle:{name:'Broadfork Ramp Oak',description:`Original ${count}-brick broad oak with a compact ramp-built root and branch skeleton, ${ramps} standard ramps, ${inverted} inverted ramps, and a layered asymmetric crown.`}});
module.exports=()=>({bytes,count,ramps,inverted});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-windswept-reference-ramp-tree.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:count,ramps,inverted},null,2));}

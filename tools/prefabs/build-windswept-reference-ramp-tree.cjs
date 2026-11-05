'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),bark=[[62,32,24],[76,39,27],[91,48,30],[105,59,36]],leaf=[[29,66,39],[37,80,43],[48,96,48],[58,108,52],[70,119,57]];let count=0,ramps=0,inverted=0;
function add(asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,color,material:'BMC_Plastic',direction,rotation});count++;ramps+=asset==='PB_DefaultRamp';inverted+=asset==='PB_DefaultRampInverted';}
const wood=(n,p)=>bark[Math.abs(n+p[0]+p[1]+p[2])%bark.length],green=(n,p)=>leaf[Math.abs(n*3+p[0]+2*p[1]+p[2])%leaf.length];
// Six opposed ramp faces form a tall, subtly offset trunk. Each pair meets at
// a face and each tier meets the next without sharing positive solid volume.
const trunk=[
 ['PB_DefaultRamp',[10,5,20],[-10,0,20],0],['PB_DefaultRamp',[10,5,20],[10,0,20],2],
 ['PB_DefaultRampInverted',[10,5,20],[-10,0,60],0],['PB_DefaultRampInverted',[10,5,20],[10,0,60],2],
 ['PB_DefaultRamp',[5,5,16],[-5,0,96],0],['PB_DefaultRamp',[5,5,16],[5,0,96],2]
];trunk.forEach((x,i)=>add(x[0],x[1],x[2],wood(i,x[2]),4,x[3]));
// Unequal radial roots give the base a natural footprint rather than a cross.
const roots=[
 ['PB_DefaultRamp',[35,5,6],[55,0,6],0],['PB_DefaultRampInverted',[25,5,6],[-45,0,6],2],
 ['PB_DefaultRamp',[30,5,6],[0,35,6],1],['PB_DefaultRampInverted',[20,5,6],[0,-25,6],3],
 ['PB_DefaultRamp',[20,5,4],[110,0,4],0],['PB_DefaultRampInverted',[15,5,4],[-85,0,4],2],
 ['PB_DefaultRamp',[15,5,4],[0,80,4],1],['PB_DefaultRampInverted',[15,5,4],[0,-60,4],3]
];roots.forEach((x,i)=>add(x[0],x[1],x[2],wood(i+10,x[2]),4,x[3]));
// Six asymmetric primary limbs. Their first piece touches the appropriate
// trunk face; extensions, forks and tips meet only along their end faces.
const limbs=[
 {axis:'x',sign:1,z:54,lengths:[20,20],fork:20,asset:'PB_DefaultRamp'},
 {axis:'y',sign:-1,z:68,lengths:[20,15],fork:15,asset:'PB_DefaultRampInverted'},
 {axis:'x',sign:-1,z:82,lengths:[20,20],fork:20,asset:'PB_DefaultRamp'},
 {axis:'y',sign:1,z:96,lengths:[15,20],fork:15,asset:'PB_DefaultRampInverted'}
];
let wi=30;for(const [li,L]of limbs.entries()){
 const rot=L.axis==='x'?(L.sign>0?0:2):(L.sign>0?1:3),crossRot=L.axis==='x'?1:0,start=L.axis==='x'?20:5;let cursor=start;
 for(const half of L.lengths){const c=cursor+half,p=L.axis==='x'?[L.sign*c,L.side?L.side*10:0,L.z]:[L.side?L.side*10:0,L.sign*c,L.z];add(L.asset,[half,5,6],p,wood(wi++,p),4,rot);cursor+=half*2;}
 const end=L.sign*cursor;
 for(const side of [-1,1]){const p=L.axis==='x'?[end,side*(5+L.fork),L.z]:[side*(5+L.fork),end,L.z];add(side>0?'PB_DefaultRamp':'PB_DefaultRampInverted',[L.fork,5,4],p,wood(wi++,p),4,crossRot+(side<0?2:0));}
 const tipHalf=15,tipCenter=cursor+tipHalf,p=L.axis==='x'?[L.sign*tipCenter,L.side?L.side*10:0,L.z]:[L.side?L.side*10:0,L.sign*tipCenter,L.z];add(li%2?'PB_DefaultRampInverted':'PB_DefaultRamp',[tipHalf,5,4],p,wood(wi++,p),4,rot);
}
// A broad windswept crown, biased east and north. Cells use a 30-unit lattice
// and at most 15-unit half-extents, so neighboring masses touch without overlap.
const canopy=[
 {z:120,h:8,c:[[-2,-1],[-2,0],[-1,-2],[-1,-1],[-1,0],[-1,1],[0,-2],[0,-1],[0,0],[0,1],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,-1],[2,0],[2,1],[3,0]]},
 {z:136,h:8,c:[[-2,0],[-1,-1],[-1,0],[-1,1],[0,-2],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1],[1,2],[2,-1],[2,0],[2,1],[3,0],[3,1]]},
 {z:152,h:8,c:[[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1],[2,0],[2,1],[3,0]]},
 {z:168,h:8,c:[[0,0],[0,1],[1,-1],[1,0],[1,1],[2,0]]}
];
let gi=0;for(const [layer,L]of canopy.entries())for(const [gx,gy]of L.c){const sx=[12,15,13,10][(gi+gx+8)%4],sy=[10,13,15,12][(gi+gy+8)%4],p=[gx*30+layer*4+18,gy*30+(layer===1?5:0),L.z];add('PB_DefaultMicroBrick',[sx,sy,L.h],p,green(gi++,p));}
// Sparse shoots occupy exposed outer faces and top faces rather than piercing
// the canopy masses.
const shoots=[[30,0],[30,30],[60,-30],[60,0],[60,30],[90,0],[90,30],[30,30]];
for(const [i,[x,y]]of shoots.entries())add('PB_DefaultMicroBrick',[2+(i%2),2,5+(i%3)],[x+(i===7?-7:0),y+(i===7?6:0),181+(i%3)],green(i+90,[x,y,181]),4,i%4);
const bytes=w.toBrz({prefab:metadata({x:135,y:110,z:188}),bundle:{name:'Windswept Ramp Oak',description:`Original ${count}-brick mature tree using the reference tree's ramp-built trunk, root and branch vocabulary: ${ramps} standard ramps, ${inverted} inverted ramps, an asymmetric windswept canopy, and exposed supporting limbs.`}});
module.exports=()=>({bytes,count,ramps,inverted});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-windswept-reference-ramp-tree.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:count,ramps,inverted},null,2));}

'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),bark=[[64,34,27],[82,43,29],[101,55,34],[71,37,31]],leaf=[[28,67,43],[36,82,47],[48,99,52],[64,116,58],[42,91,61]];let count=0,ramps=0,inverted=0,poles=0;
function add(asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,direction,rotation,color,material:'BMC_Plastic'});count++;if(asset==='PB_DefaultRamp')ramps++;if(asset==='PB_DefaultRampInverted')inverted++;if(asset==='PB_DefaultPole')poles++;}
const wood=(i,p)=>bark[Math.abs(i+p[0]+p[1]+p[2])%bark.length],green=(i,p)=>leaf[Math.abs(i*3+p[0]+p[1]*2+p[2])%leaf.length];
// Three four-sided ramp tiers create a genuinely tapered trunk. Each ramp
// owns a quadrant and meets its neighbors only at faces.
for(const [tier,z,s,asset]of [[0,14,5,'PB_DefaultRamp'],[1,42,4,'PB_DefaultRampInverted'],[2,67,3,'PB_DefaultRamp']])for(const [i,[x,y]]of [[0,[-s,-s]],[1,[s,-s]],[2,[s,s]],[3,[-s,s]]])add(asset,[s,s,tier===2?11:14],[x,y,z],wood(i+tier,[x,y,z]),4,i);
add('PB_DefaultMicroBrick',[2,2,5],[0,0,83],bark[3]);
// Four long roots and four offset secondary roots use horizontal ramps. Their
// bounding volumes touch the trunk and one another without intersecting.
for(const [i,[dir,p,size]]of [
 [0,[0,[30,0,4],[4,4,20]]],[1,[1,[-30,0,4],[4,4,20]]],[2,[2,[0,30,4],[4,4,20]]],[3,[3,[0,-30,4],[4,4,20]]],
 [4,[0,[58,0,4],[4,3,8]]],[5,[1,[-58,0,4],[4,3,8]]],[6,[2,[0,58,4],[4,3,8]]],[7,[3,[0,-58,4],[4,3,8]]]
])add(i%2?'PB_DefaultRampInverted':'PB_DefaultRamp',size,p,wood(i,p),dir,i%4);
// Four primary branches at different heights. Secondary ramps fork sideways
// at their ends, leaving the branch network visible below the canopy.
const branchSets=[
 {dir:0,p:[31,0,63],size:[4,3,25],end:[56,0],z:63},
 {dir:1,p:[-30,0,70],size:[4,3,24],end:[-54,0],z:70},
 {dir:2,p:[0,31,54],size:[4,3,23],end:[0,54],z:54},
 {dir:3,p:[0,-28,76],size:[4,3,22],end:[0,-50],z:76},
];
for(const [i,b]of branchSets.entries()){
 add(i%2?'PB_DefaultRampInverted':'PB_DefaultRamp',b.size,b.p,wood(i+8,b.p),b.dir,0);
 if(i<2){const x=b.end[0];add('PB_DefaultRamp',[4,3,14],[x,17,b.z],wood(i+12,[x,17,b.z]),2,1);add('PB_DefaultRampInverted',[4,3,14],[x,-17,b.z],wood(i+13,[x,-17,b.z]),3,3);}
 else{const y=b.end[1];add('PB_DefaultRamp',[4,3,14],[17,y,b.z],wood(i+12,[17,y,b.z]),0,2);add('PB_DefaultRampInverted',[4,3,14],[-17,y,b.z],wood(i+13,[-17,y,b.z]),1,0);}
 const tipZ=[72,78,64,81][i],tipHalf=[5,4,6,1][i];add('PB_DefaultMicroBrick',[3,3,tipHalf],[b.end[0],b.end[1],tipZ],wood(i+20,b.end));
}
// Original canopy plan. Cells occupy a 24-unit lattice while their varied
// half-extents never exceed 12, preventing same-layer overlap.
const layers=[
 {z:89,h:7,c:[[-2,-1],[-2,0],[-2,1],[-1,-2],[-1,-1],[-1,1],[-1,2],[0,-2],[0,2],[1,-2],[1,-1],[1,1],[1,2],[2,-1],[2,0],[2,1]]},
 {z:103,h:7,c:[[-2,0],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[0,-2],[0,-1],[0,0],[0,1],[0,2],[1,-2],[1,-1],[1,0],[1,1],[2,-1],[2,0]]},
 {z:117,h:7,c:[[-1,-2],[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[0,2],[1,-1],[1,0],[1,1],[2,0]]},
 {z:131,h:7,c:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,0],[1,1]]},
];
let n=0;for(const [li,L]of layers.entries())for(const [gx,gy]of L.c){const sx=[10,11,12,9][(n+gx+4)%4],sy=[9,12,10,11][(n+gy+4)%4],p=[gx*24+(li%2?4:-3),gy*24+(li===2?3:0),L.z];add('PB_DefaultMicroBrick',[sx,sy,L.h],p,green(n++,p));}
// Fine foliage hangs from selected lower cells, copying the reference's use
// of poles as secondary detail without copying its positions or layout.
for(const [i,[x,y,h]]of [[0,[-20,-20,6]],[1,[-20,4,9]],[2,[-20,28,5]],[3,[4,-20,8]],[4,[4,4,11]],[5,[4,28,6]],[6,[28,4,8]],[7,[28,28,5]]])add('PB_DefaultPole',[3,3,h],[x,y,138+h],green(i+70,[x,y,h]),4,i%4);
const bytes=w.toBrz({prefab:metadata({x:70,y:70,z:142}),bundle:{name:'Original Rampwood Tree',description:`An original ${count}-brick tree designed from scratch with ${ramps} standard ramps, ${inverted} inverted ramps, ${poles} foliage poles, a four-sided tapered trunk, radial roots, four forked branch systems, and a unique four-layer canopy.`}});
module.exports=()=>({bytes,count,ramps,inverted,poles});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-original-ramp-tree.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:count,ramps,invertedRamps:inverted,foliagePoles:poles},null,2));}

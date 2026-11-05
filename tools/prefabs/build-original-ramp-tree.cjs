'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),bark=[[64,34,27],[82,43,29],[101,55,34],[71,37,31]],leaf=[[28,67,43],[36,82,47],[48,99,52],[64,116,58],[42,91,61]];let count=0,ramps=0,inverted=0,poles=0;
function add(asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,direction,rotation,color,material:'BMC_Plastic'});count++;if(asset==='PB_DefaultRamp')ramps++;if(asset==='PB_DefaultRampInverted')inverted++;if(asset==='PB_DefaultPole')poles++;}
const wood=(i,p)=>bark[Math.abs(i+p[0]+p[1]+p[2])%bark.length],green=(i,p)=>leaf[Math.abs(i*3+p[0]+p[1]*2+p[2])%leaf.length];
// Original trunk built only from the ramp grid observed in accepted trees:
// X/Y half-extents are multiples of 5, Z is even, and directions stay 4/5.
for(const [i,[asset,size,p,rot]]of [
 ['PB_DefaultRamp',[10,5,20],[-10,0,20],0],['PB_DefaultRamp',[10,5,20],[10,0,20],2],
 ['PB_DefaultRampInverted',[5,5,18],[-5,0,58],0],['PB_DefaultRampInverted',[5,5,18],[5,0,58],2],
 ['PB_DefaultRamp',[5,5,6],[-5,0,82],0],['PB_DefaultRamp',[5,5,6],[5,0,82],2]
].entries())add(asset,size,p,wood(i,p),4,rot);
// Four radial roots and four narrower terminal pieces.
for(const [i,[asset,size,p,rot]]of [
 ['PB_DefaultRamp',[30,5,6],[50,0,6],0],['PB_DefaultRampInverted',[30,5,6],[-50,0,6],2],
 ['PB_DefaultRamp',[30,5,6],[0,35,6],1],['PB_DefaultRampInverted',[30,5,6],[0,-35,6],3],
 ['PB_DefaultRampInverted',[15,5,4],[95,0,4],0],['PB_DefaultRamp',[15,5,4],[-95,0,4],2],
 ['PB_DefaultRampInverted',[15,5,4],[0,80,4],1],['PB_DefaultRamp',[15,5,4],[0,-80,4],3]
].entries())add(asset,size,p,wood(i+10,p),4,rot);
// Four staggered primary branches and eight perpendicular forks. All ramp
// dimensions and centers obey the measured native ramp grid.
const branchSets=[
 {p:[35,0,62],end:[60,0],z:62,rot:0,axis:'x',asset:'PB_DefaultRamp'},
 {p:[-35,0,74],end:[-60,0],z:74,rot:2,axis:'x',asset:'PB_DefaultRampInverted'},
 {p:[0,30,50],end:[0,55],z:50,rot:1,axis:'y',asset:'PB_DefaultRamp'},
 {p:[0,-30,38],end:[0,-55],z:38,rot:3,axis:'y',asset:'PB_DefaultRampInverted'},
];
for(const [i,b]of branchSets.entries()){
 add(b.asset,[25,5,6],b.p,wood(i+20,b.p),4,b.rot);
 if(b.axis==='x')for(const s of [-1,1])add(s>0?'PB_DefaultRamp':'PB_DefaultRampInverted',[15,5,4],[b.end[0],s*20,b.z],wood(i+s+30,[b.end[0],s*20,b.z]),4,1);
 else for(const s of [-1,1])add(s>0?'PB_DefaultRampInverted':'PB_DefaultRamp',[15,5,4],[s*20,b.end[1],b.z],wood(i+s+40,[s*20,b.end[1],b.z]),4,0);
 const half=[7,1,13,19][i],center=[75,81,69,63][i];add('PB_DefaultMicroBrick',[4,4,half],[b.end[0],b.end[1],center],wood(i+50,b.end));
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

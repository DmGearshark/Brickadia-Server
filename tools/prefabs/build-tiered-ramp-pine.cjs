'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World();let count=0,ramps=0;
const bark=[[69,36,23],[82,44,26],[96,53,30]],dark=[28,65,34],middle=[36,78,39],light=[45,91,44];
function add(asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,color,material:'BMC_Plastic',direction,rotation});count++;if(asset.includes('Ramp'))ramps++;}

// A single uninterrupted trunk establishes the height and keeps the low-detail
// design readable from every side.
add('PB_DefaultBrick',[10,10,30],[0,0,30],bark[0]);

// Compact root flares remain inside the canopy footprint.
for(const [i,[p,rot]] of [[[25,0,6],0],[[-25,0,6],2],[[0,25,6],1],[[0,-25,6],3]].entries())
 add(i%2?'PB_DefaultRampInverted':'PB_DefaultRamp',[15,5,6],p,bark[1+i%2],4,rot);

// Four principal limbs sit directly beneath the lowest foliage tier. They
// suggest structure without becoming a visible cage.
const limbs=[
 [[30,0,54],0,20], [[-25,0,54],2,15], [[0,30,54],1,20], [[0,-25,54],3,15]
];
for(const [i,[p,rot,half]] of limbs.entries())
 add(i%2?'PB_DefaultRampInverted':'PB_DefaultRamp',[half,5,6],p,bark[(i+1)%3],4,rot);

// The silhouette is resolved with four tapering tiers. Each tier has one main
// mass and at most two attached lobes, all sharing one color instead of noisy
// per-brick variation.
const foliage=[
 // broad low skirt
 [[35,28,18],[0,0,78],dark],[[18,20,14],[53,4,76],dark],[[15,22,13],[-50,-3,77],dark],
 // middle tier
 [[28,24,17],[2,-2,113],middle],[[12,17,13],[42,2,111],middle],[[14,18,13],[-40,-5,112],middle],
 // upper tier
 [[22,19,15],[-2,2,145],light],[[11,14,11],[31,0,143],light],[[10,13,10],[-34,5,144],light],
 // crown
 [[15,14,14],[2,0,174],middle]
];
for(const [size,pos,color] of foliage)add('PB_DefaultStudded',size,pos,color);

const bytes=w.toBrz({prefab:metadata({x:72,y:55,z:190}),bundle:{name:'Tiered Ramp Pine',description:`Original ${count}-brick compact pine. Four coherent foliage tiers establish its silhouette; ${ramps} restrained root and branch ramps add structure beneath the canopy.`}});
module.exports=()=>({bytes,count,ramps});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-tiered-ramp-pine.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:count,ramps},null,2));}

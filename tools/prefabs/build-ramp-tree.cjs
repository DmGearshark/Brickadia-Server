'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World}=require('brs-js'),{read}=require('./reskin-loadboard.cjs'),{envelope}=require('./brick-shapes.cjs'),{metadata}=require('./loadboard-lib.cjs');
const SOURCE_BROWN='77,22,13',SOURCE_LIGHT='56,95,22',SOURCE_DARK='38,75,38';
const bark=[[64,34,29],[83,43,31],[104,57,36],[72,38,33]],lightLeaves=[[54,102,49],[65,118,56],[77,128,61]],darkLeaves=[[28,65,43],[35,78,47],[42,87,50]];
const pick=(palette,p)=>palette[Math.abs(p[0]*3+p[1]*5+p[2]*7)%palette.length];
function build(input){const scene=read(fs.readFileSync(input));
 const source=scene.bricks.filter(b=>b.g===1&&b.data.position[0]>=-1900&&b.data.position[0]<=-1600&&b.data.position[1]>=-17800&&b.data.position[1]<=-17300&&b.data.asset.startsWith('PB_'));
 assert.equal(source.length,181,'Expected the isolated 181-brick ramp tree reference');
 const boxes=source.map(b=>envelope(b.data)),min=[0,1,2].map(i=>Math.min(...boxes.map(x=>x.position[i]-x.size[i]))),max=[0,1,2].map(i=>Math.max(...boxes.map(x=>x.position[i]+x.size[i]))),center=[Math.round((min[0]+max[0])/2),Math.round((min[1]+max[1])/2),min[2]];
 const w=new World();let ramps=0,inverted=0,poles=0;
 for(const br of source){const d=structuredClone(br.data),key=d.color.join(','),p=d.position;d.position=[p[0]-center[0],p[1]-center[1],p[2]-center[2]];d.owner_index=0;
  if(key===SOURCE_BROWN)d.color=pick(bark,p);else if(key===SOURCE_LIGHT)d.color=pick(lightLeaves,p);else if(key===SOURCE_DARK)d.color=pick(darkLeaves,p);
  if(d.asset==='PB_DefaultRamp')ramps++;if(d.asset==='PB_DefaultRampInverted')inverted++;if(d.asset==='PB_DefaultPole')poles++;w.addBrick(d);
 }
 const ext=[Math.ceil((max[0]-min[0])/2)+2,Math.ceil((max[1]-min[1])/2)+2,max[2]-min[2]+2];
 const bytes=w.toBrz({prefab:metadata({x:ext[0],y:ext[1],z:ext[2]}),bundle:{name:'Old Growth Ramp Tree',description:`A recolored 181-brick mature tree preserving a proven in-game ramp-built skeleton: ${ramps} standard ramps, ${inverted} inverted ramps, ${poles} foliage poles, tapered roots, trunk, forks, branches, and irregular canopy masses.`}});
 return {bytes,count:source.length,ramps,inverted,poles,bounds:{min,max,center,ext}};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node build-ramp-tree.cjs reference-example.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bricks:r.count,ramps:r.ramps,invertedRamps:r.inverted,foliagePoles:r.poles,bounds:r.bounds},null,2));}

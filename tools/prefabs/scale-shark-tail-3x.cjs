'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const {C}=require('./loadboard-lib.cjs');
const SCALE=3;
const mulVector=(v,s=SCALE)=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x*s]));
function build(input){
 const scene=read(fs.readFileSync(input)),microchipGrids=new Set(scene.links.map(x=>x.grid)),physicalGrids=new Set([...new Set(scene.bricks.map(x=>x.g))].filter(g=>!microchipGrids.has(g)));
 assert.equal(microchipGrids.size,2,'Expected main and nested logic planes');assert(physicalGrids.size>=3,'Expected tail, head, and helper physical grids');
 for(const brick of scene.bricks)if(physicalGrids.has(brick.g)){
  brick.data.position=brick.data.position.map(x=>x*SCALE);
  if(brick.data.size?.some(Boolean))brick.data.size=brick.data.size.map(x=>x*SCALE);
  for(const comp of brick.comps){
   if(comp.type===C.TextDisplay.NAME){if(Number.isFinite(comp.data.LineHeight))comp.data.LineHeight*=SCALE;if(comp.data.Offset)comp.data.Offset=mulVector(comp.data.Offset);if(Number.isFinite(comp.data.LineOffset))comp.data.LineOffset*=SCALE;}
   if(comp.type===C.Servo.NAME){comp.data.Power*=SCALE**3;comp.data.ActiveDamping*=SCALE**3;}
  }
 }
 for(const joint of scene.joints)joint.offset=mulVector(joint.offset);
 const vecScale=scene.bricks.flatMap(b=>b.comps).filter(c=>c.type===C.Expr_VecScale.NAME);assert.equal(vecScale.length,1);assert.equal(vecScale[0].data.Scalar,-5);vecScale[0].data.Scalar=-15;
 const heightAdds=scene.bricks.flatMap(b=>b.comps).filter(c=>c.type===C.Expr_MathAdd.NAME&&c.data.InputB?.$variant==='Vector'&&c.data.InputB.value?.Z===20&&c.data.InputB.value.X===0&&c.data.InputB.value.Y===0);assert.equal(heightAdds.length,1);heightAdds[0].data.InputB.value.Z=60;
 const sweeps=scene.bricks.flatMap(b=>b.comps).filter(c=>c.type===C.Exec_Sweep.NAME);assert.equal(sweeps.length,1);assert.equal(sweeps[0].data.Distance,150);sweeps[0].data.Distance=450;sweeps[0].data.Radius*=SCALE;
 const root=[...scene.r.entities()].find(e=>physicalGrids.has(e.persistentIndex)&&scene.joints.some(j=>scene.bricks.find(b=>b.key===j.key)?.g===e.persistentIndex));assert(root,'Root physical entity');scene.entityOverrides=new Map();
 for(const e of scene.r.entities())if(physicalGrids.has(e.persistentIndex)&&e.persistentIndex!==root.persistentIndex){const d={X:e.location.X-root.location.X,Y:e.location.Y-root.location.Y,Z:e.location.Z-root.location.Z};scene.entityOverrides.set(e.persistentIndex,{...e,location:{X:root.location.X+d.X*SCALE,Y:root.location.Y+d.Y*SCALE,Z:root.location.Z+d.Z*SCALE}});}
 const prefab=structuredClone(scene.r.prefabJson());for(const p of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot'])prefab.pivots[p].halfExtent=mulVector(prefab.pivots[p].halfExtent);
 const out=write(scene,{assets:scene.r.externalAssets(),embedded:scene.r.prefabPaths().map(p=>scene.r.readPrefab(p)),prefab,name:'Shark Tail and Head - Player Scale 3',description:'Fixed 3x test version. Physical geometry, joint spacing, player-relative offsets, crouch probe height, sweep distance, markings, and servo strength are scaled for a player at scale 3.'});return {bytes:out.bytes,physicalGrids:[...physicalGrids],scaledBricks:scene.bricks.filter(b=>physicalGrids.has(b.g)).length};
}
module.exports=build;if(require.main===module){const [a,z]=process.argv.slice(2);if(!z)throw Error('Usage: node scale-shark-tail-3x.cjs input.brz output.brz');const r=build(a);fs.writeFileSync(z,r.bytes);console.log(JSON.stringify({output:z,scaledBricks:r.scaledBricks,physicalGrids:r.physicalGrids,bytes:r.bytes.length},null,2));}

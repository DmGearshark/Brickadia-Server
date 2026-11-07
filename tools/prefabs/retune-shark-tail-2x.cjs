'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const {C}=require('./loadboard-lib.cjs');
const SCALE=2;
const vec=(v,s=SCALE)=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x*s]));
function build(input,reference){
 const scene=read(fs.readFileSync(input)),original=read(fs.readFileSync(reference)),all=scene.bricks.flatMap(b=>b.comps);
 const scale=all.filter(c=>c.type===C.Expr_VecScale.NAME);assert.equal(scale.length,1);assert.equal(scale[0].data.Scalar,-5);scale[0].data.Scalar=-10;
 const height=all.filter(c=>c.type===C.Expr_MathAdd.NAME&&c.data.InputB?.$variant==='Vector'&&c.data.InputB.value?.X===0&&c.data.InputB.value.Y===0&&c.data.InputB.value.Z===20);assert.equal(height.length,1);height[0].data.InputB.value.Z=40;
 const sweep=all.filter(c=>c.type===C.Exec_Sweep.NAME);assert.equal(sweep.length,1);assert.equal(sweep[0].data.Distance,150);sweep[0].data.Distance=300;sweep[0].data.Radius*=SCALE;
 const servo=all.filter(c=>c.type===C.Servo.NAME);assert.equal(servo.length,1);assert.equal(servo[0].data.Power,10000);assert.equal(servo[0].data.ActiveDamping,1000);servo[0].data.Power=80000;servo[0].data.ActiveDamping=8000;
 // The resized upload omitted the original invisible pose/helper entity and
 // its ReadBrickGrid -> rerouter wire. Restore it without changing user geometry.
 assert.equal(all.filter(c=>c.type===C.ReadBrickGrid.NAME).length,1,'Expected missing physical helper reader');
 const originalLogic=new Set(original.links.map(x=>x.grid)),originalPhysical=[...new Set(original.bricks.map(b=>b.g))].filter(g=>!originalLogic.has(g));
 const helperGrid=originalPhysical.find(g=>original.bricks.some(b=>b.g===g&&b.comps.some(c=>c.type===C.ReadBrickGrid.NAME)));assert(helperGrid,'Original helper grid');
 const helperEntity=[...original.r.entities()].find(e=>e.persistentIndex===helperGrid);assert(helperEntity);
 const inputLogic=new Set(scene.links.map(x=>x.grid)),inputPhysical=[...new Set(scene.bricks.map(b=>b.g))].filter(g=>!inputLogic.has(g));const root=[...scene.r.entities()].find(e=>inputPhysical.includes(e.persistentIndex)&&scene.joints.some(j=>scene.bricks.find(b=>b.key===j.key)?.g===e.persistentIndex));assert(root,'2x root entity');
 const originalRoot=[...original.r.entities()].find(e=>originalPhysical.includes(e.persistentIndex)&&original.joints.some(j=>original.bricks.find(b=>b.key===j.key)?.g===e.persistentIndex));assert(originalRoot);
 const helperId=Math.max(...[...scene.r.entities()].map(e=>e.persistentIndex))+1,d={X:helperEntity.location.X-originalRoot.location.X,Y:helperEntity.location.Y-originalRoot.location.Y,Z:helperEntity.location.Z-originalRoot.location.Z};
 const restored={...structuredClone(helperEntity),persistentIndex:helperId,location:{X:root.location.X+d.X*SCALE,Y:root.location.Y+d.Y*SCALE,Z:root.location.Z+d.Z*SCALE}};scene.extraEntities=[restored];scene.extraGridIds=new Set([helperId]);
 let reader=null;for(const [i,b]of original.bricks.filter(b=>b.g===helperGrid).entries()){const copy=structuredClone(b);copy.key=`scale2-helper:${i}`;copy.g=helperId;copy.data.position=copy.data.position.map(x=>x*SCALE);if(copy.data.size?.some(Boolean))copy.data.size=copy.data.size.map(x=>x*SCALE);scene.bricks.push(copy);if(copy.comps.some(c=>c.type===C.ReadBrickGrid.NAME))reader=copy;}assert(reader);
 const rerouters=scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Rerouter.NAME));const target=rerouters.find(b=>scene.edges.some(e=>e.a===b.key&&e.at===C.Rerouter.NAME&&e.p==='RER_Output'&&e.zt===C.Rerouter.NAME)&&!scene.edges.some(e=>e.z===b.key&&e.zt===C.Rerouter.NAME&&e.q==='RER_Input'));assert(target,'Disconnected helper rerouter');scene.edges.push({a:reader.key,at:C.ReadBrickGrid.NAME,p:'BrickGrid',z:target.key,zt:C.Rerouter.NAME,q:'RER_Input'});
 const out=write(scene,{assets:scene.r.externalAssets(),embedded:scene.r.prefabPaths().map(p=>scene.r.readPrefab(p)),name:'Shark Tail and Head - Player Scale 2',description:'User-resized 2x geometry preserved. Follow offset, crouch height, player sweep, servo power/damping, and missing invisible pose helper are retuned for player scale 2.'});return {bytes:out.bytes,restoredHelper:true,bricks:scene.bricks.length,wires:scene.edges.length};
}
module.exports=build;if(require.main===module){const [a,ref,z]=process.argv.slice(2);if(!z)throw Error('Usage: node retune-shark-tail-2x.cjs 2x.brz original.brz output.brz');const r=build(a,ref);fs.writeFileSync(z,r.bytes);console.log(JSON.stringify({output:z,...r,bytes:r.bytes.length},null,2));}

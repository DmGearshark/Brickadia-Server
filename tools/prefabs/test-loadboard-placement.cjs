'use strict';
const assert=require('assert/strict'),{read}=require('./reskin-loadboard.cjs'),{C}=require('./loadboard-lib.cjs'),model=require('./loadboard-model.cjs');
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
module.exports=function test(ctx){
 const output=read(ctx.bytes),gm=new Map([[1,1]]);[...ctx.scene.r.entities()].forEach((e,i)=>gm.set(e.persistentIndex,i+2));assert.deepEqual(output.r.prefabJson(),ctx.original.r.prefabJson());assert.equal(output.bricks.length,ctx.scene.bricks.length);
 for(const br of ctx.scene.bricks){const saved=output.bricks.find(b=>b.g===gm.get(br.g)&&b.data.position.join()===br.data.position.join()&&b.data.asset===br.data.asset);assert(saved,'Saved gate/brick '+br.key);assert.deepEqual(saved.data,br.data);for(const comp of br.comps){const found=saved.comps.find(c=>c.type===comp.type);assert(found);for(const [k,v]of Object.entries(comp.data))assert.deepEqual(found.data[k],v);}}
 function wireSignatures(s,map=g=>g){const by=new Map(s.bricks.map(b=>[b.key,b]));const endpoint=(key,t,p)=>{const b=by.get(key);return JSON.stringify([map(b.g),b.data.position,t,p]);};return s.edges.map(e=>endpoint(e.a,e.at,e.p)+'=>'+endpoint(e.z,e.zt,e.q)).sort();}
 assert.deepEqual(wireSignatures(output),wireSignatures(ctx.scene,g=>gm.get(g)));
 const unchanged=ctx.original.bricks.filter(b=>b.g!==ctx.commandGrid);for(const b of unchanged)assert.deepEqual(ctx.scene.bricks.find(x=>x.key===b.key),b,'Preserve user geometry, settings and other circuits');
 const savedEdges=new Set(ctx.scene.edges.map(e=>JSON.stringify(e)));for(const e of ctx.original.edges.filter(e=>!ctx.oldKeys.has(e.a)&&!ctx.oldKeys.has(e.z)))assert(savedEdges.has(JSON.stringify(e)));
 assert.deepEqual(output.r.prefabPaths(),ctx.original.r.prefabPaths());for(const p of output.r.prefabPaths())assert(Buffer.from(output.r.readPrefab(p)).equals(Buffer.from(ctx.original.r.readPrefab(p))),'Exact uploaded client and cargo bytes');
 assert(!ctx.ir.nodes.some(n=>n.type===C.Exec_GetOwnTransform.NAME));assert(!ctx.ir.edges.some(e=>e.z===ctx.cmd.spawner&&e.q==='SpawnOffset'));assert.equal(ctx.cmd.orient.type,C.Exec_Entity_SetLocationRotation.NAME);
 for(const delay of [0,1])for(const yaw of [0,45,90,135,180,225,270,315])for(const pitch of [-80,0,80]){
  const pos={X:-25160,Y:-49024,Z:1951},m=model({main:ctx.ir,portable:{b:{nodes:[],edges:[]}},central:{},cmd:ctx.cmd},{network:true,reactiveDelay:delay,characterTransform:{Vector:pos,Rotation:{Pitch:pitch,Yaw:yaw,Roll:0}}});m.addPlayer('alice');m.command('alice');m.drain();const init=m.responses.find(r=>r.name==='LB1.BoardInit');assert(init);assert.equal(init.args[0],'alice');const ent=m.entities.get(init.target);assert(ent?.location,'Position applied before initialization');const a=yaw*Math.PI/180;close(ent.location.X,pos.X+60*Math.cos(a));close(ent.location.Y,pos.Y+60*Math.sin(a));close(ent.location.Z,pos.Z+16);close(ent.rotation.Yaw,yaw+180);assert.equal(ent.rotation.Pitch,0);assert.equal(ent.rotation.Roll,0);
  // The visible side of the uploaded display points along its local positive X.
  const normal=(ent.rotation.Yaw)*Math.PI/180;close(Math.cos(normal)*(-Math.cos(a))+Math.sin(normal)*(-Math.sin(a)),1);
  const old=init.target;m.command('alice');m.drain();assert(!m.entities.has(old));assert.equal(m.entities.size,1,'Repeated command replaces only the player’s previous screen');
 }
 console.log('Placement checks passed: 48 heading/pitch/timing scenarios, world position before init, facing toward caller, replacement, exact embedded client/collider/Fine settings and unrelated circuit/wire preservation.');
};

'use strict';
const assert=require('assert/strict'),{C}=require('./loadboard-lib.cjs');

module.exports=function simplifyCargoSpawn(scene,ctx,{height=40}={}){
 const grid=ctx.gridGroups.cargo,spawners=scene.bricks.filter(b=>b.g===grid&&b.comps.some(c=>c.type===C.Exec_PrefabSpawner.NAME));assert.equal(spawners.length,2);
 const keep=new Set(spawners.map(b=>b.key)),removed=scene.bricks.filter(b=>b.g===grid&&!keep.has(b.key)),removedKeys=new Set(removed.map(b=>b.key)),transforms=removed.filter(b=>b.comps.some(c=>c.type===C.Exec_GetOwnTransform.NAME)),bypasses=transforms.map(b=>{const incoming=scene.edges.find(e=>e.z===b.key&&e.zt===C.Exec_GetOwnTransform.NAME&&e.q==='Exec'),outgoing=scene.edges.find(e=>e.a===b.key&&e.at===C.Exec_GetOwnTransform.NAME&&e.p==='ExecOut');assert(incoming&&outgoing);return {a:incoming.a,at:incoming.at,p:incoming.p,z:outgoing.z,zt:outgoing.zt,q:outgoing.q};}),removedEdges=scene.edges.filter(e=>removedKeys.has(e.a)||removedKeys.has(e.z)||keep.has(e.z)&&e.zt===C.Exec_PrefabSpawner.NAME&&e.q==='SpawnOffset').map(e=>structuredClone(e));
 scene.edges=scene.edges.filter(e=>!removedKeys.has(e.a)&&!removedKeys.has(e.z)&&!(keep.has(e.z)&&e.zt===C.Exec_PrefabSpawner.NAME&&e.q==='SpawnOffset'));scene.edges.push(...bypasses);scene.bricks=scene.bricks.filter(b=>!removedKeys.has(b.key));
 for(const b of spawners){const c=b.comps.find(c=>c.type===C.Exec_PrefabSpawner.NAME);c.data.SpawnOffset={X:0,Y:0,Z:height};}
 return {grid,spawners:spawners.map(b=>b.key),removed:removed.map(b=>b.key),removedEdges,bypasses,height};
};

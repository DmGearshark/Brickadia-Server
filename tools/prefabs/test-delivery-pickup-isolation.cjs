'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js'),C=b.COMPONENTS;
module.exports=function test(ctx){
 const main=WorldReader.from(ctx.bytes),cargo=WorldReader.from(main.readPrefab(ctx.path));assert.deepEqual(main.prefabPaths(),[ctx.path]);assert(!cargo.prefabJson().bIsPhysicsGrid);assert(!cargo.prefabJson().bFreezePhysicsGrid);assert.equal([...cargo.entities()].length,0);
 function roundtrip(r,c){
  const originals=[...new Set([...c.nodes,...c.edges.flatMap(e=>[e.a,e.z])])],address=new Map(),saved=[],actual=[];
  const key=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]);
  for(const g of r.gridIds()){const all=[...r.bricks(g)];let offset=0;for(const ch of r.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const comp of (ch.numComponents?r.componentChunk(g,ch.index).components:[])){const pos=bs[comp.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));const n=originals.find(n=>n.handle.grid+1===g&&n.type===comp.typeName&&JSON.stringify(n.position)===JSON.stringify(pos));if(n){const savedNode={...n,data:comp.data};saved.push(savedNode);address.set(key(g,ch.index,comp.brickIndex,comp.typeName),savedNode);}}}}
  assert.equal(saved.length,originals.length,'Every connected component survives serialization');
  for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g)){if(!ch.numWires)continue;const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const a=address.get(key(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex,e.source.componentType)),z=address.get(key(g,ch.index,e.target.brickIndex,e.target.componentType));assert(a&&z,'Resolved saved endpoints');actual.push([a.id,e.source.port,z.id,e.target.port].join(':'));}}
  const expected=c.edges.map(e=>[e.a.id,e.p,e.z.id,e.q].join(':'));assert.deepEqual(actual.sort(),expected.sort());assert.equal(new Set(c.edges.map(e=>e.z.id+':'+e.q)).size,c.edges.length,'No input has multiple sources');
  return {...c,nodes:saved,edges:c.edges.map(e=>({...e,a:saved.find(n=>n.id===e.a.id),z:saved.find(n=>n.id===e.z.id)}))};
 }

 const c=roundtrip(main,ctx.c);
 function reachable(start){const seen=new Set(),todo=[start];while(todo.length){const n=todo.pop();if(seen.has(n.id))continue;seen.add(n.id);for(const e of c.edges)if(e.a.id===n.id&&/^(Exec|Output|OnRisingEdge)/.test(e.p)&&/^(Exec|Input)/.test(e.q))todo.push(e.z);}return c.nodes.filter(n=>seen.has(n.id));}
 const green=reachable(ctx.green.start),blue=reachable(ctx.blue.start),yellow=reachable(ctx.yellow.start),red=reachable(ctx.red.start);
 assert(green.some(n=>n.type===C.Exec_PlayerState_GetUserId.NAME));assert(!green.some(n=>[C.Exec_PrefabSpawner.NAME,C.Exec_Entity_SetCustomProperty.NAME].includes(n.type)));
 assert(blue.some(n=>n.id===ctx.spawner.id));assert(!blue.some(n=>n.type===C.Exec_Entity_SetCustomProperty.NAME));
 assert(yellow.some(n=>n.id===ctx.write.id));assert(!yellow.some(n=>n.type===C.Exec_PrefabSpawner.NAME));assert(red.some(n=>n.id===ctx.read.id));
 assert(!c.nodes.some(n=>/Zone|Leaderboard|SendCustomEvent|DestroySpawnedPrefab/.test(n.type)));
 console.log('Isolation checks passed: exact saved endpoints, plain embedded cargo, independent lookup/spawn/write/read stages, no zones or leaderboard gates.');
};

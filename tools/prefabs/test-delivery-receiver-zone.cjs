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

 const c=roundtrip(main,ctx.c),z=ctx.zoneCtx;assert(ctx.withZone);
 assert(!c.nodes.some(n=>/Leaderboard|SendCustomEvent|DestroySpawnedPrefab|SetTag/.test(n.type)));
 assert(c.edges.some(e=>e.a.id===z.entered.id&&e.p==='Entity'&&e.q==='Value'),'Capture actual zone entity');
 assert(c.edges.some(e=>e.a.id===z.arriving.id&&e.z.id===z.zoneRead.id&&e.q==='Entity'),'Read properties from detected entity, not spawner reference');
 assert.equal(c.nodes.find(n=>n.id===z.zoneRead.id).data.Key,'LoadProbe.OwnerId');
 const incoming=new Map(c.edges.map(e=>[e.z.id+':'+e.q,e]));
 function accepted(changes={}){const values=new Map([[ctx.root.id+':Value','cube-A'],[ctx.owner.id+':Value','user-A'],[z.arriving.id+':Value','cube-A'],[z.zoneRead.id+':Value','user-A'],[z.zoneRead.id+':bFound',true],...Object.entries(changes)]);function get(n,p){const key=n.id+':'+p;if(values.has(key))return values.get(key);const read=q=>{const edge=incoming.get(n.id+':'+q);const raw=n.data[q];return edge?get(edge.a,edge.p):raw&&'$variant'in Object(raw)?raw.value:raw;};switch(n.type){case C.Var.NAME:return n.data.Value.value;case C.Expr_CompareEqual.NAME:return read('InputA')===read('InputB');case C.Expr_CompareNotEqual.NAME:return read('InputA')!==read('InputB');case C.Expr_LogicalAND.NAME:return !!read('bInputA')&&!!read('bInputB');default:throw Error(n.type);}}return get(c.nodes.find(n=>n.id===z.zoneValid.id),'bOutput');}
 assert(accepted());assert(!accepted({[z.zoneRead.id+':Value']:'user-B'}));assert(!accepted({[z.zoneRead.id+':bFound']:false}));assert(!accepted({[z.arriving.id+':Value']:'cube-B'}));assert(!accepted({[ctx.root.id+':Value']:null}));
 console.log('Receiver test checks passed: exact serialized endpoints, plain cargo, zone-derived entity property read, matching/missing/wrong-owner/wrong-entity predicate cases; no object events or score writes.');
};

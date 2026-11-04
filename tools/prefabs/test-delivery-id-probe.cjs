'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js'),C=b.COMPONENTS;
module.exports=function test(ctx){
 const main=WorldReader.from(ctx.bytes);assert.deepEqual(main.prefabPaths(),[ctx.path]);const cargo=WorldReader.from(main.readPrefab(ctx.path));assert.deepEqual(main.readPrefab(ctx.path),ctx.payload);assert(cargo.prefabJson().bIsPhysicsGrid);assert(cargo.prefabJson().bFreezePhysicsGrid);
 function roundtrip(r,c){
  const originals=[...new Set([...c.nodes,...c.edges.flatMap(e=>[e.a,e.z])])],address=new Map(),saved=[],actual=[];
  const key=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]);
  for(const g of r.gridIds()){const all=[...r.bricks(g)];let offset=0;for(const ch of r.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const comp of (ch.numComponents?r.componentChunk(g,ch.index).components:[])){const pos=bs[comp.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));const n=originals.find(n=>n.handle.grid+1===g&&n.type===comp.typeName&&JSON.stringify(n.position)===JSON.stringify(pos));if(n){const savedNode={...n,data:comp.data};saved.push(savedNode);address.set(key(g,ch.index,comp.brickIndex,comp.typeName),savedNode);}}}}
  assert.equal(saved.length,originals.length,'Every connected component survives serialization');
  for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g)){if(!ch.numWires)continue;const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const a=address.get(key(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex,e.source.componentType)),z=address.get(key(g,ch.index,e.target.brickIndex,e.target.componentType));assert(a&&z,'Resolved saved endpoints');actual.push([a.id,e.source.port,z.id,e.target.port].join(':'));}}
  const expected=c.edges.map(e=>[e.a.id,e.p,e.z.id,e.q].join(':'));assert.deepEqual(actual.sort(),expected.sort());assert.equal(new Set(c.edges.map(e=>e.z.id+':'+e.q)).size,c.edges.length,'No input has multiple sources');
  return {...c,nodes:saved,edges:c.edges.map(e=>({...e,a:saved.find(n=>n.id===e.a.id),z:saved.find(n=>n.id===e.z.id)}))};
 }
 const c=roundtrip(main,ctx.c),p=roundtrip(cargo,ctx.p);
 assert(p.nodes.find(n=>n.id===ctx.label.id).data.bIsObjectEvent);assert(c.edges.some(e=>e.z.id===ctx.send.id&&e.q==='Target'&&e.a.id===ctx.root.id));
 assert.equal(c.nodes.find(n=>n.id===ctx.imprintOwner.id).data.Key,'LoadProbe.OwnerId');assert(c.edges.some(e=>e.z.id===ctx.imprintOwner.id&&e.q==='Value'&&e.a.id===ctx.expectedOwner.id));
 for(const reader of [main,cargo])for(const g of reader.gridIds())for(const ch of reader.brickChunkIndex(g))for(const comp of (ch.numComponents?reader.componentChunk(g,ch.index).components:[]))assert(!/Leaderboard/.test(comp.typeName),'Probe cannot change leaderboard scores');
 // Evaluate the actual serialized predicate graph with native entity property
 // getter outputs supplied for each scenario. This does not emulate engine timing.
 const incoming=new Map(c.edges.map(e=>[e.z.id+':'+e.q,e])),nodes=new Map(c.nodes.map(n=>[n.id,n]));
 function accepts(overrides={}){
  const values=new Map([[ctx.root.id+':Value','cargo-A'],[ctx.incoming.id+':Value','cargo-A'],[ctx.expectedOwner.id+':Value','user-A'],[ctx.delivery.id+':Value',42],[ctx.completed.id+':Value',false],[ctx.readOwner.id+':Value','user-A'],[ctx.readOwner.id+':bFound',true],[ctx.readDelivery.id+':Value',42],[ctx.readDelivery.id+':bFound',true],[ctx.readDest.id+':Value','Test Depot'],[ctx.readDest.id+':bFound',true],...Object.entries(overrides)]);
  const unbox=v=>v&&'$variant'in Object(v)?v.value:v;
  function value(n,p){const key=n.id+':'+p;if(values.has(key))return values.get(key);const get=q=>{const e=incoming.get(n.id+':'+q);return e?value(e.a,e.p):unbox(n.data[q]);};switch(n.type){case C.Var.NAME:return unbox(n.data.Value);case C.Expr_CompareEqual.NAME:return get('InputA')===get('InputB');case C.Expr_CompareNotEqual.NAME:return get('InputA')!==get('InputB');case C.Expr_LogicalNOT.NAME:return !get('bInput');case C.Expr_LogicalAND.NAME:return !!get('bInputA')&&!!get('bInputB');default:throw Error('Unexpected predicate '+n.type);}}
  return value(nodes.get(ctx.valid.id),'bOutput');
 }
 assert(accepts());assert(!accepts({[ctx.readOwner.id+':Value']:'user-B'}),'Another owner rejected');assert(!accepts({[ctx.readDelivery.id+':Value']:41}),'Old delivery rejected');assert(!accepts({[ctx.readDest.id+':Value']:'Other Depot'}),'Wrong destination rejected');assert(!accepts({[ctx.readOwner.id+':bFound']:false}),'Missing identity rejected');assert(!accepts({[ctx.completed.id+':Value']:true}),'Completed contract rejected');assert(!accepts({[ctx.incoming.id+':Value']:'cargo-B'}),'Unregistered physical crate rejected');assert(!accepts({[ctx.expectedOwner.id+':Value']:''}),'Empty owner rejected');
 console.log('Delivery probe checks passed: embedded physics cargo, object-scoped initialization, native identity imprint, exact serialized endpoints, matching/incorrect/missing/stale/completed contract decisions, and no leaderboard writes.');
};

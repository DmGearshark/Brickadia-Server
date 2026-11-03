'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js'),model=require('./wallet-demo-model.cjs');
module.exports=function test(ctx,fromSaved=false){
 for(const moduleYaw of [0,90,180,270]){
  const m=model(ctx,{moduleYaw,moduleOrigin:[1700,-320,100]});m.command('alice');m.command('bob');assert.equal(m.entities.size,1,'Serialize overlapping spawn/init requests');m.drain();assert.equal(m.entities.size,2);assert.deepEqual(m.initializations.map(e=>[e.owner,e.name]),[['alice','Alice'],['bob','Bob']]);
  const entries=[...m.entities.values()];for(const [i,id]of ['alice','bob'].entries()){const expected=m.players[id].origin.map((v,k)=>v+m.players[id].direction[k]*120);for(let k=0;k<3;k++)assert(Math.abs(entries[i].position[k]-expected[k])<1e-8,'World-to-spawner-local positioning');assert.equal(entries[i].owner,id);assert.equal(entries[i].name,m.players[id].name);}
  assert.equal(m.controller.state.get(ctx.busy.id),false);assert.deepEqual(m.controller.state.get(ctx.queue.id),[]);
 }
 let m=model(ctx,{maxSpawns:1});m.command('alice');m.command('bob');m.drain();assert.equal(m.initializations.length,1);assert.equal([...m.entities.values()][0].owner,'alice','Failed spawn must not rename previous object');assert.equal(m.messages[0].player,'bob');
 m=model(ctx);m.command('alice');m.entities.clear();m.drain();assert.equal(m.initializations.length,0,'Destroyed target must not become an untargeted global event');assert.equal(m.controller.state.get(ctx.busy.id),false);
 m=model(ctx);m.players.alice.dead=true;m.command('alice');m.drain();assert.equal(m.entities.size,0);assert(m.messages[0].message.includes('Respawn'));
 if(fromSaved)return;
 const root=WorldReader.from(ctx.bytes);assert.deepEqual(root.prefabPaths(),[ctx.path]);const payload=WorldReader.from(root.readPrefab(ctx.path));assert.deepEqual([...root.readPrefab(ctx.path)],[...ctx.payloadBytes]);
 function roundtrip(reader,c,extra=[]){
  const originals=[...c.nodes,...extra],savedNodes=[],addr=new Map(),edges=[];
  const key=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]);
  for(const g of reader.gridIds()){const all=[...reader.bricks(g)];let offset=0;for(const ch of reader.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const d of reader.componentChunk(g,ch.index).components){const position=bs[d.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));const original=originals.find(n=>n.handle.grid+1===g&&n.type===d.typeName&&JSON.stringify(n.position)===JSON.stringify(position));if(original){const n={...original,data:d.data};savedNodes.push(n);addr.set(key(g,ch.index,d.brickIndex,d.typeName),n);}}}}
  const targets=new Set();for(const g of reader.gridIds())for(const ch of reader.brickChunkIndex(g)){if(!ch.numWires)continue;const ws=reader.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const a=addr.get(key(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex,e.source.componentType)),z=addr.get(key(g,ch.index,e.target.brickIndex,e.target.componentType));assert(a&&z,'All saved endpoints exist');const target=z.id+':'+e.target.port;assert(!targets.has(target),'Unique input');targets.add(target);edges.push({a,p:e.source.port,z,q:e.target.port});}}
  assert.equal(savedNodes.length,originals.length);assert.equal(edges.length,c.edges.length);return {nodes:savedNodes,edges};
 }
 const pc=roundtrip(payload,ctx.p,ctx.plates),cc=roundtrip(root,ctx.c);
 const receiver=pc.nodes.find(n=>n.id===ctx.received.id);assert.equal(receiver.data.bIsObjectEvent,true);assert.equal(receiver.data.EventName,'WalletDemo.Initialize');const sender=cc.nodes.find(n=>n.id===ctx.send.id);assert.equal(sender.data.EventName,receiver.data.EventName);
 assert(cc.edges.some(e=>e.z.id===ctx.send.id&&e.q==='Target'&&e.a.id===ctx.root.id));assert.equal(cc.nodes.find(n=>n.id===ctx.delay.id).data.TicksToWait,3);assert.equal(ctx.spawner.handle.grid,0);assert.equal(ctx.ownTransform.handle.grid,0);
 test({...ctx,c:cc,p:pc},true);
 console.log('Wallet demo checks passed: embedded payload, object-event scope, owner/name isolation, simultaneous requests, rotated controller placement, failed/destroyed spawns, dead players, and saved-graph replay.');
};

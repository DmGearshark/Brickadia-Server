'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js'),model=require('./zone-bind-model.cjs'),C=b.COMPONENTS;
module.exports=function test(c,fromSaved=false){
 let m=model(c);m.enter('alice');m.drain();assert.equal(m.owner(),'alice');assert.equal(m.enabled(),true);assert.deepEqual(m.bindings,['alice']);
 m.enter('alice');m.drain();assert.deepEqual(m.queue(),['alice']);assert.deepEqual(m.bindings,['alice']);
 m.enter('bob');m.drain();assert.equal(m.owner(),'alice','Arrival cannot steal an occupied PC');m.leave('bob');m.drain();assert.equal(m.owner(),'alice','Another player leaving cannot unbind owner');m.enter('bob');m.drain();m.leave('alice');m.drain();assert.equal(m.owner(),'bob','Waiting occupant takes over on owner exit');m.leave('bob');m.drain();assert.equal(m.owner(),null);assert.equal(m.enabled(),false);
 m=model(c);m.enter('alice');m.drain();m.startPurchase();m.leave('alice');m.drain();assert.equal(m.owner(),'alice','Preserve transaction player until completion');assert.equal(m.enabled(),false,'Departed player controls disabled immediately');m.enter('bob');m.drain();assert.equal(m.owner(),'alice');m.finishPurchase();m.drain();assert.equal(m.owner(),'bob');
 m=model(c);m.enter('alice');m.drain();m.startPurchase();m.leave('alice');m.enter('alice');m.drain();m.finishPurchase();m.drain();assert.equal(m.owner(),'alice');assert.deepEqual(m.bindings,['alice'],'Re-entry during transaction retains ownership without rebinding');
 m.wait(1000000);m.drain();assert.equal(m.owner(),'alice','No inactivity timeout while inside zone');m.leave('alice');m.drain();assert.equal(m.owner(),null);
 m=model(c);m.enter('alice');m.drain();m.startPurchase();m.leave('alice');m.drain();m.finishPurchase();m.drain();assert.equal(m.owner(),null);assert.equal(m.enabled(),false);
 m=model(c);m.enter('alice');m.enter('bob');m.drain();assert.equal(m.owner(),'alice');assert.deepEqual(m.bindings,['alice']);
 m=model(c);m.enter(null);m.enter('alice');m.drain();assert.equal(m.owner(),'alice','Discard stale/null occupants');assert.deepEqual(m.queue(),['alice']);
 if(c.building){m=model(c);m.enter('alice');m.drain();m.startRebuild();m.leave('alice');m.enter('bob');m.drain();assert.equal(m.owner(),'alice');assert.equal(m.enabled(),false);m.finishRebuild();m.drain();assert.equal(m.owner(),'bob');}
 if(fromSaved)return;
 assert(!c.nodes.some(n=>n.comps.some(d=>d.type===C.Stopwatch.NAME)));assert(!c.bind.comps.some(d=>d.type===C.Button.NAME));
 const out=WorldReader.from(c.bytes),mapping=new Map([[1,1]]);[...c.r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));const defs=new Map(),actual=[],savedEdges=[],targets=new Set(),savedNodes=[];
 const addr=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]),point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]);
 for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;if(ch.numComponents)for(const d of out.componentChunk(g,ch.index).components){const position=bs[d.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));const n=c.nodes.find(n=>mapping.get(n.g)===g&&JSON.stringify(n.position)===JSON.stringify(position)&&n.comps.some(c=>c.type===d.typeName));assert(n,'Preserved component');const saved={...n,comps:n.comps.map(comp=>comp.type===d.typeName?{type:comp.type,data:d.data}:comp)};defs.set(addr(g,ch.index,d.brickIndex,d.typeName),{g,position,type:d.typeName,n:saved});if(n.id.startsWith('zone'))savedNodes.push(saved);}
  if(ch.numWires){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])savedEdges.push({g,ch:ch.index,...e});}}}
 for(const e of savedEdges){const a=defs.get(addr(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)),z=defs.get(addr(e.g,e.ch,e.target.brickIndex,e.target.componentType));assert(a&&z,'Saved endpoint');const target=point(z.g,z.position,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.position,a.type,e.source.port),target]));}
 assert.deepEqual(actual.sort(),c.edges.map(e=>JSON.stringify([point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)])).sort());
 for(const e of [c.entered,c.left]){const d=savedNodes.find(n=>n.id===e.id).comps[0].data;assert.equal(d.bCollisionEnabled_Player,true);assert(c.edges.some(x=>x.a===c.zone&&x.p==='ZoneRef'&&x.z===e&&x.q==='Zone'));}
 for(const n of c.originals)for(const comp of n.comps)if(comp.type===C.MapVar.NAME){const d=[...defs.values()].find(d=>d.n.id===n.id&&d.type===C.MapVar.NAME);assert(d);assert.deepEqual(d.n.comps.find(c=>c.type===C.MapVar.NAME).data.Value,comp.data.Value,'Catalogue preserved');}
 // Replay the new controller with component data read back from the BRZ.
 const replace=new Map(savedNodes.map(n=>[n.id,n]));const nodes=c.nodes.map(n=>replace.get(n.id)||n),edges=c.edges.map(e=>({...e,a:replace.get(e.a.id)||e.a,z:replace.get(e.z.id)||e.z}));
 test({...c,nodes,edges,entered:replace.get(c.entered.id),left:replace.get(c.left.id),busyEdge:replace.get(c.busyEdge.id)},true);
 // All original geometry is copied; only the manual bind components are removed.
 const mains=[...out.bricks(1)];for(const n of c.nodes.filter(n=>n.g===1)){const br=mains.find(b=>JSON.stringify(b.position)===JSON.stringify(n.position));assert(br);for(const k of ['size','color','direction','rotation','visibility','collision'])assert.deepEqual(br[k],n.brick[k]);}
 assert.deepEqual(out.prefabJson(),c.r.prefabJson());
 console.log('Zone checks passed: entry/exit, first-owner retention, waiting-player handoff, busy deferral, immediate control blocking, re-entry, stale occupants, timer removal and saved graph endpoints.');
};

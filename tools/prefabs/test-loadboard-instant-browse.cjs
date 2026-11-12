'use strict';
const assert=require('assert/strict'),crypto=require('crypto'),{read}=require('./reskin-loadboard.cjs'),{C}=require('./loadboard-lib.cjs'),model=require('./loadboard-model.cjs');
const {assertNoInstantCycles}=require('./loadboard-queue-repair.cjs');
const {serialized}=require('./test-optimized-loadboard.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const comp=(br,type)=>br.comps.find(c=>c.type===type);

function serialization(ctx){
 assertNoInstantCycles(ctx.scene);assertNoInstantCycles(ctx.client);
 serialized(ctx.scene,ctx.bytes);serialized(ctx.client,ctx.clientBytes);
 const saved=read(ctx.bytes),savedClient=read(ctx.clientBytes);
 assert.equal(saved.r.prefabPaths().length,ctx.original.r.prefabPaths().length,'same embedded prefab count');
 for(const path of ctx.original.r.prefabPaths().filter(p=>p!==ctx.oldPath))assert([...saved.r.prefabPaths()].some(p=>sha(saved.r.readPrefab(p))===sha(ctx.original.r.readPrefab(path))),'unchanged cargo embed retained byte-for-byte');
 const chat=saved.bricks.find(br=>comp(br,C.Event_ChatCommand.NAME)?.data.CommandName==='loadboard');
 const spawner=saved.bricks.find(br=>br.g===chat.g&&comp(br,C.Exec_PrefabSpawner.NAME));
 assert.equal(comp(spawner,C.Exec_PrefabSpawner.NAME).data.Prefab,ctx.newPath);
 const oldPhysical=ctx.oldClient.bricks.filter(br=>br.g===ctx.root.persistentIndex),newPhysical=savedClient.bricks.filter(br=>br.g===ctx.root.persistentIndex);
 assert.equal(newPhysical.length,oldPhysical.length,'display geometry/component bricks preserved');
 for(const old of oldPhysical){const current=newPhysical.find(br=>br.data.position.join()===old.data.position.join()&&br.data.asset===old.data.asset);assert(current,`physical brick ${old.data.position}`);assert.deepEqual(current.data,old.data,'physical geometry and collision unchanged');}
 assert.equal(savedClient.bricks.flatMap(br=>br.comps).filter(c=>c.type===C.FunctionCall.NAME).length,0,'local cache needs no authority Function call');
 assert(savedClient.bricks.flatMap(br=>br.comps).some(c=>c.type===C.Expr_Select.NAME),'local row selectors serialized');
 assert.equal(savedClient.bricks.flatMap(br=>br.comps).filter(c=>c.type===C.OneShotAudioEmitter.NAME).length,2,'confirmed accept/abandon sounds preserved');
}

function behavior(ctx){
 const portable=ctx.portable,m=model({main:{nodes:[],edges:[]},portable,central:{},optimized:true},{network:true,reactiveDelay:0,varDelay:0});
 m.addPlayer('alice');m.entities.set('board-alice',{props:{}});m.invoke(portable.init,['alice','board-alice',true]);m.advance(3);
 const initial=m.responses.filter(r=>r.name==='LB1.Request').at(-1);assert(initial,'initial listing request');
 const rows=['Alpha','Bravo','Charlie','Delta','Echo'].map((name,i)=>`${name}^${100+i}^Car^Pickup ${i}^Destination ${i}`).join('~');
 const details='x|x|x|x|x|7|0|x';m.invoke(portable.reply,['board-alice','alice','Ready',initial.args[7],'Load board',rows,details,0]);m.advance(1);
 const names=portable.ui.filter(n=>n.type===C.TextDisplay.NAME&&/Load [1-5]/.test(n.data.Text)).sort((a,z)=>z.pos[2]-a.pos[2]);
 assert.deepEqual(names.map(n=>m.read(n,'Text')),['Alpha','Bravo','>Charlie<','Delta','Echo']);
 const down=portable.ui.find(n=>n.type===C.Button.NAME&&n.data.PromptCustomLabel==='Scroll Down');assert(down);
 const before=m.tick,sentBefore=m.responses.filter(r=>r.name==='LB1.Request').length;m.press(down,'char-alice');m.advance(1);
 assert.deepEqual(names.map(n=>m.read(n,'Text')),['Bravo','Charlie','>Delta<','Echo','Alpha'],'cached rows rotate after only the native one-tick button snapshot');
 assert.equal(m.tick-before,1);assert.equal(m.published.get(portable.offset.id),1);
 assert.equal(m.responses.filter(r=>r.name==='LB1.Request').length,sentBefore,'background refresh waits one tick so the new index can settle');
 m.press(down,'char-alice');m.advance(1);assert.deepEqual(names.map(n=>m.read(n,'Text')),['Charlie','Delta','>Echo<','Alpha','Bravo'],'rapid browsing stays local while a refresh is in flight');
 const refresh=m.responses.filter(r=>r.name==='LB1.Request').at(-1);assert.equal(refresh.atTick,m.tick);assert.equal(refresh.args[2],0);assert.equal(refresh.args[3],1);
 m.advance(1);const latest=m.responses.filter(r=>r.name==='LB1.Request').at(-1);assert.equal(latest.atTick,m.tick,'latest settled index is refreshed after the local double-click');assert.equal(latest.args[3],2);assert(latest.args[7]>refresh.args[7]);
 const action=portable.ui.find(n=>n.type===C.Button.NAME&&n.data.PromptCustomLabel==='Accept/Abbandon');let count=m.responses.length;m.press(action,'char-alice');m.advance(1);assert.equal(m.responses.length,count,'transaction input stays locked until the authoritative refresh returns');
 m.invoke(portable.reply,['board-alice','alice','stale',refresh.args[7],'Load board',rows,details,0]);m.advance(1);assert.deepEqual(names.map(n=>m.read(n,'Text')),['Charlie','Delta','>Echo<','Alpha','Bravo'],'stale reply cannot roll the local selection backward');assert.equal(m.published.get(portable.busy.id),true);
 const rotated=['Charlie','Delta','Echo','Alpha','Bravo'].map((name,i)=>`${name}^${200+i}^Car^Pickup ${i}^Destination ${i}`).join('~');m.invoke(portable.reply,['board-alice','alice','Ready',latest.args[7],'Load board',rotated,'x|x|x|x|x|8|0|x',0]);m.advance(1);assert.deepEqual(names.map(n=>m.read(n,'Text')),['Charlie','Delta','>Echo<','Alpha','Bravo']);assert.equal(m.published.get(portable.offset.id),0);assert.equal(m.published.get(portable.busy.id),false);
 count=m.responses.length;m.press(action,'char-alice');m.advance(1);assert.equal(m.responses.length,count,'transaction request also snapshots settled client state');m.advance(1);assert.equal(m.responses.length,count+1,'accept request resumes after the authoritative refresh');const accept=m.responses.at(-1);assert.equal(accept.args[2],1);assert.equal(accept.args[3],2);assert.equal(accept.args[4],8);assert.equal(m.published.get(portable.pendingOp.id),1);
 const selected=m.published.get(portable.index.id);count=m.responses.length;m.press(down,'char-alice');m.advance(1);assert.equal(m.published.get(portable.index.id),selected,'browsing cannot supersede an in-flight transaction');assert.equal(m.responses.length,count);
}

module.exports=function test(ctx){serialization(ctx);behavior(ctx);console.log('Instant-browse checks passed: complete authority preserved, cargo embeds byte-identical, physical display unchanged, cached rows rotate in one tick, asynchronous refresh follows, and transactions remain locked until validated.');};

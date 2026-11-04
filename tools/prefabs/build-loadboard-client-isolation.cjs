'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');const {source}=require('./loadboard-lib.cjs'),C=b.COMPONENTS,schema=b.embeddedSchema('BRSavedComponentChunkSoA_max');
const key=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
function variant(bytes,mode){
 const r=WorldReader.from(bytes),w=new World(),grids=new Map([[1,undefined]]),nodes=new Map(),wires=[],links=[];
 for(const e of r.entities())grids.set(e.persistentIndex,w.addBrickGrid({type:e.typeName,location:e.location,rotation:e.rotation,frozen:e.frozen,sleeping:e.sleeping,data:{bCollapsed:e.data.bCollapsed,PlaneCenter:e.data.PlaneCenter,PlaneExtent:e.data.PlaneExtent}}));
 let removed=0;
 for(const g of r.gridIds()){const all=[...r.bricks(g)];let off=0;for(const ch of r.brickChunkIndex(g)){const bs=all.slice(off,off+ch.numBricks);off+=ch.numBricks;const cc=ch.numComponents?r.componentChunk(g,ch.index):null;
  for(let i=0;i<bs.length;i++){const br=bs[i],comps=(cc?.components||[]).filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}));
   const omit=mode==='chip'?g!==1:mode==='noqueue'&&comps.some(c=>c.type===C.QueueTicks.NAME);if(omit){removed++;continue;}
   const components=mode==='chip'?comps.filter(c=>[C.TextDisplay.NAME,'Component_Internal_Microchip'].includes(c.type)):comps;
   const position=br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));const data={...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],owner_index:0,position,components};delete data.asset_name_index;delete data.material_index;
   nodes.set(key(g,ch.index,i),{handle:w.addBrick(data,grids.get(g)),components,position,g});
  }
  if(cc)for(let i=0;i<cc.soa.MicrochipBrickIndices.length;i++)links.push([key(g,ch.index,cc.soa.MicrochipBrickIndices[i]),cc.soa.MicrochipBrickGridReferences[i]]);
  if(ch.numWires){const ws=r.wireChunk(g,ch.index);for(const edge of [...ws.local,...ws.remote])wires.push({a:key(edge.source.gridId??g,edge.source.chunk??ch.index,edge.source.brickIndex),at:edge.source.componentType,p:edge.source.port,z:key(g,ch.index,edge.target.brickIndex),zt:edge.target.componentType,q:edge.target.port});}
 }}
 for(const [node,g]of links)w.registerMicrochipLink(nodes.get(node).handle,grids.get(g));
 if(mode==='chip')for(const [g,grid]of grids)if(g!==1)w.addBrick({asset:C.Var.BRICK,position:[0,0,2],components:[{type:C.Var.NAME,data:{Value:{$variant:'str',value:'Chip baseline'}}}]},grid);
 const kept=mode==='noqueue'?wires.filter(e=>nodes.has(e.a)&&nodes.has(e.z)):[];
 for(const e of kept)w.addWire({brick:nodes.get(e.a).handle,component_type:e.at,port:e.p},{brick:nodes.get(e.z).handle,component_type:e.zt,port:e.q});
 const output=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Client spawn isolation: '+mode,description:'Uninitialized spawn-only diagnostic. No server initialization. Chip baseline, disconnected full client, or client with QueueTicks bricks removed.'}});
 const out=WorldReader.from(output);let queues=0,count=0,buttons=0,savedWires=0;for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){for(const c of ch.numComponents?out.componentChunk(g,ch.index).components:[]){if(c.typeName===C.QueueTicks.NAME)queues++;if(c.typeName===C.Button.NAME)buttons++;count++;}if(ch.numWires){const ws=out.wireChunk(g,ch.index);savedWires+=ws.local.length+ws.remote.length;}}
 assert.equal(savedWires,kept.length);if(mode==='chip'){assert.equal(queues,0);assert.equal(buttons,0);}if(mode==='noqueue')assert.equal(queues,0);if(mode==='gates')assert(queues>0);
 return {bytes:output,mode,removed,components:count,queueGates:queues,wires:kept.length};
}
function build(input){
 const original=require('./loadboard-terminal.cjs')(source(input)),variants=['chip','gates','noqueue'].map(mode=>variant(original.bytes,mode));
 // Reuse the direct wallet-style helper, not the failing command dispatcher.
 const helpers=require('./build-wallet-name-demo.cjs').helpers;
 const w=new World(),chip=w.addMicrochip({position:[-50,0,0],color:[165,100,45]}),c=helpers.circuit(w,chip.grid),spawns=[];
 for(const [i,v]of variants.entries()){
  const path=w.addPrefab(v.bytes),name=['lbchip','lbgates','lbnoqueue'][i],command=c.node('Event_ChatCommand',{CommandName:name,HelpText:'Client construction crash isolation. No initialization; do not click controls.'}),player=c.variable({$variant:'weak_object',value:null}),save=c.set(player);c.connect(command,'PlayerState',save,'Value');c.chain(command,save);
  const delay=c.node('BufferTicks',{TicksToWait:2,ZeroTicksToWait:0});c.connect(save,'ExecOut',delay,'Input');const spawn=c.node('Exec_PrefabSpawner',{Prefab:path,Lifetime:180,Limit:1,SpawnOffset:{X:0,Y:0,Z:60},SpawnOffsetRotation:{Pitch:0,Yaw:0,Roll:0},SpawnVelocity:{X:0,Y:0,Z:0}},[0,(i-1)*70,0],'main');c.connect(delay,'Output',spawn,'Exec');
  const returned=c.node('Exec_PlayerState_ShowChatMessage',{Message:name+' spawner returned. If its body appeared without a crash, that stage passed.'});c.connect(player,'Value',returned,'PlayerState');c.chain(spawn,returned);spawns.push({command,spawn,returned,path});
 }
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,100,24],position:[-50,0,70],direction:4,rotation:2,color:[18,20,25],components:[{type:C.TextDisplay.NAME,data:{Text:'CLIENT SPAWN ISOLATION\r\n/lbchip -> /lbgates -> /lbnoqueue\r\nNo initialization. Do not click controls.',Font:0,Face:0,LineHeight:2,WidthScale:1,bEnabled:true,Color:{R:255,G:230,B:180,A:255},bOverrideColor:true}}]});
 const bytes=w.toBrz({prefab:helpers.prefab({x:110,y:115,z:110}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Load-board client construction isolation',description:'Three independent spawn-only variants isolate simple chip attachment, disconnected client components, and QueueTicks removal. No initialization, rotation, server calls or payments.'}});
 return {bytes,variants,c,spawns,original};
}
module.exports=build;
if(require.main===module){const [input,out]=process.argv.slice(2);if(!out)throw Error('Usage: node build-loadboard-client-isolation.cjs v5.brz output.brz');try{const ctx=build(input);require('./test-loadboard-client-isolation.cjs')(ctx);fs.writeFileSync(out,ctx.bytes);console.log(JSON.stringify({output:out,variants:ctx.variants.map(({bytes,...v})=>v)},null,2));}catch(e){console.error(e.message);console.error(e.stack.split('\n').filter(x=>x.includes('/tools/prefabs/')&&!x.includes('/node_modules/')).join('\n'));process.exitCode=1;}}

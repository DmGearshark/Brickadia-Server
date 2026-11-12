'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World}=require('brs-js');
const {read,write}=require('./reskin-loadboard.cjs');
const {C}=require('./loadboard-lib.cjs');
const terminal=require('./loadboard-terminal.cjs');
const compact=require('./compact-loadboard-logic.cjs');
const {component,assetTable,confirmationAudio}=require('./loadboard-presentation-lib.cjs');

const comp=(br,type)=>br.comps.find(c=>c.type===type);

function build(input,reference){
 const original=read(fs.readFileSync(input)),scene=read(fs.readFileSync(input));
 const chat=scene.bricks.find(br=>comp(br,C.Event_ChatCommand.NAME)?.data.CommandName==='loadboard');
 assert(chat,'loadboard command');
 const spawner=scene.bricks.find(br=>br.g===chat.g&&comp(br,C.Exec_PrefabSpawner.NAME));
 assert(spawner,'loadboard prefab spawner');
 const spawn=comp(spawner,C.Exec_PrefabSpawner.NAME),oldPath=spawn.data.Prefab;
 const oldClient=read(scene.r.readPrefab(oldPath)),client=read(scene.r.readPrefab(oldPath));
 const logicEvent=client.bricks.find(br=>comp(br,C.Event_CustomGlobal.NAME)?.data.EventName==='LB1.BoardInit');
 assert(logicEvent,'portable client init event');
 const logicGrid=logicEvent.g,root=[...client.r.entities()].find(e=>e.typeName==='Entity_DynamicBrickGrid');
 assert(root,'portable display root');
 const physical=client.bricks.filter(br=>br.g===root.persistentIndex),chip=physical.find(br=>comp(br,C.Microchip.NAME));
 assert(chip,'portable display microchip');
 const layout=physical.filter(br=>br!==chip).map(br=>({brick:structuredClone(br.data),comps:structuredClone(br.comps)}));
 const portable=terminal({assets:client.r.externalAssets(),bricks:[]},{layout,richRows:true,fast:true,localBrowse:true,chipPosition:chip.data.position});

 const uiKeys=new Map();
 for(const node of portable.ui){
  const br=physical.find(br=>br.data.position.join()===node.pos.join()&&comp(br,node.type));
  assert(br,`display endpoint ${node.type} at ${node.pos}`);
  uiKeys.set(node.id,br.key);
  comp(br,node.type).data=structuredClone(node.data);
 }
 const oldLogicKeys=new Set(client.bricks.filter(br=>br.g===logicGrid).map(br=>br.key));
 client.bricks=client.bricks.filter(br=>!oldLogicKeys.has(br.key));
 client.edges=client.edges.filter(e=>!oldLogicKeys.has(e.a)&&!oldLogicKeys.has(e.z));
 const key=node=>uiKeys.get(node.id)||`instantClient:${node.id}`;
 for(const node of portable.b.nodes.filter(node=>!uiKeys.has(node.id))){
  const def=Object.values(C).find(c=>c.NAME===node.type);assert(def,node.type);
  client.bricks.push({key:key(node),g:logicGrid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[...node.pos],size:def.BRICK.startsWith('PB_Gate_')?[10,5,2]:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[50,110,150],owner_index:0},comps:[{type:node.type,data:structuredClone(node.data)}]});
 }
 for(const edge of portable.b.edges)client.edges.push({a:key(edge.a),at:edge.a.type,p:edge.p,z:key(edge.z),zt:edge.z.type,q:edge.q});

 const nodeRef=node=>({key:key(node),type:node.type});
 const receiveEdge=portable.b.edges.find(e=>e.a===portable.reply&&e.p==='ExecOut'&&e.z.type===C.QueueTicks.NAME);
 assert(receiveEdge,'reply snapshot queue');
 const matchEdge=portable.b.edges.find(e=>e.a===receiveEdge.z&&e.p==='ExecOut'&&e.z.type===C.Exec_Branch.NAME);
 assert(matchEdge,'reply identity/nonce check');
 const acceptedBrick=physical.find(br=>br.data.position.join()==='0,0,0'&&comp(br,C.OneShotAudioEmitter.NAME));
 const abandonedBrick=physical.find(br=>br.data.position.join()==='3,-14,-11'&&comp(br,C.OneShotAudioEmitter.NAME));
 assert(acceptedBrick&&abandonedBrick,'existing confirmed-action sound emitters');
 confirmationAudio(client,{valid:nodeRef(matchEdge.z),fields:{message:{node:nodeRef(receiveEdge.z),port:'DataOut5'},nonce:{node:nodeRef(receiveEdge.z),port:'DataOut4'}},messages:['Load accepted','Load returned','Load abandoned'],targetA:component(client,acceptedBrick.key,C.OneShotAudioEmitter.NAME),targetB:component(client,abandonedBrick.key,C.OneShotAudioEmitter.NAME),prefix:'clientAudio'});

 const referenceScene=read(fs.readFileSync(reference));
 const sections=compact(client,{gridGroups:{}},referenceScene,{client:true});
 const clientAssets=assetTable(client).assets;
 const clientBytes=write(client,{assets:clientAssets,name:'Scrap Runners Load Board - Instant Local Browsing',description:'Portable board caches the latest five offers and rotates the visible rows locally. Server authority remains responsible for acceptance, abandonment, ownership and payment.'}).bytes;
 const newPath=new World().addPrefab(clientBytes);spawn.data.Prefab=newPath;
 const retained=scene.r.prefabPaths().filter(p=>p!==oldPath).map(p=>scene.r.readPrefab(p));
 const out=write(scene,{embedded:[...retained,clientBytes],name:'Scrap Runners Load Board - Instant Local Browsing',description:'Complete authoritative Scrap Runners load board with one-tick local browsing and server-validated transactions.'});
 assert(out.paths.includes(newPath));
 return {bytes:out.bytes,original,scene,oldClient,client,clientBytes,oldPath,newPath,portable,logicGrid,root,physical,spawner,sections,input,reference};
}

module.exports=build;
if(require.main===module){
 const [input,reference,output]=process.argv.slice(2);
 if(!output)throw Error('Usage: node build-loadboard-instant-browse.cjs input.brz reference.brz output.brz');
 try{const ctx=build(input,reference);require('./test-loadboard-instant-browse.cjs')(ctx);fs.writeFileSync(output,ctx.bytes);console.log(JSON.stringify({output,bytes:ctx.bytes.length,clientBytes:ctx.clientBytes.length,clientComponents:ctx.client.bricks.flatMap(b=>b.comps).length,clientWires:ctx.client.edges.length,sections:ctx.sections.length},null,2));}
 catch(e){console.error(e.stack||e);process.exitCode=1;}
}

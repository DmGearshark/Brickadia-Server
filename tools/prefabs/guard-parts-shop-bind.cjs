'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node guard-parts-shop-bind.cjs saved.brz output.brz');
const r=WorldReader.from(fs.readFileSync(source)),w=new World(),C=b.COMPONENTS,schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),grids=new Map([[1,undefined]]),nodes=new Map(),edges=[];
const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
for(const e of r.entities())grids.set(e.persistentIndex,w.addBrickGrid({type:e.typeName,location:e.location,rotation:e.rotation,frozen:e.frozen,sleeping:e.sleeping,data:{bCollapsed:e.data.bCollapsed,PlaneCenter:e.data.PlaneCenter,PlaneExtent:e.data.PlaneExtent}}));
for(const g of r.gridIds()){
 const all=[...r.bricks(g)];let offset=0;
 for(const ch of r.brickChunkIndex(g)){
  const bricks=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=r.componentChunk(g,ch.index);
  for(let i=0;i<bricks.length;i++){
   const br=bricks[i],comps=cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}));
   const position=br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));
   const data={...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],owner_index:0,position,components:comps};delete data.asset_name_index;delete data.material_index;
   const n={g,i,ch:ch.index,position,comps,handle:w.addBrick(data,grids.get(g))};nodes.set(address(g,ch.index,i),n);
  }
  for(let i=0;i<cc.soa.MicrochipBrickIndices.length;i++)w.registerMicrochipLink(nodes.get(address(g,ch.index,cc.soa.MicrochipBrickIndices[i])).handle,grids.get(cc.soa.MicrochipBrickGridReferences[i]));
  const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({a:nodes.get(address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex)),aKey:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,zKey:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});
 }
}
for(const e of edges){e.a=nodes.get(e.aKey);e.z=nodes.get(e.zKey);assert(e.a&&e.z);}
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const logicGrid=4;
const at=(p,type)=>one([...nodes.values()].filter(n=>n.g===logicGrid&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+p);
const bind=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Button.NAME&&c.data.PromptCustomLabel==='Bind self to Computer')),'Bind button');
const ready=one(edges.filter(e=>e.a===bind&&e.p==='bHeld'&&e.zt===C.Expr_LogicalAND.NAME),'Character-ready signal').z;
const pulse=one(edges.filter(e=>e.a===ready&&e.zt===C.Expr_EdgeDetector.NAME),'Bind rising edge').z;
const routes=edges.filter(e=>e.a===pulse&&e.p==='bPulseOnRisingEdge');assert.equal(routes.length,3);
const busy=one([...nodes.values()].filter(n=>n.g===3&&JSON.stringify(n.position)===JSON.stringify([48,624,2])&&n.comps.some(c=>c.type===C.Var.NAME)),'Purchase busy');
const building=one([...nodes.values()].filter(n=>n.g===3&&JSON.stringify(n.position)===JSON.stringify([432,0,2])&&n.comps.some(c=>c.type===C.Var.NAME)),'Catalogue rebuilding');
const processing=one(edges.filter(e=>e.a===busy&&e.p==='Value'&&e.zt===C.Expr_LogicalOR.NAME),'Processing signal').z;
assert(edges.some(e=>e.a===building&&e.z===processing&&e.q==='bInputB'));
const idle=one(edges.filter(e=>e.a===processing&&e.p==='bOutput'&&e.zt===C.Expr_LogicalNOT.NAME),'Idle signal').z;
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));let added=0;const fresh=[];
function node(k,data={}){const position=[maxX+96+(added%3)*48,Math.floor(added/3)*48,2],n={position,type:C[k].NAME,data};added++;n.handle=w.addBrick({asset:C[k].BRICK,position,color:[55,100,165],components:[{type:n.type,data}]},grids.get(logicGrid));fresh.push(n);return n;}
// Sample the guard once on the press. A held/rejected press must not become
// accepted merely because processing ends before the button is released.
const check=node('Exec_Branch'),accepted=node('Var',{Value:{$variant:'Bool',value:false}}),on=node('Exec_Var_Set',{Value:{$variant:'Bool',value:true}}),tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0}),off=node('Exec_Var_Set',{Value:{$variant:'Bool',value:false}});
const planned=[];function wire(a,at,p,z,zt,q){w.addWire({brick:a.handle,component_type:at,port:p},{brick:z.handle,component_type:zt,port:q});planned.push({a,at,p,z,zt,q});}
for(const e of edges)if(routes.includes(e))wire(accepted,C.Var.NAME,'Value',e.z,e.zt,e.q);else wire(e.a,e.at,e.p,e.z,e.zt,e.q);
wire(pulse,C.Expr_EdgeDetector.NAME,'bPulseOnRisingEdge',check,check.type,'Exec');wire(idle,C.Expr_LogicalNOT.NAME,'bOutput',check,check.type,'bCond');wire(check,check.type,'ExecOutA',on,on.type,'Exec');wire(accepted,accepted.type,'VarRef',on,on.type,'VarRef');wire(on,on.type,'ExecOut',tick,tick.type,'Input');wire(tick,tick.type,'Output',off,off.type,'Exec');wire(accepted,accepted.type,'VarRef',off,off.type,'VarRef');
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Parts Shop - Protected Bind',description:'Rebinding is accepted only while purchases and catalogue rebuilding are idle. Busy presses are rejected rather than queued; binding remains one action per press.'}}),out=WorldReader.from(bytes);
// Verify rejection is latched to the press, including a hold across completion.
function scenario(steps){let held=false,owner='alice',busy=false,building=false;for(const event of steps){if('busy'in event)busy=event.busy;if('building'in event)building=event.building;if('held'in event){const rising=event.held&&!held;held=event.held;if(rising&&!busy&&!building&&event.player)owner=event.player;}}return owner;}
assert.equal(scenario([{busy:true},{held:true,player:'bob'},{busy:false},{held:true,player:'bob'}]),'alice');
assert.equal(scenario([{building:true},{held:true,player:'bob'},{building:false},{held:true,player:'bob'}]),'alice');
assert.equal(scenario([{busy:true},{held:true,player:'bob'},{busy:false},{held:false},{held:true,player:'bob'}]),'bob');
assert.equal(scenario([{held:true,player:'bob'}]),'bob');
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const defs=new Map(),saved=[];for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const c of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,pos:bs[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:c.typeName});const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])saved.push({g,ch:ch.index,...e});}}
const point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]),actual=[],targets=new Set();for(const e of saved){const a=defs.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=defs.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z);const target=point(z.g,z.pos,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.pos,a.type,e.source.port),target]));}
const location=n=>({g:n.g===undefined?mapping.get(logicGrid):mapping.get(n.g),pos:n.position});assert.deepEqual(actual.sort(),planned.map(e=>{const a=location(e.a),z=location(e.z);return JSON.stringify([point(a.g,a.pos,e.at,e.p),point(z.g,z.pos,e.zt,e.q)]);}).sort());assert.equal(saved.length,edges.length+7);assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,addedGates:added,guardedBindRoutes:routes.length,wires:saved.length},null,2));

'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node slow-zone-dealership-test.cjs zone-shop.brz test.brz');
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
const mode=one([...nodes.values()].filter(n=>n.comps.some(c=>c.type===C.Expr_Select.NAME&&c.data.InputA?.value===1&&c.data.InputB?.value===2)),'Buy/Sell mode selector');
const logicGrid=mode.g;
const assignment=one(edges.filter(e=>e.a===mode&&e.zt===C.Exec_Var_Set.NAME&&e.q==='Value'),'Trade mode assignment').z;
const incoming=one(edges.filter(e=>e.z===assignment&&e.q==='Exec'),'Trade lock before mode');assert.equal(incoming.at,C.Exec_Var_Set.NAME);
assert.equal(incoming.a.comps.find(c=>c.type===C.Exec_Var_Set.NAME).data.Value.value,true,'Busy is set before the delayed entry');
const original=one(edges.filter(e=>e.a===assignment&&e.p==='ExecOut'),'Transaction entry route');
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0])),position=[maxX+96,0,2];
const timer=w.addBrick({asset:C.Stopwatch.BRICK,position,color:[190,120,30],components:[{type:C.Stopwatch.NAME,data:{Limit:2,Time:0,bRunning:false}}]},grids.get(logicGrid));
for(const n of nodes.values())for(const c of n.comps)if(n.g===1&&c.type===C.TextDisplay.NAME&&c.data.Text==='Dealership')c.data.Text='TEST 2s';
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
for(const e of edges)if(e!==original)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
wire(assignment.handle,C.Exec_Var_Set.NAME,'ExecOut',timer,C.Stopwatch.NAME,'Restart');wire(timer,C.Stopwatch.NAME,'Expired',original.z.handle,original.zt,original.q);
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'TEST ONLY - Zone Dealership 2 Second Delay',description:'Temporary exit-during-transaction test. Each Buy/Sell request locks its player/mode, waits two seconds, then runs the original fresh validation and transaction. Production prefab unchanged.'}}),out=WorldReader.from(bytes);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const defs=new Map(),saved=[];for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;if(ch.numComponents)for(const c of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,pos:bs[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:c.typeName,data:c.data});if(ch.numWires){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])saved.push({g,ch:ch.index,...e});}}}
const point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]),actual=[],targets=new Set();for(const e of saved){const a=defs.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=defs.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z);const target=point(z.g,z.pos,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.pos,a.type,e.source.port),target]));}
const planned=edges.filter(e=>e!==original).map(e=>JSON.stringify([point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)]));planned.push(JSON.stringify([point(mapping.get(assignment.g),assignment.position,C.Exec_Var_Set.NAME,'ExecOut'),point(mapping.get(logicGrid),position,C.Stopwatch.NAME,'Restart')]),JSON.stringify([point(mapping.get(logicGrid),position,C.Stopwatch.NAME,'Expired'),point(mapping.get(original.z.g),original.z.position,original.zt,original.q)]));assert.deepEqual(actual.sort(),planned.sort());
const clock=one([...defs.values()].filter(d=>d.type===C.Stopwatch.NAME),'Test delay timer');assert.equal(clock.data.Limit,2);assert.equal(clock.data.Time,0);assert.equal(clock.data.bRunning,false);assert.equal(saved.length,edges.length+1);assert.deepEqual(out.prefabJson(),r.prefabJson());
// No leaderboard or ownership mutation is added: only the original transaction
// entry is delayed after locking, before its fresh reads and write validation.
for(const n of nodes.values())for(const comp of n.comps)if(comp.type===C.MapVar.NAME){const d=[...defs.values()].find(d=>d.g===mapping.get(n.g)&&d.type===comp.type&&JSON.stringify(d.pos)===JSON.stringify(n.position));assert.deepEqual(d.data.Value,comp.data.Value);}
fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,testDelaySeconds:2,addedGates:1,wires:saved.length,productionUnchanged:true},null,2));

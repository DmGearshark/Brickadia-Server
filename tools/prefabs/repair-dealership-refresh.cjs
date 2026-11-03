'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node repair-dealership-refresh.cjs saved.brz repaired.brz');
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
const logicGrid=one([...r.entities()].filter(e=>[...r.bricks(e.persistentIndex)].length>100),'Logic grid').persistentIndex;
const at=(p,type)=>one([...nodes.values()].filter(n=>n.g===logicGrid&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+p);
const completed=at([0,816,2],C.Exec_Union.NAME),refresh=at([48,240,2],C.Exec_Var_Set.NAME);
assert(!edges.some(e=>e.z===refresh&&e.q==='Exec'),'Expected the missing completion wire');
// Find the busy variable from the common true setters, rather than its saved index.
const busy=at([48,0,2],C.Var.NAME);assert.equal(busy.comps.find(c=>c.type===C.Var.NAME).data.Value.$variant,'Bool');busy.comps.find(c=>c.type===C.Var.NAME).data.Value.value=false;
const modeWire=one(edges.filter(e=>e.z===refresh&&e.q==='VarRef'),'Refresh mode reference');modeWire.a.comps.find(c=>c.type===C.Var.NAME).data.Value.value=0;
for(const n of nodes.values())for(const c of n.comps)if(c.type===C.Var.NAME&&c.data.Value?.value==='Updating…')c.data.Value.value='Bind player';
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));
const tickPosition=[maxX+96,48,2],tick=w.addBrick({asset:C.BufferTicks.BRICK,position:tickPosition,color:[55,100,165],components:[{type:C.BufferTicks.NAME,data:{TicksToWait:1,ZeroTicksToWait:0}}]},grids.get(logicGrid));
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
for(const e of edges)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
wire(completed.handle,C.Exec_Union.NAME,'ExecOut',tick,C.BufferTicks.NAME,'Input');wire(tick,C.BufferTicks.NAME,'Output',refresh.handle,C.Exec_Var_Set.NAME,'Exec');
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Buffered Refresh Repair',description:'Restores the missing transaction-completion refresh through a one-tick buffer and clears the saved busy state. Layout/settings preserved.'}}),out=WorldReader.from(bytes);
// Readback: preserve the physical arrangement and every original wire endpoint.
function geometry(reader,g){const all=[...reader.bricks(g)],result=[];let offset=0;for(const ch of reader.brickChunkIndex(g)){for(const br of all.slice(offset,offset+ch.numBricks)){const data={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index],position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]))};delete data.asset_name_index;delete data.material_index;result.push(JSON.stringify(data));}offset+=ch.numBricks;}return result;}
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
for(const g of r.gridIds()){const after=new Set(geometry(out,mapping.get(g)));for(const br of geometry(r,g))assert(after.has(br),'User geometry preserved');}
let savedWires=0;const inputs=new Set();for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){savedWires++;const key=JSON.stringify([g,ch.index,e.target]);assert(!inputs.has(key),'Unique saved targets');inputs.add(key);}}
// Compare canonical saved edges, not only the wire count.
function savedGraph(reader){const definitions=new Map(),result=[];for(const g of reader.gridIds()){const all=[...reader.bricks(g)];let offset=0;for(const ch of reader.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=reader.componentChunk(g,ch.index);for(const c of cc.components)definitions.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,position:bs[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:c.typeName,data:c.data});}}for(const g of reader.gridIds())for(const ch of reader.brickChunkIndex(g)){const ws=reader.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const a=definitions.get(address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex)+e.source.componentType),z=definitions.get(address(g,ch.index,e.target.brickIndex)+e.target.componentType);assert(a&&z,'Saved endpoint exists');result.push({a,p:e.source.port,z,q:e.target.port});}}return {definitions,result};}
const saved=savedGraph(out),point=(g,position,type,port)=>JSON.stringify([g,position,type,port]);
const canonical=e=>JSON.stringify([point(e.a.g,e.a.position,e.a.type,e.p),point(e.z.g,e.z.position,e.z.type,e.q)]);
const expected=edges.map(e=>({a:{g:mapping.get(e.a.g),position:e.a.position,type:e.at},p:e.p,z:{g:mapping.get(e.z.g),position:e.z.position,type:e.zt},q:e.q}));
const newTick={g:mapping.get(logicGrid),position:tickPosition,type:C.BufferTicks.NAME};
expected.push({a:{g:mapping.get(logicGrid),position:completed.position,type:C.Exec_Union.NAME},p:'ExecOut',z:newTick,q:'Input'},{a:newTick,p:'Output',z:{g:mapping.get(logicGrid),position:refresh.position,type:C.Exec_Var_Set.NAME},q:'Exec'});
assert.deepEqual(saved.result.map(canonical).sort(),expected.map(canonical).sort());
// Execution feedback must cross a buffer; a direct completion feedback cycle
// is the edge lost by the in-game paste of the previous version.
const adjacency=new Map();for(const e of saved.result)if(/^ExecOut[AB]?$/.test(e.p)&&e.a.type!==C.BufferTicks.NAME){const a=point(e.a.g,e.a.position,e.a.type,''),z=point(e.z.g,e.z.position,e.z.type,'');if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(z);}
const active=new Set(),visited=new Set();function visit(a){assert(!active.has(a),'Unbuffered execution cycle');if(visited.has(a))return;active.add(a);for(const z of adjacency.get(a)||[])visit(z);active.delete(a);visited.add(a);}for(const a of adjacency.keys())visit(a);
for(const n of nodes.values())for(const c of n.comps)if(c.type===C.MapVar.NAME){const savedMap=[...saved.definitions.values()].find(a=>a.g===mapping.get(n.g)&&a.type===c.type&&JSON.stringify(a.position)===JSON.stringify(n.position));assert.deepEqual(savedMap.data.Value,c.data.Value,'Editable maps preserved');}
const busySaved=[...saved.definitions.values()].find(n=>n.g===mapping.get(logicGrid)&&n.type===C.Var.NAME&&JSON.stringify(n.position)===JSON.stringify(busy.position));assert.equal(busySaved.data.Value.value,false);
assert.equal(savedWires,edges.length+2);assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,originalWires:edges.length,repairedWires:savedWires,addedGates:1,layoutPreserved:true},null,2));

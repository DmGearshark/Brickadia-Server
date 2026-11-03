'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node blank-idle-dealership.cjs saved.brz output.brz');
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
const indicator=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='■')),'Indicator');
const indicatorColor=one(edges.filter(e=>e.z===indicator&&e.zt===C.TextDisplay.NAME&&e.q==='Color'),'Indicator color input');
const bindingSignal=one(edges.filter(e=>e.z===indicatorColor.a&&e.q==='Alpha'),'Indicator binding state');
assert.equal(bindingSignal.at,C.Expr_CompareNotEqual.NAME);
const screens=[...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&!['■','▲','▼'].includes(c.data.Text)));
assert.equal(screens.length,6,'Expected six text displays on the screen');
for(const n of screens){assert(!edges.some(e=>e.z===n&&e.zt===C.TextDisplay.NAME&&e.q==='bEnabled'),'Already enabled by another source');n.comps.find(c=>c.type===C.TextDisplay.NAME).data.bEnabled=false;}
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
for(const e of edges)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
for(const n of screens)wire(bindingSignal.a.handle,bindingSignal.at,bindingSignal.p,n.handle,C.TextDisplay.NAME,'bEnabled');
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Idle Black Screen',description:'All six screen text displays are enabled only while a player is bound. The binding indicator and external scroll arrows remain visible.'}}),out=WorldReader.from(bytes);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const defs=new Map(),savedEdges=[];for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){for(const c of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,c.brickIndex)+c.typeName,c);const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])savedEdges.push({g,ch:ch.index,...e});}
assert.equal(savedEdges.length,edges.length+screens.length);
const targets=new Set();for(const e of savedEdges){const a=address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType,z=address(e.g,e.ch,e.target.brickIndex)+e.target.componentType;assert(defs.has(a)&&defs.has(z));const target=z+':'+e.target.port;assert(!targets.has(target));targets.add(target);}
const enabled=savedEdges.filter(e=>e.g===1&&e.target.componentType===C.TextDisplay.NAME&&e.target.port==='bEnabled');assert.equal(enabled.length,6);
for(const e of enabled){assert.equal(e.source.componentType,bindingSignal.at);assert.equal(e.source.port,'bOutput');const c=defs.get(address(1,e.ch,e.target.brickIndex)+C.TextDisplay.NAME);assert.equal(c.data.bEnabled,false);assert(!['■','▲','▼'].includes(c.data.Text));}
for(const c of defs.values())if(c.typeName===C.TextDisplay.NAME&&['■','▲','▼'].includes(c.data.Text))assert.equal(c.data.bEnabled,true);
function geometry(reader,g){const all=[...reader.bricks(g)],result=[];let offset=0;for(const ch of reader.brickChunkIndex(g)){for(const br of all.slice(offset,offset+ch.numBricks)){const data={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index],position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]))};delete data.asset_name_index;delete data.material_index;result.push(JSON.stringify(data));}offset+=ch.numBricks;}return result;}
for(const g of r.gridIds()){const after=new Set(geometry(out,mapping.get(g)));for(const br of geometry(r,g))assert(after.has(br),'Original geometry and brick colors preserved');}
assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,screenDisplays:screens.length,addedGates:0,addedWires:screens.length,indicatorVisible:true},null,2));

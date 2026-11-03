'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node edge-parts-shop-bind.cjs saved.brz output.brz');
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
const held=one(edges.filter(e=>e.a===bind&&e.p==='bHeld'&&e.zt===C.Expr_LogicalAND.NAME),'Character-ready bind signal').z;
// Keep raw held input on the text blend and the existing timeout edge detector.
// The legacy bind routes expect boolean signals, so use the boolean rising pulse.
const routes=edges.filter(e=>e.a===held&&e.p==='bOutput'&&e.zt!==C.Expr_EdgeDetectorExec.NAME);assert.equal(routes.length,3,'Three legacy bind routes');
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0])),position=[maxX+96,0,2];
const pulse=w.addBrick({asset:C.Expr_EdgeDetector.BRICK,position,color:[55,100,165],components:[{type:C.Expr_EdgeDetector.NAME,data:{Input:0,InputLast:0,bSeeded:true}}]},grids.get(logicGrid));
const expected=[];for(const e of edges){const selected=routes.includes(e),a=selected?pulse:e.a.handle,at=selected?C.Expr_EdgeDetector.NAME:e.at,p=selected?'bPulseOnRisingEdge':e.p;w.addWire({brick:a,component_type:at,port:p},{brick:e.z.handle,component_type:e.zt,port:e.q});expected.push({...e,newPulse:selected});}
w.addWire({brick:held.handle,component_type:C.Expr_LogicalAND.NAME,port:'bOutput'},{brick:pulse,component_type:C.Expr_EdgeDetector.NAME,port:'Input'});
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Parts Shop - Bind Press Edge',description:'A character-ready rising-edge pulse triggers the bind/reset routes once per press. Held text animation and inactivity tracking are retained.'}}),out=WorldReader.from(bytes);
// Exercise Held-first, Character-first, long hold, release and a second click.
function pulses(samples){let last=false,total=0;for(const [held,character]of samples){const value=held&&character!==null;if(value&&!last)total++;last=value;}return total;}
assert.equal(pulses([[false,null],[true,null],[true,'alice'],...Array(120).fill([true,'alice']),[false,null]]),1);
assert.equal(pulses([[false,null],[false,'alice'],[true,'alice'],[true,'alice'],[false,null],[true,'alice'],[false,null]]),2);
assert.equal(pulses([[false,null],...Array(120).fill([true,null]),[false,null]]),0);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const defs=new Map(),saved=[];for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const c of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,pos:bs[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:c.typeName});const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])saved.push({g,ch:ch.index,...e});}}
const point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]),actual=[],targets=new Set();for(const e of saved){const a=defs.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=defs.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z);const target=point(z.g,z.pos,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.pos,a.type,e.source.port),target]));}
const planned=expected.map(e=>JSON.stringify([e.newPulse?point(mapping.get(logicGrid),position,C.Expr_EdgeDetector.NAME,'bPulseOnRisingEdge'):point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)]));planned.push(JSON.stringify([point(mapping.get(held.g),held.position,C.Expr_LogicalAND.NAME,'bOutput'),point(mapping.get(logicGrid),position,C.Expr_EdgeDetector.NAME,'Input')]));assert.deepEqual(actual.sort(),planned.sort());
assert.equal(saved.length,edges.length+1);assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,addedGates:1,bindRoutesPulsed:routes.length,wires:saved.length},null,2));

'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node wire-dealership-sale-sound.cjs saved.brz output.brz');
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
const sold=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Interact.NAME&&c.data.Message.includes('Wire Sold vehicle'))),'Sold vehicle sound');assert(sold.comps.some(c=>c.type===C.OneShotAudioEmitter.NAME));
const creditEdge=one(edges.filter(e=>e.zt===C.Exec_Gamemode_IncrementLeaderboardValue.NAME&&e.q==='Value'&&e.at===C.Var.NAME),'Sale payout');
const credit=creditEdge.z;
const clearOwnership=one(edges.filter(e=>e.z===credit&&e.q==='Exec'),'Clear ownership before payout').a;
assert(clearOwnership.comps.some(c=>c.type===C.Exec_Gamemode_SetLeaderboardValue.NAME&&c.data.Value===0));
for(const e of edges)w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:e.zt,port:e.q});
const newEdges=[{a:credit,at:C.Exec_Gamemode_IncrementLeaderboardValue.NAME,p:'ExecOut',z:sold}];
for(const e of newEdges){assert(!edges.some(old=>old.z===e.z&&old.zt===C.OneShotAudioEmitter.NAME&&old.q==='Play'));w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:C.OneShotAudioEmitter.NAME,port:'Play'});}
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Sale Sound',description:'The configured sold-vehicle sound plays after the sale payout. Existing purchase sounds and settings are retained.'}}),out=WorldReader.from(bytes);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const definitions=new Map(),saved=[];for(const g of out.gridIds()){const bs=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bricks=bs.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const c of out.componentChunk(g,ch.index).components)definitions.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,position:bricks[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:c.typeName,data:c.data});const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])saved.push({g,ch:ch.index,...e});}}
assert.equal(saved.length,edges.length+1);const targets=new Set();
const point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]);const actual=[];for(const e of saved){const a=definitions.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=definitions.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z);const target=point(z.g,z.position,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.position,a.type,e.source.port),target]));}
const expected=[...edges,...newEdges.map(e=>({...e,zt:C.OneShotAudioEmitter.NAME,q:'Play'}))].map(e=>JSON.stringify([point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)]));assert.deepEqual(actual.sort(),expected.sort());
for(const n of [sold]){const after=[...definitions.values()].find(d=>d.g===1&&d.type===C.OneShotAudioEmitter.NAME&&JSON.stringify(d.position)===JSON.stringify(n.position));assert.deepEqual(after.data,n.comps.find(c=>c.type===C.OneShotAudioEmitter.NAME).data,'Sound settings preserved');}
assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,addedGates:0,addedWires:1,sold:'Sale payout ExecOut'},null,2));

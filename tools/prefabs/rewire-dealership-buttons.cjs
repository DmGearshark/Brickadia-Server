'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node rewire-dealership-buttons.cjs saved.brz output.brz');
const r=WorldReader.from(fs.readFileSync(source)),w=new World(),C=b.COMPONENTS,schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),grids=new Map([[1,undefined]]),nodes=new Map(),edges=[];
const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
for(const e of r.entities())grids.set(e.persistentIndex,w.addBrickGrid({type:e.typeName,location:e.location,rotation:e.rotation,frozen:e.frozen,sleeping:e.sleeping,data:{bCollapsed:e.data.bCollapsed,PlaneCenter:e.data.PlaneCenter,PlaneExtent:e.data.PlaneExtent}}));
for(const g of r.gridIds()){
 const all=[...r.bricks(g)];let offset=0;
 for(const ch of r.brickChunkIndex(g)){
  const bricks=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=r.componentChunk(g,ch.index);
  for(let i=0;i<bricks.length;i++){
   const br=bricks[i],comps=cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}));
   const originalComps=structuredClone(comps);
   const originalButton=comps.find(c=>c.type===C.Button.NAME);
   const removeBrick=g===1&&(comps.some(c=>c.type===C.AnimatedButton.NAME)||['Scroll Up','Scroll Down'].includes(originalButton?.data.PromptCustomLabel));
   if(g===1&&comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='Buy / Sell')){for(let j=comps.length-1;j>=0;j--)if([C.Button.NAME,C.TextDisplay.NAME].includes(comps[j].type))comps.splice(j,1);}
   const position=br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));
   const data={...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],owner_index:0,position,components:comps};delete data.asset_name_index;delete data.material_index;
   const n={g,i,ch:ch.index,position,comps,originalComps,removeBrick,handle:removeBrick?undefined:w.addBrick(data,grids.get(g))};nodes.set(address(g,ch.index,i),n);
  }
  for(let i=0;i<cc.soa.MicrochipBrickIndices.length;i++)w.registerMicrochipLink(nodes.get(address(g,ch.index,cc.soa.MicrochipBrickIndices[i])).handle,grids.get(cc.soa.MicrochipBrickGridReferences[i]));
  const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({a:nodes.get(address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex)),aKey:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,zKey:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});
 }
}
for(const e of edges){e.a=nodes.get(e.aKey);e.z=nodes.get(e.zKey);assert(e.a&&e.z);}
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const logicGrid=one([...r.entities()].filter(e=>[...r.bricks(e.persistentIndex)].length>100),'Logic grid').persistentIndex;
const at=(p,type)=>one([...nodes.values()].filter(n=>n.g===logicGrid&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+p);
const main=[...nodes.values()].filter(n=>n.g===1);
const button=n=>n.originalComps.find(c=>c.type===C.Button.NAME);
const replacement={down:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Scroll Down Rewire into this'),'new down'),up:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Scroll Up Rewire into this'),'new up'),trade:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Rewire this to be Buy/Sell'),'new trade'),bind:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Bind Player Rewire into this'),'new bind')};
const old={down:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Scroll Down'),'old down'),up:one(main.filter(n=>button(n)?.data.PromptCustomLabel==='Scroll Up'),'old up'),trade:one(main.filter(n=>n.originalComps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='Buy / Sell')),'old trade'),bind:one(main.filter(n=>n.originalComps.some(c=>c.type===C.AnimatedButton.NAME)),'old bind')};
const prompts={down:'Scroll Down',up:'Scroll Up',trade:'Buy / Sell',bind:'Bind self to Computer'};for(const [k,n]of Object.entries(replacement))n.comps.find(c=>c.type===C.Button.NAME).data.PromptCustomLabel=prompts[k];
const removed=[...nodes.values()].filter(n=>n.removeBrick);assert.equal(removed.length,3);
function redirected(n,type){for(const key of ['bind','up','down','trade'])if(n===old[key]){if(type===(key==='bind'?C.AnimatedButton.NAME:C.Button.NAME))return {n:replacement[key],type:C.Button.NAME};if(['up','down','trade'].includes(key)&&type===C.TextDisplay.NAME)return {n:replacement[key],type};}assert(!n.removeBrick,'Unexpected connection to removed brick');return {n,type};}
const expected=[];for(const e of edges){const a=redirected(e.a,e.at),z=redirected(e.z,e.zt);assert(a.n.handle&&z.n.handle);if(z.n!==e.z&&z.type===C.TextDisplay.NAME&&e.q==='bEnabled')z.n.comps.find(c=>c.type===C.TextDisplay.NAME).data.bEnabled=false;w.addWire({brick:a.n.handle,component_type:a.type,port:e.p},{brick:z.n.handle,component_type:z.type,port:e.q});expected.push({a:a.n,at:a.type,p:e.p,z:z.n,zt:z.type,q:e.q});}
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - New Buttons',description:'Replacement scroll, Buy/Sell and Bind buttons connected. Old standalone controls deleted; the former screen button is now blank panel backing. Timeout and screen blanking retained.'}}),out=WorldReader.from(bytes);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const point=(g,pos,type,port)=>JSON.stringify([g,pos,type,port]);
const defs=new Map(),savedEdges=[];let count=0;
for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;count+=all.length;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const c of out.componentChunk(g,ch.index).components){const position=bs[c.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));defs.set(address(g,ch.index,c.brickIndex)+c.typeName,{g,position,...c});}const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])savedEdges.push({g,ch:ch.index,...e});}}
assert.equal(count,[...nodes.values()].length-3);assert.equal(savedEdges.length,edges.length);
const targets=new Set(),actual=[];for(const e of savedEdges){const a=defs.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=defs.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z,'Saved endpoints exist');const target=point(z.g,z.position,z.typeName,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([point(a.g,a.position,a.typeName,e.source.port),target]));}
assert.deepEqual(actual.sort(),expected.map(e=>JSON.stringify([point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)])).sort());
for(const [key,n]of Object.entries(replacement)){for(const p of ['Character','bHeld'])assert(expected.some(e=>e.a===n&&e.at===C.Button.NAME&&e.p===p),key+' connected '+p);}
const publicButtons=[...defs.values()].filter(c=>c.g===1&&[C.Button.NAME,C.AnimatedButton.NAME].includes(c.typeName));assert.equal(publicButtons.length,4);assert(publicButtons.every(c=>!c.data.PromptCustomLabel.includes('Rewire')));
// Every retained brick keeps its geometry, material, colour and visibility.
function geometry(reader,g){const all=[...reader.bricks(g)],result=[];let offset=0;for(const ch of reader.brickChunkIndex(g)){for(const br of all.slice(offset,offset+ch.numBricks)){const d={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index],position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]))};delete d.asset_name_index;delete d.material_index;result.push({key:address(g,ch.index,result.length-offset),position:d.position,value:JSON.stringify(d)});}offset+=ch.numBricks;}return result;}
for(const g of r.gridIds()){const after=new Set(geometry(out,mapping.get(g)).map(x=>x.value));for(const br of geometry(r,g))if(!removed.some(n=>n.g===g&&JSON.stringify(n.position)===JSON.stringify(br.position)))assert(after.has(br.value),'Retained geometry preserved');}
assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,replacementButtons:4,oldStandaloneButtonsDeleted:3,oldScreenControlRemoved:true,wires:savedEdges.length},null,2));

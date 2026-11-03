'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node compact-parts-shop-button.cjs saved.brz output.brz');
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
const logicGrid=3;
const at=(p,type)=>one([...nodes.values()].filter(n=>n.g===logicGrid&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+p);
const button=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Button.NAME&&c.data.PromptCustomLabel==='Buy/Installed Button')),'Buy/Installed button');
const input=one(edges.filter(e=>e.z===button&&e.zt===C.TextDisplay.NAME&&e.q==='Text'),'Button text source');
const prompt=one(edges.filter(e=>e.z===button&&e.zt===C.Button.NAME&&e.q==='PromptCustomLabel'),'Button prompt source');assert(input.a===prompt.a&&input.p===prompt.p);
button.comps.find(c=>c.type===C.TextDisplay.NAME).data.Text='Buy';button.comps.find(c=>c.type===C.Button.NAME).data.PromptCustomLabel='Buy';
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));let count=0;
function node(k,data){const index=count++,n={type:C[k].NAME,data};n.handle=w.addBrick({asset:C[k].BRICK,position:[maxX+96+index*48,0,2],color:[55,100,165],components:[{type:n.type,data}]},grids.get(logicGrid));return n;}
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
for(const e of edges)if(e!==input&&e!==prompt)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
let previous={handle:input.a.handle,type:input.at,p:input.p};
const replacements=[['Updating...','…'],['Catalog error','Error'],['Select a vehicle','Bind']];for(const [Search,Replacement]of replacements){const n=node('Expr_String_Replace',{Search,Replacement,Start:0,MaxReplacements:1,bCaseSensitive:true});wire(previous.handle,previous.type,previous.p,n.handle,n.type,'Input');previous={...n,p:'Output'};}
const limit=node('Expr_String_Substring',{Start:0,Length:9});wire(previous.handle,previous.type,previous.p,limit.handle,limit.type,'Input');wire(limit.handle,limit.type,'Output',button.handle,C.TextDisplay.NAME,'Text');wire(limit.handle,limit.type,'Output',button.handle,C.Button.NAME,'PromptCustomLabel');
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Parts Shop - Compact Button Labels',description:'Buy/Installed button labels are limited to nine characters. Long status messages remain on the separate status readout.'}}),out=WorldReader.from(bytes);
for(const [label,expected]of [['Buy','Buy'],['Installed','Installed'],['Updating...','…'],['Catalog error','Error'],['Select a vehicle','Bind'],['Unexpected longer status','Unexpecte']]){let text=label;for(const [search,replacement]of replacements)text=text.replace(search,replacement);text=text.slice(0,9);assert(text.length<=9);if(label!=='Unexpected longer status')assert.equal(text,expected);}
let wires=0;const targets=new Set();let savedLimit=0;for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){for(const c of out.componentChunk(g,ch.index).components)if(c.typeName===C.Expr_String_Substring.NAME&&c.data.Start===0&&c.data.Length===9)savedLimit++;const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){wires++;const key=JSON.stringify([g,ch.index,e.target]);assert(!targets.has(key));targets.add(key);}}
assert.equal(savedLimit,1);assert.equal(wires,edges.length+4);assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,maxButtonCharacters:9,labels:['Buy','Installed','…','Error','Bind'],wires},null,2));

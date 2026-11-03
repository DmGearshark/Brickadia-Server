'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS;
function rehouse(source,display,output){
 const old=WorldReader.from(fs.readFileSync(source)),ref=WorldReader.from(fs.readFileSync(display)),w=new World();
 const locations=new Map();
 const schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),assets=structuredClone(old.externalAssets());
 const assetIds=ref.externalAssets().map(asset=>{let i=assets.findIndex(a=>a.type===asset.type&&a.name===asset.name);if(i<0){i=assets.length;assets.push(asset);}return i;});
 const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
 function clean(type,data,remap=false){const fields=schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(type));const d=Object.fromEntries(Object.entries(structuredClone(data)).filter(([k])=>fields.has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)));if(remap)for(const [k,v]of Object.entries(d))if(fields.get(k)?.type==='object'&&typeof v==='number')d[k]=assetIds[v];return d;}
 function read(reader){const nodes=[],wires=[];for(const g of reader.gridIds()){const all=[...reader.bricks(g)];let offset=0;for(const ch of reader.brickChunkIndex(g)){const bricks=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=ch.numComponents?reader.componentChunk(g,ch.index):{components:[]};for(let i=0;i<bricks.length;i++)nodes.push({key:address(g,ch.index,i),g,ch:ch.index,i,position:bricks[i].position.map((v,ax)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][ax])),brick:bricks[i],comps:cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:clean(c.typeName,c.data)}))});if(ch.numWires){const ws=reader.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])wires.push({a:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,z:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});}}}return {nodes,wires};}
 const src=read(old),design=read(ref);assert.equal(ref.gridIds().length,1);assert.equal(design.wires.length,0);
 const text=n=>n.comps.find(c=>c.type===C.TextDisplay.NAME)?.data.Text;
 function one(a,label){assert.equal(a.length,1,label);return a[0];}
 const oldUI={bind:one(src.nodes.filter(n=>n.g===1&&n.comps.some(c=>c.type===C.AnimatedButton.NAME)),'old bind'),up:one(src.nodes.filter(n=>n.g===1&&text(n)==='▶'),'old up'),down:one(src.nodes.filter(n=>n.g===1&&text(n)==='◀'),'old down'),action:one(src.nodes.filter(n=>n.g===1&&text(n)==='Buy'),'old action'),price:one(src.nodes.filter(n=>n.g===1&&text(n)==='Price: —'),'old price'),selected:one(src.nodes.filter(n=>n.g===1&&text(n)==='Bind player'),'old selected'),list:one(src.nodes.filter(n=>n.g===1&&text(n)===''),'old list'),name:one(src.nodes.filter(n=>n.g===1&&text(n)==='User'),'old name'),balance:one(src.nodes.filter(n=>n.g===1&&text(n)==='Scrap\r\n0'),'old balance')};
 const marked={bind:one(design.nodes.filter(n=>n.comps.some(c=>c.type===C.AnimatedButton.NAME)),'bind'),list:one(design.nodes.filter(n=>text(n)?.includes('> (X) <')),'list'),price:one(design.nodes.filter(n=>text(n)==='> Buy/Sell Price <'),'price'),selected:one(design.nodes.filter(n=>text(n)==='Selected Vehicle Name Here'),'selected'),action:one(design.nodes.filter(n=>text(n)==='> Buy/Sell Button <'),'action'),player:one(design.nodes.filter(n=>text(n)?.startsWith('Name:')),'player')};
 function copy(reader,n,grid,remap=false){const data={...n.brick,asset:reader.brickAssets()[n.brick.asset_name_index],material:reader.materials()[n.brick.material_index],owner_index:0,position:n.position,components:n.comps.map(c=>({type:c.type,data:clean(c.type,c.data,remap)}))};delete data.asset_name_index;delete data.material_index;const handle=w.addBrick(data,grid);locations.set(JSON.stringify(handle),{g:handle.grid+1,position:n.position});return handle;}
 const initial={list:'',price:'Bind player',selected:'Bind player',action:'Buy / Sell',player:'Name: User\r\n🔩Scrap: 0'};
 for(const [key,n]of Object.entries(marked))if(key!=='bind')n.comps.find(c=>c.type===C.TextDisplay.NAME).data.Text=initial[key];
 marked.action.comps.push({type:C.Button.NAME,data:{PromptCustomLabel:'Buy / Sell',PressSound:0,ReleaseSound:1}});
 for(const n of design.nodes)n.handle=copy(ref,n,undefined,true);
 const o=ref.prefabJson().addedGlobalGridOffset,at=(x,y,z)=>[x-o.x,y-o.y,z-o.z];
 const entities=[...old.entities()];assert.equal(entities.length,2);
 const chips=new Map();for(const [i,e]of entities.entries())chips.set(e.persistentIndex,w.addMicrochip({position:at(0,30,i===0?15:5),color:i===0?[40,155,95]:[55,100,165]}));
 const balanceEdge=one(src.wires.filter(e=>e.z===oldUI.balance.key&&e.q==='Text'),'balance source');
 const balanceFormatter=src.nodes.find(n=>n.key===balanceEdge.a);const formatComponent=balanceFormatter.comps.find(c=>c.type===C.Expr_String_FormatText.NAME);assert.equal(formatComponent.data.FormatString,'Scrap\r\n{A}');formatComponent.data.FormatString='🔩Scrap: {A}';
 const handles=new Map();for(const n of src.nodes)if(n.g!==1){n.handle=copy(old,n,chips.get(n.g).grid);handles.set(n.key,n.handle);}
 const logicGrid=chips.get(entities[1].persistentIndex).grid;
 const maxX=Math.max(...src.nodes.filter(n=>n.g===entities[1].persistentIndex).map(n=>n.position[0]));
 const playerFormat=w.addBrick({asset:C.Expr_String_FormatText.BRICK,position:[maxX+96,0,2],color:[55,100,165],components:[{type:C.Expr_String_FormatText.NAME,data:{FormatString:'Name: {A}\r\n{B}'}}]},logicGrid);
 // Separate wired buttons can be moved outside the case without changing logic.
 const arrowTemplate=marked.action.comps.find(c=>c.type===C.TextDisplay.NAME).data;
 const loose=[];for(const [i,key]of ['up','down'].entries())loose.push(w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,3,3],position:at(-5,-30,i===0?12:4),direction:4,rotation:2,color:[178,175,138],material:'BMC_Plastic',components:[{type:C.Button.NAME,data:{PromptCustomLabel:key==='up'?'Scroll Up':'Scroll Down'}},{type:C.TextDisplay.NAME,data:{...clean(C.TextDisplay.NAME,arrowTemplate,true),Text:key==='up'?'▲':'▼',LineHeight:2,Rotation:0}}]}));
 locations.set(JSON.stringify(playerFormat),{g:playerFormat.grid+1,position:[maxX+96,0,2]});loose.forEach((handle,i)=>locations.set(JSON.stringify(handle),{g:1,position:at(-5,-30,i===0?12:4)}));
 const endpoint=(handle,type,port)=>({brick:handle,component_type:type,port});
 const targets=new Set(),emitted=[];
 function wire(a,z){const key=JSON.stringify([z.brick,z.component_type,z.port]);assert(!targets.has(key),'Duplicate input');targets.add(key);w.addWire(a,z);emitted.push({a,z});}
 const mainMap=new Map(['bind','action','price','selected','list'].map(k=>[oldUI[k].key,marked[k]]));
 for(const e of src.wires){let a,z;
  const scroll=['up','down'].find(k=>e.a===oldUI[k].key);
  if(scroll)a=endpoint(loose[scroll==='up'?0:1],C.Button.NAME,e.p);
  else if(handles.has(e.a))a=endpoint(handles.get(e.a),e.at,e.p);
  else {const n=mainMap.get(e.a);assert(n,'Unknown source '+e.a);a=endpoint(n.handle,e.at,e.p);}
  if(e.z===oldUI.name.key&&e.q==='Text')z=endpoint(playerFormat,C.Expr_String_FormatText.NAME,'InputA');
  else if(e.z===oldUI.balance.key&&e.q==='Text')z=endpoint(playerFormat,C.Expr_String_FormatText.NAME,'InputB');
  else if(handles.has(e.z))z=endpoint(handles.get(e.z),e.zt,e.q);
  else {const n=mainMap.get(e.z);assert(n,'Unknown target '+e.z);z=endpoint(n.handle,e.zt,e.q);}
  wire(a,z);
 }
 wire(endpoint(playerFormat,C.Expr_String_FormatText.NAME,'Output'),endpoint(marked.player.handle,C.TextDisplay.NAME,'Text'));
 const prefab=structuredClone(ref.prefabJson());for(const pivot of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot'])prefab.pivots[pivot].halfExtent.y=34;
 const bytes=w.toBrz({prefab,externalAssets:assets,bundle:{name:'Vehicle Dealership - New Display',description:'Working dealership transplanted into the labeled display. The wired scroll buttons are outside the case and can be moved independently.'}});
 const result={bytes,old,ref,src,design,marked,loose,emitted,locations};require('./test-rehouse-dealership.cjs')(result);fs.writeFileSync(output,bytes);return {output,sourceWires:src.wires.length,newWires:emitted.length,externalScrollButtons:'wired'};
}
module.exports=rehouse;
if(require.main===module){const [source,display,output]=process.argv.slice(2);if(!output)throw Error('Usage: node rehouse-dealership.cjs working.brz display.brz output.brz');console.log(JSON.stringify(rehouse(source,display,output),null,2));}

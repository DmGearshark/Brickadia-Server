'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node add-dealership-indicator.cjs saved.brz output.brz');
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
const indicator=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='■')),'Indicator decal');
const bound=at([0,0,2],C.Var.NAME);
const presenceEdges=edges.filter(e=>e.a===bound&&e.p==='Value'&&e.zt===C.Expr_CompareNotEqual.NAME&&e.q==='InputA'&&e.z.comps.find(c=>c.type===C.Expr_CompareNotEqual.NAME).data.InputB?.$variant==='weak_object');assert(presenceEdges.length>0);
const present=presenceEdges[0].z;
assert(!edges.some(e=>e.z===indicator&&e.q==='Color'),'Indicator color already wired');
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));
const colorData={ColorA:{R:1,G:0,B:0,A:1},ColorB:{R:0,G:1,B:0,A:1}};
const color=w.addBrick({asset:C.Expr_ColorBlend.BRICK,position:[maxX+96,48,2],color:[55,100,165],components:[{type:C.Expr_ColorBlend.NAME,data:colorData}]},grids.get(logicGrid));
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
for(const e of edges)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
wire(present.handle,C.Expr_CompareNotEqual.NAME,'bOutput',color,C.Expr_ColorBlend.NAME,'Alpha');
wire(color,C.Expr_ColorBlend.NAME,'Output',indicator.handle,C.TextDisplay.NAME,'Color');
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Binding Indicator',description:'The indicator text is green when a player is bound, red when unbound. Brick colour, layout, transaction logic and timeout are preserved.'}}),out=WorldReader.from(bytes);
// Verify the saved circuit drives the decal Color property, never brick color.
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const defs=new Map(),savedEdges=[];for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){for(const c of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,c.brickIndex)+c.typeName,c);const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])savedEdges.push({g,ch:ch.index,...e});}
assert.equal(savedEdges.length,edges.length+2);
const targets=new Set();for(const e of savedEdges){const a=address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType,z=address(e.g,e.ch,e.target.brickIndex)+e.target.componentType;assert(defs.has(a)&&defs.has(z));const target=z+':'+e.target.port;assert(!targets.has(target));targets.add(target);}
const colorEdge=one(savedEdges.filter(e=>e.g===1&&e.target.componentType===C.TextDisplay.NAME&&e.target.port==='Color'),'Saved decal color connection');assert.equal(colorEdge.source.componentType,C.Expr_ColorBlend.NAME);
const blend=defs.get(address(colorEdge.source.gridId??colorEdge.g,colorEdge.source.chunk??colorEdge.ch,colorEdge.source.brickIndex)+C.Expr_ColorBlend.NAME);
assert.deepEqual(blend.data.ColorA,{R:1,G:0,B:0,A:1});assert.deepEqual(blend.data.ColorB,{R:0,G:1,B:0,A:1});
// The two endpoint colours are exact: null binding -> red; valid binding -> green.
function evaluate(player){const alpha=player===null?0:1;return Object.fromEntries(['R','G','B','A'].map(k=>[k,blend.data.ColorA[k]*(1-alpha)+blend.data.ColorB[k]*alpha]));}
assert.deepEqual(evaluate(null),{R:1,G:0,B:0,A:1});assert.deepEqual(evaluate('player'),{R:0,G:1,B:0,A:1});
function geometry(reader,g){const all=[...reader.bricks(g)],result=[];let offset=0;for(const ch of reader.brickChunkIndex(g)){for(const br of all.slice(offset,offset+ch.numBricks)){const data={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index],position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]))};delete data.asset_name_index;delete data.material_index;result.push(JSON.stringify(data));}offset+=ch.numBricks;}return result;}
for(const g of r.gridIds()){const after=new Set(geometry(out,mapping.get(g)));for(const br of geometry(r,g))assert(after.has(br),'Original geometry and brick colors preserved');}
assert.deepEqual(out.prefabJson(),r.prefabJson());fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,addedGates:1,addedWires:2,indicator:'TextDisplay.Color',brickColorsPreserved:true},null,2));

'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
module.exports=function test({bytes,ref,src,design,loose,emitted,locations}){
 const out=WorldReader.from(bytes),components=new Map(),wires=[];
 const address=(g,ch,i,type)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,type]);
 const point=(g,position,type,port)=>JSON.stringify([g,position,type,port]);
 for(const g of out.gridIds()){
  const all=[...out.bricks(g)];let offset=0;
  for(const ch of out.brickChunkIndex(g)){
   const bricks=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;
   if(ch.numComponents)for(const c of out.componentChunk(g,ch.index).components){const br=bricks[c.brickIndex],position=br.position.map((v,i)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][i]));components.set(address(g,ch.index,c.brickIndex,c.typeName),{g,position,type:c.typeName,data:c.data});}
   if(ch.numWires){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])wires.push({g,ch:ch.index,...e});}
  }
 }
 const actualEdges=[],targets=new Set();
 for(const e of wires){const a=components.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)),z=components.get(address(e.g,e.ch,e.target.brickIndex,e.target.componentType));assert(a&&z,'Every saved wire endpoint must exist');const target=point(z.g,z.position,z.type,e.target.port);assert(!targets.has(target),'Duplicate input');targets.add(target);actualEdges.push(JSON.stringify([point(a.g,a.position,a.type,e.source.port),target]));}
 const expectedEdges=emitted.map(e=>{const a=locations.get(JSON.stringify(e.a.brick)),z=locations.get(JSON.stringify(e.z.brick));assert(a&&z);return JSON.stringify([point(a.g,a.position,e.a.component_type,e.a.port),point(z.g,z.position,e.z.component_type,e.z.port)]);});
 assert.deepEqual(actualEdges.sort(),expectedEdges.sort());assert.equal(wires.length,src.wires.length+1,'Only the combined player display adds a wire');
 // Preserve every business-logic component, including all editable settings.
 function clean(d){return Object.fromEntries(Object.entries(d).filter(([k])=>!['VarRef','ArrayVarRef','MapVarRef'].includes(k)));}
 for(const n of src.nodes.filter(n=>n.g!==1))for(const c of n.comps){const saved=[...components.values()].filter(a=>a.g===n.handle.grid+1&&a.type===c.type&&JSON.stringify(a.position)===JSON.stringify(n.position));assert.equal(saved.length,1,'Logic component preserved');assert.deepEqual(clean(saved[0].data),clean(c.data),'Logic/settings data preserved');}
 // The reference's complete physical case and all its display bricks survive.
 function geometry(reader,br){const d={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index]};delete d.asset_name_index;delete d.material_index;return JSON.stringify(d);}
 const actualMain=new Set([...out.bricks(1)].map(br=>geometry(out,br)));for(const n of design.nodes)assert(actualMain.has(geometry(ref,n.brick)),'Reference geometry preserved');
 // Both loose buttons have Held and Character connected into the logic.
 for(const h of loose){const p=locations.get(JSON.stringify(h));for(const port of ['bHeld','Character'])assert(emitted.some(e=>JSON.stringify(e.a.brick)===JSON.stringify(h)&&e.a.port===port),'External button '+port+' connected');assert(Math.abs(p.position[1]+ref.prefabJson().addedGlobalGridOffset.y)>20,'Button outside case');}
 const fields=[...components.values()].filter(c=>c.g===1&&c.type===b.COMPONENTS.TextDisplay.NAME);assert(fields.some(c=>c.data.Text==='Vehicle Catalog'),'Static catalogue header retained');assert(!fields.some(c=>/\(X\)|Selected Vehicle Name Here|> Buy\/Sell/.test(c.data.Text)),'Placeholder text removed');
 // Original font and sound descriptors are preserved despite different source IDs.
 const font=out.externalAssets().findIndex(a=>a.type==='BrickFontDescriptor'&&a.name==='GlacialIndifferencePlus');for(const f of fields)assert.equal(f.data.Font,font);
 assert.equal([...out.entities()].length,2);
 console.log('Display transplant checks passed: unchanged logic/settings, complete saved wiring, reference geometry, font references, and both wired external scroll buttons.');
};

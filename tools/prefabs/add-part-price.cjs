'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {WorldReader,brdb:b}=require('brs-js');
const importMenu=require('./import-menu.cjs');
const [source,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node add-part-price.cjs latest-menu.brz output.brz');
const {r,w,grids,nodes,originalWires}=importMenu(source),C=b.COMPONENTS;
const one=(items,label)=>{assert.equal(items.length,1,label);return items[0];};
const display=one([...nodes.values()].filter(n=>n.comps.some(c=>c.type==='Component_TextDisplay'&&c.data.Text.trim()==='Part Price:')),'Part Price display');
const pay=one([...nodes.values()].filter(n=>n.comps.some(c=>c.type===C.Expr_String_FormatText.NAME&&c.data.FormatString==='Pay -{A} Scrap')),'Pay formatter');
const incoming=(n,p)=>one(originalWires.filter(e=>e.z===n&&e.q===p),'Input '+p);
const net=incoming(pay,'InputA').a;
assert(net.comps.some(c=>c.type===C.Expr_MathSubtract.NAME),'Net cost must subtract refund');
const price=incoming(net,'InputA');
assert.equal(price.at,C.Exec_MapVar_Get.NAME);
assert.equal(price.p,'Value');
assert(!originalWires.some(e=>e.z===display&&e.q==='Text'),'Display already wired');
const ch=r.brickChunkIndex(pay.g)[0];
const x=Math.max(...[...r.bricks(pay.g)].map(br=>br.position[0]+ch.offset.x))+96;
const formatter=w.addBrick({asset:C.Expr_String_FormatText.BRICK,position:[x,0,2],color:[100,145,100],components:[{type:C.Expr_String_FormatText.NAME,data:{FormatString:'Part Price: {A} Scrap'}}]},grids.get(pay.g));
for(const e of originalWires)w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:e.zt,port:e.q});
w.addWire({brick:price.a.handle,component_type:price.at,port:price.p},{brick:formatter,component_type:C.Expr_String_FormatText.NAME,port:'InputA'});
w.addWire({brick:formatter,component_type:C.Expr_String_FormatText.NAME,port:'Output'},{brick:display.handle,component_type:'Component_TextDisplay',port:'Text'});
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Upgrade Shop - Part Price',description:'Full selected-part catalog price alongside net Pay / Receive amount.'}}),out=WorldReader.from(bytes);
const mapping=new Map([[1,1]]);[...r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,2+i));
function geometry(reader,g){const ch=reader.brickChunkIndex(g)[0];return [...reader.bricks(g)].map(br=>JSON.stringify({...br,asset_name_index:reader.brickAssets()[br.asset_name_index],material_index:reader.materials()[br.material_index],position:br.position.map((v,i)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][i]))}));}
for(const g of r.gridIds()){const before=geometry(r,g),after=geometry(out,mapping.get(g));assert.deepEqual(after.slice(0,before.length),before,'Geometry preserved '+g);}
assert.deepEqual(out.prefabJson(),r.prefabJson());
// Preserve every original wire and verify both new endpoints survive serialization.
const rebuilt=importMenuFromReader(out);
function importMenuFromReader(reader){const edges=[];for(const g of reader.gridIds())for(const ch of reader.brickChunkIndex(g))if(ch.numWires){const ws=reader.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({g,ch:ch.index,...e});}return edges;}
assert.equal(rebuilt.length,originalWires.length+2);
const targets=new Set();for(const e of rebuilt){const key=JSON.stringify([e.g,e.ch,e.target]);assert(!targets.has(key),'Duplicate wire target');targets.add(key);}
const displayWire=one(rebuilt.filter(e=>e.g===1&&e.target.brickIndex===display.i&&e.target.port==='Text'),'Saved display connection');
assert.equal(displayWire.source.componentType,C.Expr_String_FormatText.NAME);
const comps=[];for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g))if(ch.numComponents)for(const c of out.componentChunk(g,ch.index).components)comps.push({g,ch:ch.index,...c});
const savedFormatter=one(comps.filter(c=>c.typeName===C.Expr_String_FormatText.NAME&&c.data.FormatString==='Part Price: {A} Scrap'),'Saved formatter');
const priceWire=one(rebuilt.filter(e=>e.g===savedFormatter.g&&e.target.brickIndex===savedFormatter.brickIndex&&e.target.componentType===savedFormatter.typeName&&e.target.port==='InputA'),'Saved full price input');
assert.equal(priceWire.source.componentType,C.Exec_MapVar_Get.NAME);
assert.equal(priceWire.source.port,'Value');
fs.writeFileSync(output,bytes);
console.log(JSON.stringify({output,addedGates:1,addedWires:2,originalGeometryPreserved:true,priceSource:price.aKey},null,2));

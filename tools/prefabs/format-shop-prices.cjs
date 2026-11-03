'use strict';
const fs=require('fs'),assert=require('assert/strict');const {WorldReader,brdb:b}=require('brs-js');const importMenu=require('./import-menu.cjs');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node format-shop-prices.cjs latest-menu.brz output.brz');
const {r,w,grids,nodes,originalWires}=importMenu(source),C=b.COMPONENTS,N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value});
const matches=[...nodes.values()].filter(n=>n.comps.some(c=>c.type===C.Expr_String_FormatText.NAME&&c.data.FormatString==='{A} Scrap'));assert.equal(matches.length,1,'Expected one price formatter');const format=matches[0];format.comps.find(c=>c.type===C.Expr_String_FormatText.NAME).data.FormatString='Pay -{A} Scrap';
const input=originalWires.find(e=>e.z===format&&e.zt===C.Expr_String_FormatText.NAME&&e.q==='InputA');assert(input,'Missing net-price input');
const chunks=r.brickChunkIndex(format.g);assert.equal(chunks.length,1);const ch=chunks[0],x=Math.max(...[...r.bricks(format.g)].map(br=>br.position[0]+ch.offset.x))+96;
let added=0;const newNodes=[],newWires=[];
function node(k,data={}){const c=C[k],n={type:c.NAME,data};n.handle=w.addBrick({asset:c.BRICK,position:[x+(added%3)*48,Math.floor(added/3)*48,2],color:[100,145,100],components:[{type:c.NAME,data}]},grids.get(format.g));added++;newNodes.push(n);return n;}
function wire(a,p,z,q){newWires.push({a,p,z,q});w.addWire({brick:a.handle,component_type:a.type,port:p},{brick:z.handle,component_type:z.type,port:q});}
const net={handle:input.a.handle,type:input.at},pay={handle:format.handle,type:C.Expr_String_FormatText.NAME};
const negative=node('Expr_CompareLess',{InputB:N(0)});wire(net,input.p,negative,'InputA');
const negate=node('Expr_MathNegate');wire(net,input.p,negate,'Input');const receive=node('Expr_String_FormatText',{FormatString:'Receive +{A} Scrap'});wire(negate,'Output',receive,'InputA');
const signed=node('Expr_Select');wire(negative,'bOutput',signed,'bSelectB');wire(pay,'Output',signed,'InputA');wire(receive,'Output',signed,'InputB');
const zero=node('Expr_CompareEqual',{InputB:N(0)});wire(net,input.p,zero,'InputA');const result=node('Expr_Select',{InputB:S('No Scrap cost')});wire(zero,'bOutput',result,'bSelectB');wire(signed,'Output',result,'InputA');
let consumers=0;
for(const e of originalWires){if(e.a===format&&e.at===C.Expr_String_FormatText.NAME&&e.p==='Output'){w.addWire({brick:result.handle,component_type:result.type,port:'Output'},{brick:e.z.handle,component_type:e.zt,port:e.q});consumers++;}else w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:e.zt,port:e.q});}
assert(consumers>=1);
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Upgrade Shop - Pay and Receive',description:'Pay -X Scrap / Receive +X Scrap / No Scrap cost. Buy remains the action for paying and receiving.'}}),out=WorldReader.from(bytes);
// Evaluate the actual new expression graph for positive, negative and zero net costs.
function evaluate(amount){const inputs=new Map(newWires.map(e=>[newNodes.indexOf(e.z)+':'+e.q,e]));function value(n,p){if(n===net)return amount;if(n===pay)return 'Pay -'+amount+' Scrap';function get(k){const e=inputs.get(newNodes.indexOf(n)+':'+k);if(e)return value(e.a,e.p);const v=n.data[k];return v?.$variant?v.value:v;}switch(n.type){case C.Expr_CompareLess.NAME:return get('InputA')<get('InputB');case C.Expr_MathNegate.NAME:return -get('Input');case C.Expr_String_FormatText.NAME:return n.data.FormatString.replace('{A}',get('InputA'));case C.Expr_Select.NAME:return get('bSelectB')?get('InputB'):get('InputA');case C.Expr_CompareEqual.NAME:return get('InputA')===get('InputB');default:throw Error(n.type);}}return value(result,'Output');}
for(const [amount,expected]of [[300,'Pay -300 Scrap'],[-25,'Receive +25 Scrap'],[0,'No Scrap cost'],[-313,'Receive +313 Scrap']])assert.equal(evaluate(amount),expected);
// Confirm all user geometry and catalog/refund configuration survive rebuilding.
const entities=[...r.entities()];const mapping=new Map([[1,1]]);entities.forEach((e,i)=>mapping.set(e.persistentIndex,2+i));
function canonical(reader,g){const c=reader.brickChunkIndex(g)[0];return [...reader.bricks(g)].map(br=>JSON.stringify({asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index],size:br.size,position:br.position.map((v,i)=>v+(g===1?0:[c.offset.x,c.offset.y,c.offset.z][i])),direction:br.direction,rotation:br.rotation,color:br.color,collision:br.collision,visibility:br.visibility}));}
for(const g of r.gridIds()){const before=canonical(r,g),after=canonical(out,mapping.get(g));assert.deepEqual(after.slice(0,before.length),before,'Original geometry '+g);}
function maps(reader){const a=[];for(const g of reader.gridIds())for(const c of reader.brickChunkIndex(g))if(c.numComponents)for(const v of reader.componentChunk(g,c.index).components)if(v.typeName===C.MapVar.NAME)a.push(JSON.stringify(v.data.Value));return a.sort();}
assert.deepEqual(maps(out),maps(r));assert.deepEqual(out.prefabJson(),r.prefabJson());
let wires=0;const endpoints=new Set();for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g))if(ch.numWires){const a=out.wireChunk(g,ch.index);for(const e of [...a.local,...a.remote]){const key=JSON.stringify([g,ch.index,e.target]);assert(!endpoints.has(key));endpoints.add(key);wires++;}}
assert.equal(wires,originalWires.length+newWires.length);fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,addedGates:added,priceDisplaysUpdated:consumers,wires,originalGeometryPreserved:true,catalogsPreserved:true},null,2));

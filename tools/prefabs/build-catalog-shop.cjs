'use strict';
const fs=require('fs'),assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
const importMenu=require('./import-menu.cjs'),{compile}=require('./catalog-data.cjs');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node build-catalog-shop.cjs menu.brz output.brz');
const {r,w,grids,nodes:oldNodes,originalWires}=importMenu(source),C=b.COMPONENTS,N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value}),B=value=>({$variant:'Bool',value});
const shop=458769,selector=458776;const edges=new Map();let id=0;const newer=[];
function old(g,i,type){const v=oldNodes.get(g+':'+i);assert(v);const c=v.comps.find(c=>c.type===type);assert(c,type);return {handle:v.handle,type,data:c.data,id:g+':'+i+':'+type};}
function target(z,q){return z.id+':'+q;}
function connect(a,p,z,q,replace=false){const key=target(z,q);assert(replace||!edges.has(key),'Multiple sources '+key);edges.set(key,{a,p,z,q});}
for(const e of originalWires)connect(old(e.a.g,e.a.i,e.at),e.p,old(e.z.g,e.z.i,e.zt),e.q);
function originalInput(z,q){const e=edges.get(target(z,q));assert(e);edges.delete(target(z,q));return e;}
const offset=r.prefabJson().addedGlobalGridOffset;
const at=(x,y,z)=>[x-offset.x,y-offset.y,z-offset.z];
const compiler=w.addMicrochip({position:at(0,0,-48),color:[40,155,95]});
let local=0;
function node(k,data={},grid=compiler.grid,pos){const c=C[k];assert(c,k);const i=local++,v={type:c.NAME,data,id:'new'+id++};v.handle=w.addBrick({asset:c.BRICK||'PB_DefaultMicroBrick',...(c.BRICK?{}:{size:[1,1,1]}),position:pos||[(i%18)*12,Math.floor(i/18)*12,2],color:[65,110,155],components:[{type:c.NAME,data}]},grid);newer.push(v);return v;}
function op(k,a,p,input,data={},grid){const v=node(k,data,grid);connect(a,p,v,input);return v;}
function bool(k,a,p,z,q,grid){const v=node(k,{},grid);connect(a,p,v,'bInputA');connect(z,q,v,'bInputB');return v;}
function all(terms,grid){let [a,p]=terms[0];for(const [z,q]of terms.slice(1)){a=bool('Expr_LogicalAND',a,p,z,q,grid);p='bOutput';}return [a,p];}
function set(ref,value,grid){const v=node('Exec_Var_Set',{Value:value},grid);connect(ref,'VarRef',v,'VarRef');return v;}
function ref(k,i){return old(shop,i,C[k].NAME);}
const cache={prices:ref('MapVar',97),names:ref('MapVar',98),max:ref('MapVar',99),categories:ref('MapVar',100),counts:ref('MapVar',101),prefixes:ref('MapVar',102)};
// Derive the initial catalog from the supplied working shop; retain every name
// and stored price, correcting the known spelling mismatch in the price key.
const originalPrices=new Map(cache.prices.data.Value.$map.map(([k,v])=>[k.replace('WheelDistnace','WheelDistance'),v]));const reverse=new Map(cache.prefixes.data.Value.$map.map(([a,z])=>[z,a]));const catalogEntries=[];
for(const [key,name]of cache.names.data.Value.$map){const group=[...cache.max.data.Value.$map].map(([k])=>k).sort((a,z)=>z.length-a.length).find(g=>key.startsWith(g));assert(group,key);const p=[...reverse.keys()].sort((a,z)=>z.length-a.length).find(p=>group.startsWith(p));const index=key.slice(group.length);assert(originalPrices.has(key),key);catalogEntries.push([`${reverse.get(p)}.${group.slice(p.length)}.${index}`,`${name}|${originalPrices.get(key)}`]);}
const initial=compile(catalogEntries);
for(const [k,v]of Object.entries(cache))v.data.Value.$map=initial[k];
const catalog=node('MapVar',{Value:{$keyType:'str',$valueType:'str',$map:catalogEntries}},compiler.grid,[0,0,2]);
const valid=node('Var',{Value:B(true)}),seen=node('MapVar',{Value:{$keyType:'str',$valueType:'f64',$map:[]}}),keys=node('ArrayVar',{Value:{$elementType:'str',$array:[]}});
// Single edit surface and explicit in-game refresh.
const textTemplate=oldNodes.get('1:31').comps.find(c=>c.type===C.TextDisplay.NAME).data;
w.addBrick({asset:'PB_DefaultMicroBrick',position:[-30,0,2],size:[18,5,1],color:[30,160,75],components:[{type:C.TextDisplay.NAME,data:{...textTemplate,Face:4,Text:'PartsCatalog →',LineHeight:4}}]},compiler.grid);
w.addBrick({asset:'PB_DefaultMicroBrick',position:at(0,0,-62),size:[2,40,5],color:[25,55,35],components:[{type:C.TextDisplay.NAME,data:{...textTemplate,Text:'CATALOG: EDIT MAP INSIDE CHIP',LineHeight:4}}]});
const apply={id:'apply',type:C.Button.NAME};apply.handle=w.addBrick({asset:'PB_DefaultMicroBrick',position:at(0,52,-48),size:[4,18,6],color:[30,150,65],components:[{type:C.Button.NAME,data:{PromptCustomLabel:'Apply Catalog'}},{type:C.TextDisplay.NAME,data:{...textTemplate,Text:'APPLY\r\nCATALOG',LineHeight:4}}]});
const applyEdge=op('Expr_EdgeDetectorExec',apply,'bHeld','Input');const resetValid=set(valid,B(true));connect(applyEdge,'OnRisingEdge',resetValid,'Exec');let tail=resetValid;
for(const m of [...Object.values(cache),seen]){const clear=node('Exec_MapVar_Clear');connect(m,'MapVarRef',clear,'MapVarRef');connect(tail,'ExecOut',clear,'Exec');tail=clear;}
const getKeys=node('Exec_MapVar_GetKeys');connect(catalog,'MapVarRef',getKeys,'MapVarRef');connect(keys,'ArrayVarRef',getKeys,'ArrayVarRef');connect(tail,'ExecOut',getKeys,'Exec');
const sort=node('Exec_ArrayVar_Sort');connect(keys,'ArrayVarRef',sort,'ArrayVarRef');connect(getKeys,'ExecOut',sort,'Exec');
const loop=node('Microchip_ForEachArray');connect(keys,'ArrayVarRef',loop,'ArrayVarRef');connect(sort,'ExecOut',loop,'Exec');
const callback=w.addBrickGrid({type:'Entity_MicrochipDynamicBrickGrid',frozen:true,data:{bCollapsed:true,PlaneCenter:{X:0,Y:0,Z:0},PlaneExtent:{X:120,Y:120,Z:2}}});w.registerMicrochipLink(loop.handle,callback);
const G=callback;const entry=node('CallableEntry_ForEachArray',{},G);
const getValue=node('Exec_MapVar_Get',{},G);connect(catalog,'MapVarRef',getValue,'MapVarRef');connect(entry,'Value',getValue,'Key');connect(entry,'Body',getValue,'Exec');
const key1=op('Expr_String_Split',entry,'Value','Input',{Delimiter:'.'},G),key2=op('Expr_String_Split',key1,'Right','Input',{Delimiter:'.'},G),value=op('Expr_String_Split',getValue,'Value','Input',{Delimiter:'|'},G);
const index=op('Expr_String_ParseNumber',key2,'Right','Input',{},G),price=op('Expr_String_ParseNumber',value,'Right','Input',{},G);
function lengthPositive(a,p){const len=op('Expr_String_Length',a,p,'Input',{},G);const cmp=node('Expr_CompareGreater',{InputB:N(0)},G);connect(len,'Output',cmp,'InputA');return [cmp,'bOutput'];}
function nonnegativeInteger(a){const pos=node('Expr_CompareGreaterOrEqual',{InputB:N(0)},G);connect(a,'Value',pos,'InputA');const floor=op('Expr_Floor',a,'Value','Input',{},G),eq=node('Expr_CompareEqual',{},G);connect(a,'Value',eq,'InputA');connect(floor,'Output',eq,'InputB');return [[pos,'bOutput'],[eq,'bOutput'],[a,'bSuccess']];}
const extraKey=op('Expr_String_Contains',key2,'Right','Input',{Search:'.'},G),noExtraKey=op('Expr_LogicalNOT',extraKey,'Output','bInput',{},G);
const extraValue=op('Expr_String_Contains',value,'Right','Input',{Search:'|'},G),noExtraValue=op('Expr_LogicalNOT',extraValue,'Output','bInput',{},G);
const [rowValid,rowPort]=all([[getValue,'bFound'],[key1,'bFound'],[key2,'bFound'],[value,'bFound'],lengthPositive(key1,'Left'),lengthPositive(key2,'Left'),lengthPositive(value,'Left'),...nonnegativeInteger(index),...nonnegativeInteger(price),[noExtraKey,'bOutput'],[noExtraValue,'bOutput']],G);
const validBranch=node('Exec_Branch',{},G);connect(rowValid,rowPort,validBranch,'bCond');connect(getValue,'ExecOut',validBranch,'Exec');const invalid=set(valid,B(false),G);connect(validBranch,'ExecOutB',invalid,'Exec');
const vehicleLength=op('Expr_String_Length',key1,'Left','Input',{},G),prefixLength=node('Expr_MathSubtract',{InputB:N(5)},G);connect(vehicleLength,'Output',prefixLength,'InputA');const shortPrefix=op('Expr_String_Substring',key1,'Left','Input',{Start:0},G);connect(prefixLength,'Output',shortPrefix,'Length');const endsOwned=op('Expr_String_EndsWith',key1,'Left','Input',{Suffix:'Owned'},G),prefix=node('Expr_Select',{},G);connect(key1,'Left',prefix,'InputA');connect(shortPrefix,'Output',prefix,'InputB');connect(endsOwned,'Output',prefix,'bSelectB');
function format(pattern,terms){const n=node('Expr_String_FormatText',{FormatString:pattern},G);terms.forEach(([a,p],i)=>connect(a,p,n,'Input'+String.fromCharCode(65+i)));return n;}
const group=format('{A}{B}',[[prefix,'Output'],[key2,'Left']]),partKey=format('{A}{B}',[[group,'Output'],[index,'Value']]),seenKey=format('{A}.{B}',[[key1,'Left'],[key2,'Left']]);
function mapGet(m,a,p){const n=node('Exec_MapVar_Get',{},G);connect(m,'MapVarRef',n,'MapVarRef');connect(a,p,n,'Key');return n;}
function mapSet(m,a,p,z,q){const n=node('Exec_MapVar_Set',{},G);connect(m,'MapVarRef',n,'MapVarRef');connect(a,p,n,'Key');connect(z,q,n,'Value');return n;}
const writePrefix=mapSet(cache.prefixes,key1,'Left',prefix,'Output');connect(validBranch,'ExecOutA',writePrefix,'Exec');
const lookupSeen=mapGet(seen,seenKey,'Output');connect(writePrefix,'ExecOut',lookupSeen,'Exec');const categoryBranch=node('Exec_Branch',{},G);connect(lookupSeen,'bFound',categoryBranch,'bCond');connect(lookupSeen,'ExecOut',categoryBranch,'Exec');
const countGet=mapGet(cache.counts,prefix,'Output');connect(categoryBranch,'ExecOutB',countGet,'Exec');const currentCount=node('Expr_Select',{InputA:N(0)},G);connect(countGet,'bFound',currentCount,'bSelectB');connect(countGet,'Value',currentCount,'InputB');
const categoryKey=format('{A}Category{B}',[[prefix,'Output'],[currentCount,'Output']]);
const writeCategory=mapSet(cache.categories,categoryKey,'Output',key2,'Left');connect(countGet,'ExecOut',writeCategory,'Exec');const plus=node('Expr_MathAdd',{InputB:N(1)},G);connect(currentCount,'Output',plus,'InputA');
const writeCount=mapSet(cache.counts,prefix,'Output',plus,'Output');connect(writeCategory,'ExecOut',writeCount,'Exec');const writeSeen=mapSet(seen,seenKey,'Output',currentCount,'Output');connect(writeCount,'ExecOut',writeSeen,'Exec');
const both=node('Exec_Union',{},G);connect(categoryBranch,'ExecOutA',both,'ExecA');connect(writeSeen,'ExecOut',both,'ExecB');
const maxGet=mapGet(cache.max,group,'Output');connect(both,'ExecOut',maxGet,'Exec');const currentMax=node('Expr_Select',{InputA:N(0)},G);connect(maxGet,'bFound',currentMax,'bSelectB');connect(maxGet,'Value',currentMax,'InputB');const max=node('Expr_MathMax',{},G);connect(currentMax,'Output',max,'InputA');connect(index,'Value',max,'InputB');
const writeMax=mapSet(cache.max,group,'Output',max,'Output');connect(maxGet,'ExecOut',writeMax,'Exec');const writeName=mapSet(cache.names,partKey,'Output',value,'Left');connect(writeMax,'ExecOut',writeName,'Exec');const writePrice=mapSet(cache.prices,partKey,'Output',price,'Value');connect(writeName,'ExecOut',writePrice,'Exec');
// Update the existing selector's master vehicle list from the generated prefixes.
const allVehicles=old(selector,43,C.ArrayVar.NAME);allVehicles.data.Value.$array=initial.prefixes.map(([k])=>k);
const updateVehicles=node('Exec_MapVar_GetKeys');connect(cache.prefixes,'MapVarRef',updateVehicles,'MapVarRef');connect(allVehicles,'ArrayVarRef',updateVehicles,'ArrayVarRef');connect(loop,'Completed',updateVehicles,'Exec');
// Refresh the selected upgrade and rebind/rescan the current player after Apply.
function mergeInto(z,q,a,p){const prior=originalInput(z,q),u=node('Exec_Union');connect(prior.a,prior.p,u,'ExecA');connect(a,p,u,'ExecB');connect(u,'ExecOut',z,q);}
mergeInto(old(shop,155,C.Exec_MapVar_Get.NAME),'Exec',updateVehicles,'ExecOut');mergeInto(old(selector,88,C.Exec_Var_Set.NAME),'Exec',updateVehicles,'ExecOut');
// Guard buying against malformed catalog rows and missing active lookups.
const activeReads=[155,157,158,159,160,161].map(i=>[old(shop,i,C.Exec_MapVar_Get.NAME),'bFound']);const playerPresent=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});connect(old(shop,103,C.Rerouter.NAME),'RER_Output',playerPresent,'InputA');const [canBuy,canBuyPort]=all([[valid,'Value'],[playerPresent,'bOutput'],...activeReads]);const buyLookup=old(shop,6,C.Exec_Gamemode_GetLeaderboardValue.NAME),buyInput=originalInput(buyLookup,'Exec');const checkBuy=node('Exec_Branch');connect(buyInput.a,buyInput.p,checkBuy,'Exec');connect(canBuy,canBuyPort,checkBuy,'bCond');connect(checkBuy,'ExecOutA',buyLookup,'Exec');
// The visible charge now matches the actual charge after the trade-in refund.
connect(old(shop,86,C.Expr_MathSubtract.NAME),'Output',old(shop,77,C.Expr_String_FormatText.NAME),'InputA',true);
const noBuy=op('Expr_LogicalNOT',canBuy,canBuyPort,'bInput'),status=node('Expr_Select',{InputB:S('Catalog error')});connect(noBuy,'bOutput',status,'bSelectB');connect(old(shop,81,C.Expr_Select.NAME),'Output',status,'InputA');const reason=node('Expr_Select',{InputA:S('Select a vehicle'),InputB:S('Catalog error')});connect(playerPresent,'bOutput',reason,'bSelectB');connect(reason,'Output',status,'InputB');
for(const e of [...edges.values()])if(e.a.id===old(shop,81,C.Expr_Select.NAME).id&&e.p==='Output'&&e.z.id!==status.id)connect(status,'Output',e.z,e.q,true);
// Replace obsolete setup labels with the new single-map editing contract.
for(const v of oldNodes.values())for(const c of v.comps)if(c.type===C.TextDisplay.NAME){if(c.data.Text.includes('ADDING NEW VEHICLES')||c.data.Text.includes('Links a vehicle'))c.data.Text='PARTS CATALOG\r\nEdit the map inside the green CATALOG chip.\r\nKey: CarOwned.Engine.0\r\nValue: Stock Engine|0\r\nUse consecutive options starting at 0.\r\nPress APPLY CATALOG after editing.\r\nOther lookup maps are GENERATED: do not edit.';else if(['UpgradePrices','UpgradeNames','UpgradeMaxValues','VehicleCategories','VehicleCategoryCounts','VehiclePrefixes'].some(t=>c.data.Text.includes(t))&&c.data.Text.includes('<color'))c.data.Text='GENERATED CACHE';}
// Exercise the emitted compiler graph rather than only the source data parser.
const model=require('./catalog-model.cjs'),ctx={nodes:newer,edges:[...edges.values()],start:resetValid,stopAt:updateVehicles,entry,catalog,cache,valid,allVehicles};
const normalize=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,[...v].sort(([a],[z])=>a.localeCompare(z))]));
for(const data of [catalogEntries,[...catalogEntries,['TowTruckOwned.Engine.0','Stock Diesel|0'],['TowTruckOwned.Engine.1','Turbo Diesel|700'],['TowTruckOwned.FuelTank.0','Stock Tank|0']],catalogEntries.map(([k,v])=>[k,k==='CarOwned.Engine.1'?'Renamed Engine|123':v])]){const actual=model(ctx,data),expected=compile(data);assert(actual.valid);assert.deepEqual(normalize(actual.maps),normalize(expected));assert.deepEqual([...actual.vehicles].sort(),expected.prefixes.map(([k])=>k).sort());}
for(const bad of [['CarOwned.Bad.0','Bad|-2'],['BrokenKey','Bad|2'],['CarOwned.Bad.0','Bad|2|3']])assert.equal(model(ctx,[...catalogEntries,bad]).valid,false);
// Do not ship the previous session's player name, balance or selection.
old(selector,47,C.Var.NAME).data.Value=S('User');old(selector,45,C.Var.NAME).data.Value=S('Empty');
old(selector,97,C.Exec_PlayerState_GetDisplayName.NAME).data.DisplayName='User';
old(selector,94,C.Exec_Var_Set.NAME).data.Value=S('User');
old(selector,42,C.ArrayVar.NAME).data.Value.$array=['','','','',''];
for(const i of [6,7])old(shop,i,C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Value=0;
for(const v of oldNodes.values())for(const c of v.comps)if(c.type===C.TextDisplay.NAME){if(c.data.Text==='Gearshark')c.data.Text='User';if(v.g===1&&v.i===25)c.data.Text='Scrap\r\n0';if(v.g===1&&v.i===27)c.data.Text='Select vehicle';if(v.g===1&&v.i===28)c.data.Text='';}
for(const e of edges.values())w.addWire({brick:e.a.handle,component_type:e.a.type,port:e.p},{brick:e.z.handle,component_type:e.z.type,port:e.q});
const prefab=structuredClone(r.prefabJson());for(const key of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot']){prefab.pivots[key].center.z=-16;prefab.pivots[key].halfExtent.z=52;}
const bytes=w.toBrz({prefab,externalAssets:r.externalAssets(),bundle:{name:'Vehicle Upgrade Shop - Single Catalog',description:'Edit PartsCatalog: VehicleID.Category.Index => Name|Price, then Apply Catalog. Existing upgrade leaderboard keys and 75% trade-in retained.'}});
const result=WorldReader.from(bytes);let comps=0,wires=0,mapCount=0;const inputKeys=new Set();for(const g of result.gridIds())for(const ch of result.brickChunkIndex(g)){if(ch.numComponents)for(const c of result.componentChunk(g,ch.index).components){comps++;if(c.typeName===C.MapVar.NAME)mapCount++;}if(ch.numWires){const ws=result.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const k=JSON.stringify([g,ch.index,e.target]);assert(!inputKeys.has(k),'Duplicate saved input');inputKeys.add(k);wires++;}}}
assert.equal(wires,edges.size);assert.equal(mapCount,8);fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,catalogEntries:catalogEntries.length,bricks:result.gridIds().reduce((n,g)=>n+[...result.bricks(g)].length,0),components:comps,wires,grids:result.gridIds().length,mapCount,sourcePricesPreserved:true},null,2));

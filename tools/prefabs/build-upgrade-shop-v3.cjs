'use strict';
const fs=require('fs'),assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
const importMenu=require('./import-menu.cjs'),{compile}=require('./catalog-data-v2.cjs');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node build-upgrade-shop-v2.cjs menu.brz output.brz');
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
function node(k,data={},grid=compiler.grid,pos){const c=C[k];assert(c,k);const i=local++,v={type:c.NAME,data,id:'new'+id++};v.handle=w.addBrick({asset:c.BRICK||'PB_DefaultMicroBrick',...(c.BRICK?{}:{size:[1,1,1]}),position:pos||[(i%12)*48,Math.floor(i/12)*48,2],color:[65,110,155],components:[{type:c.NAME,data}]},grid);newer.push(v);return v;}
function op(k,a,p,input,data={},grid){const v=node(k,data,grid);connect(a,p,v,input);return v;}
function bool(k,a,p,z,q,grid){const v=node(k,{},grid);connect(a,p,v,'bInputA');connect(z,q,v,'bInputB');return v;}
function all(terms,grid){let [a,p]=terms[0];for(const [z,q]of terms.slice(1)){a=bool('Expr_LogicalAND',a,p,z,q,grid);p='bOutput';}return [a,p];}
function set(ref,value,grid){const v=node('Exec_Var_Set',{Value:value},grid);connect(ref,'VarRef',v,'VarRef');return v;}
function ref(k,i){return old(shop,i,C[k].NAME);}
const cache={prices:ref('MapVar',97),names:ref('MapVar',98),max:ref('MapVar',99),categories:ref('MapVar',100),counts:ref('MapVar',101),prefixes:ref('MapVar',102)};
// Derive the initial catalog from the supplied working shop; retain every name
// and stored price, correcting the known spelling mismatch in the price key.
const originalPrices=new Map(cache.prices.data.Value.$map.map(([k,v])=>[k.replace('WheelDistnace','WheelDistance'),v]));const reverse=new Map(cache.prefixes.data.Value.$map.map(([a,z])=>[z,a]));const catalogEntries=[];
for(const [key,name]of cache.names.data.Value.$map){const group=[...cache.max.data.Value.$map].map(([k])=>k).sort((a,z)=>z.length-a.length).find(g=>key.startsWith(g));assert(group,key);const p=[...reverse.keys()].sort((a,z)=>z.length-a.length).find(p=>group.startsWith(p));const index=key.slice(group.length);assert(originalPrices.has(key),key);catalogEntries.push([`${reverse.get(p)}.${group.slice(p.length)}.${index}`,`${name}|${group}|${index}|${originalPrices.get(key)}`]);}
for(const [i,key]of ['saved','stats','refunds','indices'].entries())cache[key]=node('MapVar',{Value:{$keyType:'str',$valueType:key==='stats'?'str':'f64',$map:[]}},compiler.grid,[i*12,-24,2]);
const initial=compile(catalogEntries);
for(const [k,v]of Object.entries(cache))v.data.Value.$map=initial[k];
const catalog=node('MapVar',{Value:{$keyType:'str',$valueType:'str',$map:catalogEntries}},compiler.grid,[0,0,2]);
const valid=node('Var',{Value:B(true)}),seen=node('MapVar',{Value:{$keyType:'str',$valueType:'f64',$map:[]}}),keys=node('ArrayVar',{Value:{$elementType:'str',$array:[]}});
// Single edit surface and explicit in-game refresh.
const textTemplate=oldNodes.get('1:31').comps.find(c=>c.type===C.TextDisplay.NAME).data;
w.addBrick({asset:'PB_DefaultMicroBrick',position:[-30,0,2],size:[18,5,1],color:[30,160,75],components:[{type:C.TextDisplay.NAME,data:{...textTemplate,Face:4,Text:'PartsCatalog →',LineHeight:4}}]},compiler.grid);
w.addBrick({asset:'PB_DefaultMicroBrick',position:at(0,0,-62),size:[2,40,5],color:[25,55,35],components:[{type:C.TextDisplay.NAME,data:{...textTemplate,Text:'CATALOG: EDIT MAP INSIDE CHIP',LineHeight:4}}]});
const apply={id:'apply',type:C.Button.NAME};apply.handle=w.addBrick({asset:'PB_DefaultMicroBrick',position:at(0,52,-48),size:[4,18,6],color:[30,150,65],components:[{type:C.Button.NAME,data:{PromptCustomLabel:'Apply Catalog'}},{type:C.TextDisplay.NAME,data:{...textTemplate,Text:'APPLY\r\nCATALOG',LineHeight:4}}]});
const building=node('Var',{Value:B(false)}),notBuilding=op('Expr_LogicalNOT',building,'Value','bInput');const applyEdge=op('Expr_EdgeDetectorExec',apply,'bHeld','Input'),applyAllowed=node('Exec_Branch');connect(applyEdge,'OnRisingEdge',applyAllowed,'Exec');connect(notBuilding,'bOutput',applyAllowed,'bCond');const markBuilding=set(building,B(true));connect(applyAllowed,'ExecOutA',markBuilding,'Exec');const resetValid=set(valid,B(true));connect(markBuilding,'ExecOut',resetValid,'Exec');let tail=resetValid;
for(const m of [...Object.values(cache),seen]){const clear=node('Exec_MapVar_Clear');connect(m,'MapVarRef',clear,'MapVarRef');connect(tail,'ExecOut',clear,'Exec');tail=clear;}
const getKeys=node('Exec_MapVar_GetKeys');connect(catalog,'MapVarRef',getKeys,'MapVarRef');connect(keys,'ArrayVarRef',getKeys,'ArrayVarRef');connect(tail,'ExecOut',getKeys,'Exec');
const sort=node('Exec_ArrayVar_Sort');connect(keys,'ArrayVarRef',sort,'ArrayVarRef');connect(getKeys,'ExecOut',sort,'Exec');
const cursor=node('Var',{Value:N(0)}),loop=set(cursor,N(0));connect(sort,'ExecOut',loop,'Exec');
const G=compiler.grid,entry=node('Exec_ArrayVar_Get');connect(keys,'ArrayVarRef',entry,'ArrayVarRef');connect(cursor,'Value',entry,'Index');
const entryUnion=node('Exec_Union');connect(loop,'ExecOut',entryUnion,'ExecA');connect(entryUnion,'ExecOut',entry,'Exec');
const inBounds=op('Expr_LogicalNOT',entry,'bOutOfBounds','bInput'),stepBranch=node('Exec_Branch');connect(entry,'ExecOut',stepBranch,'Exec');connect(inBounds,'bOutput',stepBranch,'bCond');
const getValue=node('Exec_MapVar_Get',{},G);connect(catalog,'MapVarRef',getValue,'MapVarRef');connect(entry,'Value',getValue,'Key');connect(stepBranch,'ExecOutA',getValue,'Exec');
const key1=op('Expr_String_Split',entry,'Value','Input',{Delimiter:'.'},G),key2=op('Expr_String_Split',key1,'Right','Input',{Delimiter:'.'},G),value=op('Expr_String_Split',getValue,'Value','Input',{Delimiter:'|'},G);
const statField=op('Expr_String_Split',value,'Right','Input',{Delimiter:'|'},G),savedField=op('Expr_String_Split',statField,'Right','Input',{Delimiter:'|'},G);
const index=op('Expr_String_ParseNumber',key2,'Right','Input',{},G),stored=op('Expr_String_ParseNumber',savedField,'Left','Input',{},G),price=op('Expr_String_ParseNumber',savedField,'Right','Input',{},G);
function lengthPositive(a,p){const len=op('Expr_String_Length',a,p,'Input',{},G);const cmp=node('Expr_CompareGreater',{InputB:N(0)},G);connect(len,'Output',cmp,'InputA');return [cmp,'bOutput'];}
function nonnegativeInteger(a,signed=false){const pos=node('Expr_CompareGreaterOrEqual',{InputB:N(0)},G);connect(a,'Value',pos,'InputA');const floor=op('Expr_Floor',a,'Value','Input',{},G),eq=node('Expr_CompareEqual',{},G);connect(a,'Value',eq,'InputA');connect(floor,'Output',eq,'InputB');return [...(signed?[]:[[pos,'bOutput']]),[eq,'bOutput'],[a,'bSuccess']];}
const extraKey=op('Expr_String_Contains',key2,'Right','Input',{Search:'.'},G),noExtraKey=op('Expr_LogicalNOT',extraKey,'Output','bInput',{},G);
const extraValue=op('Expr_String_Contains',savedField,'Right','Input',{Search:'|'},G),noExtraValue=op('Expr_LogicalNOT',extraValue,'Output','bInput',{},G);
const currencySafe=node('Expr_CompareNotEqual',{InputB:S('Scrap')},G);connect(statField,'Left',currencySafe,'InputA');
const [rowValid,rowPort]=all([[currencySafe,'bOutput'],[getValue,'bFound'],[key1,'bFound'],[key2,'bFound'],[value,'bFound'],[statField,'bFound'],[savedField,'bFound'],lengthPositive(statField,'Left'),lengthPositive(key1,'Left'),lengthPositive(key2,'Left'),lengthPositive(value,'Left'),...nonnegativeInteger(index),...nonnegativeInteger(stored,true),...nonnegativeInteger(price),[noExtraKey,'bOutput'],[noExtraValue,'bOutput']],G);
const validBranch=node('Exec_Branch',{},G);connect(rowValid,rowPort,validBranch,'bCond');connect(getValue,'ExecOut',validBranch,'Exec');const invalid=set(valid,B(false),G);const invalidSources=[[validBranch,'ExecOutB']];
const vehicleLength=op('Expr_String_Length',key1,'Left','Input',{},G),prefixLength=node('Expr_MathSubtract',{InputB:N(5)},G);connect(vehicleLength,'Output',prefixLength,'InputA');const shortPrefix=op('Expr_String_Substring',key1,'Left','Input',{Start:0},G);connect(prefixLength,'Output',shortPrefix,'Length');const endsOwned=op('Expr_String_EndsWith',key1,'Left','Input',{Suffix:'Owned'},G),prefix=node('Expr_Select',{},G);connect(key1,'Left',prefix,'InputA');connect(shortPrefix,'Output',prefix,'InputB');connect(endsOwned,'Output',prefix,'bSelectB');
function format(pattern,terms){const n=node('Expr_String_FormatText',{FormatString:pattern},G);terms.forEach(([a,p],i)=>connect(a,p,n,'Input'+String.fromCharCode(65+i)));return n;}
const group=format('{A}{B}',[[prefix,'Output'],[key2,'Left']]),partKey=format('{A}{B}',[[group,'Output'],[index,'Value']]),seenKey=format('{A}.{B}',[[key1,'Left'],[key2,'Left']]);
function mapGet(m,a,p){const n=node('Exec_MapVar_Get',{},G);connect(m,'MapVarRef',n,'MapVarRef');connect(a,p,n,'Key');return n;}
function mapSet(m,a,p,z,q){const n=node('Exec_MapVar_Set',{},G);connect(m,'MapVarRef',n,'MapVarRef');connect(a,p,n,'Key');connect(z,q,n,'Value');return n;}
const pairKey=format('{A}{B}',[[group,'Output'],[stored,'Value']]);
const existingStat=mapGet(cache.stats,group,'Output');connect(validBranch,'ExecOutA',existingStat,'Exec');const absentStat=op('Expr_LogicalNOT',existingStat,'bFound','bInput',{},G),sameStat=node('Expr_CompareEqual',{},G);connect(existingStat,'Value',sameStat,'InputA');connect(statField,'Left',sameStat,'InputB');const statOkay=bool('Expr_LogicalOR',absentStat,'bOutput',sameStat,'bOutput',G),checkStat=node('Exec_Branch',{},G);connect(existingStat,'ExecOut',checkStat,'Exec');connect(statOkay,'bOutput',checkStat,'bCond');invalidSources.push([checkStat,'ExecOutB']);
const duplicate=mapGet(cache.indices,pairKey,'Output');connect(checkStat,'ExecOutA',duplicate,'Exec');const uniqueValue=op('Expr_LogicalNOT',duplicate,'bFound','bInput',{},G),checkUnique=node('Exec_Branch',{},G);connect(duplicate,'ExecOut',checkUnique,'Exec');connect(uniqueValue,'bOutput',checkUnique,'bCond');invalidSources.push([checkUnique,'ExecOutB']);
let bad=invalidSources[0];for(const other of invalidSources.slice(1)){const u=node('Exec_Union',{},G);connect(bad[0],bad[1],u,'ExecA');connect(other[0],other[1],u,'ExecB');bad=[u,'ExecOut'];}connect(bad[0],bad[1],invalid,'Exec');
const writePrefix=mapSet(cache.prefixes,key1,'Left',prefix,'Output');connect(checkUnique,'ExecOutA',writePrefix,'Exec');
const lookupSeen=mapGet(seen,seenKey,'Output');connect(writePrefix,'ExecOut',lookupSeen,'Exec');const categoryBranch=node('Exec_Branch',{},G);connect(lookupSeen,'bFound',categoryBranch,'bCond');connect(lookupSeen,'ExecOut',categoryBranch,'Exec');
const countGet=mapGet(cache.counts,prefix,'Output');connect(categoryBranch,'ExecOutB',countGet,'Exec');const currentCount=node('Expr_Select',{InputA:N(0)},G);connect(countGet,'bFound',currentCount,'bSelectB');connect(countGet,'Value',currentCount,'InputB');
const categoryKey=format('{A}Category{B}',[[prefix,'Output'],[currentCount,'Output']]);
const writeCategory=mapSet(cache.categories,categoryKey,'Output',key2,'Left');connect(countGet,'ExecOut',writeCategory,'Exec');const plus=node('Expr_MathAdd',{InputB:N(1)},G);connect(currentCount,'Output',plus,'InputA');
const writeCount=mapSet(cache.counts,prefix,'Output',plus,'Output');connect(writeCategory,'ExecOut',writeCount,'Exec');const writeSeen=mapSet(seen,seenKey,'Output',currentCount,'Output');connect(writeCount,'ExecOut',writeSeen,'Exec');
const both=node('Exec_Union',{},G);connect(categoryBranch,'ExecOutA',both,'ExecA');connect(writeSeen,'ExecOut',both,'ExecB');
const maxGet=mapGet(cache.max,group,'Output');connect(both,'ExecOut',maxGet,'Exec');const currentMax=node('Expr_Select',{InputA:N(0)},G);connect(maxGet,'bFound',currentMax,'bSelectB');connect(maxGet,'Value',currentMax,'InputB');const max=node('Expr_MathMax',{},G);connect(currentMax,'Output',max,'InputA');connect(index,'Value',max,'InputB');
const writeMax=mapSet(cache.max,group,'Output',max,'Output');connect(maxGet,'ExecOut',writeMax,'Exec');const writeName=mapSet(cache.names,partKey,'Output',value,'Left');connect(writeMax,'ExecOut',writeName,'Exec');const writePrice=mapSet(cache.prices,partKey,'Output',price,'Value');connect(writeName,'ExecOut',writePrice,'Exec');
const writeStat=mapSet(cache.stats,group,'Output',statField,'Left');connect(writePrice,'ExecOut',writeStat,'Exec');const writeSaved=mapSet(cache.saved,partKey,'Output',stored,'Value');connect(writeStat,'ExecOut',writeSaved,'Exec');const writeRefund=mapSet(cache.refunds,pairKey,'Output',price,'Value');connect(writeSaved,'ExecOut',writeRefund,'Exec');const writeIndex=mapSet(cache.indices,pairKey,'Output',index,'Value');connect(writeRefund,'ExecOut',writeIndex,'Exec');const next=node('Exec_Union');connect(writeIndex,'ExecOut',next,'ExecA');connect(invalid,'ExecOut',next,'ExecB');const increment=node('Exec_Var_Increment',{Value:N(1)});connect(cursor,'VarRef',increment,'VarRef');connect(next,'ExecOut',increment,'Exec');const tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});connect(increment,'ExecOut',tick,'Input');connect(tick,'Output',entryUnion,'ExecB');
// Update the existing selector's master vehicle list from the generated prefixes.
const allVehicles=old(selector,43,C.ArrayVar.NAME);allVehicles.data.Value.$array=initial.prefixes.map(([k])=>k);
const updateVehicles=node('Exec_MapVar_GetKeys');connect(cache.prefixes,'MapVarRef',updateVehicles,'MapVarRef');connect(allVehicles,'ArrayVarRef',updateVehicles,'ArrayVarRef');connect(stepBranch,'ExecOutB',updateVehicles,'Exec');const finishedBuilding=set(building,B(false));connect(updateVehicles,'ExecOut',finishedBuilding,'Exec');
// Refresh the selected upgrade and rebind/rescan the current player after Apply.
function mergeInto(z,q,a,p){const prior=originalInput(z,q),u=node('Exec_Union');connect(prior.a,prior.p,u,'ExecA');connect(a,p,u,'ExecB');connect(u,'ExecOut',z,q);}
mergeInto(old(shop,155,C.Exec_MapVar_Get.NAME),'Exec',updateVehicles,'ExecOut');mergeInto(old(selector,97,C.Exec_PlayerState_GetDisplayName.NAME),'Exec',updateVehicles,'ExecOut');
// The selected menu position, persisted value and persisted key are independent.
const statLookup=node('Exec_MapVar_Get');connect(cache.stats,'MapVarRef',statLookup,'MapVarRef');connect(old(shop,75,C.Expr_String_FormatText.NAME),'Output',statLookup,'Key');
const maxRefresh=old(shop,153,C.Exec_Union.NAME),maxInput=originalInput(maxRefresh,'ExecA');connect(maxInput.a,maxInput.p,statLookup,'Exec');connect(statLookup,'ExecOut',maxRefresh,'ExecA');
for(const [i,k]of [[3,'Exec_Gamemode_SetLeaderboardValue'],[5,'Exec_Gamemode_GetLeaderboardValue']])connect(statLookup,'Value',old(shop,i,C[k].NAME),'Key',true);
const savedLookup=node('Exec_MapVar_Get');connect(cache.saved,'MapVarRef',savedLookup,'MapVarRef');connect(old(shop,76,C.Expr_String_FormatText.NAME),'Output',savedLookup,'Key');connect(old(shop,160,C.Exec_MapVar_Get.NAME),'ExecOut',savedLookup,'Exec');
connect(savedLookup,'Value',old(shop,3,C.Exec_Gamemode_SetLeaderboardValue.NAME),'Value',true);connect(savedLookup,'Value',old(shop,138,C.Expr_CompareEqual.NAME),'InputA',true);
connect(cache.refunds,'MapVarRef',old(shop,161,C.Exec_MapVar_Get.NAME),'MapVarRef',true);
const installedIndex=node('Exec_MapVar_Get');connect(cache.indices,'MapVarRef',installedIndex,'MapVarRef');connect(old(shop,79,C.Expr_String_FormatText.NAME),'Output',installedIndex,'Key');
const positionSetter=old(shop,146,C.Exec_Var_Set.NAME),positionExec=originalInput(positionSetter,'Exec');connect(positionExec.a,positionExec.p,installedIndex,'Exec');connect(installedIndex,'ExecOut',positionSetter,'Exec');
const positionFallback=node('Expr_Select',{InputA:N(0)});connect(installedIndex,'bFound',positionFallback,'bSelectB');connect(installedIndex,'Value',positionFallback,'InputB');connect(positionFallback,'Output',positionSetter,'Value',true);
// Disable purchases while displayed option or installed-price data is refreshing.
const optionReady=node('Var',{Value:B(false)}),refundReady=node('Var',{Value:B(false)}),busy=node('Var',{Value:B(false)});const loadingOption=set(optionReady,B(false));connect(resetValid,'ExecOut',loadingOption,'Exec');
function clearBefore(z,q,ref){const e=originalInput(z,q),clear=set(ref,B(false));connect(e.a,e.p,clear,'Exec');connect(clear,'ExecOut',z,q);}
clearBefore(old(shop,155,C.Exec_MapVar_Get.NAME),'Exec',optionReady);clearBefore(old(shop,157,C.Exec_MapVar_Get.NAME),'Exec',optionReady);clearBefore(old(shop,159,C.Exec_MapVar_Get.NAME),'Exec',optionReady);
clearBefore(old(shop,5,C.Exec_Gamemode_GetLeaderboardValue.NAME),'Exec',refundReady);
const optionLoaded=set(optionReady,B(true));connect(savedLookup,'ExecOut',optionLoaded,'Exec');const refundLoaded=set(refundReady,B(true));connect(old(shop,161,C.Exec_MapVar_Get.NAME),'ExecOut',refundLoaded,'Exec');
const notBusy=op('Expr_LogicalNOT',busy,'Value','bInput');
let unlock=[refundLoaded,'ExecOut'];for(const v of [[old(shop,72,C.Exec_Branch.NAME),'ExecOutB'],[old(shop,73,C.Exec_Branch.NAME),'ExecOutA']]){const u=node('Exec_Union');connect(unlock[0],unlock[1],u,'ExecA');connect(v[0],v[1],u,'ExecB');unlock=[u,'ExecOut'];}const unlockBusy=set(busy,B(false));connect(unlock[0],unlock[1],unlockBusy,'Exec');
// Guard buying against malformed catalog rows and missing active lookups.
const activeReads=[...[155,157,158,159,160,161].map(i=>[old(shop,i,C.Exec_MapVar_Get.NAME),'bFound']),[statLookup,'bFound'],[savedLookup,'bFound'],[optionReady,'Value'],[refundReady,'Value'],[notBusy,'bOutput']];const playerPresent=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});connect(old(shop,103,C.Rerouter.NAME),'RER_Output',playerPresent,'InputA');const [canBuy,canBuyPort]=all([[notBuilding,'bOutput'],[valid,'Value'],[playerPresent,'bOutput'],...activeReads]);const buyLookup=old(shop,6,C.Exec_Gamemode_GetLeaderboardValue.NAME),buyInput=originalInput(buyLookup,'Exec');const checkBuy=node('Exec_Branch');connect(buyInput.a,buyInput.p,checkBuy,'Exec');connect(canBuy,canBuyPort,checkBuy,'bCond');const lockBusy=set(busy,B(true));connect(checkBuy,'ExecOutA',lockBusy,'Exec');connect(lockBusy,'ExecOut',buyLookup,'Exec');
// The visible charge now matches the actual charge after the trade-in refund.
connect(old(shop,86,C.Expr_MathSubtract.NAME),'Output',old(shop,77,C.Expr_String_FormatText.NAME),'InputA',true);
const noBuy=op('Expr_LogicalNOT',canBuy,canBuyPort,'bInput'),status=node('Expr_Select',{InputB:S('Catalog error')});connect(noBuy,'bOutput',status,'bSelectB');connect(old(shop,81,C.Expr_Select.NAME),'Output',status,'InputA');const reason=node('Expr_Select',{InputA:S('Select a vehicle'),InputB:S('Catalog error')});connect(playerPresent,'bOutput',reason,'bSelectB');connect(reason,'Output',status,'InputB');const [readyState,readyPort]=all([[notBuilding,'bOutput'],[optionReady,'Value'],[refundReady,'Value'],[notBusy,'bOutput']]);const pending=op('Expr_LogicalNOT',readyState,readyPort,'bInput'),progressMessage=node('Expr_Select',{InputA:S('Catalog error'),InputB:S('Updating...')});connect(pending,'bOutput',progressMessage,'bSelectB');connect(progressMessage,'Output',reason,'InputB');
for(const e of [...edges.values()])if(e.a.id===old(shop,81,C.Expr_Select.NAME).id&&e.p==='Output'&&e.z.id!==status.id)connect(status,'Output',e.z,e.q,true);
// Replace obsolete setup labels with the new single-map editing contract.
for(const v of oldNodes.values())for(const c of v.comps)if(c.type===C.TextDisplay.NAME){if(c.data.Text.includes('ADDING NEW VEHICLES')||c.data.Text.includes('Links a vehicle'))c.data.Text='PARTS CATALOG\r\nEdit the map inside the green CATALOG chip.\r\nKey: CarOwned.Engine.0\r\nValue: Stock Engine|CarEngine|0|0\r\nName|Leaderboard Key|Saved Value|Price\r\nMenu positions start at 0. Saved values are what the vehicle expects.\r\nExample: CarOwned.Color.0 = Blue|CarColor|3|50\r\nPress APPLY CATALOG after editing.\r\nOther lookup maps are GENERATED: do not edit.';else if(['UpgradePrices','UpgradeNames','UpgradeMaxValues','VehicleCategories','VehicleCategoryCounts','VehiclePrefixes'].some(t=>c.data.Text.includes(t))&&c.data.Text.includes('<color'))c.data.Text='GENERATED CACHE';}
// Exercise the emitted compiler graph rather than only the source data parser.
const model=require('./catalog-model.cjs'),ctx={nodes:newer,edges:[...edges.values()],start:resetValid,stopAt:updateVehicles,entry,catalog,cache,valid,allVehicles};
const normalize=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,[...v].sort(([a],[z])=>a.localeCompare(z))]));
for(const data of [catalogEntries,[...catalogEntries,['TowTruckOwned.Engine.0','Stock Diesel|TowPower|1|0'],['TowTruckOwned.Engine.1','Turbo Diesel|TowPower|7|700'],['TowTruckOwned.FuelTank.0','Stock Tank|Enginetank|2|0']],catalogEntries.map(([k,v])=>[k,k==='CarOwned.Engine.1'?'Renamed Engine|CarEngine|9|123':v])]){const actual=model(ctx,data),expected=compile(data);assert(actual.valid);assert.deepEqual(normalize(actual.maps),normalize(expected));assert.deepEqual([...actual.vehicles].sort(),expected.prefixes.map(([k])=>k).sort());}
for(const bad of [['CarOwned.Bad.0','Bad|CarBad|1|-2'],['BrokenKey','Bad|CarBad|1|2'],['CarOwned.Bad.0','Bad|CarBad|1|2|3'],['CarOwned.Engine.4','Duplicate|CarEngine|0|999'],['CarOwned.Engine.4','Wrong Stat|OtherStat|99|999'],['CarOwned.Bad.0','Currency|Scrap|10|1']])assert.equal(model(ctx,[...catalogEntries,bad]).valid,false);
// Do not ship the previous session's player name, balance or selection.
old(selector,47,C.Var.NAME).data.Value=S('User');old(selector,45,C.Var.NAME).data.Value=S('Empty');
old(selector,97,C.Exec_PlayerState_GetDisplayName.NAME).data.DisplayName='User';
old(selector,94,C.Exec_Var_Set.NAME).data.Value=S('User');
old(selector,42,C.ArrayVar.NAME).data.Value.$array=['','','','',''];
for(const i of [6,7])old(shop,i,C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Value=0;
for(const v of oldNodes.values())for(const c of v.comps)if(c.type===C.TextDisplay.NAME){if(c.data.Text==='Gearshark')c.data.Text='User';if(v.g===1&&v.i===25)c.data.Text='Scrap\r\n0';if(v.g===1&&v.i===27)c.data.Text='Select vehicle';if(v.g===1&&v.i===28)c.data.Text='';}
for(const e of edges.values())w.addWire({brick:e.a.handle,component_type:e.a.type,port:e.p},{brick:e.z.handle,component_type:e.z.type,port:e.q});
const prefab=structuredClone(r.prefabJson());for(const key of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot']){prefab.pivots[key].center.z=-16;prefab.pivots[key].halfExtent.z=52;}
const bytes=w.toBrz({prefab,externalAssets:r.externalAssets(),bundle:{name:'Vehicle Upgrade Shop - Flat Catalog Iterator',description:'Edit PartsCatalog: VehicleID.Category.Index => Name|LeaderboardKey|SavedValue|Price, then Apply Catalog. Existing upgrade leaderboard keys and 75% trade-in retained.'}});
const result=WorldReader.from(bytes);let comps=0,wires=0,mapCount=0;const inputKeys=new Set();for(const g of result.gridIds())for(const ch of result.brickChunkIndex(g)){if(ch.numComponents)for(const c of result.componentChunk(g,ch.index).components){comps++;if(c.typeName===C.MapVar.NAME)mapCount++;}if(ch.numWires){const ws=result.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const k=JSON.stringify([g,ch.index,e.target]);assert(!inputKeys.has(k),'Duplicate saved input');inputKeys.add(k);wires++;}}}
assert.equal(wires,edges.size);assert.equal(mapCount,12);fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,catalogEntries:catalogEntries.length,bricks:result.gridIds().reduce((n,g)=>n+[...result.bricks(g)].length,0),components:comps,wires,grids:result.gridIds().length,mapCount,sourcePricesPreserved:true},null,2));

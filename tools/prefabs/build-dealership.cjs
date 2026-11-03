'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {World,WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS,N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value}),B=value=>({$variant:'Bool',value}),O=value=>({$variant:'weak_object',value});
function build(source,options={}){
 const r=WorldReader.from(fs.readFileSync(source)),w=new World(),nodes=[],edges=[],targets=new Set(),ui=new Map();let id=0;
 function wire(a,p,z,q){assert(a&&z);assert(COMP(a).PORTS[p],a.type+'.'+p);assert(COMP(z).PORTS[q],z.type+'.'+q);const key=z.id+':'+q;assert(!targets.has(key),key);targets.add(key);edges.push({a,p,z,q});}
 function COMP(n){return Object.values(C).find(c=>c.NAME===n.type);}
 const schema=b.embeddedSchema('BRSavedComponentChunkSoA_max');
 const main=[...r.bricks(1)];let cursor=0;const chipPositions=[];
 // Copy the physical menu only. No obsolete logic grids or references survive.
 for(const ch of r.brickChunkIndex(1)){
  const cs=r.componentChunk(1,ch.index),bricks=main.slice(cursor,cursor+ch.numBricks);cursor+=ch.numBricks;
  for(let i=0;i<bricks.length;i++){
   const br=bricks[i],src=cs.components.filter(c=>c.brickIndex===i),part=ch.index.y===-25?'left':'right',key=part+':'+i;
   if(src.some(c=>c.typeName===C.Microchip.NAME)){chipPositions.push({key,position:br.position});continue;}
   if(part==='right'&&[2,3,5,6].includes(i))continue; // former part/category arrows
   const comps=src.map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','MapVarRef','ArrayVarRef'].includes(k)))}));
   if(key==='left:6'){comps.splice(comps.findIndex(c=>c.type===C.Button.NAME),1);comps.find(c=>c.type===C.TextDisplay.NAME).data.Text='DEALERSHIP';}
   if(key==='right:4'){comps.find(c=>c.type===C.TextDisplay.NAME).data.Text='Sell';comps.push({type:C.Button.NAME,data:{PromptCustomLabel:'Sell vehicle'}});}
   const initial={'right:12':'Buy','right:13':'Sell Price: —','right:14':'Vehicle Price: —','left:17':'Bind player','left:18':'Scrap\r\n0','left:19':'User','left:20':''};
   if(key in initial)comps.find(c=>c.type===C.TextDisplay.NAME).data.Text=initial[key];
   const data={...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],owner_index:0,components:comps};delete data.asset_name_index;delete data.material_index;
   const handle=w.addBrick(data);
   for(const c of comps){const n={id:'ui'+id++,handle,position:br.position,type:c.type,data:c.data};nodes.push(n);ui.set(key+':'+c.type,n);}
  }
 }
 const settings=w.addMicrochip({position:chipPositions.find(p=>p.key==='left:28').position,color:[40,155,95]}),logic=w.addMicrochip({position:chipPositions.find(p=>p.key==='left:25').position,color:[55,100,165]});
 let li=0,si=0;
 function node(k,data={},isSettings=false){const c=C[k];assert(c,k);const i=isSettings?si++:li++,n={id:'n'+id++,type:c.NAME,data,position:[(i%12)*48,Math.floor(i/12)*48,2]};n.handle=w.addBrick({asset:c.BRICK,position:n.position,color:isSettings?[40,155,95]:[55,100,165],components:[{type:c.NAME,data}]},isSettings?settings.grid:logic.grid);nodes.push(n);return n;}
 const u=(key,k)=>{const n=ui.get(key+':'+C[k].NAME);assert(n,key+' '+k);return n;};
 const ref=v=>[v,'Value'],val=x=>[null,x];
 function input(n,p,v){if(v[0])wire(v[0],v[1],n,p);else n.data[p]=v[1];}
 function expr(k,inputs={},data={}){const n=node(k,data);for(const [p,v]of Object.entries(inputs))input(n,p,v);return n;}
 function unary(k,v,p='Input'){return expr(k,{[p]:v});}
 function cmp(k,a,z){return expr(k,{InputA:a,InputB:z});}
 function and(...terms){return terms.reduce((a,z)=>[expr('Expr_LogicalAND',{bInputA:a,bInputB:z}),'bOutput']);}
 const not=v=>[unary('Expr_LogicalNOT',v,'bInput'),'bOutput'];
 function format(pattern,...terms){return expr('Expr_String_FormatText',Object.fromEntries(terms.map((v,i)=>['Input'+String.fromCharCode(65+i),v])),{FormatString:pattern});}
 function select(cond,a,z){return expr('Expr_Select',{bSelectB:cond,InputA:a,InputB:z});}
 function variable(v){return node('Var',{Value:v});}
 function set(v,value){const n=node('Exec_Var_Set');wire(v,'VarRef',n,'VarRef');input(n,'Value',value);return n;}
 function chain(a,z,p='ExecOut'){wire(a,p,z,'Exec');return z;}
 function branch(a,cond,p='ExecOut'){const n=node('Exec_Branch');input(n,'bCond',cond);wire(a,p,n,'Exec');return n;}
 function join(sources){while(sources.length>1){const a=sources.shift(),z=sources.shift(),n=node('Exec_Union');wire(a[0],a[1],n,'ExecA');wire(z[0],z[1],n,'ExecB');sources.push([n,'ExecOut']);}return sources[0];}
 const map=(rows)=>node('MapVar',{Value:{$keyType:'str',$valueType:'str',$map:rows}},true);
 const catalog=map(options.vehicles||[['CarOwned','Car|1|1000|600'],['TruckOwned','Truck|1|1500|900']]);
 const originals=[];for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g))if(ch.numComponents)for(const c of r.componentChunk(g,ch.index).components)if(c.typeName===C.MapVar.NAME&&c.data.Value.$map.some(([k])=>k==='CarOwned.Engine.0'))originals.push(c.data.Value.$map);
 assert.equal(originals.length,1,'Source parts catalog');
 const upgradeGroups=new Map();for(const [key,row]of originals[0]){const [vehicle]=key.split('.'),[,stat,saved,price]=row.split('|'),k=vehicle+'.'+stat;if(!upgradeGroups.has(k))upgradeGroups.set(k,[]);upgradeGroups.get(k).push(saved+':'+(Number(saved)===0?0:price));}
 const upgradeCatalog=map([...upgradeGroups].map(([k,rows])=>[k,rows.join('|')])),percent=node('Var',{Value:N(.75)},true);
 const bound=variable(O(null)),busy=variable(B(false)),mode=variable(N(0)),index=variable(N(0)),total=variable(N(0)),diagnostic=variable(S('')),feedback=variable(S('Bind player')),scanIndex=variable(N(0)),resetIndex=variable(N(0));
 const arr=()=>node('ArrayVar',{Value:{$elementType:'str',$array:[]}}),vehicles=arr(),upgradeKeys=arr(),resetKeys=arr();
 const notBusy=not(ref(busy)),present=[cmp('Expr_CompareNotEqual',ref(bound),val(O(null))),'bOutput'];
 function arrayOp(k,array,inputs={}){const n=node(k);wire(array,'ArrayVarRef',n,'ArrayVarRef');for(const [p,v]of Object.entries(inputs))input(n,p,v);return n;}
 function mapGet(m,key){const n=node('Exec_MapVar_Get');wire(m,'MapVarRef',n,'MapVarRef');input(n,'Key',key);return n;}
 function leaderboard(k,key,value){const n=node(k);input(n,'Key',key);wire(bound,'Value',n,'PlayerState');if(value)input(n,'Value',value);return n;}
 function split(v,delimiter){return expr('Expr_String_Split',{Input:v,Delimiter:val(delimiter)});}
 function num(v){return unary('Expr_String_ParseNumber',v);}
 function whole(v,positive=false){return and([v,'bSuccess'],[cmp(positive?'Expr_CompareGreater':'Expr_CompareGreaterOrEqual',ref(v),val(N(0))),'bOutput'],[cmp('Expr_CompareEqual',ref(v),[unary('Expr_Floor',ref(v)),'Output']),'bOutput']);}
 function nonempty(v){return [cmp('Expr_CompareGreater',[unary('Expr_String_Length',v),'Output'],val(N(0))),'bOutput'];}
 // All actions enter one locked refresh, including transaction-time ownership/balance rereads.
 const requests=[];
 function button(key,k,action,bind=false){const button=u(key,k),edge=expr('Expr_EdgeDetectorExec',{Input:[button,'bHeld']});
  const same=[cmp('Expr_CompareEqual',[button,'Character'],ref(bound)),'bOutput'],nonNull=[cmp('Expr_CompareNotEqual',[button,'Character'],val(O(null))),'bOutput'];
  const allowed=branch(edge,and(notBusy,nonNull,...(bind?[]:[present,same])),'OnRisingEdge');let tail=chain(allowed,set(busy,val(B(true))),'ExecOutA');
  if(bind){tail=chain(tail,set(bound,[button,'Character']));tail=chain(tail,set(index,val(N(0))));}
  if(action==='next'||action==='prev'){const add=expr('Expr_MathAdd',{InputA:ref(index),InputB:val(N(action==='next'?1:-1))});tail=chain(tail,set(index,[add,'Output']));}
  tail=chain(tail,set(mode,val(N(action==='buy'?1:action==='sell'?2:0))));requests.push([tail,'ExecOut']);return {edge,allowed};
 }
 const actions={bind:button('left:0','AnimatedButton','refresh',true),previous:button('left:13','Button','prev'),next:button('left:12','Button','next'),buy:button('right:12','Button','buy'),sell:button('right:4','Button','sell')};
 // Settings labels, Apply, and maintenance display are inside the configuration chip.
 const template=structuredClone(u('right:14','TextDisplay').data);
 function label(text,pos,size=[90,10,1]){w.addBrick({asset:'PB_DefaultMicroBrick',size,position:pos,color:[25,55,35],components:[{type:C.TextDisplay.NAME,data:{...template,Face:4,Rotation:0,Text:text,LineHeight:3}}]},settings.grid);}
 label('VEHICLE CATALOG →\r\nKey: ownership score (CarOwned)\r\nName|OwnedValue|BuyPrice|BaseSellPrice',[-180,0,2]);
 label('UPGRADE RESALE →\r\nKey: CarOwned.CarEngine\r\nValue: 0:0|1:100|2:250|3:500\r\nEvery listed score resets to 0 on sale.',[-180,48,2]);
 label('UPGRADE RESALE % →\r\n0.75 = 75%; stock value 0 has no refund',[-180,96,2]);
 // Use a labeled microbrick button; only the bound player may refresh the public menu.
 const applyButton={id:'apply',position:[0,160,2],type:C.Button.NAME,data:{PromptCustomLabel:'Apply Dealership Catalog'}};applyButton.handle=w.addBrick({asset:'PB_DefaultMicroBrick',size:[20,8,2],position:[0,160,2],color:[40,155,95],components:[{type:C.Button.NAME,data:applyButton.data},{type:C.TextDisplay.NAME,data:{...template,Text:'APPLY CATALOG',Face:4,Rotation:0,LineHeight:3}}]},settings.grid);nodes.push(applyButton);
 const applyEdge=expr('Expr_EdgeDetectorExec',{Input:[applyButton,'bHeld']}),applyGuard=branch(applyEdge,and(notBusy,present,[cmp('Expr_CompareEqual',[applyButton,'Character'],ref(bound)),'bOutput']),'OnRisingEdge');let applyTail=chain(applyGuard,set(busy,val(B(true))),'ExecOutA');applyTail=chain(applyTail,set(mode,val(N(0))));requests.push([applyTail,'ExecOut']);actions.apply={edge:applyEdge};
 const [entry,entryPort]=join(requests);let tail=chain(entry,set(diagnostic,val(S(''))),entryPort);tail=chain(tail,set(feedback,val(S('Updating…'))));
 const getVehicleKeys=node('Exec_MapVar_GetKeys');wire(catalog,'MapVarRef',getVehicleKeys,'MapVarRef');wire(vehicles,'ArrayVarRef',getVehicleKeys,'ArrayVarRef');tail=chain(tail,getVehicleKeys);
 tail=chain(tail,arrayOp('Exec_ArrayVar_Sort',vehicles));const length=arrayOp('Exec_ArrayVar_GetLength',vehicles);tail=chain(tail,length);
 const countOkay=[cmp('Expr_CompareGreater',[length,'Length'],val(N(0))),'bOutput'];const countBranch=branch(tail,countOkay);
 // Clamp browsing at either end; no wrapping or momentary button-dependent selection.
 const max=expr('Expr_MathSubtract',{InputA:[length,'Length'],InputB:val(N(1))}),lower=expr('Expr_MathMax',{InputA:ref(index),InputB:val(N(0))}),clamp=expr('Expr_MathMin',{InputA:[lower,'Output'],InputB:[max,'Output']});
 tail=chain(countBranch,set(index,[clamp,'Output']),'ExecOutA');
 const vehicle= arrayOp('Exec_ArrayVar_Get',vehicles,{Index:ref(index)});tail=chain(tail,vehicle);
 const row=mapGet(catalog,[vehicle,'Value']);tail=chain(tail,row);
 const name=split([row,'Value'],'|'),ownedField=split([name,'Right'],'|'),buyField=split([ownedField,'Right'],'|'),ownedValue=num([ownedField,'Left']),buyPrice=num([buyField,'Left']),baseSell=num([buyField,'Right']);
 const percentOkay=and([cmp('Expr_CompareGreaterOrEqual',ref(percent),val(N(0))),'bOutput'],[cmp('Expr_CompareLessOrEqual',ref(percent),val(N(1))),'bOutput']);
 const rowOkay=and([row,'bFound'],[name,'bFound'],[ownedField,'bFound'],[buyField,'bFound'],nonempty([name,'Left']),whole(ownedValue,true),whole(buyPrice),whole(baseSell),[cmp('Expr_CompareLessOrEqual',ref(baseSell),ref(buyPrice)),'bOutput'],[cmp('Expr_CompareNotEqual',[vehicle,'Value'],val(S('Scrap'))),'bOutput'],percentOkay);
 const rowBranch=branch(tail,rowOkay);
 const owner=leaderboard('Exec_Gamemode_GetLeaderboardValue',[vehicle,'Value']);tail=chain(rowBranch,owner,'ExecOutA');
 const balance=leaderboard('Exec_Gamemode_GetLeaderboardValue',val(S('Scrap')));tail=chain(tail,balance);
 const displayName=node('Exec_PlayerState_GetDisplayName');wire(bound,'Value',displayName,'PlayerState');tail=chain(tail,displayName);
 tail=chain(tail,set(total,ref(baseSell)));tail=chain(tail,arrayOp('Exec_ArrayVar_Clear',resetKeys));
 const getUpgradeKeys=node('Exec_MapVar_GetKeys');wire(upgradeCatalog,'MapVarRef',getUpgradeKeys,'MapVarRef');wire(upgradeKeys,'ArrayVarRef',getUpgradeKeys,'ArrayVarRef');tail=chain(tail,getUpgradeKeys);tail=chain(tail,set(scanIndex,val(N(0))));
 const scanStart=node('Exec_Union');wire(tail,'ExecOut',scanStart,'ExecA');
 const scanRow=arrayOp('Exec_ArrayVar_Get',upgradeKeys,{Index:ref(scanIndex)});chain(scanStart,scanRow);
 const scanDone=branch(scanRow,not([scanRow,'bOutOfBounds']));
 const keyParts=split([scanRow,'Value'],'.'),sameVehicle=[cmp('Expr_CompareEqual',[keyParts,'Left'],[vehicle,'Value']),'bOutput'];const filter=branch(scanDone,sameVehicle,'ExecOutA');
 const stat=[keyParts,'Right'];const statOwner=mapGet(catalog,stat);chain(filter,statOwner,'ExecOutA');
 const containsDot=expr('Expr_String_Contains',{Input:stat},{Search:'.'}),noDot=not([containsDot,'Output']);
 const safeStat=and([keyParts,'bFound'],nonempty(stat),noDot,[cmp('Expr_CompareNotEqual',stat,val(S('Scrap'))),'bOutput'],not([statOwner,'bFound']));
 const statBranch=branch(statOwner,safeStat);
 const pushReset=arrayOp('Exec_ArrayVar_Push',resetKeys,{Value:stat});chain(statBranch,pushReset,'ExecOutA');
 const haveVehicle=[cmp('Expr_CompareEqual',[owner,'Value'],ref(ownedValue)),'bOutput'];const ownedBranch=branch(pushReset,haveVehicle);
 const installed=leaderboard('Exec_Gamemode_GetLeaderboardValue',stat);chain(ownedBranch,installed,'ExecOutA');
 const zero=branch(installed,[cmp('Expr_CompareEqual',[installed,'Value'],val(N(0))),'bOutput']);
 const upgradeRow=mapGet(upgradeCatalog,[scanRow,'Value']);chain(zero,upgradeRow,'ExecOutB');
 const wrapped=format('|{A}|',[upgradeRow,'Value']),delimiter=format('|{A}:',[installed,'Value']);
 const foundPrice=expr('Expr_String_Split',{Input:[wrapped,'Output'],Delimiter:[delimiter,'Output']}),priceTail=split([foundPrice,'Right'],'|'),upgradePrice=num([priceTail,'Left']);
 const knownPrice=and([upgradeRow,'bFound'],[foundPrice,'bFound'],[priceTail,'bFound'],whole(upgradePrice));const knownBranch=branch(upgradeRow,knownPrice);
 const multiplied=expr('Expr_MathMultiply',{InputA:ref(upgradePrice),InputB:ref(percent)}),refund=unary('Expr_Floor',[multiplied,'Output']),sum=expr('Expr_MathAdd',{InputA:ref(total),InputB:[refund,'Output']});const accumulate=set(total,[sum,'Output']);chain(knownBranch,accumulate,'ExecOutA');
 const [continueNode,continuePort]=join([[filter,'ExecOutB'],[ownedBranch,'ExecOutB'],[zero,'ExecOutA'],[accumulate,'ExecOut']]);
 const increment=node('Exec_Var_Increment',{Value:N(1)});wire(scanIndex,'VarRef',increment,'VarRef');chain(continueNode,increment,continuePort);const tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(increment,'ExecOut',tick,'Input');wire(tick,'Output',scanStart,'ExecB');
 // Complete valuation before any purchase/sale writes.
 const isBuy=[cmp('Expr_CompareEqual',ref(mode),val(N(1))),'bOutput'],buyBranch=branch(scanDone,isBuy,'ExecOutB');
 const canBuy=and([cmp('Expr_CompareEqual',[owner,'Value'],val(N(0))),'bOutput'],[cmp('Expr_CompareGreaterOrEqual',[balance,'Value'],ref(buyPrice)),'bOutput']);const buyCheck=branch(buyBranch,canBuy,'ExecOutA');
 const setOwned=leaderboard('Exec_Gamemode_SetLeaderboardValue',[vehicle,'Value'],ref(ownedValue));chain(buyCheck,setOwned,'ExecOutA');
 const negativePrice=unary('Expr_MathNegate',ref(buyPrice));const debit=leaderboard('Exec_Gamemode_IncrementLeaderboardValue',val(S('Scrap')),[negativePrice,'Output']);chain(setOwned,debit);const bought=chain(debit,set(feedback,val(S('Purchased'))));
 const already=select([cmp('Expr_CompareEqual',[owner,'Value'],val(N(0))),'bOutput'],val(S('Already owned')),val(S('Not enough Scrap')));const failedBuy=chain(buyCheck,set(feedback,[already,'Output']),'ExecOutB');
 const isSell=[cmp('Expr_CompareEqual',ref(mode),val(N(2))),'bOutput'],sellBranch=branch(buyBranch,isSell,'ExecOutB');const sellCheck=branch(sellBranch,haveVehicle,'ExecOutA');
 let saleTail=chain(sellCheck,set(resetIndex,val(N(0))),'ExecOutA');const resetStart=node('Exec_Union');wire(saleTail,'ExecOut',resetStart,'ExecA');
 const resetKey=arrayOp('Exec_ArrayVar_Get',resetKeys,{Index:ref(resetIndex)});chain(resetStart,resetKey);const resetDone=branch(resetKey,not([resetKey,'bOutOfBounds']));
 const clearStat=leaderboard('Exec_Gamemode_SetLeaderboardValue',[resetKey,'Value'],val(N(0)));chain(resetDone,clearStat,'ExecOutA');
 const resetInc=node('Exec_Var_Increment',{Value:N(1)});wire(resetIndex,'VarRef',resetInc,'VarRef');chain(clearStat,resetInc);const resetTick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(resetInc,'ExecOut',resetTick,'Input');wire(resetTick,'Output',resetStart,'ExecB');
 const clearOwned=leaderboard('Exec_Gamemode_SetLeaderboardValue',[vehicle,'Value'],val(N(0)));chain(resetDone,clearOwned,'ExecOutB');
 const credit=leaderboard('Exec_Gamemode_IncrementLeaderboardValue',val(S('Scrap')),ref(total));chain(clearOwned,credit);const soldMessage=chain(credit,set(feedback,val(S('Sold + upgrades'))));const sold=chain(soldMessage,set(total,ref(baseSell)));
 const failedSell=chain(sellCheck,set(feedback,val(S('Not owned'))),'ExecOutB');const ownershipLabel=select(haveVehicle,val(S('Not owned')),val(S('Owned')));const refreshed=chain(sellBranch,set(feedback,[ownershipLabel,'Output']),'ExecOutB');
 // Refresh cached balance/ownership after successful writes; preserve transaction feedback.
 const [success,successPort]=join([[bought,'ExecOut'],[sold,'ExecOut']]);const finalBalance=leaderboard('Exec_Gamemode_GetLeaderboardValue',val(S('Scrap')));chain(success,finalBalance,successPort);
 const shownBalance=variable(N(0));const cacheNewBalance=chain(finalBalance,set(shownBalance,[finalBalance,'Value']));
 const [noWrite,noWritePort]=join([[failedBuy,'ExecOut'],[failedSell,'ExecOut'],[refreshed,'ExecOut']]);const cacheBalance=chain(noWrite,set(shownBalance,[balance,'Value']),noWritePort);
 const [done,donePort]=join([[cacheNewBalance,'ExecOut'],[cacheBalance,'ExecOut']]);const unlock=set(busy,val(B(false)));chain(done,unlock,donePort);
 // First failure stops all writes and leaves an explicit maintenance message.
 const errors=[];
 function error(a,p,message){const save=set(diagnostic,message);chain(a,save,p);const status=chain(save,set(feedback,val(S('Catalog error'))));errors.push([status,'ExecOut']);}
 error(countBranch,'ExecOutB',val(S('Vehicle catalogue is empty')));error(rowBranch,'ExecOutB',[format('Invalid vehicle row: {A}. Use Name|OwnedValue|BuyPrice|BaseSellPrice; 0 <= sell <= buy; resale % 0..1.',[vehicle,'Value']),'Output']);
 error(statBranch,'ExecOutB',[format('Unsafe upgrade score: {A}',[scanRow,'Value']),'Output']);error(knownBranch,'ExecOutB',[format('Unlisted upgrade value: {A} = {B}',stat,[installed,'Value']),'Output']);
 const [err,errPort]=join(errors);const errorUnlock=set(busy,val(B(false)));chain(err,errorUnlock,errPort);
 // Live UI: full vehicle price and total sale payout, with fixed Buy/Sell labels.
 wire(format('Vehicle Price: {A} Scrap',ref(buyPrice)),'Output',u('right:14','TextDisplay'),'Text');
 wire(format('Sell Price: {A} Scrap',ref(total)),'Output',u('right:13','TextDisplay'),'Text');
 wire(format('Scrap\r\n{A}',ref(shownBalance)),'Output',u('left:18','TextDisplay'),'Text');wire(displayName,'DisplayName',u('left:19','TextDisplay'),'Text');wire(feedback,'Value',u('left:17','TextDisplay'),'Text');
 // Five-row catalogue window. Refreshing this window never changes the selected index.
 const windowReads=[];for(const delta of [-2,-1,0,1,2]){const at=expr('Expr_MathAdd',{InputA:ref(index),InputB:val(N(delta))}),key=arrayOp('Exec_ArrayVar_Get',vehicles,{Index:[at,'Output']}),read=mapGet(catalog,[key,'Value']);chain(key,read);const splitName=split([read,'Value'],'|'),shown=select([key,'bOutOfBounds'],[splitName,'Left'],val(S('')));windowReads.push({key,read,shown});}
 const afterWindow=node('Exec_Union');wire(unlock,'ExecOut',afterWindow,'ExecA');wire(errorUnlock,'ExecOut',afterWindow,'ExecB');let winTail=afterWindow;for(const row of windowReads){chain(winTail,row.key);winTail=row.read;}
 const listing=format('{A}\r\n{B}\r\n> {C} <\r\n{D}\r\n{E}',...windowReads.map(x=>[x.shown,'Output']));wire(listing,'Output',u('left:20','TextDisplay'),'Text');
 const debug={id:'debug',position:[0,230,2],type:C.TextDisplay.NAME,data:{...template,Face:4,Rotation:0,Text:'',LineHeight:3}};debug.handle=w.addBrick({asset:'PB_DefaultMicroBrick',size:[160,16,1],position:[0,230,2],color:[60,25,25],components:[{type:debug.type,data:debug.data}]},settings.grid);nodes.push(debug);wire(diagnostic,'Value',debug,'Text');
 for(const n of nodes){const fields=schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(n.type));for(const [key,value]of Object.entries(n.data)){if(value&&typeof value==='object'&&'$variant'in value&&fields.get(key)?.type!=='WireValue')n.data[key]=value.value;}}
 for(const e of edges)w.addWire({brick:e.a.handle,component_type:e.a.type,port:e.p},{brick:e.z.handle,component_type:e.z.type,port:e.q});
 const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership',description:'Buy/sell vehicles with installed upgrade resale and zeroed configuration. Editable catalogue settings in green chip.'}});
 const ctx={nodes,edges,actions,catalog,upgradeCatalog,percent,bound,busy,index,total,diagnostic,feedback,shownBalance,vehicles,resetKeys,mode,ui};
 return {bytes,ctx,r,counts:{originalBricks:r.gridIds().reduce((a,g)=>a+[...r.bricks(g)].length,0),newBricks:WorldReader.from(bytes).gridIds().reduce((a,g)=>a+[...WorldReader.from(bytes).bricks(g)].length,0),logicGates:li,wires:edges.length}};
}
module.exports=build;
if(require.main===module){const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node build-dealership.cjs menu.brz output.brz');const result=build(source);require('./test-dealership.cjs')(result);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,...result.counts},null,2));}

'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS,N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value}),O=value=>({$variant:'weak_object',value});
function prefab(ext,flags={}){const p={pivots:{bottomStudsPivot:{center:{x:0,y:0,z:0},halfExtent:ext},studsExpandedPivot:{center:{x:0,y:0,z:0},halfExtent:ext},topStudsPivot:{center:{x:0,y:0,z:0},halfExtent:ext},boundsPivot:{center:{x:0,y:0,z:0},halfExtent:ext},bottomStudsDirection:'Z_Negative',topStudsDirection:'Z_Positive',bBottomStudsValid:true,bTopStudsValid:true},addedGlobalGridOffset:{x:0,y:0,z:0},bIsPhysicsGrid:false,bFreezePhysicsGrid:false,bFreezeGlobalGrid:false,bIsMicrochipPrefab:false};return Object.assign(p,flags);}
function circuit(w,grid){const nodes=[],edges=[];let index=0;
 function node(k,data={},position,where=grid){const c=C[k];assert(c,k);const i=index++,n={id:'n'+i,type:c.NAME,data,position:position||[(i%10)*48,Math.floor(i/10)*48,2]};n.handle=w.addBrick({asset:c.BRICK,...(c.BRICK.startsWith('PB_Gate_')?{size:[10,5,2]}:{}),position:n.position,color:[50,105,145],components:[{type:n.type,data}]},where==='main'?undefined:where);nodes.push(n);return n;}
 function connect(a,p,z,q){assert(Object.values(C).find(c=>c.NAME===a.type).PORTS[p],a.type+'.'+p);assert(Object.values(C).find(c=>c.NAME===z.type).PORTS[q],z.type+'.'+q);assert(!edges.some(e=>e.z===z&&e.q===q),'Duplicate '+z.id+'.'+q);edges.push({a,p,z,q});w.addWire({brick:a.handle,component_type:a.type,port:p},{brick:z.handle,component_type:z.type,port:q});}
 function chain(a,z,p='ExecOut',q='Exec'){connect(a,p,z,q);return z;}
 function variable(value){return node('Var',{Value:value});}
 function set(ref,value){const n=node('Exec_Var_Set',value?{Value:value}:{});connect(ref,'VarRef',n,'VarRef');return n;}
 function branch(source,cond,p='ExecOut'){const n=node('Exec_Branch');chain(source,n,p);connect(cond,'bOutput',n,'bCond');return n;}
 function cmp(k,a,p,data={}){const n=node(k,data);connect(a,p,n,'InputA');return n;}
 function join(terms){while(terms.length>1){const a=terms.shift(),z=terms.shift(),u=node('Exec_Union');connect(a[0],a[1],u,'ExecA');connect(z[0],z[1],u,'ExecB');terms.push([u,'ExecOut']);}return terms[0];}
 return {w,nodes,edges,node,connect,chain,variable,set,branch,cmp,join};
}
const B=value=>({$variant:'Bool',value});
const style={Font:0,Face:0,LineHeight:2.5,WidthScale:1,Color:{R:240,G:250,B:255,A:255},bOverrideColor:true,Material:2,Outline:2,OutlineWidth:0,Anchor:{X:.5,Y:.5},bEnabled:true};
function build(){
 // Embedded payload: one frozen physics entity, independently labeled per spawn.
 const cargo=new World(),chip=cargo.addMicrochip({position:[0,0,0],color:[70,100,115]}),p=circuit(cargo,chip.grid);
 cargo.addBrick({asset:'PB_DefaultMicroBrick',size:[16,16,16],position:[0,0,0],color:[145,95,45],material:'BMC_Plastic'});
 const label=p.node('Event_CustomGlobal',{EventName:'LoadProbe.Label',bIsObjectEvent:true,DataOut1:S(''),DataOut2:S(''),DataOut3:N(0)});
 const cargoName=p.variable(S('Awaiting initialization')),cargoOwner=p.variable(S('')),cargoDelivery=p.variable(N(0));
 let tail=label;for(const [ref,port]of [[cargoName,'DataOut1'],[cargoOwner,'DataOut2'],[cargoDelivery,'DataOut3']]){const save=p.set(ref);p.connect(label,port,save,'Value');p.chain(tail,save);tail=save;}
 const caption=p.node('Expr_String_FormatText',{FormatString:'TEST CARGO #{A}\r\n{B}\r\nOwner ID: {C}'});p.connect(cargoDelivery,'Value',caption,'InputA');p.connect(cargoName,'Value',caption,'InputB');p.connect(cargoOwner,'Value',caption,'InputC');
 for(let rot=0;rot<4;rot++){const h=cargo.addBrick({asset:'PB_DefaultMicroBrick',size:[1,16,12],position:[[17,0,0],[0,17,0],[-17,0,0],[0,-17,0]][rot],direction:4,rotation:rot,color:[40,30,20],components:[{type:C.TextDisplay.NAME,data:{...style,Text:'TEST CARGO',LineHeight:.8,WidthScale:.65}}]});p.connect(caption,'Output',{id:'face'+rot,type:C.TextDisplay.NAME,handle:h,position:[[17,0,0],[0,17,0],[-17,0,0],[0,-17,0]][rot]},'Text');}
 const payload=cargo.toBrz({prefab:prefab({x:18,y:18,z:18},{bIsPhysicsGrid:true,bFreezePhysicsGrid:true}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Delivery ID Probe Cargo',description:'Frozen cargo entity with object-scoped label initialization. Owner and contract properties are written natively by the pickup controller.'}});
 const w=new World(),backend=w.addMicrochip({position:[130,-100,0],color:[50,100,145]}),c=circuit(w,backend.grid),path=w.addPrefab(payload);
 function wait(a,ticks=1,port='ExecOut'){const n=c.node('BufferTicks',{TicksToWait:ticks,ZeroTicksToWait:0});c.chain(a,n,port,'Input');return n;}
 function after(a,z,ticks=1,port='ExecOut',target='Exec'){const tick=wait(a,ticks,port);c.chain(tick,z,'Output',target);return z;}
 function setThen(a,ref,value,port='ExecOut'){const n=c.set(ref,value);c.chain(a,n,port);return n;}
 const root=c.variable(O(null)),requestCharacter=c.variable(O(null)),expectedOwner=c.variable(S('')),expectedName=c.variable(S('')),delivery=c.variable(N(0)),completed=c.variable(B(false)),busy=c.variable(B(false)),receiveBusy=c.variable(B(false)),status=c.variable(S('Press GREEN to assign a test crate.'));
 const accepted=c.variable(N(0)),rejected=c.variable(N(0)),zoneCount=c.variable(N(0));
 const spawner=c.node('Exec_PrefabSpawner',{Prefab:path,Lifetime:0,Limit:1,SpawnOffset:{X:0,Y:0,Z:35},SpawnOffsetRotation:{Pitch:0,Yaw:0,Roll:0},SpawnVelocity:{X:0,Y:0,Z:0}},[-20,-65,0],'main');
 const destination=c.node('Exec_GetOwnTransform',{},[50,65,35],'main');
 const zoneHandle=w.addBrick({asset:C.AttachedZone.BRICK,size:[35,35,2],position:[50,65,0],direction:4,rotation:2,color:[30,140,210],components:[{type:C.AttachedZone.NAME,data:{ZoneStartDistance:0,ZoneEndDistance:90,bDetectEntities:true,bDetectPlayers:false,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,TagFilter:'LoadProbeCargo'}}]});
 const zone={id:'zone',type:C.AttachedZone.NAME,handle:zoneHandle,position:[50,65,0]};
 const entered=c.node('EntityZoneEvent_Entered',{TagFilter:'LoadProbeCargo'});c.connect(zone,'ZoneRef',entered,'Zone');
 function button(text,color,y){const handle=w.addBrick({asset:C.Button.BRICK,position:[-140,y,20],direction:4,rotation:2,color,components:[{type:C.Button.NAME,data:{bAllowNearbyInteraction:true,PromptCustomLabel:text}}]});const button={id:text,type:C.Button.NAME,handle,position:[-140,y,20]};w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,26,5],position:[-140,y,35],direction:4,rotation:2,color:[20,25,30],components:[{type:C.TextDisplay.NAME,data:{...style,Text:text,LineHeight:2}}]});const edge=c.node('Expr_EdgeDetectorExec');c.connect(button,'bHeld',edge,'Input');const free=c.node('Expr_LogicalNOT');c.connect(busy,'Value',free,'bInput');const guard=c.branch(edge,free,'OnRisingEdge');const lock=c.set(busy,B(true));c.chain(guard,lock,'ExecOutA');return {button,lock};}
 const green=button('1. ASSIGN',[30,200,70],-80),blue=button('2. DELIVER',[30,120,230],0),red=button('CORRUPT ID',[230,60,45],80);
 const unlock=c.set(busy,B(false)),unlockTerms=[];const finish=(n,p='ExecOut')=>unlockTerms.push([n,p]);
 const snap=c.set(requestCharacter);c.connect(green.button,'Character',snap,'Value');c.chain(green.lock,snap);
 const player=c.node('Exec_PlayerState_GetFromEntity');c.connect(requestCharacter,'Value',player,'Entity');after(snap,player);
 const userId=c.node('Exec_PlayerState_GetUserId');c.connect(player,'PlayerState',userId,'PlayerState');after(player,userId);
 const saveId=c.set(expectedOwner);c.connect(userId,'UserId',saveId,'Value');after(userId,saveId);
 const name=c.node('Exec_PlayerState_GetDisplayName');c.connect(player,'PlayerState',name,'PlayerState');after(saveId,name);
 const saveName=c.set(expectedName);c.connect(name,'DisplayName',saveName,'Value');after(name,saveName);
 const hasId=c.cmp('Expr_CompareNotEqual',expectedOwner,'Value',{InputB:S('')}),identified=c.branch(wait(saveName),hasId,'Output');
 const noId=c.set(status,S('FAILED: no player ID. Capture this screen.'));c.chain(identified,noId,'ExecOutB');finish(noId);
 const nextId=c.node('Exec_Var_Increment',{Value:N(1)});c.connect(delivery,'VarRef',nextId,'VarRef');c.chain(identified,nextId,'ExecOutA');
 const clearCompleted=setThen(nextId,completed,B(false));const working=setThen(clearCompleted,status,S('Spawning and imprinting cargo...'));
 const exists=c.cmp('Expr_CompareNotEqual',root,'Value',{InputB:O(null)}),oldCheck=c.branch(working,exists),destroy=c.node('Exec_Entity_DestroySpawnedPrefab');c.connect(root,'Value',destroy,'Entity');c.chain(oldCheck,destroy,'ExecOutA');
 const [spawnFrom,spawnPort]=c.join([[destroy,'ExecOut'],[oldCheck,'ExecOutB']]);after(spawnFrom,spawner,4,spawnPort);
 const saveRoot=c.set(root);c.connect(spawner,'Entity',saveRoot,'Value');after(spawner,saveRoot,3);
 const spawned=c.branch(wait(saveRoot,2),exists,'Output');const failed=c.set(status,S('FAILED: spawner returned no entity.'));c.chain(spawned,failed,'ExecOutB');finish(failed);
 const tag=c.node('Exec_Entity_SetTag',{Tag:'LoadProbeCargo'});c.connect(root,'Value',tag,'Entity');c.chain(spawned,tag,'ExecOutA');
 function property(key,value,source){const n=c.node('Exec_Entity_SetCustomProperty',{Key:key,...(value?{Value:value}:{})});c.connect(root,'Value',n,'Entity');if(source)c.connect(source,'Value',n,'Value');return n;}
 const imprintOwner=property('LoadProbe.OwnerId',null,expectedOwner),imprintDelivery=property('LoadProbe.DeliveryId',null,delivery),imprintDest=property('LoadProbe.Destination',S('Test Depot'));
 c.chain(tag,imprintOwner);c.chain(imprintOwner,imprintDelivery);c.chain(imprintDelivery,imprintDest);
 const send=c.node('Exec_SendCustomEventGlobal',{EventName:'LoadProbe.Label'});c.connect(root,'Value',send,'Target');c.connect(expectedName,'Value',send,'DataIn1');c.connect(expectedOwner,'Value',send,'DataIn2');c.connect(delivery,'Value',send,'DataIn3');after(imprintDest,send,3,'ExecOut','ExecIn');
 const ready=setThen(send,status,S('READY: blue delivers; red changes owner ID.'));finish(ready);
 // Corrupt only the physical cargo property, leaving the expected contract intact.
 const redCheck=c.branch(red.lock,exists),corrupt=property('LoadProbe.OwnerId',S('WRONG-OWNER'));c.chain(redCheck,corrupt,'ExecOutA');const corrupted=setThen(corrupt,status,S('OWNER ID CORRUPTED: press blue; expect REJECTED.'));finish(corrupted);
 const noCargo=c.set(status,S('No cargo. Press GREEN first.'));finish(noCargo);
 const blueCheck=c.branch(blue.lock,exists);const [emptySource,emptyPort]=c.join([[redCheck,'ExecOutB'],[blueCheck,'ExecOutB']]);c.chain(emptySource,noCargo,emptyPort);c.chain(blueCheck,destination,'ExecOutA');
 const move=c.node('Exec_Entity_SetLocation');c.connect(root,'Value',move,'Entity');c.connect(destination,'Location',move,'Vector');after(destination,move,2);
 // Set before moving: a synchronous zone callback must not be overwritten afterwards.
 const moving=c.set(status,S('Sending cargo into receiving zone...'));
 c.chain(blue.lock,moving); // fanout is diagnostic text only, not transaction state.
 const settle=wait(move,30);finish(settle,'Output');
 // Receiver snapshots the actual entering entity, then reads properties on THAT entity.
 const available=c.node('Expr_LogicalNOT');c.connect(receiveBusy,'Value',available,'bInput');const receiveCheck=c.branch(entered,available,'Exec'),receiveLock=c.set(receiveBusy,B(true));c.chain(receiveCheck,receiveLock,'ExecOutA');
 const incoming=c.variable(O(null)),saveIncoming=c.set(incoming);c.connect(entered,'Entity',saveIncoming,'Value');c.chain(receiveLock,saveIncoming);
 const count=c.node('Exec_Var_Increment',{Value:N(1)});c.connect(zoneCount,'VarRef',count,'VarRef');c.chain(saveIncoming,count);
 function get(key,value){const n=c.node('Exec_Entity_GetCustomProperty',{Key:key,Value:value,bFound:false});c.connect(incoming,'Value',n,'Entity');return n;}
 const readOwner=get('LoadProbe.OwnerId',S('')),readDelivery=get('LoadProbe.DeliveryId',N(0)),readDest=get('LoadProbe.Destination',S(''));
 after(count,readOwner,2);after(readOwner,readDelivery);after(readDelivery,readDest);
 const sameRoot=c.cmp('Expr_CompareEqual',incoming,'Value');c.connect(root,'Value',sameRoot,'InputB');
 const ownerMatches=c.cmp('Expr_CompareEqual',readOwner,'Value');c.connect(expectedOwner,'Value',ownerMatches,'InputB');
 const deliveryMatches=c.cmp('Expr_CompareEqual',readDelivery,'Value');c.connect(delivery,'Value',deliveryMatches,'InputB');
 const destMatches=c.cmp('Expr_CompareEqual',readDest,'Value',{InputB:S('Test Depot')}),notDone=c.node('Expr_LogicalNOT');c.connect(completed,'Value',notDone,'bInput');
 function all(terms){while(terms.length>1){const [a,ap]=terms.shift(),[z,zp]=terms.shift(),n=c.node('Expr_LogicalAND');c.connect(a,ap,n,'bInputA');c.connect(z,zp,n,'bInputB');terms.push([n,'bOutput']);}return terms[0][0];}
 const valid=all([[sameRoot,'bOutput'],[ownerMatches,'bOutput'],[deliveryMatches,'bOutput'],[destMatches,'bOutput'],[readOwner,'bFound'],[readDelivery,'bFound'],[readDest,'bFound'],[notDone,'bOutput'],[hasId,'bOutput']]);
 const verdict=c.branch(wait(readDest,2),valid,'Output');
 const mark=setThen(verdict,completed,B(true),'ExecOutA'),incAccepted=c.node('Exec_Var_Increment',{Value:N(1)});c.connect(accepted,'VarRef',incAccepted,'VarRef');c.chain(mark,incAccepted);
 const success=setThen(incAccepted,status,S('ACCEPTED: owner, delivery and destination match.'));
 const incRejected=c.node('Exec_Var_Increment',{Value:N(1)});c.connect(rejected,'VarRef',incRejected,'VarRef');c.chain(verdict,incRejected,'ExecOutB');const failure=setThen(incRejected,status,S('REJECTED: identity mismatch, missing data or completed.'));
 const [finished,finishedPort]=c.join([[success,'ExecOut'],[failure,'ExecOut']]);const receiveUnlock=c.set(receiveBusy,B(false));c.chain(finished,receiveUnlock,finishedPort);
 const summary=c.node('Expr_String_FormatText',{FormatString:'DELIVERY ID TEST\r\n{A}\r\nAssigned: {B}\r\nExpected owner ID: {C}\r\nDelivery: {D} | Zone entries: {E}\r\nAccepted: {F} | Rejected: {G}'});
 for(const [n,port,q]of [[status,'Value','A'],[expectedName,'Value','B'],[expectedOwner,'Value','C'],[delivery,'Value','D'],[zoneCount,'Value','E'],[accepted,'Value','F'],[rejected,'Value','G']])c.connect(n,port,summary,'Input'+q);
 const detail=c.node('Expr_String_FormatText',{FormatString:'Read owner: {A}\r\nRead delivery: {B} | Destination: {C}\r\nProperties found: {D}/{E}/{F}\r\nSame spawned entity: {G}'});
 for(const [n,port,q]of [[readOwner,'Value','A'],[readDelivery,'Value','B'],[readDest,'Value','C'],[readOwner,'bFound','D'],[readDelivery,'bFound','E'],[readDest,'bFound','F'],[sameRoot,'bOutput','G']])c.connect(n,port,detail,'Input'+q);
 const screen=c.node('Expr_String_FormatText',{FormatString:'{A}\r\n{B}'});c.connect(summary,'Output',screen,'InputA');c.connect(detail,'Output',screen,'InputB');
 const board=w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,145,75],position:[-150,0,125],direction:4,rotation:2,color:[8,12,18],components:[{type:C.TextDisplay.NAME,data:{...style,Text:'DELIVERY ID TEST'}}]});c.connect(screen,'Output',{id:'board',type:C.TextDisplay.NAME,handle:board,position:[-150,0,125]},'Text');
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[180,145,2],position:[0,0,-4],color:[40,45,52]});
 const [unlockSource,unlockPort]=c.join(unlockTerms);c.chain(unlockSource,unlock,unlockPort);
 const bytes=w.toBrz({prefab:prefab({x:185,y:150,z:205}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Delivery Owner ID Probe',description:'Green assigns real UserId and contract properties to embedded cargo. Blue moves cargo into a receiver that reads those properties from its detected entity. Red corrupts OwnerId for rejection testing. No currency or leaderboard writes. Single-contract diagnostic, not a load board.'}});
 return {bytes,payload,path,c,p,root,expectedOwner,delivery,completed,status,accepted,rejected,incoming,readOwner,readDelivery,readDest,sameRoot,ownerMatches,deliveryMatches,destMatches,valid,verdict,imprintOwner,imprintDelivery,imprintDest,corrupt,entered,send,spawner,label,green,blue,red};
}
module.exports=build;
if(require.main===module){const output=process.argv[2];if(!output)throw Error('Usage: node build-delivery-id-probe.cjs output.brz');const result=build();require('./test-delivery-id-probe.cjs')(result);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,controllerGates:result.c.nodes.length,cargoGates:result.p.nodes.length,embeddedPrefab:result.path},null,2));}

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
function build({withZone=false}={}){
 const w=new World(),chip=w.addMicrochip({position:[80,0,0],color:[50,100,140]}),c=circuit(w,chip.grid);
 const cargo=new World();cargo.addBrick({asset:'PB_DefaultMicroBrick',position:[0,0,0],size:[12,12,12],color:[130,85,45]});
 // Deliberately use the ordinary prefab mode from the working wallet demo:
 // no physics-grid flags, embedded microchips, object events or cargo labels.
 const payload=cargo.toBrz({prefab:prefab({x:12,y:12,z:12}),bundle:{name:'Plain Pickup Isolation Cube'}}),path=w.addPrefab(payload);
 const style={Font:0,Face:0,LineHeight:2.3,WidthScale:1,Color:{R:245,G:250,B:255,A:255},bOverrideColor:true,bEnabled:true,Material:2,Outline:2,OutlineWidth:0,Anchor:{X:.5,Y:.5}};
 const busy=c.variable(B(false)),character=c.variable(O(null)),owner=c.variable(S('')),displayName=c.variable(S('')),root=c.variable(O(null)),status=c.variable(S('Start with GREEN: read player ID only.')),step=c.variable(S('None'));
 const release=c.set(busy,B(false)),done=[];
 function wait(a,ticks=2,port='ExecOut'){const n=c.node('BufferTicks',{TicksToWait:ticks,ZeroTicksToWait:0});c.chain(a,n,port,'Input');return n;}
 function after(a,z,ticks=2,port='ExecOut'){c.chain(wait(a,ticks,port),z,'Output');return z;}
 function save(a,ref,value,p='ExecOut'){const n=c.set(ref,value);c.chain(a,n,p);return n;}
 function button(text,color,y){const h=w.addBrick({asset:C.Button.BRICK,position:[-50,y,15],direction:4,rotation:2,color,components:[{type:C.Button.NAME,data:{bAllowNearbyInteraction:true,PromptCustomLabel:text}}]});const button={id:text,type:C.Button.NAME,handle:h,position:[-50,y,15]};const edge=c.node('Expr_EdgeDetectorExec');c.connect(button,'bHeld',edge,'Input');const free=c.node('Expr_LogicalNOT');c.connect(busy,'Value',free,'bInput');const gate=c.branch(edge,free,'OnRisingEdge');const lock=c.set(busy,B(true));c.chain(gate,lock,'ExecOutA');const msg=save(lock,status,S('RUNNING '+text));w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,24,4],position:[-50,y,29],direction:4,rotation:2,color:[15,20,25],components:[{type:C.TextDisplay.NAME,data:{...style,Text:text,LineHeight:1.5}}]});return {button,start:wait(msg,5)};}
 const green=button('1 ID ONLY',[35,200,75],-90),blue=button('2 SPAWN ONLY',[35,125,240],-30),yellow=button('3 WRITE ID',[220,180,30],30),red=button('4 READ ID',[220,65,45],90);
 const capture=c.set(character);c.connect(green.button,'Character',capture,'Value');c.chain(green.start,capture,'Output');
 const player=c.node('Exec_PlayerState_GetFromEntity');c.connect(character,'Value',player,'Entity');after(capture,player);
 const getId=c.node('Exec_PlayerState_GetUserId');c.connect(player,'PlayerState',getId,'PlayerState');after(player,getId);
 const saveId=c.set(owner);c.connect(getId,'UserId',saveId,'Value');after(getId,saveId);
 const name=c.node('Exec_PlayerState_GetDisplayName');c.connect(player,'PlayerState',name,'PlayerState');after(saveId,name);
 const saveName=c.set(displayName);c.connect(name,'DisplayName',saveName,'Value');after(name,saveName);
 const idDone=save(saveName,step,S('1: player ID lookup finished'));const idStatus=save(idDone,status,S('ID lookup finished. If ID is nonempty, press BLUE.'));done.push([idStatus,'ExecOut']);
 const spawner=c.node('Exec_PrefabSpawner',{Prefab:path,Lifetime:0,Limit:1,SpawnOffset:{X:0,Y:0,Z:35},SpawnOffsetRotation:{Pitch:0,Yaw:0,Roll:0},SpawnVelocity:{X:0,Y:0,Z:0}},[20,-50,0],'main');
 c.chain(blue.start,spawner,'Output');const saveRoot=c.set(root);c.connect(spawner,'Entity',saveRoot,'Value');after(spawner,saveRoot,3);
 const spawnDone=save(saveRoot,step,S('2: plain prefab spawn returned'));const spawnStatus=save(spawnDone,status,S('Spawn returned. Check Entity present, then press YELLOW.'));done.push([spawnStatus,'ExecOut']);
 const exists=c.cmp('Expr_CompareNotEqual',root,'Value',{InputB:O(null)}),hasId=c.cmp('Expr_CompareNotEqual',owner,'Value',{InputB:S('')}),canWrite=c.node('Expr_LogicalAND');c.connect(exists,'bOutput',canWrite,'bInputA');c.connect(hasId,'bOutput',canWrite,'bInputB');
 const writeCheck=c.branch(yellow.start,canWrite,'Output'),write=c.node('Exec_Entity_SetCustomProperty',{Key:'LoadProbe.OwnerId',Value:S('')});c.connect(root,'Value',write,'Entity');c.connect(owner,'Value',write,'Value');c.chain(writeCheck,write,'ExecOutA');
 const wrote=save(write,step,S('3: owner property write returned'));const writeStatus=save(wrote,status,S('Write returned. Press RED to read it back.'));done.push([writeStatus,'ExecOut']);
 const cannotWrite=c.set(status,S('Need nonempty ID and spawned entity. Use GREEN then BLUE.'));c.chain(writeCheck,cannotWrite,'ExecOutB');done.push([cannotWrite,'ExecOut']);
 const readCheck=c.branch(red.start,exists,'Output'),read=c.node('Exec_Entity_GetCustomProperty',{Key:'LoadProbe.OwnerId',Value:S(''),bFound:false});c.connect(root,'Value',read,'Entity');c.chain(readCheck,read,'ExecOutA');
 const readDone=c.set(step,S('4: property read returned'));after(read,readDone);const match=c.cmp('Expr_CompareEqual',read,'Value');c.connect(owner,'Value',match,'InputB');
 const valid=c.node('Expr_LogicalAND');c.connect(match,'bOutput',valid,'bInputA');c.connect(read,'bFound',valid,'bInputB');const checked=c.branch(wait(readDone),valid,'Output');
 const success=c.set(status,S('PASS: native owner ID property matches.'));c.chain(checked,success,'ExecOutA');done.push([success,'ExecOut']);const fail=c.set(status,S('FAIL: owner property missing or different.'));c.chain(checked,fail,'ExecOutB');done.push([fail,'ExecOut']);
 const noEntity=c.set(status,S('No entity. Run BLUE once, or paste a fresh test copy.'));c.chain(readCheck,noEntity,'ExecOutB');done.push([noEntity,'ExecOut']);
 const zoneCtx={};
 if(withZone){
  const fifth=button('5 ZONE TEST',[170,80,230],150);
  const projector=w.addBrick({asset:C.AttachedZone.BRICK,size:[35,35,2],position:[70,110,0],direction:4,rotation:2,color:[60,150,210],components:[{type:C.AttachedZone.NAME,data:{ZoneStartDistance:0,ZoneEndDistance:90,bDetectEntities:true,bDetectPlayers:false,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,TagFilter:''}}]});
  const zone={id:'receiverZone',type:C.AttachedZone.NAME,handle:projector,position:[70,110,0]},entered=c.node('EntityZoneEvent_Entered',{TagFilter:''});c.connect(zone,'ZoneRef',entered,'Zone');
  const marker=c.node('Exec_GetOwnTransform',{},[70,110,35],'main'),move=c.node('Exec_Entity_SetLocation');c.connect(marker,'Location',move,'Vector');c.connect(root,'Value',move,'Entity');
  const moveCheck=c.branch(fifth.start,exists,'Output');c.chain(moveCheck,marker,'ExecOutA');after(marker,move,2);const moveDone=c.set(step,S('5: moved cube into receiving zone'));after(move,moveDone,30);const movedStatus=save(moveDone,status,S('Movement finished. Check RECEIVING ZONE below.'));done.push([movedStatus,'ExecOut']);
  const noCube=c.set(status,S('Run steps 1-4 first, then purple.'));c.chain(moveCheck,noCube,'ExecOutB');done.push([noCube,'ExecOut']);
  const arriving=c.variable(O(null)),receiveStatus=c.variable(S('Not tested: finish steps 1-4, then PURPLE.')),entries=c.variable(N(0));
  const captureIncoming=c.set(arriving);c.connect(entered,'Entity',captureIncoming,'Value');c.chain(entered,captureIncoming,'Exec');
  const increment=c.node('Exec_Var_Increment',{Value:N(1)});c.connect(entries,'VarRef',increment,'VarRef');c.chain(captureIncoming,increment);
  const zoneRead=c.node('Exec_Entity_GetCustomProperty',{Key:'LoadProbe.OwnerId',Value:S(''),bFound:false});c.connect(arriving,'Value',zoneRead,'Entity');after(increment,zoneRead,2);
  const same=c.cmp('Expr_CompareEqual',arriving,'Value');c.connect(root,'Value',same,'InputB');const ownerMatch=c.cmp('Expr_CompareEqual',zoneRead,'Value');c.connect(owner,'Value',ownerMatch,'InputB');
  const propertiesMatch=c.node('Expr_LogicalAND');c.connect(ownerMatch,'bOutput',propertiesMatch,'bInputA');c.connect(zoneRead,'bFound',propertiesMatch,'bInputB');const knownCube=c.node('Expr_LogicalAND');c.connect(same,'bOutput',knownCube,'bInputA');c.connect(exists,'bOutput',knownCube,'bInputB');const zoneValid=c.node('Expr_LogicalAND');c.connect(propertiesMatch,'bOutput',zoneValid,'bInputA');c.connect(knownCube,'bOutput',zoneValid,'bInputB');
  const check=c.branch(wait(zoneRead,2),zoneValid,'Output');const pass=c.set(receiveStatus,S('PASS: zone detected the stamped cube and its owner.'));c.chain(check,pass,'ExecOutA');const reject=c.set(receiveStatus,S('FAIL: detected entity or owner property differs.'));c.chain(check,reject,'ExecOutB');
  const zoneText=c.node('Expr_String_FormatText',{FormatString:'RECEIVING ZONE\r\n{A}\r\nZone entries: {B} | Same cube: {C}\r\nZone-read owner ID: {D}\r\nProperty found: {E} | Owner matches: {F}'});
  for(const [n,p,q]of [[receiveStatus,'Value','A'],[entries,'Value','B'],[same,'bOutput','C'],[zoneRead,'Value','D'],[zoneRead,'bFound','E'],[ownerMatch,'bOutput','F']])c.connect(n,p,zoneText,'Input'+q);
  Object.assign(zoneCtx,{fifth,entered,arriving,zoneRead,same,ownerMatch,zoneValid,zoneText});
 }
 const [last,lastPort]=c.join(done);c.chain(last,release,lastPort);
 const text=c.node('Expr_String_FormatText',{FormatString:'PICKUP CRASH ISOLATION\r\n{A}\r\nLast completed: {B}\r\nPlayer: {C}\r\nUser ID: {D}\r\nEntity present: {E}\r\nRead ID: {F}\r\nProperty found: {G}'});
 for(const [n,p,q]of [[status,'Value','A'],[step,'Value','B'],[displayName,'Value','C'],[owner,'Value','D'],[exists,'bOutput','E'],[read,'Value','F'],[read,'bFound','G']])c.connect(n,p,text,'Input'+q);
 let screenText=text;if(withZone){screenText=c.node('Expr_String_FormatText',{FormatString:'{A}\r\n{B}'});c.connect(text,'Output',screenText,'InputA');c.connect(zoneCtx.zoneText,'Output',screenText,'InputB');}
 const h=w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,180,100],position:[-60,0,130],direction:4,rotation:2,color:[8,12,18],components:[{type:C.TextDisplay.NAME,data:{...style,Text:'PICKUP CRASH ISOLATION'}}]});c.connect(screenText,'Output',{id:'screen',type:C.TextDisplay.NAME,handle:h,position:[-60,0,130]},'Text');
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[130,210,2],position:[0,0,-4],color:[40,45,52]});
 const bytes=w.toBrz({prefab:prefab({x:135,y:215,z:235}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:withZone?'Delivery Receiver Zone Test':'Pickup Crash Isolation - Manual Steps',description:withZone?'Repeat the four proven pickup steps, then press purple to move the plain cube into a receiving zone. Zone reads OwnerId from its detected entity. No physics payload flags, object events or scores.':'Four independent buttons isolate UserId lookup, plain nonphysics prefab spawn, entity custom property write and read. No zones, physics payload, events or scores. Blue is intended for one spawn per fresh test copy.'}});
 return {bytes,payload,path,c,green,blue,yellow,red,spawner,write,read,root,owner,withZone,zoneCtx};
}
module.exports=build;
if(require.main===module){const output=process.argv[2];if(!output)throw Error('Usage: node build-delivery-pickup-isolation.cjs output.brz');const ctx=build({withZone:process.argv.includes('--zone')});require(ctx.withZone?'./test-delivery-receiver-zone.cjs':'./test-delivery-pickup-isolation.cjs')(ctx);fs.writeFileSync(output,ctx.bytes);console.log(JSON.stringify({output,gates:ctx.c.nodes.length},null,2));}

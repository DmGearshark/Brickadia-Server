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
function build(){
 const payload=new World(),pc=payload.addMicrochip({position:[0,0,-10],color:[35,100,105]}),p=circuit(payload,pc.grid);
 payload.addBrick({asset:'PB_DefaultMicroBrick',size:[12,12,8],position:[0,0,0],color:[22,72,78],material:'BMC_Plastic'});
 const labelStyle={Text:'Wallet\r\nLoading…',Font:0,Face:0,LineHeight:2,WidthScale:.85,Color:{R:225,G:255,B:245,A:255},bOverrideColor:true,Material:2,Outline:2,OutlineWidth:1,Anchor:{X:.5,Y:.5}};
 const plates=[];for(let rot=0;rot<4;rot++){const position=[[13,0,0],[0,13,0],[-13,0,0],[0,-13,0]][rot],handle=payload.addBrick({asset:'PB_DefaultMicroBrick',size:[1,12,8],position,direction:4,rotation:rot,color:[12,22,28],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:structuredClone(labelStyle)}]});plates.push({id:'face'+rot,type:C.TextDisplay.NAME,handle,position,data:structuredClone(labelStyle)});}
 const received=p.node('Event_CustomGlobal',{EventName:'WalletDemo.Initialize',bIsObjectEvent:true,DataOut1:O(null),DataOut2:S('')});
 const owner=p.variable(O(null)),name=p.variable(S('Loading…'));
 const own=p.set(owner);p.connect(received,'DataOut1',own,'Value');p.chain(received,own);
 const named=p.set(name);p.connect(received,'DataOut2',named,'Value');p.chain(own,named);
 const text=p.node('Expr_String_FormatText',{FormatString:'Wallet\r\n{A}'});p.connect(name,'Value',text,'InputA');for(const face of plates)p.connect(text,'Output',face,'Text');
 const payloadBytes=payload.toBrz({prefab:prefab({x:14,y:14,z:12}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Wallet Name Object',description:'Object-scoped initializer stores the caller PlayerState and name independently in each spawned copy.'}});
 const w=new World(),chip=w.addMicrochip({position:[0,-48,0],color:[45,95,145]}),c=circuit(w,chip.grid),path=w.addPrefab(payloadBytes);
 const spawner=c.node('Exec_PrefabSpawner',{Prefab:path,Lifetime:60,Limit:32,SpawnOffset:{X:0,Y:0,Z:0},SpawnOffsetRotation:{Pitch:0,Yaw:0,Roll:0},SpawnVelocity:{X:0,Y:0,Z:0}},[0,0,16],'main');
 const ownTransform=c.node('Exec_GetOwnTransform',{},[48,0,16],'main');
 const command=c.node('Event_ChatCommand',{CommandName:'wallet',HelpText:'Spawn a temporary name object in front of you.'});
 const queue=c.node('ArrayVar',{Value:{$elementType:'weak_object',$array:[]}}),busy=c.variable({$variant:'Bool',value:false}),current=c.variable(O(null)),root=c.variable(O(null)),previous=c.variable(O(null)),distance=c.variable(N(120));
 const push=c.node('Exec_ArrayVar_Push');c.connect(queue,'ArrayVarRef',push,'ArrayVarRef');c.connect(command,'PlayerState',push,'Value');c.chain(command,push);
 const pump=c.node('Exec_Union');c.connect(push,'ExecOut',pump,'ExecA');
 const free=c.node('Expr_LogicalNOT');c.connect(busy,'Value',free,'bInput');const idle=c.branch(pump,free);
 const length=c.node('Exec_ArrayVar_GetLength');c.connect(queue,'ArrayVarRef',length,'ArrayVarRef');c.chain(idle,length,'ExecOutA');
 const any=c.cmp('Expr_CompareGreater',length,'Length',{InputB:N(0)}),nonEmpty=c.branch(length,any);
 const lock=c.set(busy,{$variant:'Bool',value:true});c.chain(nonEmpty,lock,'ExecOutA');
 const first=c.node('Exec_ArrayVar_Get',{Index:0});c.connect(queue,'ArrayVarRef',first,'ArrayVarRef');c.chain(lock,first);
 const player=c.set(current);c.connect(first,'Value',player,'Value');c.chain(first,player);
 const present=c.cmp('Expr_CompareNotEqual',current,'Value',{InputB:O(null)}),presentBranch=c.branch(player,present);
 const character=c.node('Exec_Character_GetFromController');c.connect(current,'Value',character,'PlayerState');c.chain(presentBranch,character,'ExecOutA');
 const alive=c.cmp('Expr_CompareNotEqual',character,'Character',{InputB:O(null)}),aliveBranch=c.branch(character,alive);
 const aim=c.node('Exec_Character_GetAim',{bLocalAim:false});c.connect(character,'Character',aim,'Character');c.chain(aliveBranch,aim,'ExecOutA');c.chain(aim,ownTransform);
 const displayName=c.node('Exec_PlayerState_GetDisplayName');c.connect(current,'Value',displayName,'PlayerState');c.chain(ownTransform,displayName);
 const offset=c.node('Expr_MathMultiply');c.connect(aim,'Direction',offset,'InputA');c.connect(distance,'Value',offset,'InputB');
 const desired=c.node('Expr_MathAdd');c.connect(aim,'Origin',desired,'InputA');c.connect(offset,'Output',desired,'InputB');
 const delta=c.node('Expr_MathSubtract');c.connect(desired,'Output',delta,'InputA');c.connect(ownTransform,'Location',delta,'InputB');
 const inverse=c.node('Expr_InvertRotation');c.connect(ownTransform,'Rotation',inverse,'Input');
 const local=c.node('Expr_RotateVector');c.connect(inverse,'Output',local,'Rotation');c.connect(delta,'Output',local,'Vector');
 // Own-transform gate is 48 local units along X from the spawner.
 const spawnOffset=c.node('Expr_MathAdd',{InputB:{$variant:'Vector',value:{X:48,Y:0,Z:0}}});c.connect(local,'Output',spawnOffset,'InputA');c.connect(spawnOffset,'Output',spawner,'SpawnOffset');
 const remember=c.set(previous);c.connect(spawner,'Entity',remember,'Value');c.chain(displayName,remember);c.chain(remember,spawner);
 const gotNew=c.cmp('Expr_CompareNotEqual',spawner,'Entity');c.connect(previous,'Value',gotNew,'InputB');
 const notNull=c.cmp('Expr_CompareNotEqual',spawner,'Entity',{InputB:O(null)}),valid=c.node('Expr_LogicalAND');c.connect(gotNew,'bOutput',valid,'bInputA');c.connect(notNull,'bOutput',valid,'bInputB');const spawned=c.branch(spawner,valid);
 const saveRoot=c.set(root);c.connect(spawner,'Entity',saveRoot,'Value');c.chain(spawned,saveRoot,'ExecOutA');
 const delay=c.node('BufferTicks',{TicksToWait:3,ZeroTicksToWait:0});c.connect(saveRoot,'ExecOut',delay,'Input');
 const targetAlive=c.cmp('Expr_CompareNotEqual',root,'Value',{InputB:O(null)}),sendCheck=c.branch(delay,targetAlive,'Output');
 const send=c.node('Exec_SendCustomEventGlobal',{EventName:'WalletDemo.Initialize'});c.connect(root,'Value',send,'Target');c.connect(current,'Value',send,'DataIn1');c.connect(displayName,'DisplayName',send,'DataIn2');c.chain(sendCheck,send,'ExecOutA','ExecIn');
 const unavailable=c.node('Exec_PlayerState_ShowStatusMessage',{Message:'Wallet could not spawn. Try again shortly.'});c.connect(current,'Value',unavailable,'PlayerState');const [failed,failedPort]=c.join([[spawned,'ExecOutB'],[sendCheck,'ExecOutB']]);c.chain(failed,unavailable,failedPort);
 const respawn=c.node('Exec_PlayerState_ShowStatusMessage',{Message:'Respawn before using /wallet.'});c.connect(current,'Value',respawn,'PlayerState');c.chain(aliveBranch,respawn,'ExecOutB');
 const [done,donePort]=c.join([[send,'ExecOut'],[unavailable,'ExecOut'],[respawn,'ExecOut'],[presentBranch,'ExecOutB']]);
 const remove=c.node('Exec_ArrayVar_RemoveAtIndex',{Index:0});c.connect(queue,'ArrayVarRef',remove,'ArrayVarRef');c.chain(done,remove,donePort);
 const unlock=c.set(busy,{$variant:'Bool',value:false});c.chain(remove,unlock);const next=c.node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});c.connect(unlock,'ExecOut',next,'Input');c.connect(next,'Output',pump,'ExecB');
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,18,7],position:[24,-72,0],color:[20,45,65],components:[{type:C.TextDisplay.NAME,data:{...labelStyle,Text:'/wallet\r\nName-object demo',LineHeight:2}}]});
 const bytes=w.toBrz({prefab:prefab({x:60,y:94,z:28}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Wallet Command Name Demo',description:'Paste once and type /wallet. Spawns an object 120 units ahead of the caller aim, then initializes only that instance with their PlayerState and display name. Includes its payload prefab.'}});
 return {bytes,payloadBytes,path,c,p,plates,received,owner,name,spawner,ownTransform,command,queue,busy,current,root,previous,distance,aim,displayName,spawnOffset,send,sendCheck,delay};
}
module.exports=build;
if(require.main===module){const output=process.argv[2];if(!output)throw Error('Usage: node build-wallet-name-demo.cjs output.brz');const result=build();require('./test-wallet-name-demo.cjs')(result);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,controllerGates:result.c.nodes.length,payloadGates:result.p.nodes.length,embeddedPrefab:result.path},null,2));}

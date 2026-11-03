'use strict';
const assert=require('assert/strict');
module.exports=function model(ctx,options={}){
 const players=structuredClone(options.players||{alice:{name:'Alice',origin:[100,200,80],direction:[1,0,0]},bob:{name:'Bob',origin:[-50,400,70],direction:[0,1,0]}}),entities=new Map(),messages=[],initializations=[],scheduled=[];
 const moduleOrigin=options.moduleOrigin||[500,-900,20],yaw=(options.moduleYaw||0)*Math.PI/180;let tick=0,spawnCount=0;
 const rotate=(v,inverse=false)=>{const a=inverse?-yaw:yaw;return [v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a),v[2]];};
 const vec=v=>Array.isArray(v)?v:[v.X,v.Y,v.Z],add=(a,z)=>a.map((v,i)=>v+z[i]);
 const unbox=v=>v&&typeof v==='object'&&'$variant'in v?v.value:v;
 const resolve=v=>typeof v==='string'&&v.startsWith('spawn:')?(entities.has(v)?v:null):typeof v==='string'&&v in players?(players[v].disconnected?null:v):v;
 function vm(c,extra=[],controller=false){
  const defs=new Map([...c.nodes,...extra].map(n=>[n.id,n])),incoming=new Map(c.edges.map(e=>[e.z.id+':'+e.q,e])),outgoing=new Map(),state=new Map(),results=new Map();
  for(const e of c.edges){const k=e.a.id+':'+e.p;if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e.z.id);}
  for(const n of defs.values()){if(n.type==='BrickComponentType_Var')state.set(n.id,n.data.Value.value);if(n.type==='BrickComponentType_ArrayVar')state.set(n.id,[...n.data.Value.$array]);}
  const input=(id,p)=>{const e=incoming.get(id+':'+p);return e?value(e.a.id,e.p):unbox(defs.get(id).data[p]);};
  function value(id,p){const n=defs.get(id),t=n.type,get=p=>input(id,p);if(['VarRef','ArrayVarRef'].includes(p))return id;
   if(t==='BrickComponentType_Var'){const v=state.get(id);return n.data.Value.$variant==='weak_object'?resolve(v):v;}
   if(t.startsWith('BrickComponentType_Exec_')||t.startsWith('BrickComponentType_Event_'))return resolve((results.get(id)||{})[p]??(p==='Entity'||p==='Character'?null:undefined));
   switch(t.replace('BrickComponentType_Expr_','')){
    case 'LogicalNOT':return !get('bInput');
    case 'LogicalAND':return Boolean(get('bInputA')&&get('bInputB'));
    case 'CompareGreater':return get('InputA')>get('InputB');
    case 'CompareNotEqual':return get('InputA')!==get('InputB');
    case 'MathAdd':return add(vec(get('InputA')),vec(get('InputB')));
    case 'MathSubtract':return vec(get('InputA')).map((v,i)=>v-vec(get('InputB'))[i]);
    case 'MathMultiply':return vec(get('InputA')).map(v=>v*get('InputB'));
    case 'InvertRotation':return {inverse:true};
    case 'RotateVector':return rotate(vec(get('Vector')),get('Rotation').inverse);
    case 'String_FormatText':return n.data.FormatString.replace(/\{([A-G])\}/g,(_,p)=>String(get('Input'+p)));
    default:throw Error('Unknown expression '+t);
   }
  }
  function emit(id,p){for(const next of outgoing.get(id+':'+p)||[])run(next);}
  function run(id){const n=defs.get(id),t=n.type,get=p=>input(id,p);let port='ExecOut';
   switch(t.replace('BrickComponentType_','')){
    case 'Exec_Union':break;
    case 'Exec_Branch':port=get('bCond')?'ExecOutA':'ExecOutB';break;
    case 'Exec_Var_Set':state.set(get('VarRef'),get('Value'));break;
    case 'Exec_ArrayVar_Push':state.get(get('ArrayVarRef')).push(get('Value'));break;
    case 'Exec_ArrayVar_GetLength':results.set(id,{Length:state.get(get('ArrayVarRef')).length});break;
    case 'Exec_ArrayVar_Get':{const a=state.get(get('ArrayVarRef')),i=get('Index');results.set(id,{Value:a[i]??null,bOutOfBounds:i<0||i>=a.length});break;}
    case 'Exec_ArrayVar_RemoveAtIndex':state.get(get('ArrayVarRef')).splice(get('Index'),1);break;
    case 'Exec_Character_GetFromController':{const who=get('PlayerState');results.set(id,{Character:players[who]&&!players[who].dead?who+':char':null});break;}
    case 'Exec_Character_GetAim':{const who=get('Character').replace(':char','');results.set(id,{Origin:players[who].origin,Direction:players[who].direction});break;}
    case 'Exec_GetOwnTransform':results.set(id,{Location:add(moduleOrigin,rotate(ctx.ownTransform.position)),Rotation:{inverse:false}});break;
    case 'Exec_PlayerState_GetDisplayName':results.set(id,{DisplayName:players[get('PlayerState')].name});break;
    case 'Exec_PrefabSpawner':{
     if(spawnCount<(options.maxSpawns??32)){const entity='spawn:'+(++spawnCount),position=add(add(moduleOrigin,rotate(ctx.spawner.position)),rotate(vec(get('SpawnOffset')))),instance=vm(ctx.p,ctx.plates);entities.set(entity,{entity,position,instance,owner:null,name:'Loading…'});results.set(id,{Entity:entity});}break;
    }
    case 'Exec_SendCustomEventGlobal':{
     const target=get('Target');assert(target!==null&&entities.has(target),'Must never broadcast or target an old/destroyed instance');const e=entities.get(target),owner=get('DataIn1'),name=get('DataIn2');e.instance.event(ctx.received.id,{DataOut1:owner,DataOut2:name});e.owner=e.instance.state.get(ctx.owner.id);e.name=e.instance.state.get(ctx.name.id);initializations.push({entity:target,owner:e.owner,name:e.name});break;
    }
    case 'Exec_PlayerState_ShowStatusMessage':messages.push({player:get('PlayerState'),message:get('Message')});break;
    case 'BufferTicks':scheduled.push({tick:tick+Math.max(1,get('TicksToWait')),run:()=>emit(id,'Output')});return;
    default:throw Error('Unknown instruction '+t);
   }
   emit(id,port);
  }
  return {state,value,event(id,data){results.set(id,data);emit(id,'ExecOut');}};
 }
 const controller=vm(ctx.c,[],true);
 return {players,entities,messages,initializations,controller,command(player){controller.event(ctx.command.id,{PlayerState:player});},advance(){if(!scheduled.length)return;scheduled.sort((a,z)=>a.tick-z.tick);const e=scheduled.shift();tick=e.tick;e.run();},drain(){let steps=0;while(scheduled.length){assert(++steps<1000,'Model execution budget');scheduled.sort((a,z)=>a.tick-z.tick);const e=scheduled.shift();tick=e.tick;e.run();}},rotate,resolve};
};

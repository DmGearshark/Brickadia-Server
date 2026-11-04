'use strict';
const assert=require('assert/strict'),{brdb:b}=require('brs-js'),C=b.COMPONENTS;
// Execute the new zone controller. The existing shop binding pipeline is a
// tested interface: acquiring its lock sets the owner then finishes loading.
module.exports=function model(c){
 const fresh=c.nodes.filter(n=>n.id.startsWith('zone')),defs=new Map(),state=new Map(),results=new Map(),outgoing=new Map(),incoming=new Map(),scheduled=[],bindings=[];let ticks=0;
 for(const n of c.nodes){defs.set(n.id,n);for(const comp of n.comps){if(comp.type===C.Var.NAME)state.set(n.id,comp.data.Value.value);if(comp.type===C.ArrayVar.NAME)state.set(n.id,[...comp.data.Value.$array]);}}
 const relevant=c.edges.filter(e=>e.a.id.startsWith('zone')||e.z.id.startsWith('zone'));
 for(const e of relevant){incoming.set(e.z.id+':'+e.q,e);const k=e.a.id+':'+e.p;if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e.z);}
 const unbox=v=>v&&typeof v==='object'&&'$variant'in v?v.value:v;
 const input=(n,p)=>{const e=incoming.get(n.id+':'+p);return e?value(e.a,e.p):unbox(n.comps[0].data[p]);};
 function value(n,p){if(['VarRef','ArrayVarRef'].includes(p))return n.id;const type=n.type||n.comps[0].type;
  if(type===C.Var.NAME)return state.get(n.id);
  if(type.startsWith('BrickComponentType_Exec_')||type.startsWith('BrickComponentType_Internal_CharacterZoneEvent_'))return (results.get(n.id)||{})[p];
  const get=p=>input(n,p);switch(type){case C.Expr_CompareEqual.NAME:return get('InputA')===get('InputB');case C.Expr_CompareNotEqual.NAME:return get('InputA')!==get('InputB');case C.Expr_LogicalNOT.NAME:return !get('bInput');case C.Expr_LogicalAND.NAME:return get('bInputA')&&get('bInputB');default:throw Error(type);}
 }
 function emit(n,p){for(const z of outgoing.get(n.id+':'+p)||[])run(z);}
 function finish(){state.set(c.busy.id,false);emit(c.busyEdge,'OnFallingEdge');}
 function run(n){if(n===c.lock){assert.equal(state.get(c.busy.id),false,'Rebind must not interrupt processing');state.set(c.busy.id,true);const who=input(c.oldOwnerSet,'Value');state.set(c.bound.id,who);bindings.push(who);scheduled.push({at:ticks+2,run:finish});return;}
  if(n===c.oldClear){state.set(c.bound.id,null);emit(n,'ExecOut');return;}
  const type=n.type,get=p=>input(n,p);let p='ExecOut';
  switch(type){case C.Exec_Union.NAME:break;case C.Exec_Branch.NAME:p=get('bCond')?'ExecOutA':'ExecOutB';break;
   case C.Exec_Var_Set.NAME:state.set(get('VarRef'),get('Value'));break;
   case C.Exec_ArrayVar_Find.NAME:{const a=state.get(get('ArrayVarRef')),index=a.indexOf(get('Value'));results.set(n.id,{Index:index,bFound:index>=0});break;}
   case C.Exec_ArrayVar_Push.NAME:state.get(get('ArrayVarRef')).push(get('Value'));break;
   case C.Exec_ArrayVar_RemoveAtIndex.NAME:state.get(get('ArrayVarRef')).splice(get('Index'),1);break;
   case C.Exec_ArrayVar_Get.NAME:{const a=state.get(get('ArrayVarRef')),index=get('Index');results.set(n.id,{Value:a[index]??null,bOutOfBounds:index<0||index>=a.length});break;}
   case C.BufferTicks.NAME:scheduled.push({at:ticks+Math.max(1,get('TicksToWait')),run:()=>emit(n,'Output')});return;
   default:throw Error('Unexpected instruction '+type);
  }emit(n,p);
 }
 return {state,bindings,enter(who){results.set(c.entered.id,{Character:who});emit(c.entered,'Exec');},leave(who){results.set(c.left.id,{Character:who});emit(c.left,'Exec');},startPurchase(){state.set(c.busy.id,true);},finishPurchase:finish,drain(){let steps=0;while(scheduled.length){assert(++steps<1000,'Zone controller loop');scheduled.sort((a,z)=>a.at-z.at);const e=scheduled.shift();ticks=e.at;e.run();}},wait(n){ticks+=n;},queue:()=>state.get(c.queue.id),owner:()=>state.get(c.bound.id),enabled:()=>state.get(c.within.id)};
};

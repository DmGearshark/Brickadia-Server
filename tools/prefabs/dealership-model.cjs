'use strict';
// Offline execution of the generated graph; buffered ticks are queued so tests
// can exercise a second player's input while a transaction is in progress.
const assert=require('assert/strict');
module.exports=function model(ctx,players,options={}){
 const defs=new Map(ctx.nodes.map(n=>[n.id,n])),incoming=new Map(),outgoing=new Map(),state=new Map(),results=new Map(),buttons=new Map(),queue=[];let steps=0;
 for(const e of ctx.edges){incoming.set(e.z.id+':'+e.q,e);const key=e.a.id+':'+e.p;if(!outgoing.has(key))outgoing.set(key,[]);outgoing.get(key).push(e.z.id);}
 for(const n of ctx.nodes){if(n.type==='BrickComponentType_Var')state.set(n.id,n.data.Value.value);if(n.type==='BrickComponentType_MapVar')state.set(n.id,new Map(n.data.Value.$map));if(n.type==='BrickComponentType_ArrayVar')state.set(n.id,[...n.data.Value.$array]);}
 const unbox=v=>v&&typeof v==='object'&&'$variant'in v?v.value:v;
 function input(id,p){const e=incoming.get(id+':'+p);return e?value(e.a.id,e.p):unbox(defs.get(id).data[p]);}
 function value(id,p){const n=defs.get(id),t=n.type,get=p=>input(id,p);if(['VarRef','MapVarRef','ArrayVarRef'].includes(p))return id;if(t==='BrickComponentType_Var')return state.get(id);if(t==='Component_Button'||t==='Component_Internal_AnimatedButton')return (buttons.get(id)||{})[p];if(t.startsWith('BrickComponentType_Exec_'))return (results.get(id)||{})[p];
  switch(t.replace('BrickComponentType_Expr_','')){
   case 'String_FormatText':return n.data.FormatString.replace(/\{([A-G])\}/g,(_,p)=>String(get('Input'+p)));
   case 'String_Split':{const s=String(get('Input')??''),del=get('Delimiter'),i=s.indexOf(del);return p==='bFound'?i>=0:p==='Left'?(i<0?s:s.slice(0,i)):(i<0?'':s.slice(i+del.length));}
   case 'String_ParseNumber':{const s=String(get('Input')??'').trim(),v=Number(s),ok=s!==''&&Number.isFinite(v);return p==='bSuccess'?ok:ok?v:0;}
   case 'String_Length':return String(get('Input')??'').length;
   case 'String_Contains':return String(get('Input')??'').includes(get('Search'));
   case 'LogicalNOT':return !get('bInput');
   case 'LogicalAND':return Boolean(get('bInputA')&&get('bInputB'));
   case 'CompareEqual':return get('InputA')===get('InputB');
   case 'CompareNotEqual':return get('InputA')!==get('InputB');
   case 'CompareGreater':return get('InputA')>get('InputB');
   case 'CompareGreaterOrEqual':return get('InputA')>=get('InputB');
   case 'CompareLessOrEqual':return get('InputA')<=get('InputB');
   case 'MathAdd':return get('InputA')+get('InputB');
   case 'MathSubtract':return get('InputA')-get('InputB');
   case 'MathMultiply':return get('InputA')*get('InputB');
   case 'MathNegate':return -get('Input');
   case 'MathMax':return Math.max(get('InputA'),get('InputB'));
   case 'MathMin':return Math.min(get('InputA'),get('InputB'));
   case 'Floor':return Math.floor(get('Input'));
   case 'Select':return get('bSelectB')?get('InputB'):get('InputA');
   default:throw Error('Unsupported expression '+t+'.'+p);
  }
 }
 function emit(id,p){for(const z of outgoing.get(id+':'+p)||[])run(z);}
 function run(id){assert(++steps<100000,'Execution budget exceeded');const n=defs.get(id),t=n.type,get=p=>input(id,p);let out='ExecOut';
  switch(t.replace('BrickComponentType_','')){
   case 'Exec_Union':break;
   case 'Exec_Branch':out=get('bCond')?'ExecOutA':'ExecOutB';break;
   case 'Exec_Var_Get':results.set(id,{Value:state.get(get('VarRef'))});break;
   case 'Exec_Var_Set':state.set(get('VarRef'),get('Value'));break;
   case 'Exec_Var_Increment':{const ref=get('VarRef');state.set(ref,state.get(ref)+get('Value'));break;}
   case 'Exec_MapVar_GetKeys':state.set(get('ArrayVarRef'),[...state.get(get('MapVarRef')).keys()]);break;
   case 'Exec_MapVar_Get':{const m=state.get(get('MapVarRef')),key=get('Key');results.set(id,{bFound:m.has(key),Value:m.get(key)??''});break;}
   case 'Exec_ArrayVar_Sort':state.get(get('ArrayVarRef')).sort();break;
   case 'Exec_ArrayVar_GetLength':results.set(id,{Length:state.get(get('ArrayVarRef')).length});break;
   case 'Exec_ArrayVar_Get':{const arr=state.get(get('ArrayVarRef')),i=get('Index');results.set(id,{Value:arr[i]??'',bOutOfBounds:i<0||i>=arr.length});break;}
   case 'Exec_ArrayVar_Clear':state.set(get('ArrayVarRef'),[]);break;
   case 'Exec_ArrayVar_Push':state.get(get('ArrayVarRef')).push(get('Value'));break;
   case 'Exec_PlayerState_GetDisplayName':results.set(id,{DisplayName:get('PlayerState')});break;
   case 'Exec_Gamemode_GetLeaderboardValue':{const player=players[get('PlayerState')];assert(player,'Invalid player');results.set(id,{Value:player[get('Key')]??0});break;}
   case 'Exec_Gamemode_SetLeaderboardValue':players[get('PlayerState')][get('Key')]=get('Value');break;
   case 'Exec_Gamemode_IncrementLeaderboardValue':{const player=players[get('PlayerState')],key=get('Key');player[key]=(player[key]??0)+get('Value');break;}
   case 'BufferTicks':queue.push(()=>emit(id,'Output'));return;
   default:throw Error('Unsupported instruction '+t);
  }
  emit(id,out);
 }
 function drain(){while(queue.length)queue.shift()();}
 function press(action,player,flush=true){const a=ctx.actions[action],button=a.button||incoming.get(a.edge.id+':Input').a;
  let last=false;function update(values){buttons.set(button.id,values);const current=Boolean(input(a.edge.id,'Input'));if(current&&!last)emit(a.edge.id,'OnRisingEdge');last=current;}
  // Brickadia can propagate Held before Character. The click signal must wait
  // until both are available rather than dropping the early rising edge.
  update({Character:null,bHeld:false});if(options.characterFirst)update({Character:player,bHeld:false});else update({Character:null,bHeld:true});update({Character:player,bHeld:true});update({Character:null,bHeld:false});if(flush)drain();}

 return {state,players,results,value,input,press,drain,queue,steps:()=>steps};
};

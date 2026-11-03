// Limited offline execution model for the actual generated catalog circuit.
// This validates its parsing/dataflow, not Brickadia runtime behavior.
const assert=require('assert/strict');
module.exports=function model(ctx,entries){const defs=new Map();for(const n of ctx.nodes)defs.set(n.id,{...n,data:structuredClone(n.data||{})});for(const e of ctx.edges)for(const n of [e.a,e.z])if(!defs.has(n.id))defs.set(n.id,{...n,data:structuredClone(n.data||{})});
const incoming=new Map(ctx.edges.map(e=>[e.z.id+':'+e.q,e])),outgoing=new Map();for(const e of ctx.edges){const k=e.a.id+':'+e.p;if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e.z.id);}
const state=new Map(),results=new Map();for(const [id,n]of defs){if(n.type.endsWith('_MapVar'))state.set(id,new Map(n.data.Value.$map));if(n.type.endsWith('_ArrayVar'))state.set(id,[...n.data.Value.$array]);if(n.type==='BrickComponentType_Var')state.set(id,n.data.Value.value);}
state.set(ctx.catalog.id,new Map(entries));let currentKey,steps=0;
const unbox=v=>v&&typeof v==='object'&&'$variant'in v?v.value:v;
function input(id,p){const edge=incoming.get(id+':'+p);return edge?value(edge.a.id,edge.p):unbox(defs.get(id).data[p]);}
function value(id,p){const n=defs.get(id),t=n.type,d=n.data,r=results.get(id)||{};
 if(['MapVarRef','ArrayVarRef','VarRef'].includes(p))return id;
 if(t==='BrickComponentType_Var')return state.get(id);
 if(t==='BrickComponentType_CallableEntry_ForEachArray')return currentKey;
 if(t.startsWith('BrickComponentType_Exec_'))return r[p];
 const get=k=>input(id,k);
 switch(t.replace('BrickComponentType_Expr_','')){
 case 'String_Split':{const x=String(get('Input')),del=get('Delimiter'),i=x.indexOf(del);return p==='bFound'?i>=0:p==='Left'?(i<0?x:x.slice(0,i)):(i<0?'':x.slice(i+del.length));}
 case 'String_ParseNumber':{const x=String(get('Input')).trim(),v=Number(x),ok=x!==''&&Number.isFinite(v);return p==='bSuccess'?ok:ok?v:0;}
 case 'String_Length':return String(get('Input')).length;
 case 'String_Contains':return String(get('Input')).includes(get('Search'));
 case 'String_EndsWith':return String(get('Input')).endsWith(get('Suffix'));
 case 'String_Substring':return String(get('Input')).substr(get('Start'),Math.max(0,get('Length')));
 case 'String_FormatText':return d.FormatString.replace(/\{([A-G])\}/g,(_,k)=>String(get('Input'+k)));
 case 'LogicalNOT':return !get('bInput');
 case 'LogicalAND':return Boolean(get('bInputA')&&get('bInputB'));
 case 'LogicalOR':return Boolean(get('bInputA')||get('bInputB'));
 case 'CompareGreater':return get('InputA')>get('InputB');
 case 'CompareGreaterOrEqual':return get('InputA')>=get('InputB');
 case 'CompareEqual':return get('InputA')===get('InputB');
 case 'CompareNotEqual':return get('InputA')!==get('InputB');
 case 'Floor':return Math.floor(get('Input'));
 case 'Select':return get('bSelectB')?get('InputB'):get('InputA');
 case 'MathAdd':return get('InputA')+get('InputB');
 case 'MathSubtract':return get('InputA')-get('InputB');
 case 'MathMax':return Math.max(get('InputA'),get('InputB'));
 default:throw Error('Unsupported model expression '+t+'.'+p);
 }}
function emit(id,p){for(const z of outgoing.get(id+':'+p)||[])run(z);}
function run(id){assert(++steps<100000,'Execution model exceeded budget');const n=defs.get(id),get=p=>input(id,p),t=n.type;let result={};
 if(t==='BrickComponentType_Exec_Var_Set'){state.set(get('VarRef'),get('Value'));emit(id,'ExecOut');}
 else if(t==='BrickComponentType_Exec_MapVar_Clear'){state.get(get('MapVarRef')).clear();emit(id,'ExecOut');}
 else if(t==='BrickComponentType_Exec_MapVar_GetKeys'){state.set(get('ArrayVarRef'),[...state.get(get('MapVarRef')).keys()]);if(id!==ctx.stopAt.id)emit(id,'ExecOut');}
 else if(t==='BrickComponentType_Exec_ArrayVar_Sort'){state.get(get('ArrayVarRef')).sort();emit(id,'ExecOut');}
 else if(t==='Component_Internal_Microchip_ForEachArray'){for(const key of [...state.get(get('ArrayVarRef'))]){currentKey=key;emit(ctx.entry.id,'Body');}emit(id,'Completed');}
 else if(t==='BrickComponentType_Exec_MapVar_Get'){const m=state.get(get('MapVarRef')),key=get('Key');results.set(id,{bFound:m.has(key),Value:m.has(key)?m.get(key):0});emit(id,'ExecOut');}
 else if(t==='BrickComponentType_Exec_MapVar_Set'){const m=state.get(get('MapVarRef')),key=get('Key'),v=get('Value');m.set(key,v);emit(id,'ExecOut');}
 else if(t==='BrickComponentType_Exec_Branch')emit(id,get('bCond')?'ExecOutA':'ExecOutB');
 else if(t==='BrickComponentType_Exec_Union')emit(id,'ExecOut');
 else throw Error('Unsupported model instruction '+t);
}
run(ctx.start.id);return {maps:Object.fromEntries(Object.entries(ctx.cache).map(([k,n])=>[k,[...state.get(n.id)]])),valid:state.get(ctx.valid.id),vehicles:state.get(ctx.allVehicles.id),steps};};

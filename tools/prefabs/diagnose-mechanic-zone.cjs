'use strict';
// Observe the production graph without replacing or delaying any existing edge.
const fs=require('fs'),assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
const build=require('./zone-bind-mechanic.cjs'),C=b.COMPONENTS;
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node diagnose-mechanic-zone.cjs original-mechanic.brz diagnostic.brz');
const baseline=build(source);require('./test-zone-bind-dealership.cjs')(baseline);
let added=0,extraWires=0;
const result=build(source,c=>{
 const {nodes,edges,logic}=c,originalEdges=[...edges],originalNodes=structuredClone(nodes);
 const maxX=Math.max(...nodes.filter(n=>n.g===logic).map(n=>n.position[0]));
 function node(k,data={}){const def=C[k],i=added++,n={id:'debug'+i,g:logic,position:[maxX+96+(i%8)*48,Math.floor(i/8)*48,2],asset:def.BRICK,type:def.NAME,comps:[{type:def.NAME,data}]};nodes.push(n);return n;}
 function wire(a,at,p,z,zt,q){assert(COMP(at,p)&&COMP(zt,q),`${at}.${p} -> ${zt}.${q}`);edges.push({a,at,p,z,zt,q});extraWires++;}
 function COMP(type,port){const def=Object.values(C).find(d=>d.NAME===type);return def&&Object.values(def.PORTS).includes(port);}
 function nn(a,p,z,q){wire(a,a.type,p,z,z.type,q);}
 function counter(source,type,port){const value=node('Var',{Value:{$variant:'f64',value:0}}),increment=node('Exec_Var_Increment',{Value:{$variant:'f64',value:1}});nn(value,'VarRef',increment,'VarRef');wire(source,type,port,increment,increment.type,'Exec');return value;}
 const enters=counter(c.entered,c.entered.type,'Exec'),exits=counter(c.left,c.left.type,'Exec'),pumps=counter(c.pump,c.pump.type,'ExecOut'),requests=counter(c.lock,C.Exec_Var_Set.NAME,'ExecOut'),assignments=counter(c.oldOwnerSet,C.Exec_Var_Set.NAME,'ExecOut');
 const length=node('Exec_ArrayVar_GetLength');wire(c.queue,C.ArrayVar.NAME,'ArrayVarRef',length,length.type,'ArrayVarRef');
 const writers=edges.filter(e=>e.a===c.queue&&['Exec_ArrayVar_Push','Exec_ArrayVar_RemoveAtIndex'].some(k=>e.zt===C[k].NAME)).map(e=>e.z);
 let terms=[...new Set(writers)].map(n=>[n,n.type,'ExecOut']);terms.push([c.pump,c.pump.type,'ExecOut']);
 while(terms.length>1){const a=terms.shift(),z=terms.shift(),u=node('Exec_Union');wire(...a,u,u.type,'ExecA');wire(...z,u,u.type,'ExecB');terms.push([u,u.type,'ExecOut']);}wire(...terms[0],length,length.type,'Exec');
 const owner=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});wire(c.bound,C.Var.NAME,'Value',owner,owner.type,'InputA');
 const counts=node('Expr_String_FormatText',{FormatString:'ZONE STARTUP TEST\r\nOccupants: {A} | Enter: {B} | Exit: {C}\r\nQueued: {D} | Reconcile: {E}\r\nBind request: {F} | Owner write: {G}'});
 wire(c.zone,C.AttachedZone.NAME,'OccupantCount',counts,counts.type,'InputA');
 for(const [n,p,q] of [[enters,'Value','B'],[exits,'Value','C'],[length,'Length','D'],[pumps,'Value','E'],[requests,'Value','F'],[assignments,'Value','G']])nn(n,p,counts,'Input'+q);
 const state=node('Expr_String_FormatText',{FormatString:'Owner present: {A} | Inside: {B} | Processing: {C}'});nn(owner,'bOutput',state,'InputA');wire(c.within,C.Var.NAME,'Value',state,state.type,'InputB');wire(c.processing,C.Expr_LogicalOR.NAME,'bOutput',state,state.type,'InputC');
 // Observe each decision in the first-entry queue path. Do not repair it yet:
 // a zero queue can mean no push, a null candidate removed, or an early read.
 const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
 const entryFind=one(edges.filter(e=>e.a===c.entered&&e.p==='Exec'&&e.zt===C.Exec_ArrayVar_Find.NAME),'Entry find').z;
 const entryBranch=one(edges.filter(e=>e.a===entryFind&&e.p==='ExecOut'&&e.zt===C.Exec_Branch.NAME),'Entry branch').z;
 const push=one(writers.filter(n=>n.type===C.Exec_ArrayVar_Push.NAME),'Queue push');
 const get=one(edges.filter(e=>e.a===c.queue&&e.zt===C.Exec_ArrayVar_Get.NAME),'Queue first read').z;
 const drops=one(writers.filter(n=>n.type===C.Exec_ArrayVar_RemoveAtIndex.NAME&&n.comps[0].data.Index===0),'Invalid candidate removal');
 const finds=counter(entryFind,entryFind.type,'ExecOut'),pushes=counter(push,push.type,'ExecOut'),duplicates=counter(entryBranch,entryBranch.type,'ExecOutA'),reads=counter(get,get.type,'ExecOut'),pruned=counter(drops,drops.type,'ExecOut');
 const charValid=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});wire(c.entered,c.entered.type,'Character',charValid,charValid.type,'InputA');
 const snapshot=node('Var',{Value:{$variant:'Bool',value:false}}),save=node('Exec_Var_Set');nn(snapshot,'VarRef',save,'VarRef');nn(charValid,'bOutput',save,'Value');wire(c.entered,c.entered.type,'Exec',save,save.type,'Exec');
 const detail=node('Expr_String_FormatText',{FormatString:'Find: {A} | Push: {B} | Duplicate: {C}\r\nFirst read: {D} | Null removed: {E}\r\nEntry character valid: {F} | Find found: {G}'});
 for(const [n,p,q] of [[finds,'Value','A'],[pushes,'Value','B'],[duplicates,'Value','C'],[reads,'Value','D'],[pruned,'Value','E'],[snapshot,'Value','F'],[entryFind,'bFound','G']])nn(n,p,detail,'Input'+q);
 const combined=node('Expr_String_FormatText',{FormatString:'{A}\r\n{B}\r\n{C}'});nn(counts,'Output',combined,'InputA');nn(state,'Output',combined,'InputB');nn(detail,'Output',combined,'InputC');
 const template=nodes.find(n=>n.g===1&&n.comps.some(x=>x.type===C.TextDisplay.NAME&&x.data.Text.startsWith('Part Price')));assert(template);
 const text=structuredClone(template.comps.find(x=>x.type===C.TextDisplay.NAME));Object.assign(text.data,{Text:'ZONE STARTUP TEST',bEnabled:true,LineHeight:2,Color:{R:255,G:255,B:255,A:255},OutlineWidth:0});
 const panel={id:'debugPanel',g:1,position:template.position.map((v,i)=>v+(i===1?100:i===2?12:0)),brick:{...structuredClone(template.brick),size:[1,80,40]},comps:[text]};nodes.push(panel);wire(combined,combined.type,'Output',panel,C.TextDisplay.NAME,'Text');
 // Instrumentation must only append. Every original component and edge is identical.
 assert.deepEqual(edges.slice(0,originalEdges.length),originalEdges);assert.deepEqual(nodes.slice(0,originalNodes.length),originalNodes);
});
const out=WorldReader.from(result.bytes);let wires=0,components=0;
for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){if(ch.numComponents)components+=out.componentChunk(g,ch.index).components.length;if(ch.numWires){const ws=out.wireChunk(g,ch.index);wires+=ws.local.length+ws.remote.length;}}
assert.equal(wires,baseline.edges.length+extraWires);assert.equal(result.edges.length,wires);
console.log(JSON.stringify({output,addedGates:added,extraWires,wires,components,productionGraphUnchanged:true},null,2));
// Check every serialized endpoint, including cross-chip diagnostic wires.
const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]),defs=new Map(),saved=[];
for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const comp of out.componentChunk(g,ch.index).components)defs.set(address(g,ch.index,comp.brickIndex)+comp.typeName,{g,pos:bs[comp.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),type:comp.typeName});if(ch.numWires){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])saved.push({g,ch:ch.index,...e});}}}
const key=(g,pos,type,port)=>JSON.stringify([g,pos,type,port]),actual=[],targets=new Set();
for(const e of saved){const a=defs.get(address(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex)+e.source.componentType),z=defs.get(address(e.g,e.ch,e.target.brickIndex)+e.target.componentType);assert(a&&z);const target=key(z.g,z.pos,z.type,e.target.port);assert(!targets.has(target));targets.add(target);actual.push(JSON.stringify([key(a.g,a.pos,a.type,e.source.port),target]));}
const mapping=new Map([[1,1]]);[...result.r.entities()].forEach((e,i)=>mapping.set(e.persistentIndex,i+2));
const expected=result.edges.map(e=>JSON.stringify([key(mapping.get(e.a.g),e.a.position,e.at,e.p),key(mapping.get(e.z.g),e.z.position,e.zt,e.q)]));assert.deepEqual(actual.sort(),expected.sort());fs.writeFileSync(output,result.bytes);console.log(`All ${wires} serialized wire endpoints match the planned graph.`);

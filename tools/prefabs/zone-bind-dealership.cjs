'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS,O=value=>({$variant:'weak_object',value}),B=value=>({$variant:'Bool',value});
function build(source){
 const r=WorldReader.from(fs.readFileSync(source)),schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),nodes=[],byKey=new Map();let edges=[],id=0;
 const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
 for(const g of r.gridIds()){const all=[...r.bricks(g)];let off=0;for(const ch of r.brickChunkIndex(g)){const bs=all.slice(off,off+ch.numBricks);off+=ch.numBricks;const cc=r.componentChunk(g,ch.index);for(let i=0;i<bs.length;i++){const br=bs[i],n={id:'old'+id++,g,i,ch:ch.index,position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),brick:br,comps:cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}))};nodes.push(n);byKey.set(address(g,ch.index,i),n);}if(ch.numWires){const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({aKey:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,zKey:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});}}}
 for(const e of edges){e.a=byKey.get(e.aKey);e.z=byKey.get(e.zKey);assert(e.a&&e.z);}
 const originals=[...nodes],originalEdges=[...edges],one=(xs,msg)=>{assert.equal(xs.length,1,msg);return xs[0];};
 const logic=one([...r.entities()].filter(e=>[...r.bricks(e.persistentIndex)].length>100),'Dealership logic grid').persistentIndex;
 const at=(pos,type)=>one(nodes.filter(n=>n.g===logic&&JSON.stringify(n.position)===JSON.stringify(pos)&&n.comps.some(c=>c.type===type)),type+' '+pos);
 const zone=one(nodes.filter(n=>n.g===1&&n.comps.some(c=>c.type===C.AttachedZone.NAME)),'Existing zone projector');
 const bind=one(nodes.filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Button.NAME&&c.data.PromptCustomLabel==='Bind self to Computer')),'Old bind button');
 const bound=at([0,0,2],C.Var.NAME),busy=at([48,0,2],C.Var.NAME),feedback=at([336,0,2],C.Var.NAME);
 bound.comps.find(c=>c.type===C.Var.NAME).data.Value=O(null);busy.comps.find(c=>c.type===C.Var.NAME).data.Value=B(false);
 const oldOwnerSet=one(edges.filter(e=>e.a===bind&&e.p==='Character'&&e.zt===C.Exec_Var_Set.NAME&&e.q==='Value'),'Old owner assignment').z;
 const lock=one(edges.filter(e=>e.z===oldOwnerSet&&e.q==='Exec'),'Old bind lock').a;
 const oldClear=one(edges.filter(e=>e.a===bound&&e.p==='VarRef'&&e.z!==oldOwnerSet),'Old timeout clear').z;
 // Remove the timer's data path, stopping before the reusable clear/notice path.
 const removed=new Set(),stop=new Set([bound,busy,feedback,oldClear]);
 const clock=one(nodes.filter(n=>n.comps.some(c=>c.type===C.Stopwatch.NAME)),'Old inactivity clock');
 const pending=[clock];while(pending.length){const n=pending.pop();if(removed.has(n)||stop.has(n))continue;removed.add(n);for(const e of edges.filter(e=>e.a===n))if(!stop.has(e.z))pending.push(e.z);}
 // The timer timestamp has no remaining use once its setter/readers are gone.
 for(const n of nodes.filter(n=>n.comps.some(c=>c.type===C.Var.NAME)&&!stop.has(n))){const out=edges.filter(e=>e.a===n);if(out.length&&out.every(e=>removed.has(e.z)))removed.add(n);}
 edges=edges.filter(e=>!removed.has(e.a)&&!removed.has(e.z)&&!(e.a===bind&&e.at===C.Button.NAME)&&!(e.z===bind&&[C.Button.NAME,C.TextDisplay.NAME].includes(e.zt))&&!(e.z===lock&&e.q==='Exec')&&!(e.z===oldOwnerSet&&e.q==='Value')&&!(e.z===oldClear&&e.q==='Exec'));
 bind.comps=bind.comps.filter(c=>![C.Button.NAME,C.TextDisplay.NAME].includes(c.type));
 for(const n of nodes)for(const c of n.comps)if(c.type===C.Expr_Select.NAME)for(const value of Object.values(c.data))if(value?.$variant==='str'&&value.value==='Bind player')value.value='Enter zone';
 for(const n of nodes)for(const c of n.comps)if(c.type===C.Exec_Var_Set.NAME&&c.data.Value?.value==='Session expired')c.data.Value.value='Walk up';
 const maxX=Math.max(...nodes.filter(n=>n.g===logic).map(n=>n.position[0]));let added=0;
 function node(k,data={}){const c=C[k],i=added++,n={id:'zone'+i,g:logic,position:[maxX+96+(i%10)*48,Math.floor(i/10)*48,2],asset:c.BRICK,comps:[{type:c.NAME,data}],type:c.NAME,data};nodes.push(n);return n;}
 const newEdges=[];function connect(a,at,p,z,zt,q){const e={a,at,p,z,zt,q};edges.push(e);newEdges.push(e);}
 const nn=(a,p,z,q)=>connect(a,a.type,p,z,z.type,q);
 function variable(value){return node('Var',{Value:value});}
 function set(ref,value){const n=node('Exec_Var_Set',value?{Value:value}:{});connect(ref,C.Var.NAME,'VarRef',n,n.type,'VarRef');return n;}
 function chain(a,z,p='ExecOut'){connect(a,a.type||C.Exec_Var_Set.NAME,p,z,z.type,'Exec');return z;}
 function branch(a,condition,p='ExecOut'){const n=node('Exec_Branch');chain(a,n,p);nn(condition,'bOutput',n,'bCond');return n;}
 function join(terms){while(terms.length>1){const a=terms.shift(),z=terms.shift(),n=node('Exec_Union');connect(a[0],a[0].type||C.Exec_Var_Set.NAME,a[1],n,n.type,'ExecA');connect(z[0],z[0].type||C.Exec_Var_Set.NAME,z[1],n,n.type,'ExecB');terms.push([n,'ExecOut']);}return terms[0];}
 const queue=node('ArrayVar',{Value:{$elementType:'weak_object',$array:[]}}),candidate=variable(O(null)),within=variable(B(false));
 function arrayOp(k,inputs={}){const n=node(k,inputs);nn(queue,'ArrayVarRef',n,'ArrayVarRef');return n;}
 const zoneData={TagFilter:'',bCollisionEnabled_Player:true,bCollisionEnabled_Player1:true,bCollisionEnabled_Player2:true,bCollisionEnabled_Player3:true};
 const entered=node('CharacterZoneEvent_Entered',zoneData),left=node('CharacterZoneEvent_Left',zoneData);for(const e of [entered,left])connect(zone,C.AttachedZone.NAME,'ZoneRef',e,e.type,'Zone');
 const enterFind=arrayOp('Exec_ArrayVar_Find');nn(entered,'Character',enterFind,'Value');chain(entered,enterFind,'Exec');const already=node('Exec_Branch');chain(enterFind,already);nn(enterFind,'bFound',already,'bCond');
 const push=arrayOp('Exec_ArrayVar_Push');nn(entered,'Character',push,'Value');chain(already,push,'ExecOutB');
 const exitFind=arrayOp('Exec_ArrayVar_Find');nn(left,'Character',exitFind,'Value');chain(left,exitFind,'Exec');
 const exitCheck=node('Exec_Branch');chain(exitFind,exitCheck);nn(exitFind,'bFound',exitCheck,'bCond');const remove=arrayOp('Exec_ArrayVar_RemoveAtIndex');nn(exitFind,'Index',remove,'Index');chain(exitCheck,remove,'ExecOutA');
 const [exitDone,exitPort]=join([[remove,'ExecOut'],[exitCheck,'ExecOutB']]);
 const ownerLeft=node('Expr_CompareEqual');nn(left,'Character',ownerLeft,'InputA');connect(bound,C.Var.NAME,'Value',ownerLeft,ownerLeft.type,'InputB');const leavingOwner=branch(exitDone,ownerLeft,exitPort),hideOwner=set(within,B(false));chain(leavingOwner,hideOwner,'ExecOutA');
 const busyEdge=node('Expr_EdgeDetectorExec');connect(busy,C.Var.NAME,'Value',busyEdge,busyEdge.type,'Input');
 const [request,requestPort]=join([[push,'ExecOut'],[already,'ExecOutA'],[hideOwner,'ExecOut'],[leavingOwner,'ExecOutB'],[busyEdge,'OnFallingEdge']]);
 const tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});connect(request,request.type,requestPort,tick,tick.type,'Input');
 const pump=node('Exec_Union');nn(tick,'Output',pump,'ExecA');const idle=node('Expr_LogicalNOT');connect(busy,C.Var.NAME,'Value',idle,idle.type,'bInput');const idleCheck=branch(pump,idle);
 const currentFind=arrayOp('Exec_ArrayVar_Find');connect(bound,C.Var.NAME,'Value',currentFind,currentFind.type,'Value');chain(idleCheck,currentFind,'ExecOutA');
 const hasOwner=node('Expr_CompareNotEqual',{InputB:O(null)});connect(bound,C.Var.NAME,'Value',hasOwner,hasOwner.type,'InputA');
 const retain=node('Expr_LogicalAND');nn(currentFind,'bFound',retain,'bInputA');nn(hasOwner,'bOutput',retain,'bInputB');const retained=branch(currentFind,retain);
 const showOwner=set(within,B(true));chain(retained,showOwner,'ExecOutA');
 const clearWithin=set(within,B(false));chain(retained,clearWithin,'ExecOutB');
 // Preserve the existing clear/notice behavior, but invoke it from zone reconciliation.
 connect(clearWithin,clearWithin.type,'ExecOut',oldClear,C.Exec_Var_Set.NAME,'Exec');
 const first=arrayOp('Exec_ArrayVar_Get',{Index:0});connect(oldClear,C.Exec_Var_Set.NAME,'ExecOut',first,first.type,'Exec');const available=node('Exec_Branch');chain(first,available);nn(first,'bOutOfBounds',available,'bCond');
 const saveCandidate=set(candidate);nn(first,'Value',saveCandidate,'Value');chain(available,saveCandidate,'ExecOutB');
 const candidateValid=node('Expr_CompareNotEqual',{InputB:O(null)});nn(candidate,'Value',candidateValid,'InputA');const validCandidate=branch(saveCandidate,candidateValid);
 const enableCandidate=set(within,B(true));chain(validCandidate,enableCandidate,'ExecOutA');connect(enableCandidate,enableCandidate.type,'ExecOut',lock,C.Exec_Var_Set.NAME,'Exec');connect(candidate,C.Var.NAME,'Value',oldOwnerSet,C.Exec_Var_Set.NAME,'Value');
 const dropDead=arrayOp('Exec_ArrayVar_RemoveAtIndex',{Index:0});chain(validCandidate,dropDead,'ExecOutB');const retry=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});nn(dropDead,'ExecOut',retry,'Input');nn(retry,'Output',pump,'ExecB');
 // Keep departed owners from using a control while an in-flight transaction finishes.
 const buttons=nodes.filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Button.NAME));assert.equal(buttons.length,3);
 const controlInputs=[];for(const button of buttons){const todo=[{n:button,p:'bHeld'}],seen=new Set(),found=[];while(todo.length){const point=todo.pop(),key=point.n.id+point.p;if(seen.has(key))continue;seen.add(key);for(const e of edges.filter(e=>e.a===point.n&&e.p===point.p)){if(e.zt===C.Expr_EdgeDetectorExec.NAME&&e.q==='Input')found.push(e);else if([C.Expr_LogicalAND.NAME,C.Expr_LogicalOR.NAME,C.Expr_LogicalNOT.NAME].includes(e.zt))todo.push({n:e.z,p:'bOutput'});}}controlInputs.push(one(found,'Public control rising edge'));}
 for(const e of controlInputs){edges=edges.filter(old=>old!==e);const gate=node('Expr_LogicalAND');connect(e.a,e.at,e.p,gate,gate.type,'bInputA');nn(within,'Value',gate,'bInputB');connect(gate,gate.type,'bOutput',e.z,e.zt,e.q);}
 for(const e of edges)if(e.z.g===1&&e.zt===C.TextDisplay.NAME&&e.q==='bEnabled')e.z.comps.find(c=>c.type===C.TextDisplay.NAME).data.bEnabled=false;
 const kept=nodes.filter(n=>!removed.has(n)),w=new World(),grids=new Map([[1,undefined]]);for(const e of r.entities())grids.set(e.persistentIndex,w.addBrickGrid({type:e.typeName,location:e.location,rotation:e.rotation,frozen:e.frozen,sleeping:e.sleeping,data:{bCollapsed:e.data.bCollapsed,PlaneCenter:e.data.PlaneCenter,PlaneExtent:e.data.PlaneExtent}}));
 for(const n of kept){const data={...(n.brick||{}),asset:n.asset||r.brickAssets()[n.brick.asset_name_index],position:n.position,owner_index:0,components:n.comps};if(n.brick){data.material=r.materials()[n.brick.material_index];delete data.asset_name_index;delete data.material_index;}else data.color=[60,110,150];n.handle=w.addBrick(data,grids.get(n.g));}
 // Recreate the original two microchip links after global component reordering.
 for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g)){const cc=r.componentChunk(g,ch.index);for(let i=0;i<cc.soa.MicrochipBrickIndices.length;i++)w.registerMicrochipLink(byKey.get(address(g,ch.index,cc.soa.MicrochipBrickIndices[i])).handle,grids.get(cc.soa.MicrochipBrickGridReferences[i]));}
 const targets=new Set();for(const e of edges){assert(!removed.has(e.a)&&!removed.has(e.z));const target=e.z.id+e.zt+e.q;assert(!targets.has(target),'Duplicate '+target);targets.add(target);w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:e.zt,port:e.q});}
 const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Zone Binding',description:'Existing zone automatically binds the first present player, retains that owner, and unbinds or hands off when they leave. Transaction-safe; no inactivity timeout or manual bind control.'}});
 return {r,bytes,nodes:kept,edges,originals,originalEdges,removed,logic,zone,bind,bound,busy,feedback,oldOwnerSet,lock,oldClear,queue,candidate,within,entered,left,busyEdge,pump,showOwner,clearWithin,enableCandidate};
}
module.exports=build;
if(require.main===module){const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node zone-bind-dealership.cjs source.brz output.brz');const result=build(source);require('./test-zone-bind-dealership.cjs')(result);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,newGates:result.nodes.filter(n=>n.id.startsWith('zone')).length,removedOldTimerGates:result.removed.size,wires:result.edges.length},null,2));}

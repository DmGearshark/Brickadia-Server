'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node add-parts-shop-timeout.cjs working.brz output.brz');
const r=WorldReader.from(fs.readFileSync(source)),w=new World(),C=b.COMPONENTS,schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),grids=new Map([[1,undefined]]),nodes=new Map(),edges=[];
const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
for(const e of r.entities())grids.set(e.persistentIndex,w.addBrickGrid({type:e.typeName,location:e.location,rotation:e.rotation,frozen:e.frozen,sleeping:e.sleeping,data:{bCollapsed:e.data.bCollapsed,PlaneCenter:e.data.PlaneCenter,PlaneExtent:e.data.PlaneExtent}}));
for(const g of r.gridIds()){
 const all=[...r.bricks(g)];let offset=0;
 for(const ch of r.brickChunkIndex(g)){
  const bricks=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=r.componentChunk(g,ch.index);
  for(let i=0;i<bricks.length;i++){
   const br=bricks[i],comps=cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}));
   const position=br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));
   const data={...br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],owner_index:0,position,components:comps};delete data.asset_name_index;delete data.material_index;
   const n={g,i,ch:ch.index,position,comps,handle:w.addBrick(data,grids.get(g))};nodes.set(address(g,ch.index,i),n);
  }
  for(let i=0;i<cc.soa.MicrochipBrickIndices.length;i++)w.registerMicrochipLink(nodes.get(address(g,ch.index,cc.soa.MicrochipBrickIndices[i])).handle,grids.get(cc.soa.MicrochipBrickGridReferences[i]));
  const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({a:nodes.get(address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex)),aKey:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,zKey:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});
 }
}
for(const e of edges){e.a=nodes.get(e.aKey);e.z=nodes.get(e.zKey);assert(e.a&&e.z);}
const one=(xs,label)=>{assert.equal(xs.length,1,label);return xs[0];};
const logicGrid=4;
const at=(g,p,type)=>one([...nodes.values()].filter(n=>n.g===g&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+g+' '+p);
const busy=at(3,[48,624,2],C.Var.NAME),building=at(3,[432,0,2],C.Var.NAME);
const indicator=one([...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='■')),'Binding indicator');
const indicatorColor=one(edges.filter(e=>e.z===indicator&&e.q==='Color'),'Indicator color').a;
const present=one(edges.filter(e=>e.z===indicatorColor&&e.q==='Alpha'),'Binding state').a;
const bound=one(edges.filter(e=>e.z===present&&e.q==='InputA'),'Bound player').a;
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));let added=0;const fresh=[];
function node(k,data={}){const n={id:'timeout'+added,type:C[k].NAME,data,position:[maxX+96+(added%3)*48,Math.floor(added/3)*48,2]};added++;n.handle=w.addBrick({asset:C[k].BRICK,position:n.position,color:[95,115,160],components:[{type:n.type,data}]},grids.get(logicGrid));fresh.push(n);return n;}
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
const extra=[];function connect(a,at,p,z,zt,q){extra.push({a,at,p,z,zt,q});wire(a.handle,at,p,z.handle,zt,q);}
const nn=(a,p,z,q)=>connect(a,a.type,p,z,z.type,q);
const N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value});
const clock=node('Stopwatch',{Time:0,Limit:1e9,bRunning:true});
const last=node('Var',{Value:N(0)}),stamp=node('Exec_Var_Set');nn(last,'VarRef',stamp,'VarRef');nn(clock,'Time',stamp,'Value');
// Reuse each control's existing held-and-bound-player guard for activity.
const mainButtons=[...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.Button.NAME));assert.equal(mainButtons.length,8);
const accepted=[];
function relayTargets(n,p,seen=new Set()){
 const key=JSON.stringify(n.handle)+p;if(seen.has(key))return [];seen.add(key);const result=[];
 for(const e of edges.filter(e=>e.a===n&&e.p===p)){
  if([C.MicrochipInput.NAME,C.MicrochipOutput.NAME,C.Rerouter.NAME].includes(e.zt))result.push(...relayTargets(e.z,'RER_Output',seen));
  else result.push(e);
 }return result;
}
for(const button of mainButtons){
 const filtered=one(edges.filter(e=>e.a===button&&e.p==='bHeld'&&e.zt===C.Expr_LogicalAND.NAME),'Valid held filter').z;
 const bind=button.comps.find(c=>c.type===C.Button.NAME).data.PromptCustomLabel==='Bind self to Computer';
 if(bind)accepted.push(filtered);
 else{const guard=one(relayTargets(filtered,'bOutput').filter(e=>e.zt===C.Expr_LogicalAND.NAME&&e.q==='bInputA'),'Bound input guard').z;const identity=one(edges.filter(e=>e.z===guard&&e.q==='bInputB'),'Player identity');assert.equal(identity.at,C.Expr_CompareEqual.NAME);accepted.push(guard);}
}
const activityEdges=accepted.map(signal=>{const edge=node('Expr_EdgeDetectorExec');connect(signal,C.Expr_LogicalAND.NAME,'bOutput',edge,edge.type,'Input');return edge;});
const activityEdge=activityEdges[0];let activity={n:activityEdge,p:'OnRisingEdge'};for(const edge of activityEdges.slice(1)){const merge=node('Exec_Union');nn(activity.n,activity.p,merge,'ExecA');nn(edge,'OnRisingEdge',merge,'ExecB');activity={n:merge,p:'ExecOut'};}
const processing=node('Expr_LogicalOR');connect(busy,C.Var.NAME,'Value',processing,processing.type,'bInputA');connect(building,C.Var.NAME,'Value',processing,processing.type,'bInputB');
const busyEdges=node('Expr_EdgeDetectorExec');nn(processing,'bOutput',busyEdges,'Input');
const busyBoth=node('Exec_Union');nn(busyEdges,'OnRisingEdge',busyBoth,'ExecA');nn(busyEdges,'OnFallingEdge',busyBoth,'ExecB');
const allActivity=node('Exec_Union');nn(activity.n,activity.p,allActivity,'ExecA');nn(busyBoth,'ExecOut',allActivity,'ExecB');nn(allActivity,'ExecOut',stamp,'Exec');
const elapsed=node('Expr_MathSubtract');nn(clock,'Time',elapsed,'InputA');nn(last,'Value',elapsed,'InputB');
const expired=node('Expr_CompareGreaterOrEqual',{InputB:N(180)});nn(elapsed,'Output',expired,'InputA');
const idle=node('Expr_LogicalNOT');nn(processing,'bOutput',idle,'bInput');
const eligible=node('Expr_LogicalAND');connect(present,C.Expr_CompareNotEqual.NAME,'bOutput',eligible,eligible.type,'bInputA');nn(idle,'bOutput',eligible,'bInputB');
const due=node('Expr_LogicalAND');nn(eligible,'bOutput',due,'bInputA');nn(expired,'bOutput',due,'bInputB');
const edge=node('Expr_EdgeDetectorExec');nn(due,'bOutput',edge,'Input');
// Recheck after propagation settles: a completing long transaction can briefly
// change Busy before its completion timestamp reaches the comparison gates.
const tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});nn(edge,'OnRisingEdge',tick,'Input');
const guard=node('Exec_Branch');nn(tick,'Output',guard,'Exec');nn(due,'bOutput',guard,'bCond');
const unbind=node('Exec_Var_Set',{Value:{$variant:'weak_object',value:null}});connect(bound,C.Var.NAME,'VarRef',unbind,unbind.type,'VarRef');nn(guard,'ExecOutA',unbind,'Exec');
// Blank screen readouts and non-bind key decals while unbound. The bind
// symbol and the separate red/green indicator remain visible.
const screens=[...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&!['■','◈'].includes(c.data.Text)));
assert.equal(screens.length,14);for(const screen of screens){assert(!edges.some(e=>e.z===screen&&e.q==='bEnabled'));screen.comps.find(c=>c.type===C.TextDisplay.NAME).data.bEnabled=false;connect(present,C.Expr_CompareNotEqual.NAME,'bOutput',screen,C.TextDisplay.NAME,'bEnabled');}
for(const e of edges)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Parts Shop - Three Minute Timeout',description:'Unbinds and blanks the display after 180 idle seconds. Accepted controls restart the timer; transactions and catalogue rebuilding are protected.'}});
require('./test-parts-shop-timeout.cjs')({r,bytes,nodes,edges,extra,fresh,clock,last,busy,building,bound,present,processing,activityEdge,activityEdges,accepted,stamp,expired,due,guard,unbind,screens});
fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,timeoutSeconds:180,addedGates:added},null,2));

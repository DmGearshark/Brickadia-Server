'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node add-dealership-timeout.cjs working.brz output.brz');
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
const logicGrid=one([...r.entities()].filter(e=>[...r.bricks(e.persistentIndex)].length>100),'Logic grid').persistentIndex;
const at=(p,type)=>one([...nodes.values()].filter(n=>n.g===logicGrid&&JSON.stringify(n.position)===JSON.stringify(p)&&n.comps.some(c=>c.type===type)),type+' '+p);
const busy=at([48,0,2],C.Var.NAME),bound=at([0,0,2],C.Var.NAME),feedback=at([336,0,2],C.Var.NAME);
const maxX=Math.max(...[...nodes.values()].filter(n=>n.g===logicGrid).map(n=>n.position[0]));let added=0;const fresh=[];
function node(k,data={}){const n={id:'timeout'+added,type:C[k].NAME,data,position:[maxX+96+(added%3)*48,Math.floor(added/3)*48,2]};added++;n.handle=w.addBrick({asset:C[k].BRICK,position:n.position,color:[95,115,160],components:[{type:n.type,data}]},grids.get(logicGrid));fresh.push(n);return n;}
const wire=(a,at,p,z,zt,q)=>w.addWire({brick:a,component_type:at,port:p},{brick:z,component_type:zt,port:q});
const extra=[];function connect(a,at,p,z,zt,q){extra.push({a,at,p,z,zt,q});wire(a.handle,at,p,z.handle,zt,q);}
const nn=(a,p,z,q)=>connect(a,a.type,p,z,z.type,q);
const N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value});
const clock=node('Stopwatch',{Time:0,Limit:1e9,bRunning:true});
const last=node('Var',{Value:N(0)}),stamp=node('Exec_Var_Set');nn(last,'VarRef',stamp,'VarRef');nn(clock,'Time',stamp,'Value');
const busyEdges=node('Expr_EdgeDetectorExec');connect(busy,C.Var.NAME,'Value',busyEdges,busyEdges.type,'Input');
const both=node('Exec_Union');nn(busyEdges,'OnRisingEdge',both,'ExecA');nn(busyEdges,'OnFallingEdge',both,'ExecB');nn(both,'ExecOut',stamp,'Exec');
const elapsed=node('Expr_MathSubtract');nn(clock,'Time',elapsed,'InputA');nn(last,'Value',elapsed,'InputB');
const expired=node('Expr_CompareGreaterOrEqual',{InputB:N(180)});nn(elapsed,'Output',expired,'InputA');
const present=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});connect(bound,C.Var.NAME,'Value',present,present.type,'InputA');
const idle=node('Expr_LogicalNOT');connect(busy,C.Var.NAME,'Value',idle,idle.type,'bInput');
const eligible=node('Expr_LogicalAND');nn(present,'bOutput',eligible,'bInputA');nn(idle,'bOutput',eligible,'bInputB');
const due=node('Expr_LogicalAND');nn(eligible,'bOutput',due,'bInputA');nn(expired,'bOutput',due,'bInputB');
const edge=node('Expr_EdgeDetectorExec');nn(due,'bOutput',edge,'Input');
// Recheck after propagation settles: a completing long transaction can briefly
// change Busy before its completion timestamp reaches the comparison gates.
const tick=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});nn(edge,'OnRisingEdge',tick,'Input');
const guard=node('Exec_Branch');nn(tick,'Output',guard,'Exec');nn(due,'bOutput',guard,'bCond');
const unbind=node('Exec_Var_Set',{Value:{$variant:'weak_object',value:null}});connect(bound,C.Var.NAME,'VarRef',unbind,unbind.type,'VarRef');nn(guard,'ExecOutA',unbind,'Exec');
const notice=node('Exec_Var_Set',{Value:S('Session expired')});connect(feedback,C.Var.NAME,'VarRef',notice,notice.type,'VarRef');nn(unbind,'ExecOut',notice,'Exec');
// Clear the shared name/balance readout while unbound, without changing its style.
const playerReadout=(()=>{const candidates=[...nodes.values()].filter(n=>n.g===1&&n.comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text.startsWith('Name:')));return one(candidates,'Player readout');})();
const playerWire=one(edges.filter(e=>e.z===playerReadout&&e.zt===C.TextDisplay.NAME&&e.q==='Text'),'Player readout source');
const playerLabel=node('Expr_Select',{InputA:S('Name: Unbound\r\n🔩Scrap: —')});nn(present,'bOutput',playerLabel,'bSelectB');connect(playerWire.a,playerWire.at,playerWire.p,playerLabel,playerLabel.type,'InputB');connect(playerLabel,playerLabel.type,'Output',playerReadout,C.TextDisplay.NAME,'Text');
for(const e of edges)if(e!==playerWire)wire(e.a.handle,e.at,e.p,e.z.handle,e.zt,e.q);
const bytes=w.toBrz({prefab:r.prefabJson(),externalAssets:r.externalAssets(),bundle:{name:'Vehicle Dealership - Three Minute Timeout',description:'Unbinds after 180 seconds of inactivity. Accepted actions and completion restart the countdown; transactions are protected.'}});
require('./test-dealership-timeout.cjs')({r,bytes,nodes,edges,playerWire,extra,fresh,clock,last,busy,bound,feedback,stamp,expired,due,guard,unbind,notice,playerLabel});
fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,timeoutSeconds:180,addedGates:added},null,2));

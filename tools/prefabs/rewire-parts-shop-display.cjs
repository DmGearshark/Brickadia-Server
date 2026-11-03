'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const {orientedHalfExtents}=require('./brick-shapes.cjs');
const C=b.COMPONENTS,N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value});
function build(source){
 const r=WorldReader.from(fs.readFileSync(source)),schema=b.embeddedSchema('BRSavedComponentChunkSoA_max'),nodes=[],byKey=new Map();let edges=[],serial=0;
 const address=(g,ch,i)=>JSON.stringify([g,ch.x,ch.y,ch.z,i]);
 for(const g of r.gridIds()){const all=[...r.bricks(g)];let offset=0;for(const ch of r.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;const cc=r.componentChunk(g,ch.index);for(let i=0;i<bs.length;i++){const br=bs[i],n={id:'old'+serial++,g,i,ch:ch.index,position:br.position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k])),brick:br,asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index],comps:cc.components.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','ArrayVarRef','MapVarRef'].includes(k)))}))};nodes.push(n);byKey.set(address(g,ch.index,i),n);}const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({aKey:address(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex),at:e.source.componentType,p:e.source.port,zKey:address(g,ch.index,e.target.brickIndex),zt:e.target.componentType,q:e.target.port});}}
 for(const e of edges){e.a=byKey.get(e.aKey);e.z=byKey.get(e.zKey);assert(e.a&&e.z);}
 const one=(xs,msg)=>{assert.equal(xs.length,1,msg);return xs[0];};
 const old=(g,i)=>one(nodes.filter(n=>n.g===g&&n.i===i),g+':'+i),main=i=>old(1,i);
 const sel=724558,shop=724560,settings=724561,visual=724557;
 const selector=i=>old(sel,i),part=i=>old(shop,i);
 const originalNodes=[...nodes],originalEdges=[...edges];
 const keepMain=new Set(nodes.filter(n=>n.g===1&&n.position[0]<-25640));
 const obsolete=new Set(nodes.filter(n=>n.g===visual));
 // Manual selection and its button are replaced by a buffered centre-row commit.
 for(const i of [58,64,65,77,86,50])obsolete.add(selector(i));
 let newIndex=0;const maxX=Math.max(...nodes.filter(n=>n.g===shop).map(n=>n.position[0]));
 function node(k,data={},g=shop){const i=newIndex++,c=C[k],n={id:'new'+i,g,i:-1,position:[maxX+96+(i%10)*48,Math.floor(i/10)*48,2],asset:c.BRICK,comps:[{type:c.NAME,data}],data,type:c.NAME};assert(c.BRICK,k);nodes.push(n);return n;}
 function add(a,at,p,z,zt,q){assert(a&&z);edges.push({a,at,p,z,zt,q});}
 function nn(a,p,z,q){add(a,a.type,p,z,z.type,q);}
 function incoming(z,q,type){return one(edges.filter(e=>e.z===z&&e.q===q&&(!type||e.zt===type)),'Incoming '+z.id+'.'+q);}
 const controls={carDown:{old:main(48),n:main(1)},carUp:{old:main(49),n:main(3)},partDown:{old:main(26),n:main(2)},partUp:{old:main(27),n:main(4)},categoryLeft:{old:main(38),n:main(8)},categoryRight:{old:main(39),n:main(9)},buy:{old:main(65),n:main(12)},bind:{old:main(0),n:main(13)}};
 const validHeld=new Map();const animations=[];
 for(const [name,c]of Object.entries(controls)){
  assert(c.n.comps.some(x=>x.type===C.Button.NAME));
  const nonNull=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}}),held=node('Expr_LogicalAND');add(c.n,C.Button.NAME,'Character',nonNull,nonNull.type,'InputA');add(c.n,C.Button.NAME,'bHeld',held,held.type,'bInputA');nn(nonNull,'bOutput',held,'bInputB');validHeld.set(c.old,held);
  const text=c.n.comps.find(x=>x.type===C.TextDisplay.NAME),rest=text.data.LineHeight,pressed=rest===3?2:rest===1.5?1:Math.round(rest*.65*20)/20;
  const blend=node('Expr_MathBlend',{InputA:N(rest),InputB:N(pressed),bClampAlpha:true});add(c.n,C.Button.NAME,'bHeld',blend,blend.type,'Blend');add(blend,blend.type,'Output',c.n,C.TextDisplay.NAME,'LineHeight');animations.push({name,n:c.n,blend,rest,pressed});
 }
 const auto=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0},sel);add(selector(31),C.Exec_ArrayVar_Get.NAME,'ExecOut',auto,auto.type,'Input');add(auto,auto.type,'Output',selector(89),C.Exec_Var_Set.NAME,'Exec');
 // The highlighted list keeps backend IDs internally; presentation strips Owned.
 selector(24).comps.find(c=>c.type===C.Expr_String_FormatText.NAME).data.FormatString='({A})\r\n({B})\r\n>({C})<\r\n({D})\r\n({E})';
 for(const port of ['InputA','InputB','InputC','InputD','InputE']){const e=incoming(selector(24),port,C.Expr_String_FormatText.NAME);edges=edges.filter(x=>x!==e);const split=node('Expr_String_Split',{Delimiter:'Owned'},sel);add(e.a,e.at,e.p,split,split.type,'Input');add(split,split.type,'Left',selector(24),C.Expr_String_FormatText.NAME,port);}
 // Combine the existing player name and balance into the marked top readout.
 const nameEdge=incoming(main(59),'Text',C.TextDisplay.NAME),balanceEdge=incoming(main(58),'Text',C.TextDisplay.NAME);
 const balanceComp=balanceEdge.a.comps.find(c=>c.type===C.Expr_String_FormatText.NAME);assert.equal(balanceComp.data.FormatString,'Scrap\r\n{A}');balanceComp.data.FormatString='🔩Scrap: {A}';
 const combined=node('Expr_String_FormatText',{FormatString:'Name: {A}\r\n{B}'});add(nameEdge.a,nameEdge.at,nameEdge.p,combined,combined.type,'InputA');add(balanceEdge.a,balanceEdge.at,balanceEdge.p,combined,combined.type,'InputB');add(combined,combined.type,'Output',main(61),C.TextDisplay.NAME,'Text');
 // Existing status drives the dedicated status field and the replacement button.
 const statusEdge=incoming(main(65),'Text',C.TextDisplay.NAME);add(statusEdge.a,statusEdge.at,statusEdge.p,main(12),C.TextDisplay.NAME,'Text');add(statusEdge.a,statusEdge.at,statusEdge.p,main(12),C.Button.NAME,'PromptCustomLabel');
 const outputs=new Map([[main(33),main(53)],[main(60),main(41)],[main(65),main(50)],[main(66),main(51)],[main(67),main(52)]]);
 const converted=[];
 for(const e of edges){
  if(obsolete.has(e.a)||obsolete.has(e.z))continue;
  if(e.z===selector(89)&&e.q==='Exec'&&e.a!==auto)continue;
  if(e.z.g===1&&!keepMain.has(e.z)){if(e.zt===C.TextDisplay.NAME&&e.q==='Text'&&outputs.has(e.z))e.z=outputs.get(e.z);else continue;}
  if(e.a.g===1&&!keepMain.has(e.a)){
   const c=Object.values(controls).find(c=>c.old===e.a);if(!c)continue;
   if(e.p==='bHeld'){e.a=validHeld.get(c.old);e.at=e.a.type;e.p='bOutput';}else{e.a=c.n;e.at=C.Button.NAME;}
  }
  converted.push(e);
 }
 edges=converted;
 // Bound-player indicator. The copied third (sold vehicle) emitter stays unused.
 const bound=selector(44),present=node('Expr_CompareNotEqual',{InputB:{$variant:'weak_object',value:null}});add(bound,C.Var.NAME,'Value',present,present.type,'InputA');
 const color=node('Expr_ColorBlend',{ColorA:{R:1,G:0,B:0,A:1},ColorB:{R:0,G:1,B:0,A:1}});nn(present,'bOutput',color,'Alpha');add(color,color.type,'Output',main(28),C.TextDisplay.NAME,'Color');
 // Successful/failed part-purchase sounds, using existing confirmed transaction branches.
 const successSound=main(19),failureSound=main(18);
 const debit=one(nodes.filter(n=>n.comps.some(c=>c.type===C.Exec_Gamemode_IncrementLeaderboardValue.NAME)),'Scrap change');
 add(debit,C.Exec_Gamemode_IncrementLeaderboardValue.NAME,'ExecOut',successSound,C.OneShotAudioEmitter.NAME,'Play');
 const failedMoney=one(edges.filter(e=>e.z===part(72)&&e.q==='bCond'),'Funds branch').z;
 add(failedMoney,C.Exec_Branch.NAME,'ExecOutB',failureSound,C.OneShotAudioEmitter.NAME,'Play');
 // Drop unused components by working backwards from public outputs and persistent
 // effects. A retained variable/cache also retains every operation that writes it.
 const available=new Set(nodes.filter(n=>!obsolete.has(n)&&(n.g!==1||keepMain.has(n))));
 const active=new Set(keepMain);for(const n of nodes)if(n.g===settings||n.comps.some(c=>[C.Exec_Gamemode_SetLeaderboardValue.NAME,C.Exec_Gamemode_IncrementLeaderboardValue.NAME].includes(c.type)))active.add(n);
 const writers=/^BrickComponentType_Exec_(Var_(Set|Increment|Decrement)|MapVar_(Set|Clear|Remove)|ArrayVar_(Set|Clear|Push|Pop|Insert|Remove|Sort|Resize)|MapVar_GetKeys)$/;
 let changed=true;while(changed){changed=false;for(const e of edges){if(active.has(e.z)&&available.has(e.a)&&!active.has(e.a)){active.add(e.a);changed=true;}if(active.has(e.a)&&['VarRef','MapVarRef','ArrayVarRef'].includes(e.p)&&writers.test(e.zt)&&available.has(e.z)&&!active.has(e.z)){active.add(e.z);changed=true;}}}
 const kept=nodes.filter(n=>active.has(n)&&available.has(n));edges=edges.filter(e=>active.has(e.a)&&active.has(e.z)&&available.has(e.a)&&available.has(e.z));
 const oldRemoved=originalNodes.filter(n=>!kept.includes(n));
 const w=new World(),gridHandles=new Map([[1,undefined]]),chipPositions=[];
 for(const [i,g]of [sel,724559,shop,settings].entries())if(kept.some(n=>n.g===g)){
  const position=[-25642,-49846+i*16,1964];const chip=w.addMicrochip({position,color:g===settings?[40,155,95]:[55,100,165]});gridHandles.set(g,chip.grid);chipPositions.push(position);
 }
 for(const n of kept){const data={...(n.brick||{}),asset:n.asset,position:n.position,owner_index:0,components:n.comps};if(n.material)data.material=n.material;delete data.asset_name_index;delete data.material_index;n.handle=w.addBrick(data,gridHandles.get(n.g));}
 const targets=new Set();for(const e of edges){const key=e.z.id+':'+e.zt+':'+e.q;assert(!targets.has(key),'Multiple sources '+key);targets.add(key);w.addWire({brick:e.a.handle,component_type:e.at,port:e.p},{brick:e.z.handle,component_type:e.zt,port:e.q});}
 // Recenter the paste bounds around the remaining PC and accessible chips.
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const n of kept.filter(n=>n.g===1)){const ext=orientedHalfExtents(n.brick.size,n.brick.direction,n.brick.rotation);for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],n.position[k]-ext[k]);hi[k]=Math.max(hi[k],n.position[k]+ext[k]);}}for(const p of chipPositions)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]-4);hi[k]=Math.max(hi[k],p[k]+4);}
 const centre=lo.map((v,k)=>(v+hi[k])/2),extent=lo.map((v,k)=>(hi[k]-v)/2),prefab=structuredClone(r.prefabJson());prefab.addedGlobalGridOffset={x:-centre[0],y:-centre[1],z:-centre[2]};for(const name of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot'])prefab.pivots[name]={center:{x:0,y:0,z:0},halfExtent:{x:extent[0],y:extent[1],z:extent[2]}};
 const bytes=w.toBrz({prefab,externalAssets:r.externalAssets(),bundle:{name:'Parts Shop - New PC Display',description:'Parts shop rewired to the marked compact PC. Highlight selects the vehicle, eight buttons shrink their text while held, and the old display/unused logic are removed.'}});
 return {bytes,r,nodes:kept,edges,originalNodes,originalEdges,oldRemoved,controls,animations,auto,selector,part,settings,sel,shop,visual,present,color,prefab};
}
module.exports=build;
if(require.main===module){const [source,output]=process.argv.slice(2);if(!output)throw Error('Usage: node rewire-parts-shop-display.cjs source.brz output.brz');const result=build(source);require('./test-parts-shop-display.cjs')(result);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,sourceBricks:result.originalNodes.length,removedOldBricks:result.oldRemoved.length,newBricks:result.nodes.length+4,animatedButtons:result.animations.length,wires:result.edges.length},null,2));}

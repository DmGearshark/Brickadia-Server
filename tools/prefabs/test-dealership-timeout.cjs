'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
module.exports=function test(c){
 const {r,bytes,nodes,edges,playerWire,extra,fresh,clock,last,busy,bound,feedback,guard,playerLabel}=c;
 for(const [i,n]of [busy,bound,feedback].entries()){n.id='old'+i;n.type=b.COMPONENTS.Var.NAME;n.data=n.comps.find(c=>c.type===n.type).data;}
 function vm(){const all=[...fresh,busy,bound,feedback],defs=new Map(all.map(n=>[n.id,n])),incoming=new Map(extra.map(e=>[e.z.id+':'+e.q,e])),outgoing=new Map(),state=new Map(),queue=[];let time=0;
  for(const n of all)if(n.type===b.COMPONENTS.Var.NAME)state.set(n.id,n.data.Value.value);
  state.set(bound.id,'alice');state.set(busy.id,false);
  for(const e of extra){const k=e.a.id+':'+e.p;if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(e.z);}
  const unbox=v=>v&&typeof v==='object'&&'$variant'in v?v.value:v;
  function input(n,p){const e=incoming.get(n.id+':'+p);return e?value(e.a,e.p):unbox(n.data[p]);}
  function value(n,p){if(['VarRef'].includes(p))return n.id;if(n===clock)return time;if(n.type===b.COMPONENTS.Var.NAME)return state.get(n.id);const get=p=>input(n,p);switch(n.type.replace('BrickComponentType_Expr_','')){case 'MathSubtract':return get('InputA')-get('InputB');case 'CompareGreaterOrEqual':return get('InputA')>=get('InputB');case 'CompareNotEqual':return get('InputA')!==get('InputB');case 'LogicalNOT':return !get('bInput');case 'LogicalAND':return get('bInputA')&&get('bInputB');case 'Select':return get('bSelectB')?get('InputB'):get('InputA');default:throw Error(n.type);}}
  function emit(n,p){for(const z of outgoing.get(n.id+':'+p)||[])run(z);}
  function run(n){switch(n.type){case b.COMPONENTS.Exec_Union.NAME:emit(n,'ExecOut');break;case b.COMPONENTS.Exec_Var_Set.NAME:state.set(input(n,'VarRef'),input(n,'Value'));emit(n,'ExecOut');break;case b.COMPONENTS.BufferTicks.NAME:queue.push(()=>emit(n,'Output'));break;case b.COMPONENTS.Exec_Branch.NAME:emit(n,input(n,'bCond')?'ExecOutA':'ExecOutB');break;default:throw Error(n.type);}}
  const busyEdge=fresh.find(n=>n.type===b.COMPONENTS.Expr_EdgeDetectorExec.NAME&&incoming.get(n.id+':Input')?.a===busy),timeoutEdge=fresh.find(n=>n.type===b.COMPONENTS.Expr_EdgeDetectorExec.NAME&&incoming.get(n.id+':Input')?.a===c.due);
  return {state,value,setTime:t=>{time=t;},activity(t){time=t;state.set(busy.id,true);emit(busyEdge,'OnRisingEdge');},complete(t){time=t;state.set(busy.id,false);emit(busyEdge,'OnFallingEdge');},check(t,flush=true){time=t;if(value(c.due,'bOutput'))emit(timeoutEdge,'OnRisingEdge');if(flush)this.flush();},flush(){while(queue.length)queue.shift()();}};
 }
 let m=vm();m.check(179.999);assert.equal(m.state.get(bound.id),'alice');m.check(180);assert.equal(m.state.get(bound.id),null);assert.equal(m.state.get(feedback.id),'Session expired');assert.equal(m.value(playerLabel,'Output'),'Name: Unbound\r\n🔩Scrap: —');
 m=vm();m.activity(170);m.complete(172);m.check(351.999);assert.equal(m.state.get(bound.id),'alice');m.check(352);assert.equal(m.state.get(bound.id),null);
 m=vm();m.activity(10);m.check(500);assert.equal(m.state.get(bound.id),'alice');m.complete(500);m.check(679.999);assert.equal(m.state.get(bound.id),'alice');m.check(680);assert.equal(m.state.get(bound.id),null);
 m=vm();m.check(180,false);m.activity(180);m.complete(180);m.flush();assert.equal(m.state.get(bound.id),'alice','Queued stale expiry must recheck the latest activity');m.check(360);assert.equal(m.state.get(bound.id),null);
 // No activity from a different player reaches Busy; the original guards are unchanged.
 assert(!extra.some(e=>e.z===busy),'Timeout must not alter transaction locking');
 const out=WorldReader.from(bytes);assert.deepEqual(out.prefabJson(),r.prefabJson());
 let count=0;const targets=new Set(),definitions=new Map(),wireList=[];const key=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]);
 for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){const cc=out.componentChunk(g,ch.index);for(const d of cc.components)definitions.set(key(g,ch.index,d.brickIndex,d.typeName),d);const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){count++;wireList.push({g,ch:ch.index,...e});const target=key(g,ch.index,e.target.brickIndex,e.target.componentType)+e.target.port;assert(!targets.has(target));targets.add(target);}}
 assert.equal(count,edges.length-1+extra.length);for(const e of wireList){assert(definitions.has(key(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)));assert(definitions.has(key(e.g,e.ch,e.target.brickIndex,e.target.componentType)));}
 const savedClock=[...definitions.values()].filter(d=>d.typeName===b.COMPONENTS.Stopwatch.NAME);assert.equal(savedClock.length,1);assert.equal(savedClock[0].data.bRunning,true);
 const savedLimit=[...definitions.values()].filter(d=>d.typeName===b.COMPONENTS.Expr_CompareGreaterOrEqual.NAME&&d.data.InputB?.value===180);assert.equal(savedLimit.length,1);
 console.log('Timeout checks passed: 180-second threshold, activity resets, transaction protection, queued expiry recheck, unbound readout, and saved wire endpoints.');
};

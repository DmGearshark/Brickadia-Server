'use strict';

// Brickadia expression gates are pure combinational nodes, except for detectors
// and time readers. Identical pure nodes with identical inputs can therefore
// share one physical gate. This is the same common-subexpression elimination
// used by the Wirescript compiler.
const stateful=/Detector|DeltaTime|Epoch|Uptime/;
const stable=value=>JSON.stringify(canonical(value));
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}

function protectedNodes(ctx){
 const keys=new Set(),seen=new WeakSet();
 function visit(value,name=''){
  if(!value||typeof value!=='object'||seen.has(value)||['main','modelGraph','b'].includes(name))return;
  seen.add(value);
  if(typeof value.sceneKey==='string'&&typeof value.type==='string')keys.add(value.sceneKey+'\0'+value.type);
  if(Array.isArray(value))for(const item of value)visit(item);
  else for(const [key,item]of Object.entries(value))visit(item,key);
 }
 visit(ctx);
 return keys;
}

function optimize(scene,{protect=new Set()}={}){
 const changedEdges=[],removed=[],passes=[];
 for(;;){
  const components=new Map();
  for(const brick of scene.bricks)for(const comp of brick.comps)components.set(brick.key+'\0'+comp.type,{brick,comp});
  const incoming=new Map();
  for(const edge of scene.edges){const key=edge.z+'\0'+edge.zt;(incoming.get(key)||incoming.set(key,[]).get(key)).push(edge);}
  const groups=new Map();
  for(const {brick,comp}of components.values()){
   if(!comp.type.startsWith('BrickComponentType_Expr_')||stateful.test(comp.type)||brick.comps.length!==1)continue;
   const key=brick.key+'\0'+comp.type,inputs=(incoming.get(key)||[]).map(e=>[e.q,e.a,e.at,e.p]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const signature=JSON.stringify([brick.g,comp.type,stable(comp.data),inputs]);
   (groups.get(signature)||groups.set(signature,[]).get(signature)).push({brick,comp,key});
  }
  let count=0;
  for(const group of groups.values()){
   if(group.length<2)continue;
   const guarded=group.filter(n=>protect.has(n.key)),free=group.filter(n=>!protect.has(n.key));
   if(!free.length)continue;
   const keeper=guarded[0]||free.shift();
   for(const duplicate of free){
    const incident=scene.edges.filter(e=>(e.a===duplicate.brick.key&&e.at===duplicate.comp.type)||(e.z===duplicate.brick.key&&e.zt===duplicate.comp.type));
    changedEdges.push(...incident.map(e=>structuredClone(e)));
    scene.edges=scene.edges.filter(e=>!(e.z===duplicate.brick.key&&e.zt===duplicate.comp.type));
    for(const edge of scene.edges)if(edge.a===duplicate.brick.key&&edge.at===duplicate.comp.type){edge.a=keeper.brick.key;edge.at=keeper.comp.type;}
    scene.bricks=scene.bricks.filter(b=>b!==duplicate.brick);
    removed.push(duplicate.brick.key);count++;
   }
  }
  if(!count)break;
  passes.push(count);
 }
 return {removed,changedEdges,passes};
}

// A one-input Union is an immediate pass-through. Bypass only unreferenced
// instances; named model/manifest nodes stay in place for maintainability.
function bypassSingleInputUnions(scene,{protect=new Set()}={}){
 const removed=[],changedEdges=[];
 for(const brick of [...scene.bricks])for(const comp of brick.comps){
  if(comp.type!=='BrickComponentType_Exec_Union'||protect.has(brick.key+'\0'+comp.type)||brick.comps.length!==1)continue;
  const incoming=scene.edges.filter(e=>e.z===brick.key&&e.zt===comp.type),outgoing=scene.edges.filter(e=>e.a===brick.key&&e.at===comp.type);
  if(incoming.length!==1||!outgoing.length)continue;
  changedEdges.push(...incoming.map(e=>structuredClone(e)),...outgoing.map(e=>structuredClone(e)));
  const source=incoming[0];
  for(const edge of outgoing){edge.a=source.a;edge.at=source.at;edge.p=source.p;}
  scene.edges=scene.edges.filter(e=>!incoming.includes(e));
  scene.bricks=scene.bricks.filter(b=>b!==brick);removed.push(brick.key);
 }
 return {removed,changedEdges};
}

module.exports={optimize,bypassSingleInputUnions,protectedNodes,stateful};

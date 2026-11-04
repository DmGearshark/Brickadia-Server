'use strict';
const fs=require('fs'),assert=require('assert/strict'),{World,WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS,schema=b.embeddedSchema('BRSavedComponentChunkSoA_max');
const N=value=>({$variant:'f64',value}),S=value=>({$variant:'str',value}),B=value=>({$variant:'Bool',value}),O=value=>({$variant:'weak_object',value});
const R=(n,p='Value')=>[n,p],isR=x=>Array.isArray(x)&&x[0]&&x[0].type;
function metadata(ext){const pivot={center:{x:0,y:0,z:0},halfExtent:ext};return {pivots:{bottomStudsPivot:pivot,studsExpandedPivot:pivot,topStudsPivot:pivot,boundsPivot:pivot,bottomStudsDirection:'Z_Negative',topStudsDirection:'Z_Positive',bBottomStudsValid:true,bTopStudsValid:true},addedGlobalGridOffset:{x:0,y:0,z:0},bIsPhysicsGrid:false,bFreezePhysicsGrid:false,bFreezeGlobalGrid:false,bIsMicrochipPrefab:false};}
class Build{
 constructor(name,assets=[]){this.name=name;this.w=new World();this.nodes=[];this.edges=[];this.assets=assets;this.chips=[];this.seq=0;}
 circuit(grid,prefix){return new Circuit(this,grid,prefix);}
 add(n,brick,grid){n.handle=this.w.addBrick(brick,grid);this.nodes.push(n);return n;}
 wire(a,p,z,q){assert(a&&z);const ac=Object.values(C).find(c=>c.NAME===a.type),zc=Object.values(C).find(c=>c.NAME===z.type);assert(ac?.PORTS[p],a.type+'.'+p);assert(zc?.PORTS[q],z.type+'.'+q);assert(!this.edges.some(e=>e.z===z&&e.q===q),'Duplicate '+z.id+'.'+q);this.edges.push({a,p,z,q});}
 finish(ext,description){for(const e of this.edges)this.w.addWire({brick:e.a.handle,component_type:e.a.type,port:e.p},{brick:e.z.handle,component_type:e.z.type,port:e.q});return this.w.toBrz({prefab:metadata(ext),externalAssets:this.assets,bundle:{name:this.name,description}});}
}
class Circuit{
 constructor(build,grid,prefix){this.b=build;this.grid=grid;this.prefix=prefix;this.i=0;}
 n(k,data={},pos,grid=this.grid){if(grid==='main')grid=undefined;const def=C[k];assert(def,k);const i=this.i++,n={id:this.prefix+'_'+i,type:def.NAME,data:{},pos:pos||[(i%16)*48,Math.floor(i/16)*48,2],grid};for(const [p,v]of Object.entries(data))if(isR(v)){}else n.data[p]=this.coerce(n,p,v);this.b.add(n,{asset:def.BRICK,...(def.BRICK.startsWith('PB_Gate_')?{size:[10,5,2]}:{}),position:n.pos,color:[50,110,150],components:[{type:n.type,data:n.data}]},grid);for(const [p,v]of Object.entries(data))if(isR(v))this.bind(n,p,v);return n;}
 coerce(n,p,v){const f=schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(n.type))?.get(p);assert(f,n.type+' data '+p);return f.type==='WireValue'&&!(v&&typeof v==='object')?(typeof v==='number'?N(v):typeof v==='boolean'?B(v):S(v)):v;}
 bind(n,p,v){if(isR(v))this.b.wire(v[0],v[1],n,p);else n.data[p]=this.coerce(n,p,v);return n;}
 v(value){return this.n('Var',{Value:typeof value==='number'?N(value):typeof value==='boolean'?B(value):typeof value==='string'?S(value):value});}
 set(ref,val){return this.n('Exec_Var_Set',{VarRef:R(ref,'VarRef'),Value:val});}
 link(a,z,p='ExecOut',q='Exec'){this.b.wire(a,p,z,q);return z;}
 wait(a,t=1,p='ExecOut'){return this.link(a,this.n('BufferTicks',{TicksToWait:t,ZeroTicksToWait:0}),p,'Input');}
 later(a,z,t=1,p='ExecOut',q='Exec'){return this.link(this.wait(a,t,p),z,'Output',q);}
 branch(a,cond,p='ExecOut'){return this.link(a,this.n('Exec_Branch',{bCond:cond}),p);}
 cmp(k,a,z){return R(this.n('Expr_Compare'+k,{InputA:a,InputB:z}),'bOutput');}
 and(...terms){return this.logic('Expr_LogicalAND',terms);}
 or(...terms){return this.logic('Expr_LogicalOR',terms);}
 logic(k,terms){while(terms.length>1){const a=terms.shift(),z=terms.shift();terms.push(R(this.n(k,{bInputA:a,bInputB:z}),'bOutput'));}return terms[0];}
 not(x){return R(this.n('Expr_LogicalNOT',{bInput:x}),'bOutput');}
 math(k,a,z){return R(this.n('Expr_Math'+k,{InputA:a,InputB:z}),'Output');}
 sel(cond,a,z){return R(this.n('Expr_Select',{InputA:a,InputB:z,bSelectB:cond}),'Output');}
 fmt(str,...args){return R(this.n('Expr_String_FormatText',{FormatString:str,...Object.fromEntries(args.map((v,i)=>['Input'+String.fromCharCode(65+i),v]))}),'Output');}
 split(input,count,delimiter='|'){let rest=input;const fields=[];for(let i=0;i<count-1;i++){const n=this.n('Expr_String_Split',{Input:rest,Delimiter:delimiter,Occurrence:1,bCaseSensitive:true});fields.push(R(n,'Left'));rest=R(n,'Right');}fields.push(rest);return fields;}
 num(x){return R(this.n('Expr_String_ParseNumber',{Input:x}),'Value');}
 join(terms){while(terms.length>1){const [a,p]=terms.shift(),[z,q]=terms.shift(),u=this.n('Exec_Union');this.b.wire(a,p,u,'ExecA');this.b.wire(z,q,u,'ExecB');terms.push([u,'ExecOut']);}return terms[0];}
 to(terms,node,q='Exec'){const old=this.b.edges.find(e=>e.z===node&&e.q===q);if(old){this.b.edges=this.b.edges.filter(e=>e!==old);terms=[...terms,[old.a,old.p]];}const [a,p]=this.join(terms);this.link(a,node,p,q);}
 arr(type){return this.n('ArrayVar',{Value:{$elementType:type,$array:[]}});}
 map(keyType,valueType,entries=[]){return this.n('MapVar',{Value:{$keyType:keyType,$valueType:valueType,$map:entries}});}
 ao(k,arr,data={}){return this.n('Exec_ArrayVar_'+k,{ArrayVarRef:R(arr,'ArrayVarRef'),...data});}
 mo(k,map,data={}){return this.n('Exec_MapVar_'+k,{MapVarRef:R(map,'MapVarRef'),...data});}
 event(name,types,object=false){return this.n('Event_CustomGlobal',{EventName:name,bIsObjectEvent:object,...Object.fromEntries(types.map((v,i)=>['DataOut'+(i+1),v]))});}
 send(name,args,target){const n=this.n('Exec_SendCustomEventGlobal',{EventName:name,...Object.fromEntries(args.map((v,i)=>['DataIn'+(i+1),v]))});if(target)this.bind(n,'Target',target);return n;}
 edge(signal){return this.n('Expr_EdgeDetectorExec',{Input:signal});}
 queue(event,types){const q=this.n('QueueTicks',{TicksToWait:1,...Object.fromEntries(types.map((v,i)=>['DataIn'+(i+1),R(event,'DataOut'+(i+1))]))});this.link(event,q,'ExecOut','ExecIn');return q;}
 // The native QueueTicks snapshots event arguments before delayed processing.
 inbox(event,types){const q=this.queue(event,types),arrays=types.map(v=>this.arr(v.$variant==='weak_object'?'weak_object':v.$variant==='str'?'str':'f64'));let a=q;arrays.forEach((arr,i)=>{const push=this.ao('Push',arr,{Value:R(q,'DataOut'+(i+1))});this.link(a,push);a=push;});const pump=this.n('Exec_Union'),clock=this.n('Stopwatch',{Limit:.1,Time:0,bRunning:true});this.link(clock,pump,'Expired','ExecA');this.later(clock,clock,2,'Expired','Restart');const busy=this.v(false),idle=this.branch(pump,this.not(R(busy))),length=this.ao('GetLength',arrays[0]);this.link(idle,length,'ExecOutA');const nonempty=this.branch(this.wait(length),this.cmp('Greater',R(length,'Length'),0),'Output'),lock=this.set(busy,true);this.link(nonempty,lock,'ExecOutA');const vars=types.map(v=>this.v(v));let tail=lock;arrays.forEach((arr,i)=>{const get=this.ao('Get',arr,{Index:0});this.link(tail,get,tail.type===C.BufferTicks.NAME?'Output':'ExecOut');const set=this.set(vars[i],R(get,'Value'));this.later(get,set);tail=set;});const start=this.wait(tail,2);const done=this.n('Exec_Union');tail=done;arrays.forEach(arr=>{const remove=this.ao('RemoveAtIndex',arr,{Index:0});this.link(tail,remove);tail=remove;});const unlock=this.set(busy,false);this.link(tail,unlock);return {vars,start,done,busy,arrays,pump,clock};}
}
function source(path){const r=WorldReader.from(fs.readFileSync(path)),off=r.prefabJson().addedGlobalGridOffset,assets=r.externalAssets(),bricks=[];for(const g of r.gridIds())if(g===1){const bs=[...r.bricks(g)];let o=0;for(const ch of r.brickChunkIndex(g)){const chunk=bs.slice(o,o+ch.numBricks);o+=ch.numBricks;const cc=ch.numComponents?r.componentChunk(g,ch.index):null;chunk.forEach((br,i)=>{const comps=(cc?.components||[]).filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([k])=>schema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(c.typeName)).has(k)&&!['VarRef','MapVarRef','ArrayVarRef'].includes(k)))}));bricks.push({brick:{...br,position:br.position.map((v,k)=>v+[off.x,off.y,off.z][k]),asset:r.brickAssets()[br.asset_name_index],material:r.materials()[br.material_index]},comps});});}}
 return {r,assets,bricks};}
function copy(build,items,prefix,shift=[0,0,0]){const ns=[];for(const {brick,comps}of items){const data={...brick,position:brick.position.map((v,i)=>v-shift[i]),components:structuredClone(comps),owner_index:0};delete data.asset_name_index;delete data.material_index;const handle=build.w.addBrick(data);for(const comp of data.components){const n={id:prefix+'_'+ns.length,type:comp.type,data:comp.data,handle,pos:data.position};build.nodes.push(n);ns.push(n);}}return ns;}
module.exports={Build,C,N,S,B,O,R,metadata,source,copy};

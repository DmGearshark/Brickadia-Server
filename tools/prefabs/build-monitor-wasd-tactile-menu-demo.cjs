'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const buildBase=require('./build-monitor-wasd-menu-demo.cjs');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N,S}=require('./loadboard-lib.cjs');
function one(xs,label){assert.equal(xs.length,1,`Expected one ${label}, found ${xs.length}`);return xs[0];}
function build(input){
 const donor=fs.readFileSync(input),base=buildBase(input),scene=read(base.bytes),link=one(scene.links,'chip link'),grid=link.grid;
 const main=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'original display');
 const presentationTypes=new Set([C.ArrayVar.NAME,C.Exec_ArrayVar_Get.NAME,C.Clock.NAME,C.Expr_String_FormatText.NAME]);
 const removed=new Set(scene.bricks.filter(b=>b.g===grid&&b.comps.some(c=>presentationTypes.has(c.type))).map(b=>b.key));
 scene.bricks=scene.bricks.filter(b=>!removed.has(b.key));scene.edges=scene.edges.filter(e=>!removed.has(e.a)&&!removed.has(e.z));
 const vars=scene.bricks.filter(b=>b.g===grid&&b.comps.some(c=>c.type===C.Var.NAME)).sort((a,b)=>Number(a.key.match(/wasd-menu:(\d+)/)?.[1])-Number(b.key.match(/wasd-menu:(\d+)/)?.[1]));
 assert.equal(vars.length,5);const selection={key:vars[0].key,type:C.Var.NAME},counts=vars.slice(1).map(b=>({key:b.key,type:C.Var.NAME}));
 const branches=scene.bricks.filter(b=>b.g===grid&&b.comps.some(c=>c.type===C.Exec_Branch.NAME));assert.equal(branches.length,4);
 const dc=main.comps.find(c=>c.type===C.TextDisplay.NAME);dc.data.Text='WASD  MOVE        SPACE  ACTIVATE';dc.data.Anchor={X:.5,Y:.08};dc.data.Offset={X:0,Y:0,Z:0};dc.data.LineHeight=1.15;dc.data.WidthScale=.9;dc.data.LineOffset=0;
 let seq=100;
 function gate(kind,data={}){const def=C[kind],i=seq++,brick={key:`tactile-menu:${i}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[(i%8)*48,Math.floor((i-100)/8)*48+336,2],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(brick);return {key:brick.key,type:def.NAME};}
 function wire(a,p,z,q){assert(Object.values(C).find(c=>c.NAME===a.type)?.PORTS[p],`${a.type}.${p}`);assert(Object.values(C).find(c=>c.NAME===z.type)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`Duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 function overlay(key,pos,text,lineHeight=1.4){const data=structuredClone(dc.data);Object.assign(data,{Text:text,Anchor:{X:.5,Y:.5},Offset:{X:0,Y:0,Z:0},LineHeight:lineHeight,WidthScale:1,LineOffset:0,Kerning:0,bEnabled:true});const brick={key,g:1,data:{asset:'PB_DefaultMicroBrick',material:'BMC_Glow',position:pos,size:[8,1,2],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:false,physics:false},visibility:false,material_intensity:0,color:[0,0,0],owner_index:0},comps:[{type:C.TextDisplay.NAME,data}]};scene.bricks.push(brick);return {key,type:C.TextDisplay.NAME};}
 const specs=[
  {name:'🍪 COOKIE',x:6109,z:11047}, {name:'⚙ FACTORY',x:6127,z:11047},
  {name:'💎 MINE',x:6109,z:11035}, {name:'⭐ RESEARCH',x:6127,z:11035}
 ];
 specs.forEach((spec,i)=>{
  const title=overlay(`tactile:title:${i}`,[spec.x,-75361,spec.z],spec.name),counter=overlay(`tactile:counter:${i}`,[spec.x,-75361,spec.z-4],'ACTIVATED 0',.85);
  const eq=gate('Expr_CompareEqual',{InputB:N(i)});wire(selection,'Value',eq,'InputA');
  const select=gate('Expr_Select',{InputA:S(`  ${spec.name}  `),InputB:S(`> ${spec.name} <`),bSelectB:false});wire(eq,'bOutput',select,'bSelectB');wire(select,'Output',title,'Text');
  const countText=gate('Expr_String_FormatText',{FormatString:'ACTIVATED {A}'});wire(counts[i],'Value',countText,'InputA');wire(countText,'Output',counter,'Text');
  const scale=gate('Var',{Value:N(1)});wire(scale,'Value',title,'WidthScale');const height=gate('Expr_MathMultiply',{InputB:N(1.4)});wire(scale,'Value',height,'InputA');wire(height,'Output',title,'LineHeight');
  function setter(value){const n=gate('Exec_Var_Set',{Value:N(value),bChangeType:false});wire(scale,'VarRef',n,'VarRef');return n;}
  const press=setter(.78),wait1=gate('BufferTicks',{TicksToWait:2,ZeroTicksToWait:0}),bounce=setter(1.22),wait2=gate('BufferTicks',{TicksToWait:3,ZeroTicksToWait:0}),rest=setter(1);
  const branch={key:branches[i].key,type:C.Exec_Branch.NAME};wire(branch,'ExecOutA',press,'Exec');wire(press,'ExecOut',wait1,'Input');wire(wait1,'Output',bounce,'Exec');wire(bounce,'ExecOut',wait2,'Input');wire(wait2,'Output',rest,'Exec');
 });
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'chip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:192,Y:216,Z:2},PlaneExtent:{X:235,Y:250,Z:8}}}]]);
 const name='Monitor Frame - WASD Tactile Multi-Display Demo V1',description='Seat-controlled fixed 2x2 menu with independent centered text displays and per-item shrink/bounce activation.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,placement,summary:{bricks:scene.bricks.length,wires:scene.edges.length,textDisplays:scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)).length,buttons:0,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-wasd-tactile-menu-demo.cjs input.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bytes:r.bytes.length,...r.summary,strictPlacement:r.placement.strictOk,warnings:r.placement.warnings||[]},null,2));}

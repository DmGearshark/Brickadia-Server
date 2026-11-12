'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N,R}=require('./loadboard-lib.cjs');

function one(items,label){assert.equal(items.length,1,`Expected one ${label}, found ${items.length}`);return items[0];}
function build(input){
 const donor=fs.readFileSync(input),scene=read(donor);
 const link=one(scene.links,'microchip link'),chip=one(scene.bricks.filter(b=>b.key===link.key),'microchip');
 const grid=link.grid;
 const display=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'Text Display');
 const buttons=scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Button.NAME));
 assert.equal(buttons.length,63,'7x9 button grid');
 assert.deepEqual([...new Set(buttons.map(b=>b.data.position[0]))].sort((a,b)=>a-b),[6108,6112,6116,6120,6124,6128,6132,6136,6140]);
 assert.deepEqual([...new Set(buttons.map(b=>b.data.position[2]))].sort((a,b)=>a-b),[10994,10998,11002,11006,11010,11014,11018]);
 assert.equal(scene.bricks.filter(b=>b.g===grid).length,0,'supplied chip starts empty');

 const nodes=[];let seq=0;
 function node(kind,data={}){const def=C[kind];assert(def,kind);const i=seq++,pos=[(i%6)*48,Math.floor(i/6)*48,2];const brick={key:`live-cursor:${i}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position:pos,size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(brick);const n={key:brick.key,type:def.NAME,brick};nodes.push(n);return n;}
 function wire(a,p,z,q){assert(Object.values(C).find(c=>c.NAME===a.type)?.PORTS[p],`${a.type}.${p}`);assert(Object.values(C).find(c=>c.NAME===z.type)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`Duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 function math(kind,a,ap,b,bp,data={}){const n=node('Expr_Math'+kind,data);wire(a,ap,n,'InputA');if(b)wire(b,bp,n,'InputB');return n;}

 // The most recently spawned character owns the single-player cursor probe.
 const spawned=node('Event_Gamemode_CharacterSpawned');
 const clock=node('Clock',{IntervalSeconds:.05,bEnabled:true});
 const aim=node('Exec_Character_GetAim',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},bLocalAim:false});
 wire(spawned,'Character',aim,'Character');wire(clock,'Pulse',aim,'Exec');
 const origin=node('Expr_SplitVector');wire(aim,'Origin',origin,'Input');
 const direction=node('Expr_SplitVector');wire(aim,'Direction',direction,'Input');

 // Intersect the camera ray with the button plane Y=-75049.
 const planeDelta=node('Expr_MathSubtract',{InputA:N(-75049)});wire(origin,'Y',planeDelta,'InputB');
 const distance=node('Expr_MathDivide',{InputA:N(0),InputB:N(1)});wire(planeDelta,'Output',distance,'InputA');wire(direction,'Y',distance,'InputB');
 const xTravel=math('Multiply',direction,'X',distance,'Output');
 const hitX=math('Add',origin,'X',xTravel,'Output');
 const zTravel=math('Multiply',direction,'Z',distance,'Output');
 const hitZ=math('Add',origin,'Z',zTravel,'Output');

 // Button boundaries: X 6106..6142 and Z 10992..11020. Row zero is the top row.
 const xOffset=node('Expr_MathSubtract',{InputB:N(6106)});wire(hitX,'Output',xOffset,'InputA');
 const xScaled=node('Expr_MathDivide',{InputB:N(4)});wire(xOffset,'Output',xScaled,'InputA');
 const xFloor=node('Expr_Floor');wire(xScaled,'Output',xFloor,'Input');
 const col=node('Expr_MathClamp',{Min:N(0),Max:N(8)});wire(xFloor,'Output',col,'Input');
 const zOffset=node('Expr_MathSubtract',{InputA:N(11020)});wire(hitZ,'Output',zOffset,'InputB');
 const zScaled=node('Expr_MathDivide',{InputB:N(4)});wire(zOffset,'Output',zScaled,'InputA');
 const zFloor=node('Expr_Floor');wire(zScaled,'Output',zFloor,'Input');
 const row=node('Expr_MathClamp',{Min:N(0),Max:N(6)});wire(zFloor,'Output',row,'Input');
 const rowBase=node('Expr_MathMultiply',{InputB:N(9)});wire(row,'Output',rowBase,'InputA');
 const index=math('Add',rowBase,'Output',col,'Output');

 const screens=[];
 for(let selected=0;selected<63;selected++){
  const lines=[];
  for(let y=0;y<7;y++)lines.push(Array.from({length:9},(_,x)=>y*9+x===selected?'◆':'·').join(''));
  screens.push(lines.join('\r\n'));
 }
 const frames=node('ArrayVar',{Value:{$elementType:'str',$array:screens}});
 const get=node('Exec_ArrayVar_Get',{Index:0,Value:{$variant:'str',value:screens[31]}});
 wire(frames,'ArrayVarRef',get,'ArrayVarRef');wire(index,'Output',get,'Index');wire(aim,'ExecOut',get,'Exec');
 wire(get,'Value',{key:display.key,type:C.TextDisplay.NAME},'Text');
 const displayComp=display.comps.find(c=>c.type===C.TextDisplay.NAME);
 displayComp.data.Text=screens[31];
 displayComp.data.Kerning=4;displayComp.data.LineHeight=1.5;displayComp.data.WidthScale=1;

 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'microchip entity');
 scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:120,Y:72,Z:2},PlaneExtent:{X:160,Y:110,Z:8}}}]]);
 const name='Monitor Frame - Live Aim Cursor Probe';
 const description='Single-player 7x9 live aim cursor probe. The most recently spawned character is sampled at 20 Hz and projected onto the supplied monitor button plane.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes;
 const bytes=repack(generated,donor,{name,description});
 const placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,scene,nodes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:buttons.length,rows:7,columns:9,updateHz:20,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-live-cursor-probe.cjs input.brz output.brz');const result=build(input);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,bytes:result.bytes.length,...result.summary,strictPlacement:result.placement.strictOk,warnings:result.placement.warnings||[]},null,2));}

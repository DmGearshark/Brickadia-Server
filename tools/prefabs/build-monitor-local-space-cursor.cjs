'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N}=require('./loadboard-lib.cjs');

function one(xs,label){assert.equal(xs.length,1,`Expected one ${label}, found ${xs.length}`);return xs[0];}
function build(framePath,entityTemplatePath){
 const frameDonor=fs.readFileSync(framePath),templateDonor=fs.readFileSync(entityTemplatePath);
 const frame=read(frameDonor),scene=read(templateDonor);
 const mainEntity=one([...scene.r.entities()].filter(e=>e.typeName==='Entity_DynamicBrickGrid'),'screen entity');
 const chipEntity=one([...scene.r.entities()].filter(e=>e.typeName==='Entity_MicrochipDynamicBrickGrid'),'chip entity');
 const mainGrid=mainEntity.persistentIndex,chipGrid=chipEntity.persistentIndex;
 const off=frame.r.prefabJson().addedGlobalGridOffset;
 scene.bricks=[];scene.edges=[];scene.links=[];
 for(const source of frame.bricks){
  assert(source.g!==undefined);
  const b=structuredClone(source);b.g=mainGrid;b.key=`monitor:${source.key}`;
  b.data.position=[source.data.position[0]+off.x,source.data.position[1]+off.y,source.data.position[2]+off.z];
  scene.bricks.push(b);
 }
 const chip=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Microchip.NAME)),'monitor chip');
 const display=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'monitor display');
 assert.equal(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Button.NAME)).length,63);
 scene.links=[{key:chip.key,grid:chipGrid}];

 // A deliberate player-binding switch: interact once to bind its Character
 // output, and use its enabled state to start/stop cursor updates.
 const switchBrick={key:'monitor:control-switch',g:mainGrid,data:{asset:C.AnimatedSwitch.BRICK,material:'BMC_Plastic',position:[40,-20,30],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:C.AnimatedSwitch.NAME,data:{bEnabled:false,InteractSound:1,bAllowNearbyInteraction:true,bHiddenInteraction:false,PromptCustomLabel:'Bind Monitor Cursor'}}]};
 scene.bricks.push(switchBrick);

 const nodes=[];let seq=0;
 function node(kind,data={}){const def=C[kind];assert(def,kind);const i=seq++,brick={key:`local-cursor:${i}:${kind}`,g:chipGrid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[(i%7)*48,Math.floor(i/7)*48,2],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(brick);const n={key:brick.key,type:def.NAME};nodes.push(n);return n;}
 function target(brick,type){return {key:brick.key,type};}
 function wire(a,p,z,q){assert(Object.values(C).find(c=>c.NAME===a.type)?.PORTS[p],`${a.type}.${p}`);assert(Object.values(C).find(c=>c.NAME===z.type)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`Duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 function math(kind,a,ap,b,bp,data={}){const n=node('Expr_Math'+kind,data);wire(a,ap,n,'InputA');if(b)wire(b,bp,n,'InputB');return n;}

 const sw=target(switchBrick,C.AnimatedSwitch.NAME),readGrid=node('ReadBrickGrid');
 const clock=node('Clock',{IntervalSeconds:.05,bEnabled:false});wire(sw,'bEnabled',clock,'bEnabled');
 const pose=node('Exec_Entity_GetLocationRotation',{Vector:{X:0,Y:0,Z:0},Rotation:{Pitch:0,Yaw:0,Roll:0}});wire(readGrid,'BrickGrid',pose,'Entity');wire(clock,'Pulse',pose,'Exec');
 const aim=node('Exec_Character_GetAim',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},bLocalAim:false});wire(sw,'Character',aim,'Character');wire(pose,'ExecOut',aim,'Exec');
 const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1000,Radius:0,bRelative:false,bIgnoreOwningGrid:false,CollisionChannel:8,bDetectBricks:true,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,bDetectPlayers4:false,bDetectPhysics:false,bDetectMap:false});wire(aim,'Origin',sweep,'Origin');wire(aim,'Direction',sweep,'Direction');wire(aim,'ExecOut',sweep,'Exec');

 // Build our own local coordinate frame from the entity rotation. The screen
 // lies in local X/Z, so these axes move and rotate with the complete monitor.
 const localX=node('Expr_RotateVector',{Vector:{X:1,Y:0,Z:0},Rotation:{X:0,Y:0,Z:0,W:1}});wire(pose,'Rotation',localX,'Rotation');
 const localZ=node('Expr_RotateVector',{Vector:{X:0,Y:0,Z:1},Rotation:{X:0,Y:0,Z:0,W:1}});wire(pose,'Rotation',localZ,'Rotation');
 const delta=node('Expr_MathSubtract',{InputA:N(0),InputB:N(0)});wire(sweep,'HitLocation',delta,'InputA');wire(pose,'Vector',delta,'InputB');
 const xDot=node('Expr_VecDotProduct',{InputA:{X:0,Y:0,Z:0},InputB:{X:1,Y:0,Z:0}});wire(delta,'Output',xDot,'InputA');wire(localX,'Output',xDot,'InputB');
 const zDot=node('Expr_VecDotProduct',{InputA:{X:0,Y:0,Z:0},InputB:{X:0,Y:0,Z:1}});wire(delta,'Output',zDot,'InputA');wire(localZ,'Output',zDot,'InputB');

 // The display is centered at local X=0, Z=-2 and spans 36 by 28 units.
 const xOffset=node('Expr_MathAdd',{InputB:N(18)});wire(xDot,'Output',xOffset,'InputA');
 const xScaled=node('Expr_MathDivide',{InputB:N(4)});wire(xOffset,'Output',xScaled,'InputA');
 const xFloor=node('Expr_Floor');wire(xScaled,'Output',xFloor,'Input');const col=node('Expr_MathClamp',{Min:N(0),Max:N(8)});wire(xFloor,'Output',col,'Input');
 const zOffset=node('Expr_MathSubtract',{InputA:N(12)});wire(zDot,'Output',zOffset,'InputB');
 const zScaled=node('Expr_MathDivide',{InputB:N(4)});wire(zOffset,'Output',zScaled,'InputA');
 const zFloor=node('Expr_Floor');wire(zScaled,'Output',zFloor,'Input');const row=node('Expr_MathClamp',{Min:N(0),Max:N(6)});wire(zFloor,'Output',row,'Input');
 const rowBase=node('Expr_MathMultiply',{InputB:N(9)});wire(row,'Output',rowBase,'InputA');const index=math('Add',rowBase,'Output',col,'Output');

 const screens=[];for(let selected=0;selected<63;selected++){const lines=[];for(let y=0;y<7;y++)lines.push(Array.from({length:9},(_,x)=>y*9+x===selected?'◆':'·').join(''));screens.push(lines.join('\r\n'));}
 const frames=node('ArrayVar',{Value:{$elementType:'str',$array:screens}}),get=node('Exec_ArrayVar_Get',{Index:0,Value:{$variant:'str',value:screens[31]}});wire(frames,'ArrayVarRef',get,'ArrayVarRef');wire(index,'Output',get,'Index');wire(sweep,'ExecOut',get,'Exec');wire(get,'Value',target(display,C.TextDisplay.NAME),'Text');

 const correctEntity=node('Expr_CompareEqual',{InputA:{$variant:'weak_object',value:null},InputB:{$variant:'weak_object',value:null}});wire(sweep,'HitEntity',correctEntity,'InputA');wire(readGrid,'BrickGrid',correctEntity,'InputB');
 const xMin=node('Expr_CompareGreaterOrEqual',{InputB:N(-18)});wire(xDot,'Output',xMin,'InputA');const xMax=node('Expr_CompareLessOrEqual',{InputB:N(18)});wire(xDot,'Output',xMax,'InputA');
 const zMin=node('Expr_CompareGreaterOrEqual',{InputB:N(-16)});wire(zDot,'Output',zMin,'InputA');const zMax=node('Expr_CompareLessOrEqual',{InputB:N(12)});wire(zDot,'Output',zMax,'InputA');
 const xInside=node('Expr_LogicalAND');wire(xMin,'bOutput',xInside,'bInputA');wire(xMax,'bOutput',xInside,'bInputB');const zInside=node('Expr_LogicalAND');wire(zMin,'bOutput',zInside,'bInputA');wire(zMax,'bOutput',zInside,'bInputB');
 const inRect=node('Expr_LogicalAND');wire(xInside,'bOutput',inRect,'bInputA');wire(zInside,'bOutput',inRect,'bInputB');const visible=node('Expr_LogicalAND');wire(correctEntity,'bOutput',visible,'bInputA');wire(inRect,'bOutput',visible,'bInputB');wire(visible,'bOutput',target(display,C.TextDisplay.NAME),'bEnabled');
 const dc=display.comps.find(c=>c.type===C.TextDisplay.NAME);dc.data.Text=screens[31];dc.data.Kerning=15;dc.data.LineHeight=1.5;dc.data.WidthScale=1;

 scene.entityOverrides=new Map([
  [mainGrid,{...mainEntity,location:{X:0,Y:0,Z:0},rotation:{X:0,Y:0,Z:0,W:1},frozen:true}],
  [chipGrid,{...chipEntity,location:{X:-17,Y:-1,Z:38},rotation:{X:0,Y:0,Z:0,W:1},frozen:true,data:{...chipEntity.data,bCollapsed:true,PlaneCenter:{X:144,Y:96,Z:2},PlaneExtent:{X:190,Y:130,Z:8}}}]
 ]);
 const name='Monitor Frame - Local Space Aim Cursor V1',description='Portable switch-bound 9x7 monitor cursor using entity-local raycast coordinates; supports moving and rotating the complete monitor.';
 const generated=write(scene,{assets:[...new Set([...scene.r.externalAssets(),...frame.r.externalAssets()])],name,description}).bytes;
 const bytes=repack(generated,templateDonor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [frame,template,out]=process.argv.slice(2);if(!frame||!template||!out)throw Error('Usage: node build-monitor-local-space-cursor.cjs frame.brz entity-template.brz output.brz');const r=build(frame,template);fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,bytes:r.bytes.length,...r.summary,strictPlacement:r.placement.strictOk,warnings:r.placement.warnings||[]},null,2));}

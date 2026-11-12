'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N,R}=require('./loadboard-lib.cjs');

function one(items,label){assert.equal(items.length,1,`Expected one ${label}, found ${items.length}`);return items[0];}
function build(input,{debug=false,rayDebug=false,rayCursor=false,calibrate=false}={}){
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

 if(calibrate){
  const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1000,Radius:0,bRelative:false,bIgnoreOwningGrid:false,CollisionChannel:8,bDetectBricks:true,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,bDetectPlayers4:false,bDetectPhysics:false,bDetectMap:false});
  wire(aim,'Origin',sweep,'Origin');wire(aim,'Direction',sweep,'Direction');wire(aim,'ExecOut',sweep,'Exec');
  const hit=node('Expr_SplitVector');wire(sweep,'HitLocation',hit,'Input');
  const text=node('Expr_String_FormatText',{FormatString:'AIM CALIBRATION\r\n\r\nAim just inside each black corner\r\nand screenshot these values.\r\n\r\nX  {A}\r\nZ  {B}\r\n\r\nY  {C}\r\nDistance  {D}'});
  wire(hit,'X',text,'InputA');wire(hit,'Z',text,'InputB');wire(hit,'Y',text,'InputC');wire(sweep,'HitDistance',text,'InputD');wire(text,'Output',{key:display.key,type:C.TextDisplay.NAME},'Text');
  const displayComp=display.comps.find(c=>c.type===C.TextDisplay.NAME);displayComp.data.Text='AIM CALIBRATION';displayComp.data.Kerning=2;displayComp.data.LineHeight=1.25;displayComp.data.WidthScale=1;
  const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'microchip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:120,Y:72,Z:2},PlaneExtent:{X:160,Y:110,Z:8}}}]]);
  const name='Monitor Frame - Raycast Edge Calibration',description='Displays the normal aim-ray hit coordinates used to calibrate all four monitor edges.';
  const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
  return {bytes,scene,nodes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:buttons.length,updateHz:20,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
 }

 if(rayCursor){
  const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1000,Radius:0,bRelative:false,bIgnoreOwningGrid:false,CollisionChannel:8,bDetectBricks:true,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,bDetectPlayers4:false,bDetectPhysics:false,bDetectMap:false});
  wire(aim,'Origin',sweep,'Origin');wire(aim,'Direction',sweep,'Direction');wire(aim,'ExecOut',sweep,'Exec');
  const hitFlag=node('Var',{Value:{$variant:'Bool',value:false}});
  function setHit(port,value){const set=node('Exec_Var_Set',{Value:{$variant:'Bool',value},bChangeType:false});wire(hitFlag,'VarRef',set,'VarRef');wire(sweep,port,set,'Exec');}
  setHit('Hit',true);setHit('Miss',false);
  const hit=node('Expr_SplitVector');wire(sweep,'HitLocation',hit,'Input');

  // The physical display face is sampled directly. Its nine column centers
  // are X 6108..6140; its seven row centers run from Z 11018 down to 10994.
  const xOffset=node('Expr_MathSubtract',{InputB:N(6106)});wire(hit,'X',xOffset,'InputA');
  const xScaled=node('Expr_MathDivide',{InputB:N(4)});wire(xOffset,'Output',xScaled,'InputA');
  const xFloor=node('Expr_Floor');wire(xScaled,'Output',xFloor,'Input');
  const col=node('Expr_MathClamp',{Min:N(0),Max:N(8)});wire(xFloor,'Output',col,'Input');
  const zOffset=node('Expr_MathSubtract',{InputA:N(11020)});wire(hit,'Z',zOffset,'InputB');
  const zScaled=node('Expr_MathDivide',{InputB:N(4)});wire(zOffset,'Output',zScaled,'InputA');
  const zFloor=node('Expr_Floor');wire(zScaled,'Output',zFloor,'Input');
  const row=node('Expr_MathClamp',{Min:N(0),Max:N(6)});wire(zFloor,'Output',row,'Input');
  const rowBase=node('Expr_MathMultiply',{InputB:N(9)});wire(row,'Output',rowBase,'InputA');
  const index=math('Add',rowBase,'Output',col,'Output');
  const screens=[];
  for(let selected=0;selected<63;selected++){const lines=[];for(let y=0;y<7;y++)lines.push(Array.from({length:9},(_,x)=>y*9+x===selected?'◆':'·').join(''));screens.push(lines.join('\r\n'));}
  const frames=node('ArrayVar',{Value:{$elementType:'str',$array:screens}});
  const get=node('Exec_ArrayVar_Get',{Index:0,Value:{$variant:'str',value:screens[31]}});wire(frames,'ArrayVarRef',get,'ArrayVarRef');wire(index,'Output',get,'Index');wire(sweep,'ExecOut',get,'Exec');wire(get,'Value',{key:display.key,type:C.TextDisplay.NAME},'Text');

  const xMin=node('Expr_CompareGreaterOrEqual',{InputB:N(6106)});wire(hit,'X',xMin,'InputA');
  const xMax=node('Expr_CompareLessOrEqual',{InputB:N(6142)});wire(hit,'X',xMax,'InputA');
  const zMin=node('Expr_CompareGreaterOrEqual',{InputB:N(10992)});wire(hit,'Z',zMin,'InputA');
  const zMax=node('Expr_CompareLessOrEqual',{InputB:N(11020)});wire(hit,'Z',zMax,'InputA');
  const xInside=node('Expr_LogicalAND');wire(xMin,'bOutput',xInside,'bInputA');wire(xMax,'bOutput',xInside,'bInputB');
  const zInside=node('Expr_LogicalAND');wire(zMin,'bOutput',zInside,'bInputA');wire(zMax,'bOutput',zInside,'bInputB');
  const inRect=node('Expr_LogicalAND');wire(xInside,'bOutput',inRect,'bInputA');wire(zInside,'bOutput',inRect,'bInputB');
  const visible=node('Expr_LogicalAND');wire(hitFlag,'Value',visible,'bInputA');wire(inRect,'bOutput',visible,'bInputB');wire(visible,'bOutput',{key:display.key,type:C.TextDisplay.NAME},'bEnabled');
  const displayComp=display.comps.find(c=>c.type===C.TextDisplay.NAME);displayComp.data.Text=screens[31];displayComp.data.Kerning=4;displayComp.data.LineHeight=1.5;displayComp.data.WidthScale=1;
  const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'microchip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:120,Y:72,Z:2},PlaneExtent:{X:160,Y:110,Z:8}}}]]);
  const name='Monitor Frame - Raycast Live Aim Cursor V4',description='Reliable 7x9 cursor driven by a physical raycast hit on the monitor face.';
  const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
  return {bytes,scene,nodes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:buttons.length,rows:7,columns:9,updateHz:20,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
 }

 if(rayDebug){
  const negX=node('Expr_MathMultiply',{InputB:N(-1)});wire(direction,'X',negX,'InputA');
  const negY=node('Expr_MathMultiply',{InputB:N(-1)});wire(direction,'Y',negY,'InputA');
  const negZ=node('Expr_MathMultiply',{InputB:N(-1)});wire(direction,'Z',negZ,'InputA');
  const reversed=node('Expr_MakeVector');wire(negX,'Output',reversed,'X');wire(negY,'Output',reversed,'Y');wire(negZ,'Output',reversed,'Z');
  const sweepData={Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1000,Radius:0,bRelative:false,bIgnoreOwningGrid:false,CollisionChannel:8,bDetectBricks:true,bDetectPlayers1:false,bDetectPlayers2:false,bDetectPlayers3:false,bDetectPlayers4:false,bDetectPhysics:false,bDetectMap:false};
  const direct=node('Exec_Sweep',structuredClone(sweepData));
  const reverse=node('Exec_Sweep',structuredClone(sweepData));
  wire(aim,'Origin',direct,'Origin');wire(aim,'Direction',direct,'Direction');wire(aim,'ExecOut',direct,'Exec');
  wire(aim,'Origin',reverse,'Origin');wire(reversed,'Output',reverse,'Direction');wire(aim,'ExecOut',reverse,'Exec');
  const directHit=node('Var',{Value:{$variant:'Bool',value:false}}),reverseHit=node('Var',{Value:{$variant:'Bool',value:false}});
  function setFlag(sweep,port,target,value){const set=node('Exec_Var_Set',{Value:{$variant:'Bool',value},bChangeType:false});wire(target,'VarRef',set,'VarRef');wire(sweep,port,set,'Exec');}
  setFlag(direct,'Hit',directHit,true);setFlag(direct,'Miss',directHit,false);
  setFlag(reverse,'Hit',reverseHit,true);setFlag(reverse,'Miss',reverseHit,false);
  const directLoc=node('Expr_SplitVector');wire(direct,'HitLocation',directLoc,'Input');
  const reverseLoc=node('Expr_SplitVector');wire(reverse,'HitLocation',reverseLoc,'Input');
  const directText=node('Expr_String_FormatText',{FormatString:'AIM DIRECTION  Hit {A}\r\nDistance {B}\r\nX {C}\r\nY {D}\r\nZ {E}'});
  wire(directHit,'Value',directText,'InputA');wire(direct,'HitDistance',directText,'InputB');wire(directLoc,'X',directText,'InputC');wire(directLoc,'Y',directText,'InputD');wire(directLoc,'Z',directText,'InputE');
  const reverseText=node('Expr_String_FormatText',{FormatString:'REVERSED  Hit {A}\r\nDistance {B}\r\nX {C}\r\nY {D}\r\nZ {E}'});
  wire(reverseHit,'Value',reverseText,'InputA');wire(reverse,'HitDistance',reverseText,'InputB');wire(reverseLoc,'X',reverseText,'InputC');wire(reverseLoc,'Y',reverseText,'InputD');wire(reverseLoc,'Z',reverseText,'InputE');
  const combined=node('Expr_String_FormatText',{FormatString:'RAYCAST TEST\r\n\r\n{A}\r\n\r\n{B}'});wire(directText,'Output',combined,'InputA');wire(reverseText,'Output',combined,'InputB');
  wire(combined,'Output',{key:display.key,type:C.TextDisplay.NAME},'Text');
  const displayComp=display.comps.find(c=>c.type===C.TextDisplay.NAME);
  displayComp.data.Text='RAYCAST TEST';displayComp.data.Kerning=2;displayComp.data.LineHeight=1.15;displayComp.data.WidthScale=1;
  const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'microchip entity');
  scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:120,Y:72,Z:2},PlaneExtent:{X:160,Y:110,Z:8}}}]]);
  const name='Monitor Frame - Aim Raycast Diagnostic';
  const description='Tests both Get Aim directions against the physical monitor buttons with owning-grid collision enabled.';
  const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes;
  const bytes=repack(generated,donor,{name,description});
  const placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
  return {bytes,scene,nodes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:buttons.length,updateHz:20,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
 }

 // Get Aim uses the same full world-coordinate scale as the saved monitor.
 const planeDelta=node('Expr_MathSubtract',{InputA:N(-75049)});wire(origin,'Y',planeDelta,'InputB');
 const distance=node('Expr_MathDivide',{InputA:N(0),InputB:N(1)});wire(planeDelta,'Output',distance,'InputA');wire(direction,'Y',distance,'InputB');
 const xTravel=math('Multiply',direction,'X',distance,'Output');
 const hitX=math('Add',origin,'X',xTravel,'Output');
 const zTravel=math('Multiply',direction,'Z',distance,'Output');
 const hitZ=math('Add',origin,'Z',zTravel,'Output');

 // Button boundaries are X 6106..6142 and Z 10992..11020, with four world
 // units per cell. This display face presents both axes reversed.
 const xOffset=node('Expr_MathSubtract',{InputA:N(6142)});wire(hitX,'Output',xOffset,'InputB');
 const xScaled=node('Expr_MathDivide',{InputB:N(4)});wire(xOffset,'Output',xScaled,'InputA');
 const xFloor=node('Expr_Floor');wire(xScaled,'Output',xFloor,'Input');
 const col=node('Expr_MathClamp',{Min:N(0),Max:N(8)});wire(xFloor,'Output',col,'Input');
 const zOffset=node('Expr_MathSubtract',{InputB:N(10992)});wire(hitZ,'Output',zOffset,'InputA');
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
 if(debug){
  const diagnostic=node('Expr_String_FormatText',{FormatString:'ORIGIN\r\nX {A}\r\nY {B}\r\nZ {C}\r\nDIRECTION\r\nX {D}  Y {E}\r\nZ {F}'});
  wire(origin,'X',diagnostic,'InputA');wire(origin,'Y',diagnostic,'InputB');wire(origin,'Z',diagnostic,'InputC');
  wire(direction,'X',diagnostic,'InputD');wire(direction,'Y',diagnostic,'InputE');wire(direction,'Z',diagnostic,'InputF');
  wire(diagnostic,'Output',{key:display.key,type:C.TextDisplay.NAME},'Text');
 }else{
  wire(get,'Value',{key:display.key,type:C.TextDisplay.NAME},'Text');
  // Do not clamp off-screen aim into an edge cursor. The cursor is visible
  // only while the projected ray intersection is inside the monitor bounds.
  const xMin=node('Expr_CompareGreaterOrEqual',{InputB:N(6106)});wire(hitX,'Output',xMin,'InputA');
  const xMax=node('Expr_CompareLessOrEqual',{InputB:N(6142)});wire(hitX,'Output',xMax,'InputA');
  const zMin=node('Expr_CompareGreaterOrEqual',{InputB:N(10992)});wire(hitZ,'Output',zMin,'InputA');
  const zMax=node('Expr_CompareLessOrEqual',{InputB:N(11020)});wire(hitZ,'Output',zMax,'InputA');
  const xInside=node('Expr_LogicalAND');wire(xMin,'bOutput',xInside,'bInputA');wire(xMax,'bOutput',xInside,'bInputB');
  const zInside=node('Expr_LogicalAND');wire(zMin,'bOutput',zInside,'bInputA');wire(zMax,'bOutput',zInside,'bInputB');
  const onScreen=node('Expr_LogicalAND');wire(xInside,'bOutput',onScreen,'bInputA');wire(zInside,'bOutput',onScreen,'bInputB');
  wire(onScreen,'bOutput',{key:display.key,type:C.TextDisplay.NAME},'bEnabled');
 }
 const displayComp=display.comps.find(c=>c.type===C.TextDisplay.NAME);
 displayComp.data.Text=debug?'ORIGIN\r\nX 0\r\nY 0\r\nZ 0\r\nDIRECTION\r\nX 0  Y 0\r\nZ 0':screens[31];
 displayComp.data.Kerning=4;displayComp.data.LineHeight=1.5;displayComp.data.WidthScale=1;

 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'microchip entity');
 scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:120,Y:72,Z:2},PlaneExtent:{X:160,Y:110,Z:8}}}]]);
 const name=debug?'Monitor Frame - Aim Coordinate Diagnostic':'Monitor Frame - Live Aim Cursor Probe V3';
 const description=debug?'Displays live Get Aim origin and direction values for coordinate-space calibration.':'World-space 7x9 live cursor with corrected display axes; cursor visibility is limited to intersections inside the monitor bounds.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes;
 const bytes=repack(generated,donor,{name,description});
 const placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,scene,nodes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:buttons.length,rows:7,columns:9,updateHz:20,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [input,output,flag]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-live-cursor-probe.cjs input.brz output.brz [--debug|--ray-debug|--ray-cursor|--calibrate]');const opts={debug:flag==='--debug',rayDebug:flag==='--ray-debug',rayCursor:flag==='--ray-cursor',calibrate:flag==='--calibrate'};const result=build(input,opts);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,...opts,bytes:result.bytes.length,...result.summary,strictPlacement:result.placement.strictOk,warnings:result.placement.warnings||[]},null,2));}

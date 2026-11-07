'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const {C,N}=require('./loadboard-lib.cjs');
const MICRO='Component_Internal_Microchip',BEARING=C.RigidBearing.NAME,READ=C.ReadBrickGrid.NAME;
function one(a,s){assert.equal(a.length,1,`Expected one ${s}, found ${a.length}`);return a[0];}
function build(input){
 const scene=read(fs.readFileSync(input)),link=one(scene.links,'microchip link'),shell=one(scene.bricks.filter(b=>b.key===link.key),'microchip shell'),brain=link.grid;assert(shell.comps.some(c=>c.type===MICRO));
 const joints=scene.joints.filter(j=>scene.bricks.some(b=>b.key===j.key&&b.comps.some(c=>c.type===BEARING)));assert.equal(joints.length,2,'Frame needs exactly two rigid-bearing joints');
 const verticalJoint=one(joints.filter(j=>j.entity===shell.g),'monitor hinge joint'),verticalBrick=one(scene.bricks.filter(b=>b.key===verticalJoint.key),'monitor hinge bearing');
 const horizontalJoint=one(joints.filter(j=>j.entity===verticalBrick.g),'base joint'),horizontalBrick=one(scene.bricks.filter(b=>b.key===horizontalJoint.key),'base bearing');
 const horizontal={key:horizontalBrick.key,type:BEARING},vertical={key:verticalBrick.key,type:BEARING};
 const old=new Set(scene.bricks.filter(b=>b.g===brain).map(b=>b.key));scene.bricks=scene.bricks.filter(b=>b.g!==brain);scene.edges=scene.edges.filter(e=>!old.has(e.a)&&!old.has(e.z));
 let i=0;const nodes=[];
 function node(kind,data={},color=[55,105,165]){const d=C[kind],pos=[(i%5)*48,Math.floor(i/5)*48,2],b={key:`independent-monitor:${i++}:${kind}`,g:brain,data:{asset:d.BRICK,material:'BMC_Plastic',position:pos,size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color,owner_index:0},comps:[{type:d.NAME,data}]};scene.bricks.push(b);const n={key:b.key,type:d.NAME,brick:b};nodes.push(n);return n;}
 const definition=n=>Object.values(C).find(d=>d.NAME===n.type);
 function wire(a,p,z,q){assert(definition(a)?.PORTS[p],`${a.type}.${p}`);assert(definition(z)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 const baseGrid=node('MicrochipInput',{PortLabel:'Base Grid'}),monitorGrid=node('MicrochipInput',{PortLabel:'Monitor Grid'}),hCurrent=node('MicrochipInput',{PortLabel:'Input Current Direction Base'}),vCurrent=node('MicrochipInput',{PortLabel:'Input Current Direction Monitor Hinge'});
 const clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:.1});
 const baseTransform=node('Exec_Entity_GetLocationRotation');wire(baseGrid,'RER_Output',baseTransform,'Entity');wire(clock,'Pulse',baseTransform,'Exec');
 const baseReady=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(baseTransform,'ExecOut',baseReady,'Input');
 const monitorTransform=node('Exec_Entity_GetLocationRotation');wire(monitorGrid,'RER_Output',monitorTransform,'Entity');wire(baseReady,'Output',monitorTransform,'Exec');
 const monitorReady=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(monitorTransform,'ExecOut',monitorReady,'Input');
 const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1,Radius:150,bRelative:false,bIgnoreOwningGrid:true,CollisionChannel:8,bDetectBricks:false,bDetectPlayers1:true,bDetectPlayers2:true,bDetectPlayers3:true,bDetectPlayers4:true,bOnlyHitPlayerBodyParts:false,bDetectPhysics:false,bDetectMap:false},[45,220,95]);wire(monitorTransform,'Vector',sweep,'Origin');wire(monitorReady,'Output',sweep,'Exec');
 const delta=node('Expr_MathSubtract',{InputA:{$variant:'Vector',value:{X:0,Y:0,Z:0}},InputB:{$variant:'Vector',value:{X:0,Y:0,Z:0}}});wire(sweep,'HitLocation',delta,'InputA');wire(monitorTransform,'Vector',delta,'InputB');
 const direction=node('Expr_DirectionToRotation',{Direction:{X:1,Y:0,Z:0}});wire(delta,'Output',direction,'Direction');
 const targetRotation=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(direction,'Output',targetRotation,'Input');
 const baseRotation=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(baseTransform,'Rotation',baseRotation,'Input');
 const monitorRotation=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(monitorTransform,'Rotation',monitorRotation,'Input');
 function axis(label,current,actual,actualPort,desired,desiredPort,bearing,wrap){
  let error=node('Expr_MathSubtract',{InputA:N(0),InputB:N(0)});wire(desired,desiredPort,error,'InputA');wire(actual,actualPort,error,'InputB');
  if(wrap){const shifted=node('Expr_MathAdd',{InputA:N(0),InputB:N(180)});wire(error,'Output',shifted,'InputA');const modulo=node('Expr_MathModuloFloored',{InputA:N(0),InputB:N(360)});wire(shifted,'Output',modulo,'InputA');const centered=node('Expr_MathSubtract',{InputA:N(0),InputB:N(180)});wire(modulo,'Output',centered,'InputA');error=centered;}
  const target=node('Expr_MathAdd',{InputA:N(0),InputB:N(0)});wire(current,'RER_Output',target,'InputA');wire(error,'Output',target,'InputB');
  const physical=one(scene.bricks.filter(b=>b.key===bearing.key),`${label} bearing`),saved=one(physical.comps.filter(c=>c.type===BEARING),`${label} bearing component`).data.CurrentAngle||0;
  const held=node('Var',{Value:N(saved)}),set=node('Exec_Var_Set',{Value:N(saved)});wire(held,'VarRef',set,'VarRef');wire(target,'Output',set,'Value');wire(sweep,'Hit',set,'Exec');
  const output=node('MicrochipOutput',{PortLabel:label});wire(held,'Value',output,'RER_Input');wire(output,'RER_Output',bearing,'TargetAngle');wire(bearing,'CurrentAngle',current,'RER_Input');
 }
 const horizontalDesired=node('Expr_MathAdd',{InputA:N(0),InputB:N(180)});wire(targetRotation,'Yaw',horizontalDesired,'InputA');
 const verticalDesired=node('Expr_MathNegate',{Input:N(0)});wire(targetRotation,'Pitch',verticalDesired,'Input');
 axis('Output Target Direction Base',hCurrent,baseRotation,'Yaw',horizontalDesired,'Output',horizontal,true);
 axis('Output Target Direction Monitor Hinge',vCurrent,monitorRotation,'Pitch',verticalDesired,'Output',vertical,false);
 function reader(key,grid,pos,input){const b={key,g:grid,data:{asset:C.ReadBrickGrid.BRICK,material:'BMC_Plastic',position:pos,size:[0,0,0],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:false,material_intensity:0,color:[255,255,255],owner_index:0},comps:[{type:READ,data:{}}]};scene.bricks.push(b);wire({key,type:READ},'BrickGrid',input,'RER_Input');}
 reader('independent-monitor:base-reader',horizontalJoint.entity,[30,0,0],baseGrid);reader('independent-monitor:screen-reader',verticalJoint.entity,[30,0,30],monitorGrid);
 const note={key:'independent-monitor:note',g:brain,data:{asset:'PB_DefaultTile',material:'BMC_Plastic',position:[96,-18,2],size:[35,5,2],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:true,material_intensity:0,color:[20,60,35],owner_index:0},comps:[{type:C.TextDisplay.NAME,data:{Text:'RANGE: EDIT GREEN SWEEP RADIUS  |  150 = 15 BLOCKS',Font:0,Face:0,LineHeight:1.1,WidthScale:.7,bEnabled:true,Color:{R:235,G:255,B:235,A:255},bOverrideColor:true}}]};scene.bricks.push(note);
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===brain),'brain entity');scene.entityOverrides=new Map([[brain,{...entity,data:{...structuredClone(entity.data),PlaneCenter:{X:96,Y:120,Z:entity.data.PlaneCenter.Z},PlaneExtent:{X:145,Y:150,Z:8}}}]]);
 const out=write(scene,{assets:scene.r.externalAssets(),embedded:scene.r.prefabPaths().map(p=>scene.r.readPrefab(p)),name:'Independent Dual Axis Player Monitor',description:'Fresh logic: base yaw follows the player from the base grid, while monitor pitch follows independently from the monitor grid. Both targets latch on player hits.'});return {bytes:out.bytes,inside:nodes.length,total:nodes.length+2,wires:scene.edges.length};
}
module.exports=build;if(require.main===module){const [a,z]=process.argv.slice(2);const r=build(a);fs.writeFileSync(z,r.bytes);console.log(JSON.stringify({output:z,...r,bytes:r.bytes.length},null,2));}

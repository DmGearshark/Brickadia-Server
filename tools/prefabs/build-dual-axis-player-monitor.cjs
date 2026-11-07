'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const {C,N}=require('./loadboard-lib.cjs');
const MICRO='Component_Internal_Microchip',BEARING=C.RigidBearing.NAME,READ=C.ReadBrickGrid.NAME;
function one(a,s){assert.equal(a.length,1,`Expected one ${s}, found ${a.length}`);return a[0];}
function build(input){
 const scene=read(fs.readFileSync(input)),link=one(scene.links,'microchip link'),shell=one(scene.bricks.filter(b=>b.key===link.key),'microchip shell'),brain=link.grid;
 assert(shell.comps.some(c=>c.type===MICRO));
 const innerJoint=one(scene.joints.filter(j=>j.entity===shell.g),'vertical joint'),verticalBrick=one(scene.bricks.filter(b=>b.key===innerJoint.key),'vertical bearing');
 const outerJoint=one(scene.joints.filter(j=>j.entity===verticalBrick.g),'horizontal joint'),horizontalBrick=one(scene.bricks.filter(b=>b.key===outerJoint.key),'horizontal bearing');
 const horizontal={key:horizontalBrick.key,type:BEARING},vertical={key:verticalBrick.key,type:BEARING};
 const old=new Set(scene.bricks.filter(b=>b.g===brain).map(b=>b.key));scene.bricks=scene.bricks.filter(b=>b.g!==brain);scene.edges=scene.edges.filter(e=>!old.has(e.a)&&!old.has(e.z));
 let i=0;const nodes=[];
 function node(kind,data={},color=[55,105,165]){const d=C[kind],pos=[(i%5)*48,Math.floor(i/5)*48,2],b={key:`dual-monitor:${i++}:${kind}`,g:brain,data:{asset:d.BRICK,material:'BMC_Plastic',position:pos,size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color,owner_index:0},comps:[{type:d.NAME,data}]};scene.bricks.push(b);const n={key:b.key,type:d.NAME,brick:b};nodes.push(n);return n;}
 function def(n){return Object.values(C).find(d=>d.NAME===n.type)}
 function wire(a,p,z,q){assert(def(a)?.PORTS[p],`${a.type}.${p}`);assert(def(z)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 const displayInput=node('MicrochipInput',{PortLabel:'Display Grid'}),hCurrent=node('MicrochipInput',{PortLabel:'Horizontal Current'}),vCurrent=node('MicrochipInput',{PortLabel:'Vertical Current'});
 const clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:.1});
 const transform=node('Exec_Entity_GetLocationRotation');wire(displayInput,'RER_Output',transform,'Entity');wire(clock,'Pulse',transform,'Exec');
 const ready=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(transform,'ExecOut',ready,'Input');
 const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1,Radius:150,bRelative:false,bIgnoreOwningGrid:true,CollisionChannel:8,bDetectBricks:false,bDetectPlayers1:true,bDetectPlayers2:true,bDetectPlayers3:true,bDetectPlayers4:true,bOnlyHitPlayerBodyParts:false,bDetectPhysics:false,bDetectMap:false},[45,220,95]);wire(transform,'Vector',sweep,'Origin');wire(ready,'Output',sweep,'Exec');
 const delta=node('Expr_MathSubtract',{InputA:{$variant:'Vector',value:{X:0,Y:0,Z:0}},InputB:{$variant:'Vector',value:{X:0,Y:0,Z:0}}});wire(sweep,'HitLocation',delta,'InputA');wire(transform,'Vector',delta,'InputB');
 const direction=node('Expr_DirectionToRotation',{Direction:{X:1,Y:0,Z:0}});wire(delta,'Output',direction,'Direction');
 const targetRotation=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(direction,'Output',targetRotation,'Input');
 const displayRotation=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(transform,'Rotation',displayRotation,'Input');
 function axis(label,current,currentPort,targetPort,bearing,offset=0){
  const sum=node('Expr_MathAdd',{InputA:N(0),InputB:N(0)});wire(current,'RER_Output',sum,'InputA');wire(displayRotation,currentPort,sum,'InputB');
  const corrected=node('Expr_MathSubtract',{InputA:N(0),InputB:N(0)});wire(sum,'Output',corrected,'InputA');wire(targetRotation,targetPort,corrected,'InputB');
  let target=corrected;
  if(offset){target=node('Expr_MathAdd',{InputA:N(0),InputB:N(offset)});wire(corrected,'Output',target,'InputA');}
  const bearingBrick=one(scene.bricks.filter(b=>b.key===bearing.key),`${label} bearing brick`),savedAngle=one(bearingBrick.comps.filter(c=>c.type===BEARING),`${label} bearing component`).data.CurrentAngle||0;
  const held=node('Var',{Value:N(savedAngle)}),set=node('Exec_Var_Set',{Value:N(savedAngle)});wire(held,'VarRef',set,'VarRef');wire(target,'Output',set,'Value');wire(sweep,'Hit',set,'Exec');
  const output=node('MicrochipOutput',{PortLabel:`${label} Angle`});wire(held,'Value',output,'RER_Input');wire(output,'RER_Output',bearing,'TargetAngle');wire(bearing,'CurrentAngle',current,'RER_Input');
 }
 axis('Horizontal',hCurrent,'Yaw','Yaw',horizontal,180);axis('Vertical',vCurrent,'Pitch','Pitch',vertical);
 const reader={key:'dual-monitor:display-grid-reader',g:shell.g,data:{asset:C.ReadBrickGrid.BRICK,material:'BMC_Plastic',position:[30,0,30],size:[0,0,0],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:false,material_intensity:0,color:[255,255,255],owner_index:0},comps:[{type:READ,data:{}}]};scene.bricks.push(reader);wire({key:reader.key,type:READ},'BrickGrid',displayInput,'RER_Input');
 const note={key:'dual-monitor:note',g:brain,data:{asset:'PB_DefaultTile',material:'BMC_Plastic',position:[96,-18,2],size:[35,5,2],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:true,material_intensity:0,color:[20,60,35],owner_index:0},comps:[{type:C.TextDisplay.NAME,data:{Text:'RANGE: EDIT GREEN SWEEP RADIUS  |  150 = 15 BLOCKS',Font:0,Face:0,LineHeight:1.1,WidthScale:.7,bEnabled:true,Color:{R:235,G:255,B:235,A:255},bOverrideColor:true}}]};scene.bricks.push(note);
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===brain),'brain entity');scene.entityOverrides=new Map([[brain,{...entity,data:{...structuredClone(entity.data),PlaneCenter:{X:96,Y:72,Z:entity.data.PlaneCenter.Z},PlaneExtent:{X:145,Y:100,Z:8}}}]]);
 const out=write(scene,{assets:scene.r.externalAssets(),embedded:scene.r.prefabPaths().map(p=>scene.r.readPrefab(p)),name:'Dual Axis Closest Player Monitor',description:'Latched horizontal and vertical closest-player tracking. Clock Enabled is free for a zone. Edit the green Sweep Radius; 150 equals 15 blocks.'});return {bytes:out.bytes,inside:nodes.length,total:nodes.length+1,wires:scene.edges.length,horizontal:horizontal.key,vertical:vertical.key};
}
module.exports=build;if(require.main===module){const [a,z]=process.argv.slice(2);const r=build(a);fs.writeFileSync(z,r.bytes);console.log(JSON.stringify({output:z,...r,bytes:r.bytes.length},null,2));}

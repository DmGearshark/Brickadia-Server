'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const {C,N}=require('./loadboard-lib.cjs');
const INPUT='BrickComponentType_Internal_MicrochipInput',OUTPUT='BrickComponentType_Internal_MicrochipOutput';
const MICRO='Component_Internal_Microchip',BEARING='Component_Internal_RigidBearing',READ=C.ReadBrickGrid.NAME;
function one(a,s){assert.equal(a.length,1,`Expected one ${s}, found ${a.length}`);return a[0];}
function build(input){
 const scene=read(fs.readFileSync(input)),link=one(scene.links,'microchip link'),chip=one(scene.bricks.filter(b=>b.key===link.key),'microchip');
 assert(chip.comps.some(c=>c.type===MICRO)); const grid=link.grid;
 const bearingBrick=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===BEARING)),'bearing');
 const bearing={key:bearingBrick.key,type:BEARING};
 const joint=one(scene.joints.filter(j=>j.key===bearing.key),'bearing joint'),monitorGrid=joint.entity;
 scene.bricks=scene.bricks.filter(b=>b.g!==grid); const removed=new Set(scene.bricks.filter(()=>false));
 scene.edges=scene.edges.filter(e=>!e.a.startsWith?.('minimal-monitor:')&&!e.z.startsWith?.('minimal-monitor:'));
 let i=0; const nodes=[];
 function node(kind,data={},color=[55,105,165]){const d=C[kind],pos=[(i%5)*48,Math.floor(i/5)*48,2],b={key:`minimal-monitor:${i++}:${kind}`,g:grid,data:{asset:d.BRICK,material:'BMC_Plastic',position:pos,size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color,owner_index:0},comps:[{type:d.NAME,data}]};scene.bricks.push(b);const n={key:b.key,type:d.NAME,brick:b};nodes.push(n);return n;}
 function wire(a,p,z,q){assert(C[Object.keys(C).find(k=>C[k].NAME===a.type)]?.PORTS[p],`${a.type}.${p}`);assert(C[Object.keys(C).find(k=>C[k].NAME===z.type)]?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 const clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:.1});
 const transform=node('Exec_GetOwnTransform');wire(clock,'Pulse',transform,'Exec');
 const sweep=node('Exec_Sweep',{Origin:{X:0,Y:0,Z:0},Direction:{X:1,Y:0,Z:0},Distance:1,Radius:150,bRelative:false,bIgnoreOwningGrid:true,CollisionChannel:8,bDetectBricks:false,bDetectPlayers1:true,bDetectPlayers2:true,bDetectPlayers3:true,bDetectPlayers4:true,bOnlyHitPlayerBodyParts:false,bDetectPhysics:false,bDetectMap:false},[45,220,95]);
 wire(transform,'Location',sweep,'Origin');wire(transform,'ExecOut',sweep,'Exec');
 const delta=node('Expr_MathSubtract',{InputA:{$variant:'Vector',value:{X:0,Y:0,Z:0}},InputB:{$variant:'Vector',value:{X:0,Y:0,Z:0}}});wire(sweep,'HitLocation',delta,'InputA');wire(transform,'Location',delta,'InputB');
 const direction=node('Expr_DirectionToRotation',{Direction:{X:1,Y:0,Z:0}});wire(delta,'Output',direction,'Direction');
 const split=node('Expr_SplitRotation',{Input:{Pitch:0,Yaw:0,Roll:0}});wire(direction,'Output',split,'Input');
 const reverse=node('Expr_MathMultiply',{InputA:N(0),InputB:N(-1)});wire(split,'Yaw',reverse,'InputA');
 const output=node('MicrochipOutput',{PortLabel:'Bearing Angle'});wire(reverse,'Output',output,'RER_Input');wire(output,'RER_Output',bearing,'TargetAngle');
 const note={key:'minimal-monitor:note',g:grid,data:{asset:'PB_DefaultTile',material:'BMC_Plastic',position:[96,-18,2],size:[30,5,2],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:true,material_intensity:0,color:[20,60,35],owner_index:0},comps:[{type:C.TextDisplay.NAME,data:{Text:'RANGE: EDIT GREEN SWEEP RADIUS\n150 = 15 BLOCKS',Font:0,Face:0,LineHeight:1.2,WidthScale:.75,bEnabled:true,Color:{R:235,G:255,B:235,A:255},bOverrideColor:true}}]};scene.bricks.push(note);
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'brain entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),PlaneCenter:{X:96,Y:24,Z:entity.data.PlaneCenter.Z},PlaneExtent:{X:145,Y:58,Z:8}}}]]);
 const result=write(scene,{assets:scene.r.externalAssets(),embedded:scene.r.prefabPaths().map(p=>scene.r.readPrefab(p)),name:'Closest Player Monitor - Minimal 8 Gate Tracker',description:'Eight-gate closest-player bearing tracker. Edit the green Sweep Radius; 150 equals 15 blocks. Bearing Angle is exposed on the microchip.'});
 return {bytes:result.bytes,inside:nodes.length,total:nodes.length,wires:scene.edges.length};
}
module.exports=build;if(require.main===module){const [a,z]=process.argv.slice(2);const r=build(a);fs.writeFileSync(z,r.bytes);console.log(JSON.stringify({output:z,...r,bytes:r.bytes.length},null,2));}

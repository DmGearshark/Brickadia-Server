'use strict';
const fs=require('fs'),path=require('path');
const {Build,N,B,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Fresh Dynamic Vehicle Router');
 const chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:40,Y:35,Z:0},collapsed:false});
 const c=b.circuit(chip.grid,'fresh-route');
 let i=0;
 const node=(kind,data={})=>c.n(kind,data,[(i%8)*10-35,Math.floor(i++/8)*10-30,2]);

 const steering=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)});
 const compass=node('MicrochipOutput',{PortLabel:'Compass direction',CallableDefault:N(0),CallableResult:N(0)});
 const record=node('MicrochipInput',{PortLabel:'Record Coordinates',CallableDefault:B(false),CallableMirror:B(false)});
 const remove=node('MicrochipInput',{PortLabel:'Delete Coordinates',CallableDefault:B(false),CallableMirror:B(false)});
 const vehicle=node('MicrochipInput',{PortLabel:'Vehicle Grid (Internal)'});
 const points=node('ArrayVar',{Value:{$elementType:'Vector',$array:[]}});
 const index=node('Var',{Value:N(0)});
 const arrivalRadius=node('Var',{Value:N(50)});
 const steeringDegrees=node('Var',{Value:N(45)});
 const headingOffset=node('Var',{Value:N(-90)});
 const steeringSign=node('Var',{Value:N(1)});

 // Record the actual vehicle-grid location. Query results publish asynchronously.
 const recordEdge=node('Expr_EdgeDetectorExec',{Input:R(record,'RER_Output')});
 const recordTransform=node('Exec_Entity_GetLocationRotation',{Entity:R(vehicle,'RER_Output')});
 b.wire(recordEdge,'OnRisingEdge',recordTransform,'Exec');
 const recordWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(recordTransform,'ExecOut',recordWait,'Input');
 const push=node('Exec_ArrayVar_Push',{ArrayVarRef:R(points,'ArrayVarRef'),Value:R(recordTransform,'Vector')});
 b.wire(recordWait,'Output',push,'Exec');

 const deleteEdge=node('Expr_EdgeDetectorExec',{Input:R(remove,'RER_Output')});
 const clear=node('Exec_ArrayVar_Clear',{ArrayVarRef:R(points,'ArrayVarRef')});
 b.wire(deleteEdge,'OnRisingEdge',clear,'Exec');
 const reset=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:N(0)});
 b.wire(clear,'ExecOut',reset,'Exec');

 // Re-read position, length, and target once per second. Never index an empty array.
 const clock=node('Clock',{IntervalSeconds:N(1),bEnabled:B(true)});
 const transform=node('Exec_Entity_GetLocationRotation',{Entity:R(vehicle,'RER_Output')});
 b.wire(clock,'Pulse',transform,'Exec');
 const transformWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(transform,'ExecOut',transformWait,'Input');
 const length=node('Exec_ArrayVar_GetLength',{ArrayVarRef:R(points,'ArrayVarRef')});
 b.wire(transformWait,'Output',length,'Exec');
 const lengthWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(length,'ExecOut',lengthWait,'Input');
 const hasPoints=node('Expr_CompareGreater',{InputA:R(length,'Length'),InputB:N(0)});
 const validBranch=node('Exec_Branch',{bCond:R(hasPoints,'bOutput')});
 b.wire(lengthWait,'Output',validBranch,'Exec');
 const safeLength=node('Expr_MathMax',{InputA:R(length,'Length'),InputB:N(1)});
 const safeIndex=node('Expr_MathModuloFloored',{InputA:R(index,'Value'),InputB:R(safeLength,'Output')});
 const get=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(safeIndex,'Output')});
 b.wire(validBranch,'ExecOutA',get,'Exec');
 const pointWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(get,'ExecOut',pointWait,'Input');

 const ownPos=node('Expr_SplitVector',{Input:R(transform,'Vector')});
 const targetPos=node('Expr_SplitVector',{Input:R(get,'Value')});
 const dx=node('Expr_MathSubtract',{InputA:R(targetPos,'X'),InputB:R(ownPos,'X')});
 const dy=node('Expr_MathSubtract',{InputA:R(targetPos,'Y'),InputB:R(ownPos,'Y')});
 const flatDelta=node('Expr_MakeVector',{X:R(dx,'Output'),Y:R(dy,'Output'),Z:N(0)});
 const distance=node('Expr_VecMagnitude',{Input:R(flatDelta,'Output')});
 const arrived=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:R(arrivalRadius,'Value')});
 const arrivalBranch=node('Exec_Branch',{bCond:R(arrived,'bOutput')});
 b.wire(pointWait,'Output',arrivalBranch,'Exec');
 const next=node('Expr_MathAdd',{InputA:R(safeIndex,'Output'),InputB:N(1)});
 const wrapped=node('Expr_MathModuloFloored',{InputA:R(next,'Output'),InputB:R(safeLength,'Output')});
 const setIndex=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(wrapped,'Output')});
 b.wire(arrivalBranch,'ExecOutA',setIndex,'Exec');

 const desiredRot=node('Expr_DirectionToRotation',{Direction:R(flatDelta,'Output')});
 const desiredAngles=node('Expr_SplitRotation',{Input:R(desiredRot,'Output')});
 const ownAngles=node('Expr_SplitRotation',{Input:R(transform,'Rotation')});
 const vehicleHeading=node('Expr_MathAdd',{InputA:R(ownAngles,'Yaw'),InputB:R(headingOffset,'Value')});
 const rawError=node('Expr_MathSubtract',{InputA:R(desiredAngles,'Yaw'),InputB:R(vehicleHeading,'Output')});
 const shifted=node('Expr_MathAdd',{InputA:R(rawError,'Output'),InputB:N(180)});
 const modulo=node('Expr_MathModuloFloored',{InputA:R(shifted,'Output'),InputB:N(360)});
 const centered=node('Expr_MathSubtract',{InputA:R(modulo,'Output'),InputB:N(180)});
 const proportional=node('Expr_MathDivide',{InputA:R(centered,'Output'),InputB:R(steeringDegrees,'Value')});
 const clamp=node('Expr_MathClamp',{Input:R(proportional,'Output'),Min:N(-1),Max:N(1)});
 const signed=node('Expr_MathMultiply',{InputA:R(clamp,'Output'),InputB:R(steeringSign,'Value')});
 const selected=node('Expr_Select',{InputA:N(0),InputB:R(signed,'Output'),bSelectB:R(hasPoints,'bOutput')});
 b.wire(selected,'Output',steering,'RER_Input');
 const compassSelected=node('Expr_Select',{InputA:N(0),InputB:R(centered,'Output'),bSelectB:R(hasPoints,'bOutput')});
 b.wire(compassSelected,'Output',compass,'RER_Input');

 if(i>56)throw Error(`Brain exceeds 8x7 plane: ${i} gates`);
 b.w.makePrefab({isMicrochipPrefab:true});
 const bytes=b.finish({x:5,y:5,z:2},'Fresh dynamic waypoint controller. Records the vehicle grid, safely follows a live-length coordinate array, and advances once targets are reached.');
 return {bytes,gates:i,wires:b.edges.length};
}
module.exports=build;
if(require.main===module){const out=process.argv[2]||'prefabs/fresh-dynamic-route-brain.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

'use strict';
const fs=require('fs'),path=require('path');
const {Build,N,B,R}=require('./loadboard-lib.cjs');
function build(){
 const b=new Build('Latched Waypoint Vehicle Router'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:50,Y:55,Z:0},collapsed:false}),c=b.circuit(chip.grid,'latched-route');
 let i=0;const node=(kind,data={})=>c.n(kind,data,[(i%10)*10-45,Math.floor(i++/10)*10-40,2]);
 const steering=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)}),compass=node('MicrochipOutput',{PortLabel:'Compass direction',CallableDefault:N(0),CallableResult:N(0)}),record=node('MicrochipInput',{PortLabel:'Record Coordinates',CallableDefault:B(false),CallableMirror:B(false)}),remove=node('MicrochipInput',{PortLabel:'Delete Coordinates',CallableDefault:B(false),CallableMirror:B(false)}),vehicle=node('MicrochipInput',{PortLabel:'Vehicle Grid (Internal)'});
 const points=node('ArrayVar',{Value:{$elementType:'Vector',$array:[]}}),index=node('Var',{Value:N(0)}),target=node('Var',{Value:{$variant:'Vector',value:{X:0,Y:0,Z:0}}}),targetValid=node('Var',{Value:B(false)}),currentPosition=node('Var',{Value:{$variant:'Vector',value:{X:0,Y:0,Z:0}}}),currentRotation=node('Var',{Value:{$variant:'Rotator',value:{Pitch:0,Yaw:0,Roll:0}}}),lengthHold=node('Var',{Value:N(0)}),steeringHold=node('Var',{Value:N(0)}),compassHold=node('Var',{Value:N(0)}),arrivalRadius=node('Var',{Value:N(50)}),steeringDegrees=node('Var',{Value:N(90)}),headingOffset=node('Var',{Value:N(-90)}),steeringSign=node('Var',{Value:N(1)});

 // Recording is independent. The first recorded point initializes the target latch.
 const recordEdge=node('Expr_EdgeDetectorExec',{Input:R(record,'RER_Output')}),recordTransform=node('Exec_Entity_GetLocationRotation',{Entity:R(vehicle,'RER_Output')});b.wire(recordEdge,'OnRisingEdge',recordTransform,'Exec');
 const recordWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(recordTransform,'ExecOut',recordWait,'Input');
 const push=node('Exec_ArrayVar_Push',{ArrayVarRef:R(points,'ArrayVarRef'),Value:R(recordTransform,'Vector')});b.wire(recordWait,'Output',push,'Exec');
 const invalidTarget=node('Expr_LogicalNOT',{bInput:R(targetValid,'Value')}),initializeBranch=node('Exec_Branch',{bCond:R(invalidTarget,'bOutput')});b.wire(push,'ExecOut',initializeBranch,'Exec');
 const initTarget=node('Exec_Var_Set',{VarRef:R(target,'VarRef'),Value:R(recordTransform,'Vector')});b.wire(initializeBranch,'ExecOutA',initTarget,'Exec');
 const initValid=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(true)});b.wire(initTarget,'ExecOut',initValid,'Exec');

 const deleteEdge=node('Expr_EdgeDetectorExec',{Input:R(remove,'RER_Output')}),clear=node('Exec_ArrayVar_Clear',{ArrayVarRef:R(points,'ArrayVarRef')});b.wire(deleteEdge,'OnRisingEdge',clear,'Exec');
 const resetIndex=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:N(0)});b.wire(clear,'ExecOut',resetIndex,'Exec');
 const clearValid=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(false)});b.wire(resetIndex,'ExecOut',clearValid,'Exec');
 const clearSteering=node('Exec_Var_Set',{VarRef:R(steeringHold,'VarRef'),Value:N(0)});b.wire(clearValid,'ExecOut',clearSteering,'Exec');
 const clearCompass=node('Exec_Var_Set',{VarRef:R(compassHold,'VarRef'),Value:N(0)});b.wire(clearSteering,'ExecOut',clearCompass,'Exec');

 // This loop refreshes sensors and steering only. It never normally reloads the target.
 const clock=node('Clock',{IntervalSeconds:1,bEnabled:true}),transform=node('Exec_Entity_GetLocationRotation',{Entity:R(vehicle,'RER_Output')});b.wire(clock,'Pulse',transform,'Exec');
 const transformWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(transform,'ExecOut',transformWait,'Input');
 const latchPosition=node('Exec_Var_Set',{VarRef:R(currentPosition,'VarRef'),Value:R(transform,'Vector')});b.wire(transformWait,'Output',latchPosition,'Exec');
 const latchRotation=node('Exec_Var_Set',{VarRef:R(currentRotation,'VarRef'),Value:R(transform,'Rotation')});b.wire(latchPosition,'ExecOut',latchRotation,'Exec');
 const length=node('Exec_ArrayVar_GetLength',{ArrayVarRef:R(points,'ArrayVarRef')});b.wire(latchRotation,'ExecOut',length,'Exec');
 const lengthWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(length,'ExecOut',lengthWait,'Input');
 const storeLength=node('Exec_Var_Set',{VarRef:R(lengthHold,'VarRef'),Value:R(length,'Length')});b.wire(lengthWait,'Output',storeLength,'Exec');
 const sampleSettled=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(storeLength,'ExecOut',sampleSettled,'Input');
 const hasPoints=node('Expr_CompareGreater',{InputA:R(lengthHold,'Value'),InputB:N(0)}),safeLength=node('Expr_MathMax',{InputA:R(lengthHold,'Value'),InputB:N(1)}),safeIndex=node('Expr_MathModuloFloored',{InputA:R(index,'Value'),InputB:R(safeLength,'Output')});

 // A manual shrink can invalidate the index; only that exceptional case relatches it.
 const indexInvalid=node('Expr_CompareGreaterOrEqual',{InputA:R(index,'Value'),InputB:R(lengthHold,'Value')}),recoverNeeded=node('Expr_LogicalAND',{bInputA:R(hasPoints,'bOutput'),bInputB:R(indexInvalid,'bOutput')}),recoverEdge=node('Expr_EdgeDetectorExec',{Input:R(recoverNeeded,'bOutput')});
 const recoverInvalidate=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(false)});b.wire(recoverEdge,'OnRisingEdge',recoverInvalidate,'Exec');
 const recoverIndex=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(safeIndex,'Output')});b.wire(recoverInvalidate,'ExecOut',recoverIndex,'Exec');
 const recoverGet=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(safeIndex,'Output')});b.wire(recoverIndex,'ExecOut',recoverGet,'Exec');
 const recoverWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(recoverGet,'ExecOut',recoverWait,'Input');
 const recoverTarget=node('Exec_Var_Set',{VarRef:R(target,'VarRef'),Value:R(recoverGet,'Value')});b.wire(recoverWait,'Output',recoverTarget,'Exec');
 const recoverValid=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(true)});b.wire(recoverTarget,'ExecOut',recoverValid,'Exec');

 const ownPos=node('Expr_SplitVector',{Input:R(currentPosition,'Value')}),targetPos=node('Expr_SplitVector',{Input:R(target,'Value')}),dx=node('Expr_MathSubtract',{InputA:R(targetPos,'X'),InputB:R(ownPos,'X')}),dy=node('Expr_MathSubtract',{InputA:R(targetPos,'Y'),InputB:R(ownPos,'Y')}),flatDelta=node('Expr_MakeVector',{X:R(dx,'Output'),Y:R(dy,'Output'),Z:N(0)}),distance=node('Expr_VecMagnitude',{Input:R(flatDelta,'Output')}),insideRadius=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:R(arrivalRadius,'Value')}),arrived=node('Expr_LogicalAND',{bInputA:R(targetValid,'Value'),bInputB:R(insideRadius,'bOutput')}),arrivalPulse=node('Exec_Branch',{bCond:R(arrived,'bOutput')});b.wire(sampleSettled,'Output',arrivalPulse,'Exec');

 // Arrival is the normal event that advances and reloads the selected waypoint.
 const arrivalInvalidate=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(false)});b.wire(arrivalPulse,'ExecOutA',arrivalInvalidate,'Exec');
 const next=node('Expr_MathAdd',{InputA:R(safeIndex,'Output'),InputB:N(1)}),wrapped=node('Expr_MathModuloFloored',{InputA:R(next,'Output'),InputB:R(safeLength,'Output')}),setIndex=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(wrapped,'Output')});b.wire(arrivalInvalidate,'ExecOut',setIndex,'Exec');
 const getNext=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(wrapped,'Output')});b.wire(setIndex,'ExecOut',getNext,'Exec');
 const nextWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(getNext,'ExecOut',nextWait,'Input');
 const setTarget=node('Exec_Var_Set',{VarRef:R(target,'VarRef'),Value:R(getNext,'Value')});b.wire(nextWait,'Output',setTarget,'Exec');
 const setValid=node('Exec_Var_Set',{VarRef:R(targetValid,'VarRef'),Value:B(true)});b.wire(setTarget,'ExecOut',setValid,'Exec');

 const desiredRot=node('Expr_DirectionToRotation',{Direction:R(flatDelta,'Output')}),desiredAngles=node('Expr_SplitRotation',{Input:R(desiredRot,'Output')}),ownAngles=node('Expr_SplitRotation',{Input:R(currentRotation,'Value')}),vehicleHeading=node('Expr_MathAdd',{InputA:R(ownAngles,'Yaw'),InputB:R(headingOffset,'Value')}),rawError=node('Expr_MathSubtract',{InputA:R(desiredAngles,'Yaw'),InputB:R(vehicleHeading,'Output')}),shifted=node('Expr_MathAdd',{InputA:R(rawError,'Output'),InputB:N(180)}),modulo=node('Expr_MathModuloFloored',{InputA:R(shifted,'Output'),InputB:N(360)}),centered=node('Expr_MathSubtract',{InputA:R(modulo,'Output'),InputB:N(180)}),proportional=node('Expr_MathDivide',{InputA:R(centered,'Output'),InputB:R(steeringDegrees,'Value')}),clamp=node('Expr_MathClamp',{Input:R(proportional,'Output'),Min:N(-0.65),Max:N(0.65)}),signed=node('Expr_MathMultiply',{InputA:R(clamp,'Output'),InputB:R(steeringSign,'Value')}),absoluteError=node('Expr_MathAbs',{Input:R(centered,'Output')}),outsideDeadZone=node('Expr_CompareGreater',{InputA:R(absoluteError,'Output'),InputB:N(6)}),deadZoneTarget=node('Expr_Select',{InputA:N(0),InputB:R(signed,'Output'),bSelectB:R(outsideDeadZone,'bOutput')}),oppositeProduct=node('Expr_MathMultiply',{InputA:R(deadZoneTarget,'Output'),InputB:R(steeringHold,'Value')}),oppositeSide=node('Expr_CompareLess',{InputA:R(oppositeProduct,'Output'),InputB:N(0)}),safeTarget=node('Expr_Select',{InputA:R(deadZoneTarget,'Output'),InputB:N(0),bSelectB:R(oppositeSide,'bOutput')}),steeringDelta=node('Expr_MathSubtract',{InputA:R(safeTarget,'Output'),InputB:R(steeringHold,'Value')}),limitedDelta=node('Expr_MathClamp',{Input:R(steeringDelta,'Output'),Min:N(-0.25),Max:N(0.25)}),limitedSteering=node('Expr_MathAdd',{InputA:R(steeringHold,'Value'),InputB:R(limitedDelta,'Output')});
 const updateSteering=node('Exec_Branch',{bCond:R(targetValid,'Value')});b.wire(sampleSettled,'Output',updateSteering,'Exec');
 const storeSteering=node('Exec_Var_Set',{VarRef:R(steeringHold,'VarRef'),Value:R(limitedSteering,'Output')});b.wire(updateSteering,'ExecOutA',storeSteering,'Exec');
 const storeCompass=node('Exec_Var_Set',{VarRef:R(compassHold,'VarRef'),Value:R(centered,'Output')});b.wire(storeSteering,'ExecOut',storeCompass,'Exec');
 b.wire(steeringHold,'Value',steering,'RER_Input');b.wire(compassHold,'Value',compass,'RER_Input');
 if(i>100)throw Error(`Brain exceeds 10x10 plane: ${i} gates`);
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Latched waypoint controller. Refreshes steering once per second; only arrival advances and loads the next coordinate.');return {bytes,gates:i,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/latched-waypoint-route-brain.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

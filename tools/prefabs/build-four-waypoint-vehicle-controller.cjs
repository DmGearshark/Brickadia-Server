'use strict';
const fs=require('fs');
const {Build,C,N,B,O,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Four Waypoint Vehicle Controller');
 const chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175]});
 const c=b.circuit(chip.grid,'route');
 let i=0;
 const node=(kind,data={})=>c.n(kind,data,[(i%7)*48,Math.floor(i++/7)*48,2]);

 const vehicle=node('MicrochipInput',{PortLabel:'Vehicle Grid',CallableDefault:O(null),CallableMirror:O(null)});
 const enabled=node('MicrochipInput',{PortLabel:'Enabled',CallableDefault:B(true),CallableMirror:B(true)});
 const throttle=node('MicrochipInput',{PortLabel:'Throttle',CallableDefault:N(.5),CallableMirror:N(.5)});
 const arrivalRadius=node('MicrochipInput',{PortLabel:'Arrival Radius',CallableDefault:N(50),CallableMirror:N(50)});
 const steeringRange=node('MicrochipInput',{PortLabel:'Full Steering At Degrees',CallableDefault:N(45),CallableMirror:N(45)});
 const steeringSign=node('MicrochipInput',{PortLabel:'Steering Sign (+1 or -1)',CallableDefault:N(1),CallableMirror:N(1)});

 // This is deliberately one editable Vector array: entries 1-4 are route points 1-4.
 const points=node('ArrayVar',{Value:{$elementType:'Vector',$array:[
  {X:0,Y:0,Z:0},{X:500,Y:0,Z:0},{X:500,Y:500,Z:0},{X:0,Y:500,Z:0}
 ]}});
 const index=node('Var',{Value:N(0)});
 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:R(enabled,'RER_Output')});
 const transform=node('Exec_Entity_GetLocationRotation',{Entity:R(vehicle,'RER_Output')});
 b.wire(clock,'Pulse',transform,'Exec');
 const transformWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(transform,'ExecOut',transformWait,'Input');
 const getPoint=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(index,'Value')});
 b.wire(transformWait,'Output',getPoint,'Exec');
 const pointWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(getPoint,'ExecOut',pointWait,'Input');

 const vehicleSplit=node('Expr_SplitVector',{Input:R(transform,'Vector')});
 const pointSplit=node('Expr_SplitVector',{Input:R(getPoint,'Value')});
 const deltaX=node('Expr_MathSubtract',{InputA:R(pointSplit,'X'),InputB:R(vehicleSplit,'X')});
 const deltaY=node('Expr_MathSubtract',{InputA:R(pointSplit,'Y'),InputB:R(vehicleSplit,'Y')});
 const flatDelta=node('Expr_MakeVector',{X:R(deltaX,'Output'),Y:R(deltaY,'Output'),Z:N(0)});
 const distance=node('Expr_VecMagnitude',{Input:R(flatDelta,'Output')});
 const arrived=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:R(arrivalRadius,'RER_Output')});
 const arrivalEdge=node('Expr_EdgeDetectorExec',{Input:R(arrived,'bOutput')});
 const plusOne=node('Expr_MathAdd',{InputA:R(index,'Value'),InputB:N(1)});
 const wrapped=node('Expr_MathModuloFloored',{InputA:R(plusOne,'Output'),InputB:N(4)});
 const setIndex=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(wrapped,'Output')});
 b.wire(arrivalEdge,'OnRisingEdge',setIndex,'Exec');

 const desiredRotation=node('Expr_DirectionToRotation',{Direction:R(flatDelta,'Output')});
 const desiredSplit=node('Expr_SplitRotation',{Input:R(desiredRotation,'Output')});
 const actualSplit=node('Expr_SplitRotation',{Input:R(transform,'Rotation')});
 const yawDifference=node('Expr_MathSubtract',{InputA:R(desiredSplit,'Yaw'),InputB:R(actualSplit,'Yaw')});
 const shifted=node('Expr_MathAdd',{InputA:R(yawDifference,'Output'),InputB:N(180)});
 const normalized=node('Expr_MathModuloFloored',{InputA:R(shifted,'Output'),InputB:N(360)});
 const centered=node('Expr_MathSubtract',{InputA:R(normalized,'Output'),InputB:N(180)});
 const proportional=node('Expr_MathDivide',{InputA:R(centered,'Output'),InputB:R(steeringRange,'RER_Output')});
 const clamped=node('Expr_MathClamp',{Input:R(proportional,'Output'),Min:N(-1),Max:N(1)});
 const signed=node('Expr_MathMultiply',{InputA:R(clamped,'Output'),InputB:R(steeringSign,'RER_Output')});
 const steering=node('Expr_Select',{InputA:N(0),InputB:R(signed,'Output'),bSelectB:R(enabled,'RER_Output')});
 const drive=node('Expr_Select',{InputA:N(0),InputB:R(throttle,'RER_Output'),bSelectB:R(enabled,'RER_Output')});

 const driveOut=node('MicrochipOutput',{PortLabel:'Drive',CallableDefault:N(0),CallableResult:N(0)});
 const steerOut=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)});
 const indexOut=node('MicrochipOutput',{PortLabel:'Current Point (1-4)',CallableDefault:N(1),CallableResult:N(1)});
 const targetOut=node('MicrochipOutput',{PortLabel:'Current Target Coordinate'});
 const distanceOut=node('MicrochipOutput',{PortLabel:'Distance To Target',CallableDefault:N(0),CallableResult:N(0)});
 b.wire(drive,'Output',driveOut,'RER_Input');
 b.wire(steering,'Output',steerOut,'RER_Input');
 b.wire(plusOne,'Output',indexOut,'RER_Input');
 b.wire(getPoint,'Value',targetOut,'RER_Input');
 b.wire(distance,'Output',distanceOut,'RER_Input');

 const labels=[
  ['EDIT THIS VECTOR ARRAY: entries 1, 2, 3, 4 are route points 1, 2, 3, 4. After point 4 it loops to point 1.',[25,85,45],-28],
  ['Wire Vehicle Grid from the vehicle. Drive and Steering go to its engine controls. Steering runs continuously while Enabled.',[30,60,90],-42],
  ['If it steers away from the target, change Steering Sign from +1 to -1. Arrival Radius is in Brickadia units (10 units = 1 block).',[85,55,25],-56]
 ];
 for(const [text,color,y] of labels)b.w.addBrick({asset:'PB_DefaultTile',size:[155,5,2],position:[145,y,2],color,components:[{type:C.TextDisplay.NAME,data:{Text:text,Font:0,Face:4,LineHeight:1.15,WidthScale:.62,bEnabled:true,Color:{R:245,G:250,B:255,A:255},bOverrideColor:true}}]},chip.grid);

 b.w.makePrefab({snap:10});
 const bytes=b.finish({x:190,y:190,z:10},'Standalone four-point vehicle route controller. Edit the single Vector Array in order; the target wraps 1 to 2 to 3 to 4 to 1.');
 return {bytes,gates:b.nodes.length,wires:b.edges.length};
}

module.exports=build;
if(require.main===module){
 const out=process.argv[2]||'prefabs/four-waypoint-vehicle-controller.brz';
 const result=build();fs.mkdirSync(require('path').dirname(out),{recursive:true});fs.writeFileSync(out,result.bytes);
 console.log(JSON.stringify({output:out,gates:result.gates,wires:result.wires,bytes:result.bytes.length},null,2));
}

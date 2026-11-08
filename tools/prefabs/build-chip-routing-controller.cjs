'use strict';
const fs=require('fs');
const path=require('path');
const {Build,C,N,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Vehicle Routing Chip');
 const chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175]});
 const c=b.circuit(chip.grid,'route');
 let i=0;
 const node=(kind,data={})=>c.n(kind,data,[(i%7)*48,Math.floor(i++/7)*48,2]);

 // Edit these four Vector entries in the chip. Array indices 0-3 represent route points 1-4.
 const points=node('ArrayVar',{Value:{$elementType:'Vector',$array:[
  {X:0,Y:0,Z:0},{X:500,Y:0,Z:0},{X:500,Y:500,Z:0},{X:0,Y:500,Z:0}
 ]}});
 const currentIndex=node('Var',{Value:N(0)});
 const arrivalRadius=node('Var',{Value:N(50)});
 const fullSteeringDegrees=node('Var',{Value:N(45)});
 const steeringSign=node('Var',{Value:N(1)});

 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:true});
 const ownTransform=node('Exec_GetOwnTransform');
 b.wire(clock,'Pulse',ownTransform,'Exec');
 const transformWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(ownTransform,'ExecOut',transformWait,'Input');
 const getPoint=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(currentIndex,'Value')});
 b.wire(transformWait,'Output',getPoint,'Exec');
 const pointWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 b.wire(getPoint,'ExecOut',pointWait,'Input');

 const ownPosition=node('Expr_SplitVector',{Input:R(ownTransform,'Location')});
 const targetPosition=node('Expr_SplitVector',{Input:R(getPoint,'Value')});
 const deltaX=node('Expr_MathSubtract',{InputA:R(targetPosition,'X'),InputB:R(ownPosition,'X')});
 const deltaY=node('Expr_MathSubtract',{InputA:R(targetPosition,'Y'),InputB:R(ownPosition,'Y')});
 const flatDelta=node('Expr_MakeVector',{X:R(deltaX,'Output'),Y:R(deltaY,'Output'),Z:N(0)});

 const distance=node('Expr_VecMagnitude',{Input:R(flatDelta,'Output')});
 const arrived=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:R(arrivalRadius,'Value')});
 const arrivalEdge=node('Expr_EdgeDetectorExec',{Input:R(arrived,'bOutput')});
 const plusOne=node('Expr_MathAdd',{InputA:R(currentIndex,'Value'),InputB:N(1)});
 const wrapped=node('Expr_MathModuloFloored',{InputA:R(plusOne,'Output'),InputB:N(4)});
 const setIndex=node('Exec_Var_Set',{VarRef:R(currentIndex,'VarRef'),Value:R(wrapped,'Output')});
 b.wire(arrivalEdge,'OnRisingEdge',setIndex,'Exec');

 const desiredRotation=node('Expr_DirectionToRotation',{Direction:R(flatDelta,'Output')});
 const desiredAngles=node('Expr_SplitRotation',{Input:R(desiredRotation,'Output')});
 const ownAngles=node('Expr_SplitRotation',{Input:R(ownTransform,'Rotation')});
 const rawError=node('Expr_MathSubtract',{InputA:R(desiredAngles,'Yaw'),InputB:R(ownAngles,'Yaw')});
 const shift=node('Expr_MathAdd',{InputA:R(rawError,'Output'),InputB:N(180)});
 const wrap=node('Expr_MathModuloFloored',{InputA:R(shift,'Output'),InputB:N(360)});
 const centered=node('Expr_MathSubtract',{InputA:R(wrap,'Output'),InputB:N(180)});
 const proportional=node('Expr_MathDivide',{InputA:R(centered,'Output'),InputB:R(fullSteeringDegrees,'Value')});
 const clamp=node('Expr_MathClamp',{Input:R(proportional,'Output'),Min:N(-1),Max:N(1)});
 const signed=node('Expr_MathMultiply',{InputA:R(clamp,'Output'),InputB:R(steeringSign,'Value')});
 const steeringOutput=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)});
 b.wire(signed,'Output',steeringOutput,'RER_Input');

 const labels=[
  ['EDIT VECTOR ARRAY: entries 1-4 are points 1-4. It loops from point 4 back to point 1.',[25,85,45],-28],
  ['TUNING VARS IN ORDER: Arrival Radius = 50; Full Steering Degrees = 45; Steering Sign = 1.',[30,60,90],-42],
  ['10 coordinate units = 1 block. If steering is reversed, change Steering Sign to -1.',[85,55,25],-56]
 ];
 for(const [text,color,y] of labels)b.w.addBrick({asset:'PB_DefaultTile',size:[155,5,2],position:[145,y,2],color,components:[{type:C.TextDisplay.NAME,data:{Text:text,Font:0,Face:4,LineHeight:1.15,WidthScale:.62,bEnabled:true,Color:{R:245,G:250,B:255,A:255},bOverrideColor:true}}]},chip.grid);

 b.w.makePrefab({snap:10});
 const bytes=b.finish({x:190,y:190,z:10},'Place this chip on the vehicle. It reads its own position and facing, routes through four editable coordinates, and exposes one Steering output.');
 return {bytes,gates:b.nodes.length,wires:b.edges.length};
}

module.exports=build;
if(require.main===module){const out=process.argv[2]||'prefabs/vehicle-routing-chip.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

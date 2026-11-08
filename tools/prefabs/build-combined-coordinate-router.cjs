'use strict';
const fs=require('fs'),path=require('path');
const {Build,N,B,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Combined Coordinate Recorder Router'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:30,Y:25,Z:0},collapsed:false}),c=b.circuit(chip.grid,'combined');
 let i=0;const node=(k,d={})=>{const pos=[(i%6)*10-25,Math.floor(i/6)*10-20,2];i++;return c.n(k,d,pos);};
 const points=node('ArrayVar',{Value:{$elementType:'Vector',$array:[]}}),index=node('Var',{Value:N(0)}),record=node('MicrochipInput',{PortLabel:'Record Coordinates',CallableDefault:B(false),CallableMirror:B(false)}),recordEdge=node('Expr_EdgeDetectorExec',{Input:R(record,'RER_Output')});
 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:true}),own=node('Exec_GetOwnTransform');b.wire(clock,'Pulse',own,'Exec');
 // Transform queries publish their value asynchronously. Recording therefore
 // uses a dedicated query and waits one tick before appending its Location.
 const recordOwn=node('Exec_GetOwnTransform');b.wire(recordEdge,'OnRisingEdge',recordOwn,'Exec');
 const recordWait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(recordOwn,'ExecOut',recordWait,'Input');
 const push=node('Exec_ArrayVar_Push',{ArrayVarRef:R(points,'ArrayVarRef'),Value:R(recordOwn,'Location')});b.wire(recordWait,'Output',push,'Exec');
 const length=node('Exec_ArrayVar_GetLength',{ArrayVarRef:R(points,'ArrayVarRef')});b.wire(own,'ExecOut',length,'Exec');
 const get=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'ArrayVarRef'),Index:R(index,'Value')});b.wire(length,'ExecOut',get,'Exec');
 const ownSplit=node('Expr_SplitVector',{Input:R(own,'Location')}),targetSplit=node('Expr_SplitVector',{Input:R(get,'Value')}),dx=node('Expr_MathSubtract',{InputA:R(targetSplit,'X'),InputB:R(ownSplit,'X')}),dy=node('Expr_MathSubtract',{InputA:R(targetSplit,'Y'),InputB:R(ownSplit,'Y')});
 const distance=node('Expr_VecDistance',{InputA:R(own,'Location'),InputB:R(get,'Value')}),arrived=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:N(50)}),arrivalEdge=node('Expr_EdgeDetectorExec',{Input:R(arrived,'bOutput')});
 const plus=node('Expr_MathAdd',{InputA:R(index,'Value'),InputB:N(1)}),wrapped=node('Expr_MathModuloFloored',{InputA:R(plus,'Output'),InputB:R(length,'Length')}),set=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(wrapped,'Output')});b.wire(arrivalEdge,'OnRisingEdge',set,'Exec');
 const radians=node('Expr_MathAtan2',{X:R(dx,'Output'),Y:R(dy,'Output')}),degrees=node('Expr_MathMultiply',{InputA:R(radians,'Output'),InputB:N(57.29577951308232)}),ownRotation=node('Expr_SplitRotation',{Input:R(own,'Rotation')}),raw=node('Expr_MathSubtract',{InputA:R(degrees,'Output'),InputB:R(ownRotation,'Yaw')}),shift=node('Expr_MathAdd',{InputA:R(raw,'Output'),InputB:N(180)}),angleWrap=node('Expr_MathModuloFloored',{InputA:R(shift,'Output'),InputB:N(360)}),center=node('Expr_MathSubtract',{InputA:R(angleWrap,'Output'),InputB:N(180)}),scale=node('Expr_MathDivide',{InputA:R(center,'Output'),InputB:N(45)}),out=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)});b.wire(scale,'Output',out,'RER_Input');
 if(i!==30)throw Error(`Expected 30 gates, got ${i}`);
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Records coordinates into an internal array and dynamically routes through every recorded point.');return {bytes,gates:i,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/combined-coordinate-router-generated.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

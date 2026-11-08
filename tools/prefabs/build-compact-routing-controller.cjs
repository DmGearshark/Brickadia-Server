'use strict';
const fs=require('fs'),path=require('path');
const {Build,C,N,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Compact Routing Chip'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:25,Y:25,Z:0},collapsed:false}),c=b.circuit(chip.grid,'compact');
 let i=0;const node=(k,d={})=>{const x=(i%5)*10-20,y=Math.floor(i/5)*10-20;i++;return c.n(k,d,[x,y,2]);};
 const points=node('MicrochipInput',{PortLabel:'Coordinate Array Ref'});
 const index=node('Var',{Value:N(0)});
 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:true});
 const own=node('Exec_GetOwnTransform');b.wire(clock,'Pulse',own,'Exec');
 const length=node('Exec_ArrayVar_GetLength',{ArrayVarRef:R(points,'RER_Output')});b.wire(own,'ExecOut',length,'Exec');
 const get=node('Exec_ArrayVar_Get',{ArrayVarRef:R(points,'RER_Output'),Index:R(index,'Value')});b.wire(length,'ExecOut',get,'Exec');
 const ownSplit=node('Expr_SplitVector',{Input:R(own,'Location')}),targetSplit=node('Expr_SplitVector',{Input:R(get,'Value')});
 const dx=node('Expr_MathSubtract',{InputA:R(targetSplit,'X'),InputB:R(ownSplit,'X')}),dy=node('Expr_MathSubtract',{InputA:R(targetSplit,'Y'),InputB:R(ownSplit,'Y')});
 const distance=node('Expr_VecDistance',{InputA:R(own,'Location'),InputB:R(get,'Value')});
 // Edit InputB=50 for arrival radius. 10 coordinate units equal one block.
 const arrived=node('Expr_CompareLessOrEqual',{InputA:R(distance,'Output'),InputB:N(50)}),edge=node('Expr_EdgeDetectorExec',{Input:R(arrived,'bOutput')});
 const plus=node('Expr_MathAdd',{InputA:R(index,'Value'),InputB:N(1)}),wrappedIndex=node('Expr_MathModuloFloored',{InputA:R(plus,'Output'),InputB:R(length,'Length')}),set=node('Exec_Var_Set',{VarRef:R(index,'VarRef'),Value:R(wrappedIndex,'Output')});b.wire(edge,'OnRisingEdge',set,'Exec');
 const radians=node('Expr_MathAtan2',{X:R(dx,'Output'),Y:R(dy,'Output')}),desiredDegrees=node('Expr_MathMultiply',{InputA:R(radians,'Output'),InputB:N(57.29577951308232)}),ownRotation=node('Expr_SplitRotation',{Input:R(own,'Rotation')});
 const raw=node('Expr_MathSubtract',{InputA:R(desiredDegrees,'Output'),InputB:R(ownRotation,'Yaw')}),shift=node('Expr_MathAdd',{InputA:R(raw,'Output'),InputB:N(180)}),wrap=node('Expr_MathModuloFloored',{InputA:R(shift,'Output'),InputB:N(360)}),center=node('Expr_MathSubtract',{InputA:R(wrap,'Output'),InputB:N(180)});
 // Edit InputB=45 for steering sensitivity; use -45 if steering is reversed.
 const scale=node('Expr_MathDivide',{InputA:R(center,'Output'),InputB:N(45)}),out=node('MicrochipOutput',{PortLabel:'Steering',CallableDefault:N(0),CallableResult:N(0)});b.wire(scale,'Output',out,'RER_Input');
 if(i!==25)throw Error(`Compact circuit must be exactly 25 gates, got ${i}`);
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Compact 5x5 four-waypoint steering circuit.');return {bytes,gates:i,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/compact-routing-generated.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,...r,bytes:r.bytes.length},null,2));}

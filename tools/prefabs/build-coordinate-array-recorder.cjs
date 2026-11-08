'use strict';
const fs=require('fs'),path=require('path');
const {Build,N,B,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Coordinate Array Recorder'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:25,Y:25,Z:0},collapsed:false}),c=b.circuit(chip.grid,'record');
 let i=0;const positions=[[-20,-20,2],[-10,-20,2],[0,-20,2],[10,-20,2],[20,-20,2],[-20,-10,2]];const node=(k,d={})=>c.n(k,d,positions[i++]);
 const array=node('MicrochipInput',{PortLabel:'Coordinate Array Ref'});
 const button=node('MicrochipInput',{PortLabel:'Record Coordinate',CallableDefault:B(false),CallableMirror:B(false)});
 const edge=node('Expr_EdgeDetectorExec',{Input:R(button,'RER_Output')});
 const own=node('Exec_GetOwnTransform');b.wire(edge,'OnRisingEdge',own,'Exec');
 const wait=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});b.wire(own,'ExecOut',wait,'Input');
 const push=node('Exec_ArrayVar_Push',{ArrayVarRef:R(array,'RER_Output'),Value:R(own,'Location')});b.wire(wait,'Output',push,'Exec');
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Wire a Vector Array reference and a button. Each rising button press appends the chip world position to the array.');return {bytes,gates:b.nodes.length,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/coordinate-array-recorder-generated.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

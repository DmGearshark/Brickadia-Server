'use strict';
const fs=require('fs'),path=require('path');
const {Build,C,N,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Current Transform Reader Outputs'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:25,Y:25,Z:0},collapsed:false}),c=b.circuit(chip.grid,'reader');
 let i=0;const positions=[[-20,-20,2],[-10,-20,2],[0,-20,2],[10,-20,2],[20,-20,2],[-20,-10,2]];const node=(k,d={})=>c.n(k,d,positions[i++]);
 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:true}),own=node('Exec_GetOwnTransform');b.wire(clock,'Pulse',own,'Exec');
 const split=node('Expr_SplitVector',{Input:R(own,'Location')});
 const x=node('MicrochipOutput',{PortLabel:'Current X',CallableDefault:N(0),CallableResult:N(0)}),y=node('MicrochipOutput',{PortLabel:'Current Y',CallableDefault:N(0),CallableResult:N(0)}),z=node('MicrochipOutput',{PortLabel:'Current Z',CallableDefault:N(0),CallableResult:N(0)});b.wire(split,'X',x,'RER_Input');b.wire(split,'Y',y,'RER_Input');b.wire(split,'Z',z,'RER_Input');
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Current-position reader with labeled X/Y/Z microchip outputs.');return {bytes,gates:b.nodes.length,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/transform-reader-generated.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

'use strict';
const fs=require('fs'),path=require('path');
const {Build,C,N,R}=require('./loadboard-lib.cjs');

function build(){
 const b=new Build('Current Transform Reader'),chip=b.w.addMicrochip({position:[0,0,2],color:[45,120,175],planeExtent:{X:25,Y:25,Z:0},collapsed:false}),c=b.circuit(chip.grid,'reader');
 let i=0;const positions=[[-20,-20,2],[-10,-20,2],[0,-20,2],[20,-20,2]];const node=(k,d={})=>c.n(k,d,positions[i++]);
 const clock=node('Clock',{IntervalSeconds:N(.1),bEnabled:true}),own=node('Exec_GetOwnTransform');b.wire(clock,'Pulse',own,'Exec');
 const split=node('Expr_SplitVector',{Input:R(own,'Location')}),format=node('Expr_String_FormatText',{FormatString:'X: {A}\r\nY: {B}\r\nZ: {C}',InputA:R(split,'X'),InputB:R(split,'Y'),InputC:R(split,'Z')});
 const display={id:'reader_display',type:C.TextDisplay.NAME,data:{Text:'Waiting for transform...',Font:0,Face:4,LineHeight:1.2,WidthScale:.7,bEnabled:true,Color:{R:255,G:255,B:255,A:255},bOverrideColor:true},pos:[0,10,2],grid:chip.grid};b.add(display,{asset:'PB_DefaultTile',size:[20,5,2],position:display.pos,color:[25,60,90],components:[{type:display.type,data:display.data}]},chip.grid);b.wire(format,'Output',display,'Text');
 b.w.makePrefab({isMicrochipPrefab:true});const bytes=b.finish({x:5,y:5,z:2},'Current-position reader with X/Y/Z outputs and an internal display.');return {bytes,gates:b.nodes.length,wires:b.edges.length};
}
module.exports=build;if(require.main===module){const out=process.argv[2]||'prefabs/transform-reader-generated.brz',r=build();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gates:r.gates,wires:r.wires,bytes:r.bytes.length},null,2));}

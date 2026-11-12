'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N}=require('./loadboard-lib.cjs');
function one(xs,label){assert.equal(xs.length,1,`Expected one ${label}, found ${xs.length}`);return xs[0];}
function build(input){
 const donor=fs.readFileSync(input),scene=read(donor),link=one(scene.links,'chip link'),grid=link.grid;
 const display=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'display');
 const splitterBrick=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.InputSplitter.NAME)),'seat control splitter');
 assert.equal(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Button.NAME)).length,0,'no buttons');
 const nodes=[];let seq=0;
 function node(kind,data={}){const def=C[kind];assert(def,kind);const i=seq++,brick={key:`wasd-menu:${i}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[(i%8)*48,Math.floor(i/8)*48+48,2],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(brick);const n={key:brick.key,type:def.NAME};nodes.push(n);return n;}
 const splitter={key:splitterBrick.key,type:C.InputSplitter.NAME},out={key:display.key,type:C.TextDisplay.NAME};
 function wire(a,p,z,q){assert(Object.values(C).find(c=>c.NAME===a.type)?.PORTS[p],`${a.type}.${p}`);assert(Object.values(C).find(c=>c.NAME===z.type)?.PORTS[q],`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`Duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 function unary(kind,a,ap,data={}){const n=node(kind,data);wire(a,ap,n,Object.keys(C[kind].PORTS).find(p=>['Input','InputA'].includes(p)));return n;}
 function math(kind,a,ap,data={}){const n=node('Expr_Math'+kind,data);wire(a,ap,n,'InputA');return n;}
 const selection=node('Var',{Value:N(0)}),counts=Array.from({length:4},()=>node('Var',{Value:N(0)}));
 function setVar(variable,valueNode,valuePort,execNode,execPort){const set=node('Exec_Var_Set',{Value:N(0),bChangeType:false});wire(variable,'VarRef',set,'VarRef');wire(valueNode,valuePort,set,'Value');wire(execNode,execPort,set,'Exec');return set;}
 function directional(inputPort,compareKind,threshold,valueNode,valuePort){const cmp=node('Expr_Compare'+compareKind,{InputB:N(threshold)});wire(splitter,inputPort,cmp,'InputA');const edge=node('Expr_EdgeDetectorExec',{Input:0,InputLast:0,bSeeded:true});wire(cmp,'bOutput',edge,'Input');setVar(selection,valueNode,valuePort,edge,'OnRisingEdge');}

 const minusTwo=math('Subtract',selection,'Value',{InputB:N(2)}),plusTwo=math('Add',selection,'Value',{InputB:N(2)});
 const topHalf=node('Expr_CompareLess',{InputB:N(2)});wire(selection,'Value',topHalf,'InputA');
 const upValue=node('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:false});wire(selection,'Value',upValue,'InputA');wire(minusTwo,'Output',upValue,'InputB');
 const bottomHalf=node('Expr_CompareGreaterOrEqual',{InputB:N(2)});wire(selection,'Value',bottomHalf,'InputA');wire(bottomHalf,'bOutput',upValue,'bSelectB');
 const downValue=node('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:false});wire(selection,'Value',downValue,'InputA');wire(plusTwo,'Output',downValue,'InputB');wire(topHalf,'bOutput',downValue,'bSelectB');
 const mod=node('Expr_MathModuloFloored',{InputB:N(2)});wire(selection,'Value',mod,'InputA');
 const isOdd=node('Expr_CompareEqual',{InputB:N(1)});wire(mod,'Output',isOdd,'InputA');const isEven=node('Expr_CompareEqual',{InputB:N(0)});wire(mod,'Output',isEven,'InputA');
 const minusOne=math('Subtract',selection,'Value',{InputB:N(1)}),plusOne=math('Add',selection,'Value',{InputB:N(1)});
 const leftValue=node('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:false});wire(selection,'Value',leftValue,'InputA');wire(minusOne,'Output',leftValue,'InputB');wire(isOdd,'bOutput',leftValue,'bSelectB');
 const rightValue=node('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:false});wire(selection,'Value',rightValue,'InputA');wire(plusOne,'Output',rightValue,'InputB');wire(isEven,'bOutput',rightValue,'bSelectB');
 directional('InputForward','Greater',.5,upValue,'Output');directional('InputForward','Less',-.5,downValue,'Output');directional('InputRight','Less',-.5,leftValue,'Output');directional('InputRight','Greater',.5,rightValue,'Output');

 const spaceCmp=node('Expr_CompareGreater',{InputB:N(.5)});wire(splitter,'InputUp',spaceCmp,'InputA');const spaceEdge=node('Expr_EdgeDetectorExec',{Input:0,InputLast:0,bSeeded:true});wire(spaceCmp,'bOutput',spaceEdge,'Input');
 counts.forEach((counter,i)=>{const eq=node('Expr_CompareEqual',{InputB:N(i)});wire(selection,'Value',eq,'InputA');const branch=node('Exec_Branch',{bCond:false});wire(eq,'bOutput',branch,'bCond');wire(spaceEdge,'OnRisingEdge',branch,'Exec');const inc=math('Add',counter,'Value',{InputB:N(1)});setVar(counter,inc,'Output',branch,'ExecOutA');});

 const templates=[
  'WASD: MOVE     SPACE: ACTIVATE\r\n\r\n> 🍪 COOKIE <          ⚙ FACTORY\r\n   Activated: {A}          Activated: {B}\r\n\r\n  💎 MINE              ⭐ RESEARCH\r\n   Activated: {C}          Activated: {D}',
  'WASD: MOVE     SPACE: ACTIVATE\r\n\r\n  🍪 COOKIE          > ⚙ FACTORY <\r\n   Activated: {A}          Activated: {B}\r\n\r\n  💎 MINE              ⭐ RESEARCH\r\n   Activated: {C}          Activated: {D}',
  'WASD: MOVE     SPACE: ACTIVATE\r\n\r\n  🍪 COOKIE             ⚙ FACTORY\r\n   Activated: {A}          Activated: {B}\r\n\r\n> 💎 MINE <            ⭐ RESEARCH\r\n   Activated: {C}          Activated: {D}',
  'WASD: MOVE     SPACE: ACTIVATE\r\n\r\n  🍪 COOKIE             ⚙ FACTORY\r\n   Activated: {A}          Activated: {B}\r\n\r\n  💎 MINE            > ⭐ RESEARCH <\r\n   Activated: {C}          Activated: {D}'
 ];
 const arr=node('ArrayVar',{Value:{$elementType:'str',$array:templates}}),get=node('Exec_ArrayVar_Get',{Index:0,Value:{$variant:'str',value:templates[0]}}),clock=node('Clock',{IntervalSeconds:.05,bEnabled:true});wire(arr,'ArrayVarRef',get,'ArrayVarRef');wire(selection,'Value',get,'Index');wire(clock,'Pulse',get,'Exec');
 const format=node('Expr_String_FormatText',{FormatString:templates[0]});wire(get,'Value',format,'FormatString');counts.forEach((c,i)=>wire(c,'Value',format,`Input${String.fromCharCode(65+i)}`));wire(format,'Output',out,'Text');
 const dc=display.comps.find(c=>c.type===C.TextDisplay.NAME);dc.data.Text=templates[0].replaceAll('{A}','0').replaceAll('{B}','0').replaceAll('{C}','0').replaceAll('{D}','0');dc.data.Kerning=0;dc.data.LineHeight=1.5;dc.data.WidthScale=.8;dc.data.LineOffset=0;dc.data.Anchor={X:0,Y:0};dc.data.Offset={X:1,Y:-1,Z:0};
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'chip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:168,Y:120,Z:2},PlaneExtent:{X:210,Y:155,Z:8}}}]]);
 const name='Monitor Frame - WASD Space Menu Demo V1',description='Seat-controlled four-item menu: WASD changes the > selected item < and Space activates its counter; no buttons.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,buttons:0,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-wasd-menu-demo.cjs input.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bytes:r.bytes.length,...r.summary,strictPlacement:r.placement.strictOk,warnings:r.placement.warnings||[]},null,2));}

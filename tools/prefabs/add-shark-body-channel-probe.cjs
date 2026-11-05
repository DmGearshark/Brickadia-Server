'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {C, N} = require('./loadboard-lib.cjs');

const INPUT = '/workspace/attachments/29a059c5-2941-45a1-bddf-4ba3f71f998e/Shark Tail Updated to use crouch.brz';
function one(scene, type, predicate = () => true) {
  const found = scene.bricks.flatMap(brick => brick.comps.filter(comp => comp.type === type && predicate(brick, comp)).map(comp => ({brick, comp, key: brick.key, type: comp.type})));
  assert.equal(found.length, 1, `Expected one ${type}, found ${found.length}`);
  return found[0];
}
function build(input = INPUT) {
  const original = read(fs.readFileSync(input)), scene = read(fs.readFileSync(input));
  const getLocation = one(scene, C.Exec_Entity_GetLocation.NAME);
  const sweepTemplate = one(scene, C.Exec_Sweep.NAME);
  const addTemplate = one(scene, C.Expr_MathAdd.NAME, (_b, c) => c.data.InputA?.$variant === 'Vector' && c.data.InputB?.value?.Z === 20);
  const formatTemplate = one(scene, C.Expr_String_FormatText.NAME);
  const displayBrick = scene.bricks.find(brick => brick.g === getLocation.brick.g && brick.comps.some(comp => comp.type === C.TextDisplay.NAME));
  assert(displayBrick);
  const display = displayBrick.comps.find(comp => comp.type === C.TextDisplay.NAME);
  const grid = getLocation.brick.g, created = [];
  function node(template, suffix, position, data) {
    const brick = {key:`body-channel:${suffix}`,g:grid,data:{...structuredClone(template.brick.data),position,direction:4,rotation:0,color:[205,65,180]},comps:[{type:template.type,data:{...structuredClone(template.comp.data),...data}}]};
    scene.bricks.push(brick);const n={key:brick.key,type:template.type,brick,comp:brick.comps[0]};created.push(n);return n;
  }
  function wire(a,p,z,q){assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q));scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
  const origin=node(addTemplate,'origin',[180,20,2],{InputB:{$variant:'Vector',value:{X:-30,Y:0,Z:20}}});
  wire(getLocation,'Vector',origin,'InputA');
  const sweeps=[];
  for(let channel=0;channel<=8;channel++){
    const sweep=node(sweepTemplate,`channel-${channel}`,[180+channel*30,60,2],{
      Direction:{X:1,Y:0,Z:0},Distance:60,Radius:0,bRelative:false,bIgnoreOwningGrid:true,CollisionChannel:channel,
      bDetectBricks:false,bDetectPlayers1:true,bDetectPlayers2:true,bDetectPlayers3:true,bDetectPlayers4:true,
      bOnlyHitPlayerBodyParts:true,bDetectPhysics:false,bDetectMap:false,
    });
    wire(origin,'Output',sweep,'Origin');
    if(channel===0)wire(getLocation,'ExecOut',sweep,'Exec');else wire(sweeps.at(-1),'ExecOut',sweep,'Exec');
    sweeps.push(sweep);
  }
  const control=node(sweepTemplate,'capsule-control',[450,60,2],{
    Direction:{X:1,Y:0,Z:0},Distance:60,Radius:0,bRelative:false,bIgnoreOwningGrid:true,CollisionChannel:8,
    bDetectBricks:false,bDetectPlayers1:true,bDetectPlayers2:true,bDetectPlayers3:true,bDetectPlayers4:true,
    bOnlyHitPlayerBodyParts:false,bDetectPhysics:false,bDetectMap:false,
  });
  wire(origin,'Output',control,'Origin');wire(sweeps.at(-1),'ExecOut',control,'Exec');
  const format=node(formatTemplate,'report',[300,120,2],{
    FormatString:'BODY COLLISION CHANNEL TEST\\nValues below 60 mean HIT.\\nPhysics 0: {A}  Weapon 1: {B}\\nInteract 2: {C} Tool 3: {D}\\nPlayer1 4: {E} Player2 5: {F}\\nPlayer3 6: {G}\\nChannels 7, 8 and capsule control are saved in their gates.',
    InputA:N(60),InputB:N(60),InputC:N(60),InputD:N(60),InputE:N(60),InputF:N(60),InputG:N(60),
  });
  sweeps.slice(0,7).forEach((sweep,i)=>wire(sweep,'HitDistance',format,`Input${String.fromCharCode(65+i)}`));
  wire(format,'Output',{key:displayBrick.key,type:C.TextDisplay.NAME},'Text');
  display.Text='BODY COLLISION CHANNEL TEST';display.LineHeight=1.05;display.LineOffset=0;display.WidthScale=.68;display.Offset={X:0,Y:0,Z:0};display.bEnabled=true;display.bForeground=true;
  const embedded=scene.r.prefabPaths().map(path=>scene.r.readPrefab(path)),out=write(scene,{embedded,name:'Shark Tail - Body Collision Channel Probe'}),reread=read(out.bytes);
  assert.equal(reread.bricks.length,original.bricks.length+12);assert.equal(reread.edges.length,original.edges.length+29);assert.equal(reread.links.length,original.links.length);
  return {bytes:out.bytes,original,scene:reread,created};
}
module.exports=build;
if(require.main===module){const [input=INPUT,output='prefabs/shark-tail-body-collision-channel-probe.brz']=process.argv.slice(2),r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bodyPartChannels:9,capsuleControl:1,addedGates:r.created.length},null,2));}

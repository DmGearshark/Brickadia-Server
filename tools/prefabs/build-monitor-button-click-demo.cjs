'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C}=require('./loadboard-lib.cjs');
function one(xs,label){assert.equal(xs.length,1,`Expected one ${label}, found ${xs.length}`);return xs[0];}
function build(input){
 const donor=fs.readFileSync(input),scene=read(donor),link=one(scene.links,'chip link'),grid=link.grid;
 const display=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'display');
 const all=scene.bricks.filter(b=>b.comps.some(c=>c.type===C.Button.NAME));assert.equal(all.length,63);
 function at(x,z){return one(all.filter(b=>b.data.position[0]===x&&b.data.position[2]===z),`button ${x},${z}`);}
 const chosen=[
  {brick:at(6112,11014),label:'Cookie'},
  {brick:at(6136,11014),label:'Machine'},
  {brick:at(6112,10998),label:'Gem'},
  {brick:at(6136,10998),label:'Star'}
 ];
 const selected=new Set(chosen.map(x=>x.brick.key));
 for(const brick of all){
  if(!selected.has(brick.key))continue;
  const spec=chosen.find(x=>x.brick===brick),comp=brick.comps.find(c=>c.type===C.Button.NAME);
  // Keep the supplied 7x9 interaction grid intact. Only these four existing
  // buttons receive demo labels and wires; the other 59 remain untouched.
  brick.data.collision.interaction=true;
  comp.data.bAllowNearbyInteraction=true;comp.data.bHiddenInteraction=false;comp.data.PromptCustomLabel=`Click ${spec.label}`;
 }
 const def=C.Expr_String_FormatText,gate={key:'button-demo:format',g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[0,0,2],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data:{FormatString:'🍪  {A}                 ⚙  {B}\r\n\r\n\r\n\r\n💎  {C}                 ⭐  {D}'}}]};scene.bricks.push(gate);
 function wire(a,p,z,q){scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 chosen.forEach((x,i)=>wire({key:x.brick.key,type:C.Button.NAME},'PressCount',{key:gate.key,type:def.NAME},`Input${String.fromCharCode(65+i)}`));
 wire({key:gate.key,type:def.NAME},'Output',{key:display.key,type:C.TextDisplay.NAME},'Text');
 const dc=display.comps.find(c=>c.type===C.TextDisplay.NAME);dc.data.Text='🍪  0                 ⚙  0\r\n\r\n\r\n\r\n💎  0                 ⭐  0';dc.data.Kerning=1;dc.data.LineHeight=2.25;dc.data.WidthScale=.85;dc.data.Anchor={X:.5,Y:.5};
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'chip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:0,Y:0,Z:2},PlaneExtent:{X:80,Y:50,Z:8}}}]]);
 const name='Monitor Frame - Four Button Emoji Demo V3',description='Four existing buttons in the intact 7x9 grid update independent emoji counters without raycasts or cursor logic.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));
 return {bytes,placement,summary:{bricks:scene.bricks.length,wires:scene.edges.length,activeButtons:4,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-button-click-demo.cjs input.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bytes:r.bytes.length,...r.summary,strictPlacement:r.placement.strictOk,warnings:r.placement.warnings||[]},null,2));}

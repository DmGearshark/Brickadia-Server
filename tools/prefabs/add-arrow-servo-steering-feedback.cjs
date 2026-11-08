'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const {C,N}=require('./loadboard-lib.cjs');

const INPUT='Arrow Servo Current Angle (Internal)';
function build(inputPath){
 const donor=fs.readFileSync(inputPath),scene=read(donor);
 const original={bricks:scene.bricks.length,edges:scene.edges.length,links:scene.links.length,joints:scene.joints.length};
 const routeLink=scene.links.find(l=>scene.bricks.some(b=>b.g===l.grid&&b.comps.some(c=>c.data.PortLabel==='Arrow pointing to next Waypoint')));assert(routeLink,'Route chip');
 const grid=routeLink.grid,route=scene.bricks.filter(b=>b.g===grid);
 const one=(items,label)=>{assert.equal(items.length,1,label);return items[0];};
 const servo=one(scene.bricks.filter(b=>b.comps.some(c=>c.type==='Component_Internal_Servo')),'one arrow servo');
 const centered=one(route.filter(b=>b.comps.some(c=>c.type===C.Expr_MathSubtract.NAME)&&b.data.position[0]===20&&b.data.position[1]===25),'centered heading error');
 const divide=one(route.filter(b=>b.comps.some(c=>c.type===C.Expr_MathDivide.NAME)&&b.data.position[0]===35&&b.data.position[1]===25),'steering divide');
 const absolute=one(route.filter(b=>b.comps.some(c=>c.type===C.Expr_MathAbs.NAME)&&b.data.position[0]===-10&&b.data.position[1]===10),'steering absolute error');
 const removed=scene.edges.filter(e=>e.a===centered.key&&((e.z===divide.key&&e.q==='InputA')||(e.z===absolute.key&&e.q==='Input')));assert.equal(removed.length,2,'two centered-error steering inputs');
 scene.edges=scene.edges.filter(e=>!removed.includes(e));
 const collision={player:false,weapon:false,interaction:false,tool:true,physics:false};
 const angleInput={key:'arrow-feedback:input',g:grid,data:{asset:C.MicrochipInput.BRICK,material:'BMC_Plastic',position:[-15,-115,2],size:[0,0,0],direction:4,rotation:0,collision,visibility:true,material_intensity:0,color:[65,125,185],owner_index:0},comps:[{type:C.MicrochipInput.NAME,data:{PortLabel:INPUT,PortOrder:6,CallableDefault:N(0),CallableMirror:N(0)}}]};
 const invert={key:'arrow-feedback:invert',g:grid,data:{asset:C.Expr_MathMultiply.BRICK,material:'BMC_Plastic',position:[-30,65,2],size:[0,0,0],direction:4,rotation:0,collision,visibility:true,material_intensity:0,color:[210,125,45],owner_index:0},comps:[{type:C.Expr_MathMultiply.NAME,data:{InputA:N(-1),InputB:N(0)}}]};
 scene.bricks.push(angleInput,invert);
 const add=(a,at,p,z,zt,q)=>{assert(!scene.edges.some(e=>e.z===z.key&&e.zt===zt&&e.q===q),`duplicate ${zt}.${q}`);scene.edges.push({a:a.key,at,p,z:z.key,zt,q});};
 add(servo,'Component_Internal_Servo','CurrentAngle',angleInput,C.MicrochipInput.NAME,'RER_Input');
 add(angleInput,C.MicrochipInput.NAME,'RER_Output',invert,C.Expr_MathMultiply.NAME,'InputB');
 add(invert,C.Expr_MathMultiply.NAME,'Output',divide,C.Expr_MathDivide.NAME,'InputA');
 add(invert,C.Expr_MathMultiply.NAME,'Output',absolute,C.Expr_MathAbs.NAME,'Input');
 assert.equal(scene.bricks.length,original.bricks+2);assert.equal(scene.edges.length,original.edges+2);
 const generated=write(scene,{name:'Vehicle - Arrow Smoothed Steering',description:'Waypoint wheels use the physical arrow servo current angle as their smoothed steering error.'}).bytes;
 const bytes=repack(generated,donor,{name:'Vehicle - Arrow Smoothed Steering',description:'Waypoint wheels use the physical arrow servo current angle as their smoothed steering error.'});
 return {bytes,original,grid};
}
module.exports=build;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node add-arrow-servo-steering-feedback.cjs input.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,grid:r.grid,original:r.original,bytes:r.bytes.length},null,2));}

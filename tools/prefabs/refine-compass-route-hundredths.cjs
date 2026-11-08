'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const {C,N}=require('./loadboard-lib.cjs');
function refine(input){
 const donor=fs.readFileSync(input),scene=read(donor);
 const link=scene.links.find(l=>scene.bricks.some(br=>br.g===l.grid&&br.comps.some(c=>c.data.PortLabel==='Has Hit a Waypoint Pulse')));assert(link,'Route chip with waypoint pulse output');
 const grid=link.grid,bricks=scene.bricks.filter(br=>br.g===grid),at=(position,type)=>{const hits=bricks.filter(br=>br.data.position.join()===position&&br.comps.some(c=>c.type===type));assert.equal(hits.length,1,`${position} ${type}`);return hits[0];};
 const divide=at('35,25,2',C.Expr_MathDivide.NAME),round=at('50,25,2',C.Expr_Round.NAME),clamp=at('-55,10,2',C.Expr_MathClamp.NAME),scale=at('-25,10,2',C.Expr_MathMultiply.NAME),arrival=at('20,-55,2',C.Exec_Branch.NAME);
 const pulse=bricks.find(br=>br.comps.some(c=>c.type===C.MicrochipOutput.NAME&&c.data.PortLabel==='Has Hit a Waypoint Pulse'));assert(pulse,'Waypoint pulse output');
 const divideComp=divide.comps.find(c=>c.type===C.Expr_MathDivide.NAME),clampComp=clamp.comps.find(c=>c.type===C.Expr_MathClamp.NAME),scaleComp=scale.comps.find(c=>c.type===C.Expr_MathMultiply.NAME);
 assert(scene.edges.some(e=>e.a===divide.key&&e.p==='Output'&&e.z===round.key&&e.q==='Input'),'Divide feeds steering round');
 assert(scene.edges.some(e=>e.a===round.key&&e.p==='Output'&&e.z===clamp.key&&e.q==='Input'),'Round feeds steering clamp');
 divideComp.data.InputB=N(1);clampComp.data.Min=N(-100);clampComp.data.Max=N(100);scaleComp.data.InputB=N(0.01);
 assert(!scene.edges.some(e=>e.z===pulse.key&&e.zt===C.MicrochipOutput.NAME&&e.q==='RER_Input'),'Pulse output already driven');
 scene.edges.push({a:arrival.key,at:C.Exec_Branch.NAME,p:'ExecOutA',z:pulse.key,zt:C.MicrochipOutput.NAME,q:'RER_Input'});
 const generated=write(scene,{name:'Vehicle - Compass Route Hundredth Steering',description:'Fully working compass route with 0.01 steering increments and a one-shot waypoint arrival pulse.'}).bytes;
 const bytes=repack(generated,donor,{name:'Vehicle - Compass Route Hundredth Steering',description:'Fully working compass route with 0.01 steering increments and a one-shot waypoint arrival pulse.'});return {bytes,grid};
}
module.exports=refine;if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node refine-compass-route-hundredths.cjs input.brz output.brz');const r=refine(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,grid:r.grid,bytes:r.bytes.length},null,2));}

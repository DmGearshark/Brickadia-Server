'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const {C,N}=require('./loadboard-lib.cjs');
const OUTPUT='BrickComponentType_Internal_MicrochipOutput';
function update(input){
 const donor=fs.readFileSync(input),scene=read(donor);
 const link=scene.links.find(l=>scene.bricks.some(br=>br.g===l.grid&&br.comps.some(c=>c.data.PortLabel==='Has Hit a Waypoint Pulse')));assert(link,'Route chip with waypoint pulse output');
 const grid=link.grid,bricks=scene.bricks.filter(br=>br.g===grid);
 const at=(pos,type)=>{const hits=bricks.filter(br=>br.data.position.join()===pos&&br.comps.some(c=>c.type===type));assert.equal(hits.length,1,`${type} at ${pos}`);return hits[0];};
 const component=(br,type)=>{const c=br.comps.find(c=>c.type===type);assert(c,type);return c;};
 const divide=at('35,25,2',C.Expr_MathDivide.NAME),clamp=at('-55,10,2',C.Expr_MathClamp.NAME),scale=at('-25,10,2',C.Expr_MathMultiply.NAME);
 component(divide,C.Expr_MathDivide.NAME).data.InputB=N(1);
 Object.assign(component(clamp,C.Expr_MathClamp.NAME).data,{Min:N(-100),Max:N(100)});
 component(scale,C.Expr_MathMultiply.NAME).data.InputB=N(0.01);
 const arrivalBranch=at('20,-55,2',C.Exec_Branch.NAME),arrivalCompare=at('5,-55,2',C.Expr_CompareLessOrEqual.NAME);
 const pulseHits=bricks.filter(br=>br.comps.some(c=>c.type===OUTPUT&&c.data.PortLabel==='Has Hit a Waypoint Pulse'));assert.equal(pulseHits.length,1,'Pulse output');const pulse=pulseHits[0];
 assert(!scene.edges.some(e=>e.z===pulse.key&&e.zt===OUTPUT&&e.q==='RER_Input'),'Pulse output already driven');
 scene.edges.push({a:arrivalBranch.key,at:C.Exec_Branch.NAME,p:'ExecOutA',z:pulse.key,zt:OUTPUT,q:'RER_Input'});
 const radiusHits=bricks.filter(br=>br.comps.some(c=>c.type===C.Var.NAME&&c.data.Value?.$variant==='f64'&&c.data.Value.value===75)&&br.comps.some(c=>c.type===C.TextDisplay.NAME&&c.data.Text==='Waypoint Radius control'));assert.equal(radiusHits.length,1,'Labeled waypoint radius variable');const radius=radiusHits[0];
 const oldRadius=scene.edges.filter(e=>e.z===arrivalCompare.key&&e.zt===C.Expr_CompareLessOrEqual.NAME&&e.q==='InputB');assert.equal(oldRadius.length,1,'Existing arrival radius driver');scene.edges=scene.edges.filter(e=>e!==oldRadius[0]);scene.edges.push({a:radius.key,at:C.Var.NAME,p:'Value',z:arrivalCompare.key,zt:C.Expr_CompareLessOrEqual.NAME,q:'InputB'});
 const generated=write(scene,{name:'Vehicle - Compass Route 0.01 Steering',description:'Fully working compass route with 0.01 steering increments, adjustable waypoint radius, and a one-shot waypoint-arrival pulse.'}).bytes;
 const bytes=repack(generated,donor,{name:'Vehicle - Compass Route 0.01 Steering',description:'Fully working compass route with 0.01 steering increments, adjustable waypoint radius, and a one-shot waypoint-arrival pulse.'});
 return {bytes,grid,removedRadiusSource:oldRadius[0].a,radiusKey:radius.key,pulseKey:pulse.key};
}
module.exports=update;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node update-route-resolution-radius-pulse.cjs input.brz output.brz');const r=update(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,grid:r.grid,bytes:r.bytes.length},null,2));}

'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const {C,N,B}=require('./loadboard-lib.cjs');
function add(input){
 const donor=fs.readFileSync(input),scene=read(donor);
 const link=scene.links.find(l=>scene.bricks.some(br=>br.g===l.grid&&br.comps.some(c=>c.data.PortLabel==='Compass Bearing Current Angle')));assert(link,'Compass controller chip');
 const grid=link.grid,bricks=scene.bricks.filter(br=>br.g===grid);
 const pin=label=>{const hits=bricks.filter(br=>br.comps.some(c=>c.data.PortLabel===label));assert.equal(hits.length,1,label);return hits[0];};
 const compass=pin('Compass Bearing Current Angle'),steering=pin('Steering');
 const compassComp=compass.comps.find(c=>c.data.PortLabel==='Compass Bearing Current Angle');compassComp.data.CallableDefault=N(0);compassComp.data.CallableMirror=N(0);
 let id=0;
 function gate(kind,data,position,color=[55,90,135]){const def=C[kind];assert(def,kind);const br={key:`compass-hold:${id++}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position,size:[0,0,0],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:true,material_intensity:0,color,owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(br);return br;}
 function wire(a,kindA,port,z,kindZ,inputPort){const at=C[kindA].NAME,zt=C[kindZ]?.NAME||kindZ;assert(!scene.edges.some(e=>e.z===z.key&&e.zt===zt&&e.q===inputPort),`Duplicate ${zt}.${inputPort}`);scene.edges.push({a:a.key,at,p:port,z:z.key,zt,q:inputPort});}
 const desired=gate('Var',{Value:N(0)},[-55,25,2],[45,190,95]);
 const sign=gate('Var',{Value:N(1)},[-40,25,2],[210,125,45]);
 const raw=gate('Expr_MathSubtract',{InputA:N(0),InputB:N(0)},[-25,25,2]);wire(desired,'Var','Value',raw,'Expr_MathSubtract','InputA');scene.edges.push({a:compass.key,at:compassComp.type,p:'RER_Output',z:raw.key,zt:C.Expr_MathSubtract.NAME,q:'InputB'});
 const shifted=gate('Expr_MathAdd',{InputA:N(0),InputB:N(180)},[-10,25,2]);wire(raw,'Expr_MathSubtract','Output',shifted,'Expr_MathAdd','InputA');
 const wrapped=gate('Expr_MathModuloFloored',{InputA:N(0),InputB:N(360)},[5,25,2]);wire(shifted,'Expr_MathAdd','Output',wrapped,'Expr_MathModuloFloored','InputA');
 const centered=gate('Expr_MathSubtract',{InputA:N(0),InputB:N(180)},[20,25,2]);wire(wrapped,'Expr_MathModuloFloored','Output',centered,'Expr_MathSubtract','InputA');
 const proportional=gate('Expr_MathDivide',{InputA:N(0),InputB:N(10)},[35,25,2]);wire(centered,'Expr_MathSubtract','Output',proportional,'Expr_MathDivide','InputA');
 const rounded=gate('Expr_Round',{Input:N(0)},[50,25,2]);wire(proportional,'Expr_MathDivide','Output',rounded,'Expr_Round','Input');
 const limited=gate('Expr_MathClamp',{Input:N(0),Min:N(-10),Max:N(10)},[-55,10,2]);wire(rounded,'Expr_Round','Output',limited,'Expr_MathClamp','Input');
 const signed=gate('Expr_MathMultiply',{InputA:N(0),InputB:N(0)},[-40,10,2]);wire(limited,'Expr_MathClamp','Output',signed,'Expr_MathMultiply','InputA');wire(sign,'Var','Value',signed,'Expr_MathMultiply','InputB');
 const scaled=gate('Expr_MathMultiply',{InputA:N(0),InputB:N(0.1)},[-25,10,2]);wire(signed,'Expr_MathMultiply','Output',scaled,'Expr_MathMultiply','InputA');
 const absolute=gate('Expr_MathAbs',{Input:N(0)},[-10,10,2]);wire(centered,'Expr_MathSubtract','Output',absolute,'Expr_MathAbs','Input');
 const outside=gate('Expr_CompareGreater',{InputA:N(0),InputB:N(5)},[5,10,2]);wire(absolute,'Expr_MathAbs','Output',outside,'Expr_CompareGreater','InputA');
 const select=gate('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:B(false)},[20,10,2]);wire(scaled,'Expr_MathMultiply','Output',select,'Expr_Select','InputB');wire(outside,'Expr_CompareGreater','bOutput',select,'Expr_Select','bSelectB');
 assert(!scene.edges.some(e=>e.z===steering.key&&e.zt==='BrickComponentType_Internal_MicrochipOutput'&&e.q==='RER_Input'),'Steering already driven');scene.edges.push({a:select.key,at:C.Expr_Select.NAME,p:'Output',z:steering.key,zt:'BrickComponentType_Internal_MicrochipOutput',q:'RER_Input'});
 const generated=write(scene,{name:'Vehicle - Compass Heading Hold 0.1 Steps',description:'Continuous compass heading controller using the full steering range in signed 0.1 steps.'}).bytes,bytes=repack(generated,donor,{name:'Vehicle - Compass Heading Hold 0.1 Steps',description:'Continuous compass heading controller using the full steering range in signed 0.1 steps.'});return {bytes,added:id,grid};
}
module.exports=add;if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node add-compass-heading-hold.cjs input.brz output.brz');const r=add(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,addedGates:r.added,grid:r.grid,bytes:r.bytes.length},null,2));}

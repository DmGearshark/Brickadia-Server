'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const buildBrain=require('./build-fresh-dynamic-route-brain.cjs');
const T={microchip:'Component_Internal_Microchip',input:'BrickComponentType_Internal_MicrochipInput',output:'BrickComponentType_Internal_MicrochipOutput',readGrid:'BrickComponentType_Internal_ReadBrickGrid'};

function component(brick,type){return brick.comps.find(c=>c.type===type);}
function labeled(bricks,type,label){const hits=bricks.filter(br=>component(br,type)?.data.PortLabel===label);assert.equal(hits.length,1,`${label} pin`);return hits[0];}
function connect(scene,a,at,p,z,zt,q){assert(!scene.edges.some(e=>e.z===z.key&&e.zt===zt&&e.q===q),`Duplicate target ${zt}.${q}`);scene.edges.push({a:a.key,at,p,z:z.key,zt,q});}

function merge(input,brainFactory=buildBrain){
 const scene=read(fs.readFileSync(input));
 const brainBuilt=brainFactory();
 const brain=read(brainBuilt.bytes);
 const targetLink=scene.links.find(link=>{
  const pins=scene.bricks.filter(br=>br.g===link.grid);
  return pins.some(br=>component(br,T.input)?.data.PortLabel==='Record Coordinates')&&pins.some(br=>component(br,T.output)?.data.PortLabel==='Steering');
 });
 assert(targetLink,'Routing chip not found');
 const targetGrid=targetLink.grid;
 const vehicleGrid=scene.bricks.find(br=>br.key===targetLink.key).g;
 const sourceLink=brain.links[0];assert(sourceLink,'Compiled brain link');
 const sourceGrid=sourceLink.grid;
 const old=scene.bricks.filter(br=>br.g===targetGrid);
 const oldByRole=new Map();
 for(const label of ['Steering','Compass direction','Record Coordinates','Delete Coordinates']){
  const type=label.includes('Coordinates')?T.input:T.output;
  oldByRole.set(label,labeled(old,type,label));
 }
 const oldKeys=new Set(old.map(br=>br.key));
 scene.bricks=scene.bricks.filter(br=>!oldKeys.has(br.key));
 // Preserve cross-grid wiring by replacing old pin endpoints after import.
 const outsideEdges=scene.edges.filter(e=>!oldKeys.has(e.a)&&!oldKeys.has(e.z));
 const touchingEdges=scene.edges.filter(e=>oldKeys.has(e.a)||oldKeys.has(e.z));
 scene.edges=outsideEdges;
 const keyMap=new Map();
 for(const br of brain.bricks.filter(br=>br.g===sourceGrid)){
  const key=`fresh-route:${br.key}`;keyMap.set(br.key,key);
  scene.bricks.push({...structuredClone(br),key,g:targetGrid});
 }
 for(const edge of brain.edges){
  if(keyMap.has(edge.a)&&keyMap.has(edge.z))scene.edges.push({...edge,a:keyMap.get(edge.a),z:keyMap.get(edge.z)});
 }
 const imported=scene.bricks.filter(br=>br.g===targetGrid);
 const newByRole=new Map();
 for(const label of ['Steering','Compass direction','Record Coordinates','Delete Coordinates']){
  const type=label.includes('Coordinates')?T.input:T.output;
  newByRole.set(label,labeled(imported,type,label));
 }
 const oldRoleByKey=new Map([...oldByRole].map(([label,br])=>[br.key,label]));
 for(const edge of touchingEdges){
  const copy={...edge};
  if(oldRoleByKey.has(copy.a))copy.a=newByRole.get(oldRoleByKey.get(copy.a)).key;
  if(oldRoleByKey.has(copy.z))copy.z=newByRole.get(oldRoleByKey.get(copy.z)).key;
  assert(!oldKeys.has(copy.a)&&!oldKeys.has(copy.z),'Unmapped old routing brick');
  scene.edges.push(copy);
 }
 const vehicleInput=labeled(imported,T.input,'Vehicle Grid (Internal)');
 const reader={key:'fresh-route:vehicle-grid-reader',g:vehicleGrid,data:{asset:'B_1x1_Gate_Internal_ReadBrickGrid',material:'BMC_Plastic',position:[-30,-30,30],size:[0,0,0],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:false,material_intensity:0,color:[255,255,255],owner_index:0},comps:[{type:T.readGrid,data:{}}]};
 scene.bricks.push(reader);
 connect(scene,reader,T.readGrid,'BrickGrid',vehicleInput,T.input,'RER_Input');
 const targetEntity=[...scene.r.entities()].find(e=>e.persistentIndex===targetGrid);assert(targetEntity,'Target chip entity');
 const sourceEntity=[...brain.r.entities()].find(e=>e.persistentIndex===sourceGrid);assert(sourceEntity,'Source chip entity');
 scene.entityOverrides=new Map([[targetGrid,{...targetEntity,data:{...structuredClone(targetEntity.data),PlaneCenter:structuredClone(sourceEntity.data.PlaneCenter),PlaneExtent:structuredClone(sourceEntity.data.PlaneExtent),bCollapsed:false}}]]);
 const output=write(scene,{name:'Vehicle Logic and Vehicle - Fresh Dynamic Router',description:'Original vehicle with a fresh one-second dynamic coordinate recorder and waypoint steering controller.'});
 return {bytes:output.bytes,brainBuilt,targetGrid,vehicleGrid,scene};
}
module.exports=merge;
if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node merge-fresh-dynamic-route-controller.cjs input.brz output.brz');const result=merge(input);fs.writeFileSync(output,result.bytes);console.log(JSON.stringify({output,targetGrid:result.targetGrid,vehicleGrid:result.vehicleGrid,gates:result.brainBuilt.gates,wires:result.brainBuilt.wires,bytes:result.bytes.length},null,2));}

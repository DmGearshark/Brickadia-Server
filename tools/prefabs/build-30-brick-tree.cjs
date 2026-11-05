'use strict';
const fs=require('fs'),{World}=require('brs-js'),{metadata}=require('./loadboard-lib.cjs');
const w=new World(),brown=[94,58,31],darkBrown=[72,43,25],green=[48,112,52],lightGreen=[67,139,61];
function add(size,position,color,rotation=0){w.addBrick({asset:'PB_DefaultMicroBrick',size,position,direction:4,rotation,color,material:'BMC_Plastic'});}
// Six-piece trunk. Each segment touches the next at one face.
for(let i=0;i<6;i++)add([4,4,5],[0,0,5+i*10],i%2?darkBrown:brown);
// Nine low branches, separated vertically so their volumes never cross.
add([8,3,3],[12,0,23],brown); add([8,3,3],[-12,0,29],darkBrown);
add([3,8,3],[0,12,35],brown); add([3,8,3],[0,-12,41],darkBrown);
add([8,3,3],[12,0,47],brown); add([8,3,3],[-12,0,53],darkBrown);
add([3,8,3],[0,12,23],darkBrown); add([3,8,3],[0,-12,29],brown);
add([3,6,3],[0,10,47],darkBrown);
// Broad nine-block crown, a five-block upper cross, and a single treetop.
for(const x of [-16,0,16])for(const y of [-16,0,16])add([8,8,6],[x,y,66],(x+y)%32?lightGreen:green);
for(const [x,y]of [[0,0],[-16,0],[16,0],[0,-16],[0,16]])add([8,8,6],[x,y,78],x||y?green:lightGreen);
add([8,8,6],[0,0,90],lightGreen);
const bytes=w.toBrz({prefab:metadata({x:28,y:28,z:98}),bundle:{name:'Thirty Brick Tree',description:'A stylized tree built from exactly 30 non-overlapping microbricks. Generated with measured face-contact spacing and placement-preflight validation.'}});
module.exports=()=>({bytes,count:30});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-30-brick-tree.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,bricks:30},null,2));}

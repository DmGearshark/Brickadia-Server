'use strict';
const fs=require('fs'),{World,brdb:b}=require('brs-js');
const {metadata}=require('./loadboard-lib.cjs');
const C=b.COMPONENTS,w=new World(),tests=[];
const font={Font:0,Face:0,LineHeight:1.45,WidthScale:.75,Color:{R:245,G:248,B:255,A:255},bOverrideColor:true,Material:2,Outline:1,OutlineWidth:1,Anchor:{X:.5,Y:.5}};
const colors=[[45,95,145],[235,125,35],[110,200,95],[185,90,210]];
function brick(spec,origin,tag){const p=(spec.position||[0,0,0]).map((v,i)=>v+origin[i]);return w.addBrick({asset:spec.asset||'PB_DefaultMicroBrick',size:spec.size||[10,10,10],position:p,direction:spec.direction??4,rotation:spec.rotation??0,color:spec.color||colors[tag.index%colors.length],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,Text:`PP2|${tag.id}|${tag.index}`,bEnabled:false}}]});}
function add(id,description,parts){const col=tests.length%6,row=Math.floor(tests.length/6),origin=[col*100,row*100,18];parts.forEach((x,i)=>brick(x,origin,{id,index:i}));w.addBrick({asset:'PB_DefaultMicroBrick',size:[31,2,6],position:[origin[0]+10,origin[1]-32,7],direction:4,rotation:0,color:[15,22,34],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,Text:`${id}\r\n${description}`}}]});tests.push({id,description,parts});}
// All 24 direction/rotation combinations. A tiny cube sits exactly on the
// expected X face, then 0.1 unit inside it. This verifies oriented extents.
const size=[10,4,2];
function orientedXExtent(direction,rotation){
 // Brickadia directions map local Z to ±X, ±Y, ±Z. Around-axis rotation then
 // swaps the remaining local dimensions. Values are hypotheses tested here.
 const axis=Math.floor(direction/2),normal=[2,1,0][axis];
 if(normal===0)return size[2];
 const other=rotation%2?size[2]:size[0];
 return other;
}
for(let d=0;d<6;d++)for(let r=0;r<4;r++){const e=orientedXExtent(d,r),key=`O${d}${r}`;add(key,`orient d${d} r${r}; X face ${e+1}`,[{size,direction:d,rotation:r},{size:[1,1,1],position:[e+1,0,0]}]);add(key+'I',`orient d${d} r${r}; inside ${e}`,[{size,direction:d,rotation:r},{size:[1,1,1],position:[e,0,0]}]);}
// Special assets use native geometry that may not equal their serialized size.
for(const [prefix,asset]of [['GV',C.Var.BRICK],['GB',C.Exec_Branch.BRICK],['BT','B_Button_Square'],['MC','B_1x1_Microchip']])for(const d of [0,2,4,6,8,10,12,14,16,18,20,22])add(prefix+String(d).padStart(2,'0'),`${asset} vs cube X ${d}`,[{asset,size:[10,5,2]},{size:[1,1,1],position:[d,0,0]}]);
// Shape tests place a tiny cube at points inside the shape's bounding box.
for(const [prefix,asset]of [['WG','PB_DefaultWedge'],['MW','PB_DefaultMicroWedge'],['RP','PB_DefaultRamp']])for(const [name,pos]of [['LOW',[-7,0,-7]],['HIGH',[-7,0,7]],['TIP',[7,0,-7]],['TOP',[7,0,7]],['MID',[0,0,0]]])add(prefix+name,`${asset} point ${name}`,[{asset,size:[10,10,10]},{size:[1,1,1],position:pos}]);
// Odd/even half extents establish exact fine-grid face equations.
for(const [id,a,z,d]of [['F11',1,1,2],['F12',1,2,3],['F23',2,3,5],['F35',3,5,8],['F57',5,7,12]]){add(id,`fine exact ${a}+${z}=${d}`,[{size:[a,a,a]},{size:[z,z,z],position:[d,0,0]}]);add(id+'I',`fine inside ${d-1}`,[{size:[a,a,a]},{size:[z,z,z],position:[d-1,0,0]}]);}
// Collision graph behavior: chain, one conflict plus a distant member, and
// one central brick touching two neighbors without overlap.
add('CHAIN','A overlaps B; B overlaps C',[{size:[5,5,5],position:[0,0,0]},{size:[5,5,5],position:[9,0,0]},{size:[5,5,5],position:[18,0,0]}]);
add('PAIRFAR','A/B overlap; C distant',[{size:[5,5,5],position:[0,0,0]},{size:[5,5,5],position:[9,0,0]},{size:[5,5,5],position:[30,0,0]}]);
add('TOUCH3','three exact touching cubes',[{size:[5,5,5],position:[0,0,0]},{size:[5,5,5],position:[10,0,0]},{size:[5,5,5],position:[20,0,0]}]);
w.addBrick({asset:'PB_DefaultMicroBrick',size:[165,3,13],position:[245,-76,15],direction:4,rotation:0,color:[10,16,26],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,LineHeight:2,Text:'BRICK PLACEMENT PROBE 2\r\nPaste once into an empty area. Do not repair or move anything.\r\nCopy the complete placed result and return its .brz file.'}}]});
const bytes=w.toBrz({prefab:metadata({x:310,y:Math.ceil(tests.length/6)*52+100,z:50}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Brick Placement Probe 2',description:`${tests.length} cases for orientations, special assets, shaped bricks, fine grid, and collision graphs.`}});
module.exports=()=>({bytes,tests});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-placement-probe-v2.cjs output.brz');fs.writeFileSync(out,bytes);console.log(JSON.stringify({output:out,cases:tests.length,bricks:tests.reduce((n,x)=>n+x.parts.length+1,1)},null,2));}

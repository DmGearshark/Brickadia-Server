'use strict';
const fs=require('fs'),path=require('path'),{World,brdb:b}=require('brs-js');
const {metadata}=require('./loadboard-lib.cjs');
const C=b.COMPONENTS,font={Font:0,Face:0,LineHeight:1.6,WidthScale:.75,Color:{R:245,G:248,B:255,A:255},bOverrideColor:true,Material:2,Outline:1,OutlineWidth:1,Anchor:{X:.5,Y:.5}};
const shapes=[
 ['PB_DefaultRampCorner',[10,10,6]],['PB_DefaultRampCornerInverted',[10,10,6]],['PB_DefaultRampInnerCorner',[10,10,6]],['PB_DefaultRampInnerCornerInverted',[10,10,6]],['PB_DefaultRampCrest',[10,5,6]],
 ['PB_DefaultRampCrestEnd',[10,5,6]],['PB_DefaultRampCrestCorner',[10,10,6]],['PB_DefaultArch',[10,15,30]],['PB_DefaultArchInverted',[10,15,30]],['PB_DefaultMicroWedgeCorner',[5,5,5]],
 ['PB_DefaultMicroWedgeTriangleCorner',[5,5,5]],['PB_DefaultMicroWedgeInnerCorner',[5,5,5]],['PB_DefaultMicroWedgeOuterCorner',[5,5,5]],['PB_DefaultMicroWedgeHalfInnerCorner',[5,5,5]],['PB_DefaultMicroWedgeHalfInnerCornerInverted',[5,5,5]],
 ['PB_DefaultMicroWedgeHalfOuterCorner',[5,5,5]],['PB_DefaultMicroRoundCorner',[5,5,5]],['PB_DefaultMicroRoundHalf',[5,10,5]],['PB_DefaultPole',[5,5,12]],['PB_DefaultStudded',[10,10,10]]
];
const levels=[-.8,-.4,0,.4,.8];
function tag(Text){return {type:C.TextDisplay.NAME,data:{...font,Text,bEnabled:false}};}
function buildPack(packIndex,entries){const w=new World(),tests=[];let caseIndex=0;
 for(const [assetIndex,[asset,size]]of entries.entries())for(const nx of levels)for(const ny of levels)for(const nz of levels){const col=caseIndex%25,row=Math.floor(caseIndex/25)+assetIndex*7,origin=[col*80,row*80,50],point=[nx,ny,nz].map((v,i)=>Math.round(v*size[i])),id=`D${packIndex}-${String(caseIndex).padStart(3,'0')}`,sample=`${nx},${ny},${nz}`;
  w.addBrick({asset,size,position:origin,direction:4,rotation:0,color:[48,105,165],material:'BMC_Plastic',components:[tag(`PSD|${id}|SHAPE|${asset}|${sample}`)]});
  w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,1,1],position:origin.map((v,i)=>v+point[i]),direction:4,rotation:0,color:[245,125,35],material:'BMC_Glow',components:[tag(`PSD|${id}|PROBE|${asset}|${sample}`)]});
  tests.push({id,asset,size,normalized:[nx,ny,nz],localPoint:point});caseIndex++;
 }
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[300,3,16],position:[960,-55,20],direction:4,rotation:0,color:[8,13,23],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,Text:`DENSE SHAPE PROBE ${packIndex}\r\nPaste once into an empty area. Blocked pairs are expected.\r\nCopy the complete placed result and return its .brz file.`}}]});
 const bytes=w.toBrz({prefab:metadata({x:1030,y:1500,z:90}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:`Dense Procedural Shape Probe ${packIndex}`,description:`${tests.length} isolated 5x5x5 samples for ${entries.length} procedural shapes.`}});return {bytes,manifest:{version:1,pack:packIndex,levels,tests}};}
function buildAll(outDir){fs.mkdirSync(outDir,{recursive:true});const result=[];for(let i=0;i<4;i++){const pack=i+1,built=buildPack(pack,shapes.slice(i*5,i*5+5)),base=`dense-procedural-shape-probe-${pack}`;fs.writeFileSync(path.join(outDir,base+'.brz'),built.bytes);fs.writeFileSync(path.join(outDir,base+'.manifest.json'),JSON.stringify(built.manifest,null,2));result.push({pack,cases:built.manifest.tests.length,bricks:built.manifest.tests.length*2+1,assets:[...new Set(built.manifest.tests.map(x=>x.asset))]});}return result;}
module.exports={buildAll,buildPack,shapes};
if(require.main===module)console.log(JSON.stringify(buildAll(process.argv[2]||'prefabs'),null,2));

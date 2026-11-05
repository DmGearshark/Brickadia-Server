'use strict';
const fs=require('fs'),{World,brdb:b}=require('brs-js');
const {metadata}=require('./loadboard-lib.cjs');
const C=b.COMPONENTS,w=new World(),tests=[];
const font={Font:0,Face:0,LineHeight:1.2,WidthScale:.65,Color:{R:245,G:248,B:255,A:255},bOverrideColor:true,Material:2,Outline:1,OutlineWidth:1,Anchor:{X:.5,Y:.5}};
const shapes={
 PB_DefaultWedge:[5,5,4],PB_DefaultSideWedge:[10,10,6],PB_DefaultSideWedgetile:[10,10,6],
 PB_DefaultRampCorner:[10,10,6],PB_DefaultRampCornerInverted:[10,10,6],PB_DefaultRampInnerCorner:[10,10,6],PB_DefaultRampInnerCornerInverted:[10,10,6],
 PB_DefaultRampCrest:[10,5,6],PB_DefaultRampCrestEnd:[10,5,6],PB_DefaultRampCrestCorner:[10,10,6],
 PB_DefaultArch:[10,15,30],PB_DefaultArchInverted:[10,15,30],PB_DefaultPole:[5,5,12],PB_DefaultStudded:[10,10,10],
 PB_DefaultMicroRamp:[5,5,5],PB_DefaultMicroWedge:[5,5,5],PB_DefaultMicroWedgeCorner:[5,5,5],PB_DefaultMicroWedgeTriangleCorner:[5,5,5],
 PB_DefaultMicroWedgeInnerCorner:[5,5,5],PB_DefaultMicroWedgeOuterCorner:[5,5,5],PB_DefaultMicroWedgeHalfInnerCorner:[5,5,5],PB_DefaultMicroWedgeHalfInnerCornerInverted:[5,5,5],PB_DefaultMicroWedgeHalfOuterCorner:[5,5,5],
 PB_DefaultMicroRoundCorner:[5,5,5],PB_DefaultMicroRoundHalf:[5,10,5]
};
const samples=[['C',[0,0,0]],['LLO',[-.7,0,-.7]],['LHI',[-.7,0,.7]],['RLO',[.7,0,-.7]],['RHI',[.7,0,.7]],['FL',[0,-.7,0]],['BK',[0,.7,0]],['TL',[-.55,-.55,.55]],['BR',[.55,.55,-.55]]];
function tag(text){return {type:C.TextDisplay.NAME,data:{...font,Text:text,bEnabled:false}};}
function add(asset,size,sample,pos,index){const col=index%8,row=Math.floor(index/8),origin=[col*100,row*105,45],point=pos.map((v,i)=>Math.round(v*size[i])),id=`S${String(index).padStart(3,'0')}`;
 w.addBrick({asset,size,position:origin,direction:4,rotation:0,color:[52,112,170],material:'BMC_Plastic',components:[tag(`PSP|${id}|SHAPE|${asset}|${sample}`)]});
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[1,1,1],position:origin.map((v,i)=>v+point[i]),direction:4,rotation:0,color:[245,125,35],material:'BMC_Glow',components:[tag(`PSP|${id}|PROBE|${asset}|${sample}`)]});
 w.addBrick({asset:'PB_DefaultMicroBrick',size:[38,2,6],position:[origin[0],origin[1]-37,8],direction:4,rotation:0,color:[12,18,28],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,Text:`${id} ${asset.replace('PB_Default','')} ${sample}`}}]});
 tests.push({id,asset,size,sample,localPoint:point});
}
let index=0;for(const [asset,size]of Object.entries(shapes))for(const [sample,pos]of samples)add(asset,size,sample,pos,index++);
const rows=Math.ceil(index/8);w.addBrick({asset:'PB_DefaultMicroBrick',size:[260,3,15],position:[350,-85,18],direction:4,rotation:0,color:[8,13,23],material:'BMC_Plastic',components:[{type:C.TextDisplay.NAME,data:{...font,LineHeight:1.8,Text:'PROCEDURAL SHAPE COLLISION PROBE\r\nPaste once into an empty area. Blocked pairs are expected.\r\nCopy the complete placed result and return its .brz file.'}}]});
const bytes=w.toBrz({prefab:metadata({x:410,y:rows*55+110,z:80}),externalAssets:[{type:'BrickFontDescriptor',name:'GlacialIndifferencePlus'}],bundle:{name:'Procedural Shape Collision Probe',description:`${tests.length} isolated point samples for cooked procedural shapes.`}});
module.exports=()=>({bytes,tests});
if(require.main===module){const out=process.argv[2];if(!out)throw Error('Usage: node build-procedural-shape-probe.cjs output.brz [manifest.json]');fs.writeFileSync(out,bytes);if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({version:1,tests},null,2));console.log(JSON.stringify({output:out,cases:tests.length,bricks:tests.length*3+1},null,2));}

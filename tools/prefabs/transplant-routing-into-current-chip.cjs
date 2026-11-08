'use strict';
const fs=require('fs');
const zlib=require('zlib');
const {brdb}=require('./node_modules/brs-js');

function tree(worldFs,generatedFs,dir='',donorGrid='38306',generatedGrid='2'){
 const out=[];
 const donorInner=`World/0/Bricks/Grids/${donorGrid}`;
 const generatedInner=`World/0/Bricks/Grids/${generatedGrid}`;
 const donorFiles=worldFs.childFiles(dir);
 const names=new Set(donorFiles);
 // The generated routing grid adds a Wires folder/file absent from the donor.
 if(dir.startsWith(donorInner)){
  const mapped=generatedInner+dir.slice(donorInner.length);
  for(const n of generatedFs.childFiles(mapped))names.add(n);
 }
 for(const name of names){
  const full=dir?`${dir}/${name}`:name;
  let content;
  if(full==='World/0/GlobalData.mps'||full==='World/0/GlobalData.schema'||(full.startsWith('World/0/Bricks/')&&full.endsWith('.schema'))) content=generatedFs.readFile(full);
  else if(full.startsWith(donorInner)){
   const mapped=generatedInner+full.slice(donorInner.length);
   content=generatedFs.readFile(mapped);
  }else content=worldFs.readFile(full);
  out.push([name,{type:'file',content}]);
 }
 const folderNames=new Set(worldFs.childFolders(dir));
 if(dir.startsWith(donorInner)){
  const mapped=generatedInner+dir.slice(donorInner.length);
  for(const n of generatedFs.childFolders(mapped))folderNames.add(n);
 }
 for(const name of folderNames){
  const full=dir?`${dir}/${name}`:name;
  out.push([name,{type:'folder',children:tree(worldFs,generatedFs,full,donorGrid,generatedGrid)}]);
 }
 return out;
}

function compressIndex(raw){
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),indexSize=view.getInt32(5,true);
 const compressed=zlib.zstdCompressSync(raw.subarray(45,45+indexSize));
 const out=new Uint8Array(45+compressed.length+raw.length-45-indexSize);
 out.set(raw.subarray(0,45));out[4]=1;new DataView(out.buffer).setInt32(9,compressed.length,true);
 out.set(compressed,45);out.set(raw.subarray(45+indexSize),45+compressed.length);return out;
}

function transplant(donor,generated,out){
 const d=brdb.WorldReader.from(fs.readFileSync(donor)),g=brdb.WorldReader.from(fs.readFileSync(generated));
 const donorInner=String(d.gridIds().find(x=>x!==1));
 const generatedInner=String(g.gridIds().find(x=>x!==1));
 const raw=brdb.writeBrzContainer(tree(d.fs,g.fs,'',donorInner,generatedInner),{compress:x=>zlib.zstdCompressSync(x)});
 const bytes=compressIndex(raw);fs.writeFileSync(out,bytes);
 const check=brdb.WorldReader.from(bytes);let bricks=0,components=0,wires=0;
 for(const id of check.gridIds())for(const ch of check.brickChunkIndex(id)){bricks+=ch.numBricks;components+=ch.numComponents;wires+=ch.numWires;}
 return {bytes:bytes.length,grids:check.gridIds(),bricks,components,wires,bundle:check.bundle(),prefab:check.prefabJson()};
}

module.exports=transplant;
if(require.main===module){const [donor,generated,out]=process.argv.slice(2);if(!out)throw Error('Usage: node transplant-routing-into-current-chip.cjs donor.brz generated.brz output.brz');console.log(JSON.stringify(transplant(donor,generated,out),null,2));}

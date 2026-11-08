'use strict';
const fs=require('fs');
const zlib=require('zlib');
const {brdb}=require('./node_modules/brs-js');

function entries(worldFs,currentFs,dir=''){
 const result=[];
 for(const name of worldFs.childFiles(dir)){
  const full=dir?`${dir}/${name}`:name;
  const useCurrent=full.endsWith('.schema')&&currentFs.findFileByPath(full);
  result.push([name,{type:'file',content:(useCurrent?currentFs:worldFs).readFile(full)}]);
 }
 for(const name of worldFs.childFolders(dir)){
  const full=dir?`${dir}/${name}`:name;
  result.push([name,{type:'folder',children:entries(worldFs,currentFs,full)}]);
 }
 return result;
}

function repack(generated,current,out){
 const generatedReader=brdb.WorldReader.from(fs.readFileSync(generated));
 const currentReader=brdb.WorldReader.from(fs.readFileSync(current));
 const root=entries(generatedReader.fs,currentReader.fs);
 const raw=brdb.writeBrzContainer(root,{compress:data=>zlib.zstdCompressSync(data)});
 // Current Brickadia exports use a zstd-compressed archive index (method 1).
 // brs-js 4.0.4 always writes that index raw even when blob compression is on.
 const indexSize=raw.readInt32LE?raw.readInt32LE(5):new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getInt32(5,true);
 const index=zlib.zstdCompressSync(raw.subarray(45,45+indexSize));
 const bytes=new Uint8Array(45+index.length+(raw.length-45-indexSize));
 bytes.set(raw.subarray(0,45));bytes[4]=1;
 new DataView(bytes.buffer).setInt32(9,index.length,true);
 bytes.set(index,45);bytes.set(raw.subarray(45+indexSize),45+index.length);
 fs.writeFileSync(out,bytes);
 const check=brdb.WorldReader.from(bytes);
 return {bytes:bytes.length,grids:check.gridIds(),prefab:check.prefabJson(),assets:check.brickAssets().length};
}

module.exports=repack;
if(require.main===module){const [generated,current,out]=process.argv.slice(2);if(!out)throw Error('Usage: node repack-with-current-brickadia-schemas.cjs generated.brz current-blank.brz output.brz');console.log(JSON.stringify(repack(generated,current,out),null,2));}

'use strict';
const fs=require('fs');
const zlib=require('zlib');
const {WorldReader,brdb:b}=require('brs-js');
function repack(generatedBytes,donorBytes,{name,description}={}){
 const generated=WorldReader.from(generatedBytes),donor=WorldReader.from(donorBytes);
 const replacements=new Map();
 const bundle=JSON.parse(Buffer.from(donor.fs.readFile('Meta/Bundle.json')).toString());
 if(name)bundle.name=name;if(description!=null)bundle.description=description;
 replacements.set('Meta/Bundle.json',Buffer.from(JSON.stringify(bundle,null,'\t')));
 if(donor.fs.listPaths().includes('Meta/Thumbnail.png'))replacements.set('Meta/Thumbnail.png',donor.fs.readFile('Meta/Thumbnail.png'));
 function tree(prefix=''){
  const replacementFiles=[...replacements].filter(([p])=>p.slice(0,p.lastIndexOf('/'))===prefix).map(([p])=>p.slice(p.lastIndexOf('/')+1));
  const depth=prefix?prefix.split('/').length:0;
  const replacementFolders=[...replacements].map(([p])=>p.split('/')).filter(parts=>parts.length>depth+1&&(prefix?parts.slice(0,depth).join('/')===prefix:true)).map(parts=>parts[depth]).filter(Boolean);
  const folders=[...new Set([...generated.fs.childFolders(prefix),...replacementFolders])];
  const files=[...new Set([...generated.fs.childFiles(prefix),...replacementFiles])];
  return [
   ...folders.map(n=>[n,b.folder(tree(prefix?`${prefix}/${n}`:n))]),
   ...files.map(n=>{const p=prefix?`${prefix}/${n}`:n;return[n,b.file(replacements.get(p)||generated.fs.readFile(p))];}),
  ];
 }
 const useCompressedIndex=donorBytes[4]===1;
 const raw=b.writeBrzContainer(tree(),useCompressedIndex?{compress:data=>zlib.zstdCompressSync(data)}:undefined);
 if(!useCompressedIndex)return raw;
 // brs-js compresses file blobs but leaves the archive index raw. Current
 // Brickadia exports mark and zstd-compress that index as method 1.
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 const indexSize=view.getInt32(5,true);
 const index=zlib.zstdCompressSync(raw.subarray(45,45+indexSize));
 const bytes=new Uint8Array(45+index.length+(raw.length-45-indexSize));
 bytes.set(raw.subarray(0,45));
 bytes[4]=1;
 const outputView=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 outputView.setInt32(9,index.length,true);
 bytes.set(index,45);
 bytes.set(raw.subarray(45+indexSize),45+index.length);
 return bytes;
}
module.exports=repack;
if(require.main===module){const [generated,donor,output]=process.argv.slice(2);if(!output)throw Error('Usage: node repack-with-donor-metadata.cjs generated.brz donor.brz output.brz');fs.writeFileSync(output,repack(fs.readFileSync(generated),fs.readFileSync(donor),{name:'Vehicle Logic and Vehicle - Fresh Router',description:'Fresh dynamic coordinate recorder and waypoint steering controller.'}));console.log(output);}

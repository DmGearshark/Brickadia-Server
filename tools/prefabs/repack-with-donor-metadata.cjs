'use strict';
const fs=require('fs');
const {WorldReader,brdb:b}=require('brs-js');
function repack(generatedBytes,donorBytes,{name,description}={}){
 const generated=WorldReader.from(generatedBytes),donor=WorldReader.from(donorBytes);
 const replacements=new Map();
 const bundle=JSON.parse(Buffer.from(donor.fs.readFile('Meta/Bundle.json')).toString());
 if(name)bundle.name=name;if(description!=null)bundle.description=description;
 replacements.set('Meta/Bundle.json',Buffer.from(JSON.stringify(bundle,null,'\t')));
 if(donor.fs.listPaths().includes('Meta/Thumbnail.png'))replacements.set('Meta/Thumbnail.png',donor.fs.readFile('Meta/Thumbnail.png'));
 function tree(prefix=''){
  return [
   ...generated.fs.childFolders(prefix).map(n=>[n,b.folder(tree(prefix?`${prefix}/${n}`:n))]),
   ...generated.fs.childFiles(prefix).map(n=>{const p=prefix?`${prefix}/${n}`:n;return[n,b.file(replacements.get(p)||generated.fs.readFile(p))];}),
  ];
 }
 return b.writeBrzContainer(tree());
}
module.exports=repack;
if(require.main===module){const [generated,donor,output]=process.argv.slice(2);if(!output)throw Error('Usage: node repack-with-donor-metadata.cjs generated.brz donor.brz output.brz');fs.writeFileSync(output,repack(fs.readFileSync(generated),fs.readFileSync(donor),{name:'Vehicle Logic and Vehicle - Fresh Router',description:'Fresh dynamic coordinate recorder and waypoint steering controller.'}));console.log(output);}

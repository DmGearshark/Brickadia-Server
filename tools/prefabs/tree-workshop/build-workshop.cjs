'use strict';
const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const root=__dirname,out=path.join(root,'Brickadia-Tree-Workshop.html');
esbuild.buildSync({entryPoints:[path.join(root,'tree-workshop-app.mjs')],bundle:true,minify:true,format:'iife',platform:'browser',write:false}).outputFiles.forEach(file=>{const html=fs.readFileSync(path.join(root,'index.template.html'),'utf8').replace('/*__BUNDLE__*/',file.text);fs.writeFileSync(out,html);});
console.log(JSON.stringify({output:out,bytes:fs.statSync(out).size},null,2));

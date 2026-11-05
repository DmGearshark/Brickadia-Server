'use strict';
const fs=require('fs'),{read}=require('./reskin-loadboard.cjs');
function analyze(prefabPath,manifestPath){const scene=read(fs.readFileSync(prefabPath)),manifest=JSON.parse(fs.readFileSync(manifestPath)),tags=new Set(scene.bricks.flatMap(b=>b.comps||[]).map(c=>c.data?.Text).filter(x=>x?.startsWith('PSD|'))),assets={},summary={cases:manifest.tests.length,solid:0,empty:0,partial:0};
 for(const t of manifest.tests){const prefix=`PSD|${t.id}|`,shape=[...tags].some(x=>x.startsWith(prefix+'SHAPE|')),probe=[...tags].some(x=>x.startsWith(prefix+'PROBE|')),state=!shape&&!probe?'solid':shape&&probe?'empty':'partial';summary[state]++;(assets[t.asset]??=[]).push({...t,state});}return {pack:manifest.pack,bricks:scene.bricks.length,summary,assets};}
module.exports=analyze;
if(require.main===module){if(!process.argv[2]||!process.argv[3])throw Error('Usage: node analyze-dense-shape-probe.cjs returned.brz matching.manifest.json');console.log(JSON.stringify(analyze(process.argv[2],process.argv[3]),null,2));}

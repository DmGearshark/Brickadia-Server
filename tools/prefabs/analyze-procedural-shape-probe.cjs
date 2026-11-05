'use strict';
const fs=require('fs'),{read}=require('./reskin-loadboard.cjs');
const manifest=require('./procedural-shape-collision-probe.manifest.json');
function analyze(input){const scene=read(typeof input==='string'?fs.readFileSync(input):input),tags=new Set(scene.bricks.flatMap(b=>b.comps||[]).map(c=>c.data?.Text).filter(x=>x?.startsWith('PSP|'))),assets={},summary={cases:manifest.tests.length,solid:0,empty:0,partial:0};
 for(const t of manifest.tests){const prefix=`PSP|${t.id}|`,shape=[...tags].some(x=>x.startsWith(prefix+'SHAPE|')),probe=[...tags].some(x=>x.startsWith(prefix+'PROBE|')),state=!shape&&!probe?'solid':shape&&probe?'empty':'partial';summary[state]++;(assets[t.asset]??=[]).push({...t,state});}
 return {bricks:scene.bricks.length,summary,assets};}
module.exports=analyze;
if(require.main===module){if(!process.argv[2])throw Error('Usage: node analyze-procedural-shape-probe.cjs returned-results.brz');console.log(JSON.stringify(analyze(process.argv[2]),null,2));}

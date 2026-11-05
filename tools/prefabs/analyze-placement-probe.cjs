'use strict';
const fs=require('fs'),{WorldReader,brdb:b}=require('brs-js');
const C=b.COMPONENTS;
const input=process.argv[2];if(!input)throw Error('Usage: node analyze-placement-probe.cjs returned-result.brz');
const r=WorldReader.from(fs.readFileSync(input));
const found=new Map();
for(const grid of r.gridIds()){
 const bricks=[...r.bricks(grid)];let offset=0;
 for(const entry of r.brickChunkIndex(grid)){
  const chunk=bricks.slice(offset,offset+entry.numBricks);offset+=entry.numBricks;
  if(!entry.numComponents)continue;
  const components=r.componentChunk(grid,entry.index).components;
  for(const comp of components){if(comp.typeName!==C.TextDisplay.NAME)continue;const match=/^PP\|([^|]+)\|(Base|Probe)$/.exec(comp.data.Text||'');if(!match)continue;const [,id,part]=match;if(!found.has(id))found.set(id,new Set());found.get(id).add(part);}
 }
}
const expected=require('./build-placement-probe.cjs')().tests;
const rows=expected.map(t=>{const parts=found.get(t.id)||new Set();return {id:t.id,base:parts.has('Base'),probe:parts.has('Probe'),result:parts.has('Probe')?'PLACED':'BLOCKED/MISSING',description:t.description};});
console.table(rows);
const counts=rows.reduce((o,x)=>(o[x.result]=(o[x.result]||0)+1,o),{});
console.log(JSON.stringify({file:input,cases:rows.length,counts,missingBases:rows.filter(x=>!x.base).map(x=>x.id)},null,2));

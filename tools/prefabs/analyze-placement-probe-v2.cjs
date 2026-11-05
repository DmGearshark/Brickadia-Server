'use strict';
const fs=require('fs'),{WorldReader,brdb:b}=require('brs-js'),C=b.COMPONENTS;
const input=process.argv[2];if(!input)throw Error('Usage: node analyze-placement-probe-v2.cjs returned-result.brz');
const r=WorldReader.from(fs.readFileSync(input)),found=new Map();
for(const grid of r.gridIds()){const bricks=[...r.bricks(grid)];let off=0;for(const entry of r.brickChunkIndex(grid)){off+=entry.numBricks;if(!entry.numComponents)continue;for(const comp of r.componentChunk(grid,entry.index).components){if(comp.typeName!==C.TextDisplay.NAME)continue;const m=/^PP2\|([^|]+)\|(\d+)$/.exec(comp.data.Text||'');if(!m)continue;if(!found.has(m[1]))found.set(m[1],new Set());found.get(m[1]).add(Number(m[2]));}}}
const expected=require('./build-placement-probe-v2.cjs')().tests;
const rows=expected.map(t=>{const got=found.get(t.id)||new Set(),present=t.parts.map((_,i)=>got.has(i));return {id:t.id,present:present.map(x=>x?'Y':'-').join(''),count:`${got.size}/${t.parts.length}`,result:got.size===t.parts.length?'PLACED':got.size===0?'REJECTED':'PARTIAL',description:t.description};});
console.table(rows);console.log(JSON.stringify({file:input,cases:rows.length,placed:rows.filter(x=>x.result==='PLACED').map(x=>x.id),rejected:rows.filter(x=>x.result==='REJECTED').map(x=>x.id),partial:rows.filter(x=>x.result==='PARTIAL')},null,2));

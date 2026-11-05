'use strict';
const fs=require('fs'),{read}=require('./reskin-loadboard.cjs'),{C}=require('./loadboard-lib.cjs');
const s=read(fs.readFileSync(process.argv[2])),results={},native=[],screens=[];
for(const b of s.bricks){const marker=b.comps.find(c=>c.type===C.Interact.NAME&&/^GP[12]:/.test(c.data.Message||'')),v=b.comps.find(c=>c.type===C.Var.NAME);if(marker&&v)results[marker.data.Message.slice(4)]=v.data.Value;for(const c of b.comps){if([C.FunctionCall.NAME,C.Microchip_CountFor.NAME,C.Microchip_ForEachArray.NAME,C.Microchip_ForEachMap.NAME,C.QueueTicks.NAME,C.ArrayVar.NAME].includes(c.type))native.push({grid:b.g,position:b.data.position,type:c.type,data:c.data});if(c.type===C.TextDisplay.NAME)screens.push({grid:b.g,position:b.data.position,text:c.data.Text});}}
console.log(JSON.stringify({results,native,screens},null,2));

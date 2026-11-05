'use strict';
const fs=require('fs');
const ctx=require('./build-gate-probe.cjs')({version:2});require('./test-gate-probe.cjs')(ctx);fs.writeFileSync(process.argv[2],ctx.bytes);console.log(JSON.stringify({output:process.argv[2],components:ctx.b.nodes.length,recordedVariables:ctx.records.length,version:2}));

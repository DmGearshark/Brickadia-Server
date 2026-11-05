import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {generateNursery} from './tree-workshop-core.mjs';
const require=createRequire(import.meta.url),validate=require('../validate-placement.cjs');
let cases=0,bricks=0;
for(const style of ['Conifer','Broadleaf','Mixed'])for(const seed of [1,17421,987654321])for(const scale of [.7,1,1.4]){
 const a=generateNursery({seed,count:20,style,scale,variation:1,spacing:220}),z=generateNursery({seed,count:20,style,scale,variation:1,spacing:220});
 assert.deepEqual(a.bytes,z.bytes,'same settings must reproduce identical bytes');assert.equal(a.manifest.trees.length,20);assert.equal(new Set(a.manifest.trees.map(t=>t.seed)).size,20);
 const report=validate(a.bytes);assert(report.strictOk,JSON.stringify(report));cases++;bricks+=report.bricks;
}
console.log(JSON.stringify({cases,validatedBricks:bricks,deterministic:true,strictPlacement:true},null,2));

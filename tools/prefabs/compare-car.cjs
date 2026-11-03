const fs=require('node:fs');
const {WorldReader}=require('brs-js');
const [generatedPath,savedPath]=process.argv.slice(2);
if(!savedPath)throw Error('Usage: node compare-car.cjs generated.brz in-game-save.brz');
const a=WorldReader.from(fs.readFileSync(generatedPath));
const z=WorldReader.from(fs.readFileSync(savedPath));
const before=[...a.bricks()],after=[...z.bricks()];
function same(br,other){return br.position.join()===other.position.join()&&br.size.join()===other.size.join();}
function overlap(br,other){return br.position.every((v,k)=>Math.abs(v-other.position[k])<br.size[k]+other.size[k]);}
const kept=before.map((br,i)=>({i,br})).filter(({br})=>after.some(other=>same(br,other)));
const rejectedBody=before.slice(0,63).map((br,i)=>({i,br})).filter(({br})=>!after.some(other=>same(br,other)));
const rejectedWithOverlap=rejectedBody.filter(({br,i})=>before.slice(0,64).some((other,j)=>i!==j&&overlap(br,other)));
console.log(JSON.stringify({generatedMainBricks:before.length,savedMainBricks:after.length,keptIndices:kept.map(v=>v.i),rejectedBody:rejectedBody.length,rejectedBodyWithPositiveVolumeOverlap:rejectedWithOverlap.length},null,2));

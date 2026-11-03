// Preserve mechanical archive records and brick indices; replace body geometry.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {WorldReader,brdb:b}=require('brs-js');
const [input,output]=process.argv.slice(2);if(!input||!output||input===output)throw Error('Usage: node build-roadster.cjs reference.brz output.brz');
const r=WorldReader.from(fs.readFileSync(input)),archive=r.fs;
const files=new Map(archive.listPaths().map(p=>[p,archive.readFile(p)]));
const schema=r.schema('World/0/Bricks/ChunksShared.schema');
const chunk=r.brickChunkIndex(1)[0],mainPath=`World/0/Bricks/Grids/1/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
const soa=r.brickChunkSoa(1,chunk.index),original=structuredClone(soa),bricks=[...r.bricks()];
assert.equal(bricks.length,74);
const TEAL=[15,145,150],SILVER=[205,217,220],BLACK=[19,24,30],RED=[240,35,40],WHITE=[225,245,255];
const body=[];
function box(x,y,z,sx,sy,sz,color=TEAL,material=0){body.push({position:[x,y,z],size:[sx,sy,sz],color,material});}
// Narrow lower sills and raised fender rails keep the reference wheel clearance.
for(const x of [-24,24]){
 box(x,0,-7,3,21,5,BLACK);box(x,0,0,3,21,2);
 box(x,45,4,3,25,3);box(x,-45,4,3,25,3);
 box(x,0,5,3,20,3); // low, open cockpit side
 box(x,66,-3,3,5,4);box(x,-66,-3,3,5,4);
}
// Long bonnet with a continuous silver center stripe.
box(0,45,5,21,25,3);
box(0,45,8,4,25,1,SILVER);
box(0,72,0,24,3,5);box(0,76,-9,26,2,2,BLACK);
box(0,76,-2,12,1,3,BLACK);
for(const x of [-9,-6,-3,0,3,6,9])box(x,77,-2,1,1,2,SILVER);
// Rear body surrounds the reference hinged rear deck.
box(0,-72,0,24,3,6);box(0,-76,-9,26,2,2,BLACK);
box(0,-76,2,18,1,2,RED);
box(0,-77,-4,6,1,2,SILVER);
for(const x of [-22,22])box(x,-65,10,3,6,2);
// Frameless low windshield and slim pillars; seats remain fully accessible.
box(0,19,18,20,1,9,[85,160,175],1);
box(0,19,28,22,2,1,BLACK);
for(const x of [-22,22])box(x,19,18,1,2,10,BLACK);
// Rear roll hoop, with no roof over the two seats.
for(const x of [-21,21])box(x,-23,19,2,2,13,BLACK);
box(0,-23,32,23,2,2,SILVER);
box(0,-25,8,20,2,2,TEAL);
// Dashboard, instrument pods, mirrors and rear exhausts.
box(0,15,6,20,2,3,BLACK);
for(const x of [-10,10])box(x,12,9,3,1,2,SILVER);
for(const x of [-29,29]){box(x,14,12,3,3,2,BLACK);box(x,11,12,2,1,1,SILVER);}
for(const x of [-17,17])box(x,-77,-10,3,2,2,SILVER);
// A splitter stripe, two hood vents and rear-deck silver accent.
box(0,74,-12,23,2,1,SILVER);
for(const x of [-13,13]){box(x,52,9,4,8,1,BLACK);box(x,35,9,4,3,1,BLACK);}
box(0,-67,10,4,4,1,SILVER);
// Small amber side markers.
for(const x of [-27,27])box(x,63,4,1,3,1,[255,150,25]);
for(const x of [-27,27])box(x,0,-2,1,18,1,SILVER);
for(const x of [-9,-3,3,9])box(x,-76,-5,2,1,1,BLACK);
assert.equal(body.length,63);
// Rebuild the size table without reordering any brick: components and joint
// references use chunk-local brick indices and must continue to point at 63–73.
const all=bricks.map((br,i)=>i<63?{...br,size:body[i].size,asset_name_index:9}:br);
const sizes=[],counters=[],indices=new Array(74);
for(let asset=7;asset<r.brickAssets().length;asset++){
 const matches=all.map((br,i)=>({br,i})).filter(x=>x.br.asset_name_index===asset);
 if(!matches.length)continue;
 const unique=new Map();
 for(const {br,i} of matches){const key=br.size.join(',');if(!unique.has(key)){unique.set(key,7+sizes.length);sizes.push({X:br.size[0],Y:br.size[1],Z:br.size[2]});}indices[i]=unique.get(key);}
 counters.push({AssetIndex:asset-7,NumSizes:unique.size});
}
all.forEach((br,i)=>{if(br.asset_name_index<7)indices[i]=br.asset_name_index;});
soa.BrickSizeCounters=counters;soa.BrickSizes=sizes;soa.BrickTypeIndices=indices;
for(let i=0;i<63;i++){
 const d=body[i];soa.RelativePositions[i]={X:d.position[0],Y:d.position[1],Z:d.position[2]};
 soa.Orientations[i]=16;soa.MaterialIndices[i]=d.material;
 soa.ColorsAndAlphas[i]={R:d.color[0],G:d.color[1],B:d.color[2],A:5};
}
for(const i of [64,65])Object.assign(soa.ColorsAndAlphas[i],{R:WHITE[0],G:WHITE[1],B:WHITE[2]});
files.set(mainPath,schema.encode('BRSavedBrickChunkSoA',soa));
// Match the existing hinged deck to the new body; retain its mechanism exactly.
const deckChunk=r.brickChunkIndex(15640671)[0];
const deckPath=`World/0/Bricks/Grids/15640671/Chunks/${deckChunk.index.x}_${deckChunk.index.y}_${deckChunk.index.z}.mps`;
const deck=r.brickChunkSoa(15640671,deckChunk.index);
for(const c of deck.ColorsAndAlphas)if(c.R===81&&c.G===61&&c.B===28)Object.assign(c,{R:TEAL[0],G:TEAL[1],B:TEAL[2]});
files.set(deckPath,schema.encode('BRSavedBrickChunkSoA',deck));
const bundle={...r.bundle(),name:'Tide R-20 Roadster',description:'Original teal open-top roadster body with silver stripe, low windshield and roll hoop. Reference chassis, wheels, seats and drive mechanics retained.'};
files.set('Meta/Bundle.json',Buffer.from(JSON.stringify(bundle)));
// Keep native pivot centers; widen their bounds to include the new mirrors.
const prefab=structuredClone(r.prefabJson());
for(const pivot of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot'])prefab.pivots[pivot].halfExtent.x=32;
files.set('Meta/Prefab.json',Buffer.from(JSON.stringify(prefab)));
// Omit the reference thumbnail rather than showing a different car.
files.delete('Meta/Thumbnail.png');
function tree(prefix=''){
 return [...archive.childFolders(prefix).map(n=>[n,b.folder(tree(prefix?`${prefix}/${n}`:n))]),...archive.childFiles(prefix).flatMap(n=>{const p=prefix?`${prefix}/${n}`:n;return files.has(p)?[[n,b.file(files.get(p))]]:[];})];
}
const bytes=b.writeBrzContainer(tree()),out=WorldReader.from(bytes);
assert.deepEqual([...out.entities()],[...r.entities()]);assert.deepEqual(out.prefabJson(),prefab);
const permitted=new Set([mainPath,deckPath,'Meta/Bundle.json','Meta/Prefab.json','Meta/Thumbnail.png']);
for(const p of archive.listPaths())if(!permitted.has(p))assert.deepEqual(Buffer.from(out.fs.readFile(p)),Buffer.from(archive.readFile(p)),p);
const result=[...out.bricks()];assert.equal(result.length,74);
for(let i=63;i<74;i++){
 const expected=structuredClone(bricks[i]);if(i===64||i===65)expected.color=WHITE;
 assert.deepEqual(result[i],expected,`Preserved mechanical brick ${i}`);
}
body.forEach((d,i)=>{assert.deepEqual(result[i].position,d.position.map(v=>v-1024));assert.deepEqual(result[i].size,d.size);assert.deepEqual(result[i].color,d.color);});
assert.equal([...out.bricks(15640671)].length,3);
fs.writeFileSync(output,bytes);
console.log(JSON.stringify({output,newBodyBricks:63,totalBricks:out.gridIds().reduce((n,g)=>n+[...out.bricks(g)].length,0),entities:[...out.entities()].length,grids:out.gridIds().length,mechanicalData:'preserved',bytes:bytes.length},null,2));

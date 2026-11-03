const fs=require('node:fs');
const assert=require('node:assert/strict');
const {WorldReader,brdb:b}=require('brs-js');
const [input,output]=process.argv.slice(2);
if(!input||!output||input===output)throw Error('Usage: node build-targa.cjs reference.brz output.brz');
const r=WorldReader.from(fs.readFileSync(input));
const archive=r.fs,files=new Map(archive.listPaths().map(p=>[p,archive.readFile(p)]));
const schema=r.schema('World/0/Bricks/ChunksShared.schema');
const ch=r.brickChunkIndex(1)[0],s=r.brickChunkSoa(1,ch.index);
const old=structuredClone(s),before=[...r.bricks()];
assert.equal(before.length,74);
assert.equal(r.brickAssets()[before[13].asset_name_index],'PB_DefaultTile');
assert.deepEqual(before[13].size,[15,25,2]);
assert.equal(s.Orientations[13],18); // Z-up, half-turn; same world-axis extents
const slot=s.BrickTypeIndices[13]-s.ProceduralBrickStartingIndex;
assert.deepEqual(s.BrickSizes[slot],{X:15,Y:25,Z:2});
assert.deepEqual(s.BrickTypeIndices.flatMap((v,i)=>v===s.BrickTypeIndices[13]?[i]:[]),[13]);
// Shorten the center roof into a rear crossbar. Entirely inside the original
// tile: [-15,15] x [-25,-15] x [32,36], in the native main-grid coordinates.
s.BrickSizes[slot].Y=5;
s.RelativePositions[13].Y=-20;
const teal={R:18,G:125,B:135},cream={R:225,G:218,B:192};
for(let i=0;i<63;i++){
 const c=s.ColorsAndAlphas[i];
 if(c.R===81&&c.G===61&&c.B===28)Object.assign(c,teal);
}
// Cream targa frame and hood accents use existing bricks, without overlays.
for(const i of [0,1,6,11,12,13])Object.assign(s.ColorsAndAlphas[i],cream);
for(const i of [50,51,52])Object.assign(s.ColorsAndAlphas[i],{R:175,G:187,B:192});
const path=`World/0/Bricks/Grids/1/Chunks/${ch.index.x}_${ch.index.y}_${ch.index.z}.mps`;
files.set(path,schema.encode('BRSavedBrickChunkSoA',s));
const dc=r.brickChunkIndex(15640671)[0],deck=r.brickChunkSoa(15640671,dc.index);
for(const c of deck.ColorsAndAlphas)if(c.R===81&&c.G===61&&c.B===28)Object.assign(c,teal);
const deckPath=`World/0/Bricks/Grids/15640671/Chunks/${dc.index.x}_${dc.index.y}_${dc.index.z}.mps`;
files.set(deckPath,schema.encode('BRSavedBrickChunkSoA',deck));
files.set('Meta/Bundle.json',Buffer.from(JSON.stringify({...r.bundle(),name:'Tide Targa - Reference Chassis',description:'Reference-based teal and cream targa prototype. Original mechanics and body assembly retained; center roof shortened into a rear crossbar.'})));
files.delete('Meta/Thumbnail.png');
function tree(prefix=''){
 return [...archive.childFolders(prefix).map(n=>[n,b.folder(tree(prefix?`${prefix}/${n}`:n))]),...archive.childFiles(prefix).flatMap(n=>{const p=prefix?`${prefix}/${n}`:n;return files.has(p)?[[n,b.file(files.get(p))]]:[];})];
}
const bytes=b.writeBrzContainer(tree()),result=WorldReader.from(bytes),after=[...result.bricks()];
assert.deepEqual(result.gridIds(),r.gridIds());
assert.deepEqual([...result.entities()],[...r.entities()]);
assert.deepEqual(result.prefabJson(),r.prefabJson());
const allowed=new Set([path,deckPath,'Meta/Bundle.json','Meta/Thumbnail.png']);
for(const p of archive.listPaths())if(!allowed.has(p))assert.deepEqual(Buffer.from(result.fs.readFile(p)),Buffer.from(archive.readFile(p)),p);
// Every geometric field except the one roof size and center stays native.
for(const field of Object.keys(old)){
 if(['BrickSizes','RelativePositions','ColorsAndAlphas'].includes(field))continue;
 assert.deepEqual(s[field],old[field],field);
}
for(let i=0;i<74;i++){
 const expected=structuredClone(before[i]);expected.color=after[i].color;
 if(i===13){expected.size=[15,5,2];expected.position[1]-=20;}
 assert.deepEqual(after[i],expected,`Native geometry ${i}`);
}
// Box containment is exact here: this is an axis-aligned tile. Its new solid
// is a subset of the old solid, so it cannot introduce a new intersection.
for(let ax=0;ax<3;ax++)assert(Math.abs(after[13].position[ax]-before[13].position[ax])+after[13].size[ax]<=before[13].size[ax]);
fs.writeFileSync(output,bytes);
console.log(JSON.stringify({output,totalBricks:result.gridIds().reduce((n,g)=>n+[...result.bricks(g)].length,0),geometricallyChangedBricks:1,newSolidOutsideReference:0,mechanics:'byte-identical',bytes:bytes.length},null,2));

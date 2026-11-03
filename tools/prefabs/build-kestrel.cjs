// Preserve mechanical archive records and brick indices; replace body geometry.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {WorldReader,brdb:b}=require('brs-js');
const [input,output]=process.argv.slice(2);if(!input||!output||input===output)throw Error('Usage: node build-kestrel.cjs reference.brz output.brz');
const r=WorldReader.from(fs.readFileSync(input)),archive=r.fs;
const files=new Map(archive.listPaths().map(p=>[p,archive.readFile(p)]));
const schema=r.schema('World/0/Bricks/ChunksShared.schema');
const chunk=r.brickChunkIndex(1)[0],mainPath=`World/0/Bricks/Grids/1/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
const soa=r.brickChunkSoa(1,chunk.index),original=structuredClone(soa),bricks=[...r.bricks()];
assert.equal(bricks.length,74);
const TEAL=[28,108,165],SILVER=[238,155,45],BLACK=[19,24,30],RED=[240,35,40],WHITE=[225,245,255];
const body=[];
function box(x,y,z,sx,sy,sz,color=TEAL,material=0){body.push({position:[x,y,z],size:[sx,sy,sz],color,material});}
// Face-connected panels: never intersect another brick's occupied volume.
for(const x of [-18,18])box(x,0,-14,3,22,6,BLACK);
box(0,48,-10,5,3,2,BLACK);box(0,55,-7,5,5,1,BLACK);
for(const x of [-23,23])box(x,0,-8,2,22,8);
for(const x of [-23,23]){
 box(x,0,2,2,22,2);
 box(x,47,2,2,25,2);box(x,-49,2,2,27,2);
}
// Bonnet and stripe tile the same plane, rather than layering through it.
for(const x of [-15,15])box(x,48,5,10,26,1);
box(0,48,5,5,26,1,SILVER);
box(0,61,-1,14,11,5); // chassis/bonnet bridge, clear of engine at Y=40
box(0,75,-2,14,3,6);
box(0,80,-7,26,2,1,BLACK);
box(0,-79,-4,25,3,4);
box(0,-79,2,25,3,2);
box(0,-83,-2,18,1,1,RED);
box(0,-84,-7,26,2,1,BLACK);
for(const x of [-17,17])box(x,-86,-10,3,2,2,SILVER);
box(0,22,19,20,1,13,[85,160,175],1);
for(const x of [-22,22])box(x,22,19,2,1,13,BLACK);
box(0,22,33,24,1,1,BLACK);
for(const x of [-23,23])box(x,20,5,2,2,1);
box(0,18,5,21,2,1,BLACK);
for(const x of [-22,22])box(x,-24,18,2,2,14,BLACK);
box(0,-24,34,24,2,2,SILVER);
for(const x of [-28,28]){box(x,18,4,3,3,2,BLACK);box(x,14,4,2,1,1,SILVER);}
for(const x of [-14,14])box(x,50,7,3,8,1,BLACK);
for(const x of [-26,26])box(x,0,-3,1,18,1,SILVER);
box(0,-83,-5,6,1,1,SILVER);
for(const x of [-8,0,8])box(x,79,-2,1,1,2,SILVER);
for(const x of [-26,26])box(x,66,2,1,3,1,[255,150,25]);
for(const x of [-10,10])box(x,18,7,3,1,1,SILVER);
for(const x of [-14,14])box(x,36,7,3,3,1,BLACK);
for(const x of [-23,23])box(x,68,7,2,4,1,SILVER);
box(0,0,35,24,22,1,TEAL);
box(0,-83,1,2,1,1,SILVER);
// Continuous doors, side glazing and rear window complete the new cabin.
for(const x of [-23,23]){
 box(x,-2,10,2,20,6,TEAL);
 box(x,-2,24,1,20,8,[85,160,175],1);
 box(x,-2,33,1,20,1,BLACK);
}
box(0,-24,19,20,1,13,[85,160,175],1);

assert.equal(body.length,63);
// Face contact is allowed; strict positive-volume intersections are rejected.
function overlaps(a,z){return a.position.every((v,i)=>Math.abs(v-z.position[i])<a.size[i]+z.size[i]);}
for(let i=0;i<body.length;i++)for(let j=0;j<i;j++)assert(!overlaps(body[i],body[j]),`Body overlap ${i}/${j}`);
// Keep the new boxes clear of the retained chassis and mechanical envelopes.
const reserved=[
 {position:[0,-60,8],size:[15,15,4]},
 {position:[0,-73,-2],size:[15,2,6]},
 {position:[0,-5,-14],size:[15,50,6]},
 {position:[0,40,-6],size:[5,5,2]},
 ...[-10,10].map(x=>({position:[x,0,3],size:[10,15,11]})),
 ...[-20,20].map(x=>({position:[x,77,-1],size:[5,2,5]})),
];
for(let i=0;i<body.length;i++)for(let j=0;j<reserved.length;j++)assert(!overlaps(body[i],reserved[j]),`Mechanical clearance ${i}/${j}`);
// Conservative axis-aligned structural check: every new body box must reach
// the retained weight/chassis brick by face contact or overlap.
const chassis={position:[0,-5,-14],size:[15,50,6]};
const connected=new Set([63]),boxes=[...body,chassis];
function touches(a,z){return a.position.every((v,i)=>Math.abs(v-z.position[i])<=a.size[i]+z.size[i]);}
let grew=true;while(grew){grew=false;for(let i=0;i<63;i++)if(!connected.has(i)&&[...connected].some(j=>touches(boxes[i],boxes[j]))){connected.add(i);grew=true;}}
assert.equal(connected.size,64,'Disconnected body pieces: '+body.map((_,i)=>i).filter(i=>!connected.has(i)).join(','));
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
const bundle={...r.bundle(),name:'Kestrel GT',description:'Original blue and amber enclosed sports coupe, with new body panels, cabin and roof. Reference wheels, seats, suspension and engine retained.'};
files.set('Meta/Bundle.json',Buffer.from(JSON.stringify(bundle)));
// Keep native pivot centers; widen their bounds to include the new mirrors.
const prefab=structuredClone(r.prefabJson());
for(const pivot of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot'])prefab.pivots[pivot].halfExtent.x=32;
for(const pivot of ['bottomStudsPivot','studsExpandedPivot','topStudsPivot','boundsPivot']){prefab.pivots[pivot].halfExtent.y=88;prefab.pivots[pivot].halfExtent.z=37;}
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
// Export authored geometry plus retained reference wheel/seat geometry for preview.
const assets=out.brickAssets();
const geometry=[];
const quat=q=>{const {X:x,Y:y,Z:z,W:v}=q;return [[1-2*(y*y+z*z),2*(x*y-z*v),2*(x*z+y*v)],[2*(x*y+z*v),1-2*(x*x+z*z),2*(y*z-x*v)],[2*(x*z-y*v),2*(y*z+x*v),1-2*(x*x+y*y)]];};
const identity=[[1,0,0],[0,1,0],[0,0,1]];
const entities=new Map([...out.entities()].map(e=>[e.persistentIndex,e]));
for(const g of out.gridIds()){
 const e=entities.get(g),rotation=e?quat(e.rotation):identity,translation=e?[e.location.X,e.location.Y,e.location.Z]:[0,0,0];
 for(const br of out.bricks(g))if(br.visibility){
  const asset=assets[br.asset_name_index];
  geometry.push({asset,position:br.position.map(v=>v+1024),size:br.size,color:br.color,material:br.material_index,direction:br.direction,rotation:br.rotation,gridRotation:rotation,translation});
 }
}
fs.writeFileSync(output+'.geometry.json',JSON.stringify(geometry));
console.log(JSON.stringify({output,newBodyBricks:63,totalBricks:out.gridIds().reduce((n,g)=>n+[...out.bricks(g)].length,0),entities:[...out.entities()].length,grids:out.gridIds().length,mechanicalData:'preserved',bytes:bytes.length},null,2));

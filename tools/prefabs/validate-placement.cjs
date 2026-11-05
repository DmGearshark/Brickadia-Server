'use strict';
const fs=require('fs'),{read}=require('./reskin-loadboard.cjs'),{orientedHalfExtents,makeConvex,convexIntersects}=require('./brick-shapes.cjs');
const native=require('./native-brick-half-extents.json');
const procedural=require('./procedural-brick-metadata.json');
const proceduralBoxes=new Set(['PB_DefaultBrick','PB_DefaultMicroBrick','PB_DefaultTile','PB_DefaultSmoothTile']);
const shaped=new Set(['PB_DefaultWedge','PB_DefaultMicroWedge','PB_DefaultRamp']);
const standardGridProcedural=/^PB_Default(?:Brick|Tile|SmoothTile|Wedge|SideWedge|SideWedgetile|Ramp|RampInverted|RampCorner|RampCornerInverted|RampCrest|RampCrestCorner|RampCrestEnd|RampInnerCorner|RampInnerCornerInverted|Arch|ArchInverted)$/;
const nativeBoxes=name=>/^B_1x1_Gate_/.test(name)||/^PB_Gate_/.test(name)||/^B_Button_Square(?:_|$)/.test(name)||/^B_1x1_Microchip(?:_|$)/.test(name);
function half(br,warnings){const asset=br.data.asset;let local,source,exact=false;
 if(asset.startsWith('PB_')){local=br.data.size;source='procedural-size';exact=proceduralBoxes.has(asset);}
 else if(native.assets[asset]){local=native.assets[asset];source='native-catalogue';exact=nativeBoxes(asset);}
 else{local=br.data.size?.some(Boolean)?br.data.size:[5,5,6];source='unknown-fallback';warnings.push({type:'unknown-native-bounds',grid:br.g,brick:br.key,asset,assumed:local});}
 return {half:orientedHalfExtents(local,br.data.direction??4,br.data.rotation??0),source,exact,shaped:shaped.has(asset)};
}
function intersect(a,z){return a.min.every((v,i)=>v<z.max[i]&&a.max[i]>z.min[i]);}
function validate(input){const bytes=typeof input==='string'?fs.readFileSync(input):Buffer.from(input),scene=read(bytes),warnings=[],items=scene.bricks.map((br,index)=>{const h=half(br,warnings),p=br.data.position,convex=makeConvex(br.data);return {index,br,...h,convex,exact:h.exact||!!convex,min:p.map((v,i)=>v-h.half[i]),max:p.map((v,i)=>v+h.half[i])};}),pairs=[];
 const invalidBricks=[];for(const x of items){const {asset,size,position,direction}=x.br.data;if(standardGridProcedural.test(asset)){const reasons=[];if(size[0]%procedural.gridRules.standardHorizontalStep||size[1]%procedural.gridRules.standardHorizontalStep)reasons.push('Standard procedural X/Y half-extents must use 5-unit increments');if(size[2]%procedural.gridRules.standardVerticalStep)reasons.push('Standard procedural Z half-extent must use 2-unit increments');if(reasons.length)invalidBricks.push({grid:x.br.g,brick:x.br.key,asset,size,position,direction,rotation:x.br.data.rotation,reasons});}}
 for(const group of Map.groupBy(items,x=>x.br.g).values()){
  group.sort((a,z)=>a.min[0]-z.min[0]);
  for(let i=0;i<group.length;i++)for(let k=i+1;k<group.length&&group[k].min[0]<group[i].max[0];k++)if(intersect(group[i],group[k])){const a=group[i],z=group[k];if(a.convex&&z.convex&&!convexIntersects(a.convex,z.convex))continue;const certain=a.exact&&z.exact;pairs.push({grid:a.br.g,certain,a:a.br.key,z:z.br.key,aAsset:a.br.data.asset,zAsset:z.br.data.asset,aPosition:a.br.data.position,zPosition:z.br.data.position,reason:certain?'confirmed-convex-overlap':'envelope-overlap-shape-uncertain'});}
 }
 const adjacency=new Map(items.map(x=>[x.br.key,new Set()]));for(const p of pairs){adjacency.get(p.a).add(p.z);adjacency.get(p.z).add(p.a);}const seen=new Set(),components=[];
 for(const item of items){if(seen.has(item.br.key)||!adjacency.get(item.br.key).size)continue;const stack=[item.br.key],members=[],componentPairs=[];seen.add(item.br.key);while(stack.length){const key=stack.pop();members.push(key);for(const next of adjacency.get(key))if(!seen.has(next)){seen.add(next);stack.push(next);}}const set=new Set(members);componentPairs.push(...pairs.filter(p=>set.has(p.a)&&set.has(p.z)));components.push({grid:item.br.g,members,confirmed:componentPairs.some(p=>p.certain),pairs:componentPairs});}
 return {ok:invalidBricks.length===0&&!pairs.some(p=>p.certain),strictOk:invalidBricks.length===0&&pairs.length===0,bricks:items.length,invalidBricks,confirmedPairs:pairs.filter(p=>p.certain),uncertainPairs:pairs.filter(p=>!p.certain),components,warnings,catalogue:{source:native.source,assets:Object.keys(native.assets).length,proceduralSource:procedural.source}};
}
module.exports=validate;
if(require.main===module){const input=process.argv[2];if(!input)throw Error('Usage: node validate-placement.cjs prefab.brz [--strict]');const strict=process.argv.includes('--strict'),r=validate(input);console.log(JSON.stringify(r,null,2));if(strict?!r.strictOk:!r.ok)process.exitCode=1;}

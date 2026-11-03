'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js');
module.exports=function test(c){
 const {bytes,r,nodes,edges,originalNodes,oldRemoved,controls,animations,auto,selector,part,settings,sel,shop,visual}=c,C=b.COMPONENTS;
 assert.equal(animations.length,8);assert(!nodes.some(n=>n.g===visual));assert(!nodes.some(n=>n.g===1&&n.position[0]>-25640));
 assert(!nodes.includes(selector(58)));assert(!nodes.includes(selector(64)));assert(!nodes.includes(selector(65)));assert(!nodes.includes(selector(77)));assert(!nodes.includes(selector(86)));
 // Automatic selection executes only after the list's centre row was read.
 assert(edges.some(e=>e.a===selector(31)&&e.p==='ExecOut'&&e.z===auto&&e.q==='Input'));
 assert(edges.some(e=>e.a===auto&&e.p==='Output'&&e.z===selector(89)&&e.q==='Exec'));
 assert(edges.some(e=>e.a===selector(31)&&e.p==='Value'&&e.z===selector(89)&&e.q==='Value'));
 assert.equal(auto.data.TicksToWait,1);
 // Eight independent blend circuits preserve the resting type size and shrink on hold.
 for(const a of animations){assert(a.rest>a.pressed&&a.pressed>0);assert.equal(a.blend.data.InputA.value,a.rest);assert.equal(a.blend.data.InputB.value,a.pressed);assert(edges.some(e=>e.a===a.n&&e.at===C.Button.NAME&&e.p==='bHeld'&&e.z===a.blend&&e.q==='Blend'));assert(edges.some(e=>e.a===a.blend&&e.p==='Output'&&e.z===a.n&&e.zt===C.TextDisplay.NAME&&e.q==='LineHeight'));}
 for(const control of Object.values(controls))assert(edges.some(e=>e.a===control.n&&e.at===C.Button.NAME&&e.p==='Character'));
 // The saved player-specific purchase backend and catalog values remain intact.
 const maps=originalNodes.filter(n=>n.comps.some(c=>c.type===C.MapVar.NAME));for(const m of maps)assert(nodes.includes(m),'Retain catalogue/cache '+m.id);
 const sets=originalNodes.filter(n=>n.comps.some(c=>c.type===C.Exec_Gamemode_SetLeaderboardValue.NAME||c.type===C.Exec_Gamemode_IncrementLeaderboardValue.NAME));for(const n of sets)assert(nodes.includes(n));
 const sourceGet=p=>edges.find(e=>e.z===part(3)&&e.zt===C.Exec_Gamemode_SetLeaderboardValue.NAME&&e.q===p);
 assert.equal(sourceGet('Key').at,C.Exec_MapVar_Get.NAME);assert.equal(sourceGet('Value').at,C.Exec_MapVar_Get.NAME);
 const sold=nodes.find(n=>n.g===1&&n.i===17);assert(sold);assert(!edges.some(e=>e.z===sold&&e.zt===C.OneShotAudioEmitter.NAME&&e.q==='Play'));
 const out=WorldReader.from(bytes),mapping=new Map([[1,1],[sel,2],[724559,3],[shop,4],[settings,5]]),defs=new Map(),actual=[],targets=new Set();
 const addr=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]),point=(g,pos,t,p)=>JSON.stringify([g,pos,t,p]);
 for(const g of out.gridIds()){const all=[...out.bricks(g)];let offset=0;for(const ch of out.brickChunkIndex(g)){const bs=all.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;for(const d of out.componentChunk(g,ch.index).components){const pos=bs[d.brickIndex].position.map((v,k)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][k]));defs.set(addr(g,ch.index,d.brickIndex,d.typeName),{g,pos,...d});}}}
 for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const a=defs.get(addr(e.source.gridId??g,e.source.chunk??ch.index,e.source.brickIndex,e.source.componentType)),z=defs.get(addr(g,ch.index,e.target.brickIndex,e.target.componentType));assert(a&&z,'Saved endpoint exists');const target=point(z.g,z.pos,z.typeName,e.target.port);assert(!targets.has(target),'Unique target '+target);targets.add(target);actual.push(JSON.stringify([point(a.g,a.pos,a.typeName,e.source.port),target]));}}
 assert.deepEqual(actual.sort(),edges.map(e=>JSON.stringify([point(mapping.get(e.a.g),e.a.position,e.at,e.p),point(mapping.get(e.z.g),e.z.position,e.zt,e.q)])).sort());
 // Preserve the new PC and keyboard geometry and every retained logic gate.
 const main=[...out.bricks(1)];for(const n of nodes.filter(n=>n.g===1)){const br=main.find(br=>JSON.stringify(br.position)===JSON.stringify(n.position));assert(br,'New layout retained');for(const k of ['size','direction','rotation','color','material_intensity','collision','visibility'])assert.deepEqual(br[k],n.brick[k],k+' retained');assert.equal(out.brickAssets()[br.asset_name_index],n.asset);}
 const publicButtons=[...defs.values()].filter(d=>d.g===1&&d.typeName===C.Button.NAME);assert.equal(publicButtons.length,8);assert(![...defs.values()].some(d=>d.typeName===C.AnimatedButton.NAME));
 assert.equal([...out.entities()].length,4);assert(oldRemoved.filter(n=>n.g===1).length>30);
 console.log('Parts shop checks passed: automatic centre selection, all eight held blends, purchase key/value lookups, catalogues, saved endpoints, retained layout, and unused sale sound.');
};

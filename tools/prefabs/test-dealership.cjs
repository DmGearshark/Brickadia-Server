'use strict';
const assert=require('assert/strict'),{WorldReader,brdb:b}=require('brs-js'),model=require('./dealership-model.cjs');
module.exports=function test({ctx,bytes,r,counts},fromSaved=false){
 const players=()=>({alice:{Scrap:10000,CarOwned:1,CarEngine:3,CarFuelTank:2,TruckOwned:1,TruckEngine:2,TruckWheelDistance:4,TruckSpawned:1},bob:{Scrap:5000,CarOwned:1,CarEngine:1}});
 const text=(m,key)=>m.input(ctx.ui.get(key+':Component_TextDisplay').id,'Text');
 const action=m=>text(m,'right:12'),price=m=>text(m,'right:14');
 let m=model(ctx,players());m.press('bind','alice');assert.equal(m.state.get(ctx.total.id),1125);assert.equal(action(m),'Sell');assert.equal(price(m),'Sell Price: 1125 Scrap');
 const unchanged=structuredClone(m.players);m.press('trade','bob');m.press('next','bob');assert.deepEqual(m.players,unchanged);assert.equal(m.state.get(ctx.index.id),0);
 m.press('trade','alice',false);assert.equal(m.state.get(ctx.busy.id),true);assert.equal(action(m),'Updating…');m.press('bind','bob',false);m.press('trade','alice',false);m.press('next','alice',false);assert.equal(m.state.get(ctx.bound.id),'alice');m.drain();
 assert.equal(m.players.alice.Scrap,11125);assert.equal(m.players.alice.CarOwned,0);assert.equal(m.players.alice.CarEngine,0);assert.equal(m.players.alice.CarFuelTank,0);assert.equal(m.players.alice.TruckEngine,2);assert.deepEqual(m.players.bob,unchanged.bob);assert.equal(action(m),'Buy');assert.equal(price(m),'Buy Price: 1000 Scrap');
 m.press('trade','alice');assert.equal(m.players.alice.Scrap,10125);assert.equal(m.players.alice.CarOwned,1);assert.equal(action(m),'Sell');assert.equal(price(m),'Sell Price: 600 Scrap');
 m.press('next','alice');assert.equal(m.state.get(ctx.index.id),1);assert(text(m,'left:17').startsWith('Truck'));assert.equal(action(m),'Sell');assert.equal(price(m),'Sell Price: 1424 Scrap');m.press('trade','alice');assert.equal(m.players.alice.Scrap,11549);assert.equal(m.players.alice.TruckOwned,0);assert.equal(m.players.alice.TruckEngine,0);assert.equal(m.players.alice.TruckWheelDistance,0);assert.equal(m.players.alice.TruckSpawned,1);assert.equal(action(m),'Buy');assert.equal(price(m),'Buy Price: 1500 Scrap');
 m.press('next','alice');assert.equal(m.state.get(ctx.index.id),1);m.press('previous','alice');m.press('previous','alice');assert.equal(m.state.get(ctx.index.id),0);
 m.press('bind','bob');const before=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,before);
 // Invalid saved upgrade values and invalid catalogues stop all writes.
 m=model(ctx,players());m.players.alice.CarEngine=99;m.press('bind','alice');assert(m.state.get(ctx.diagnostic.id).includes('CarEngine = 99'));const invalid=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,invalid);assert.equal(action(m),'Unavailable');assert.equal(price(m),'Price unavailable');
 for(const row of ['Bad|0|100|50','Bad|1|-1|0','Bad|1|100|101','Bad|1|x|0','|1|100|0','Bad|1|100|0|oops']){m=model(ctx,players());m.state.get(ctx.catalog.id).set('CarOwned',row);m.press('bind','alice');const before=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,before);assert(m.state.get(ctx.diagnostic.id));}
 m=model(ctx,players());m.state.get(ctx.upgradeCatalog.id).set('CarOwned.Scrap','0:0|10000:10000');m.press('bind','alice');const unsafe=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,unsafe);assert(m.state.get(ctx.diagnostic.id).includes('Unsafe upgrade'));
 // Insufficient funds keep the Buy action. Clicking rereads the actual balance.
 m=model(ctx,players());Object.assign(m.players.alice,{CarOwned:0,CarEngine:0,CarFuelTank:0});m.press('bind','alice');m.players.alice.Scrap=999;const poor=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,poor);assert.equal(m.state.get(ctx.feedback.id),'Not enough Scrap');assert.equal(action(m),'Buy');m.players.alice.Scrap=1000;m.press('trade','alice');assert.equal(m.players.alice.Scrap,0);assert.equal(action(m),'Sell');
 // A stale ownership change must not reverse the action the player clicked.
 m=model(ctx,players());m.players.alice.CarOwned=0;m.press('bind','alice');m.players.alice.CarOwned=1;let stale=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,stale);assert.equal(action(m),'Sell');m.players.alice.CarOwned=0;stale=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,stale);assert.equal(action(m),'Buy');
 // Buying with old saved configuration refreshes the next sale quote correctly.
 m=model(ctx,players());m.players.alice.CarOwned=0;m.press('bind','alice');m.press('trade','alice');assert.equal(price(m),'Sell Price: 1125 Scrap');
 m=model(ctx,players());m.state.get(ctx.catalog.id).set('CarOwned','Custom Car|1|1200|700');m.state.get(ctx.upgradeCatalog.id).set('CarOwned.CarEngine','0:0|9:501');m.state.set(ctx.percent.id,.5);m.players.alice.CarEngine=9;m.press('bind','alice');assert.equal(price(m),'Sell Price: 1050 Scrap');m.press('trade','alice');assert.equal(m.players.alice.Scrap,11050);assert.equal(price(m),'Buy Price: 1200 Scrap');
 m=model(ctx,players());m.press('bind','alice');m.press('apply','alice');assert.equal(m.state.get(ctx.bound.id),'alice');assert.equal(price(m),'Sell Price: 1125 Scrap');
 m=model(ctx,players());m.state.get(ctx.catalog.id).clear();m.press('bind','alice');assert.equal(m.state.get(ctx.busy.id),false);assert(m.state.get(ctx.diagnostic.id).includes('empty'));
 m=model(ctx,players());m.state.set(ctx.percent.id,1.01);m.press('bind','alice');const badPercent=structuredClone(m.players);m.press('trade','alice');assert.deepEqual(m.players,badPercent);assert(m.state.get(ctx.diagnostic.id));
 // New vehicles and sparse upgrade IDs require no new gates.
 m=model(ctx,players());m.state.get(ctx.catalog.id).set('VanOwned','Van|2|800|400');m.state.get(ctx.upgradeCatalog.id).set('VanOwned.VanEngine','0:0|7:300');Object.assign(m.players.alice,{VanOwned:2,VanEngine:7});m.press('bind','alice');m.press('next','alice');m.press('next','alice');assert.equal(price(m),'Sell Price: 625 Scrap');m.press('trade','alice');assert.equal(m.players.alice.VanOwned,0);assert.equal(m.players.alice.VanEngine,0);assert.equal(m.players.alice.Scrap,10625);m.press('trade','alice');assert.equal(m.players.alice.VanOwned,2);assert.equal(m.players.alice.Scrap,9825);
 // Both input orders update highlighted selection and the shared action/price.
 m=model(ctx,players(),{characterFirst:true});m.players.alice.TruckOwned=0;m.press('bind','alice');m.press('next','alice');assert.equal(m.state.get(ctx.index.id),1);assert(text(m,'left:17').startsWith('Truck'));assert.equal(action(m),'Buy');assert.equal(price(m),'Buy Price: 1500 Scrap');m.press('previous','alice');assert.equal(action(m),'Sell');assert.equal(price(m),'Sell Price: 1125 Scrap');
 assert(!ctx.actions.select&&!ctx.actions.buy&&!ctx.actions.sell);assert(!ctx.ui.has('left:6:Component_Button'));assert(!ctx.ui.has('left:6:Component_TextDisplay'));assert(!ctx.ui.has('right:4:Component_Button'));assert(!ctx.ui.has('right:4:Component_TextDisplay'));assert(!ctx.ui.has('right:13:Component_TextDisplay'));
 if(fromSaved)return;
 // Read back the emitted prefab: every source/target port and brick exists.
 const out=WorldReader.from(bytes),components=new Map(),edges=[],key=(g,ch,i,t)=>JSON.stringify([g,ch.x,ch.y,ch.z,i,t]);
 for(const g of out.gridIds())for(const ch of out.brickChunkIndex(g)){if(ch.numComponents)for(const c of out.componentChunk(g,ch.index).components)components.set(key(g,ch.index,c.brickIndex,c.typeName),c);if(ch.numWires){const ws=out.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote])edges.push({g,ch:ch.index,...e});}}
 const targets=new Set();for(const e of edges){assert(components.has(key(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)),'Missing source');assert(components.has(key(e.g,e.ch,e.target.brickIndex,e.target.componentType)),'Missing target');const t=key(e.g,e.ch,e.target.brickIndex,e.target.componentType)+e.target.port;assert(!targets.has(t),'Duplicate input');targets.add(t);}
 // Every retained menu brick keeps its exact geometry/material/colour.
 function physical(reader,br){const copy={...br,asset:reader.brickAssets()[br.asset_name_index],material:reader.materials()[br.material_index]};delete copy.asset_name_index;delete copy.material_index;return JSON.stringify(copy);}
 const actualMain=new Set([...out.bricks(1)].map(br=>physical(out,br)));let originalOffset=0;
 const originalMain=[...r.bricks(1)];for(const ch of r.brickChunkIndex(1)){const bricks=originalMain.slice(originalOffset,originalOffset+ch.numBricks);originalOffset+=ch.numBricks;const comps=r.componentChunk(1,ch.index).components;for(let i=0;i<bricks.length;i++){if(comps.some(c=>c.brickIndex===i&&c.typeName===b.COMPONENTS.Microchip.NAME)||(ch.index.y===-24&&[2,3,5,6].includes(i)))continue;assert(actualMain.has(physical(r,bricks[i])),'Retained menu geometry changed');}}
 assert.equal(edges.length,ctx.edges.length);assert.deepEqual(out.prefabJson(),r.prefabJson());assert.equal([...out.entities()].length,2);assert(counts.newBricks<counts.originalBricks);
 // Map saved components back to graph IDs by their physical grid, position,
 // and type, then rerun behavior tests using only saved component data/wires.
 const savedDefs=new Map(),addressToNode=new Map();
 for(const g of out.gridIds()){
  const bricks=[...out.bricks(g)];let offset=0;
  for(const ch of out.brickChunkIndex(g)){
   const local=bricks.slice(offset,offset+ch.numBricks);offset+=ch.numBricks;
   if(!ch.numComponents)continue;
   for(const c of out.componentChunk(g,ch.index).components){
    if(c.typeName===b.COMPONENTS.Microchip.NAME)continue;
    const pos=local[c.brickIndex].position.map((v,i)=>v+(g===1?0:[ch.offset.x,ch.offset.y,ch.offset.z][i]));
    const original=ctx.nodes.find(n=>n.handle.grid+1===g&&n.type===c.typeName&&JSON.stringify(n.position)===JSON.stringify(pos));
    if(!original){assert(!edges.some(e=>key(e.g,e.ch,e.target.brickIndex,e.target.componentType)===key(g,ch.index,c.brickIndex,c.typeName)||key(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)===key(g,ch.index,c.brickIndex,c.typeName)),'Unmatched wired component');continue;}
    const n={...original,data:c.data};savedDefs.set(n.id,n);addressToNode.set(key(g,ch.index,c.brickIndex,c.typeName),n);
   }
  }
 }
 assert.equal(savedDefs.size,ctx.nodes.length);
 const savedEdges=edges.map(e=>({a:addressToNode.get(key(e.source.gridId??e.g,e.source.chunk??e.ch,e.source.brickIndex,e.source.componentType)),p:e.source.port,z:addressToNode.get(key(e.g,e.ch,e.target.brickIndex,e.target.componentType)),q:e.target.port}));
 test({ctx:{...ctx,nodes:[...savedDefs.values()],edges:savedEdges},bytes,r,counts},true);
 console.log('Dealership graph tests passed: player binding, buy/sell, upgrade payout/reset, repeat inputs, fresh balances, invalid data, and serialized wire endpoints.');
};

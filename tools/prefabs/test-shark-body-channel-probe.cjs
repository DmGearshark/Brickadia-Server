'use strict';
const fs=require('fs'),assert=require('assert/strict'),build=require('./add-shark-body-channel-probe.cjs'),validate=require('./validate-placement.cjs'),{C}=require('./loadboard-lib.cjs');
const input=process.argv[2],r=build(input),sweeps=r.scene.bricks.flatMap(b=>b.comps.map(c=>({b,c}))).filter(x=>x.c.type===C.Exec_Sweep.NAME&&x.c.data.Distance===60);
const body=sweeps.filter(x=>x.c.data.bOnlyHitPlayerBodyParts),control=sweeps.filter(x=>!x.c.data.bOnlyHitPlayerBodyParts);
assert.equal(body.length,9);assert.deepEqual(body.map(x=>x.c.data.CollisionChannel).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);assert.equal(control.length,1);assert.equal(control[0].c.data.CollisionChannel,8);
assert.equal(r.scene.edges.length,r.original.edges.length+29);
const before=validate(fs.readFileSync(input)),after=validate(r.bytes),contact=p=>[p.aAsset,p.zAsset,p.aPosition,p.zPosition];assert(after.ok);assert.equal(after.invalidBricks.length,0);assert.equal(after.confirmedPairs.length,0);assert.deepEqual(after.uncertainPairs.map(contact),before.uncertainPairs.map(contact));
console.log(JSON.stringify({bodyPartChannels:9,capsuleControls:1,originalWiresPreserved:r.original.edges.length,newPlacementIssues:0},null,2));

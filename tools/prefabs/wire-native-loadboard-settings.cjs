'use strict';
const fs=require('fs'),assert=require('assert/strict'),{read,write}=require('./reskin-loadboard.cjs'),{C,S}=require('./loadboard-lib.cjs');
const has=(b,t)=>b.comps.find(c=>c.type===t);
module.exports=function build(input){
 const scene=read(fs.readFileSync(input));
 const configGrid=[...new Set(scene.bricks.filter(b=>has(b,C.MapVar.NAME)&&has(b,C.MapVar.NAME).data.Value?.$map?.some(([k])=>k==='CarOwned')).map(b=>b.g))];assert.equal(configGrid.length,1);const g=configGrid[0];
 const labels=scene.bricks.filter(b=>b.g===g&&has(b,C.TextDisplay.NAME)&&/^Small Explanation/.test(has(b,C.TextDisplay.NAME).data.Text)).sort((a,b)=>a.data.position[1]-b.data.position[1]);assert.equal(labels.length,10);
 const examples=scene.bricks.filter(b=>b.g===g&&b.data.position[0]===655&&b.data.position[1]>=165&&b.data.position[1]<=255&&b.comps.some(c=>[C.Var.NAME,C.ArrayVar.NAME].includes(c.type)));assert.equal(examples.length,10);const exampleKeys=new Set(examples.map(b=>b.key));assert(!scene.edges.some(e=>exampleKeys.has(e.a)||exampleKeys.has(e.z)));scene.bricks=scene.bricks.filter(b=>!exampleKeys.has(b.key));
 const mapWith=key=>scene.bricks.find(b=>b.g===g&&has(b,C.MapVar.NAME)?.data.Value?.$map?.some(([k])=>k===key)),vehicle=mapWith('CarOwned'),cargo=mapWith('0'),pickup=mapWith('1')&&scene.bricks.find(b=>b.g===g&&has(b,C.MapVar.NAME)?.data.Value?.$map?.some(([k,v])=>k==='1'&&v==='Pickup Depot')),destination=scene.bricks.find(b=>b.g===g&&has(b,C.MapVar.NAME)?.data.Value?.$map?.some(([k,v])=>k==='1'&&v==='Delivery Depot')),routes=scene.bricks.find(b=>b.g===g&&has(b,C.MapVar.NAME)?.data.Value?.$map?.some(([k])=>k.includes('|')));assert(vehicle&&cargo&&pickup&&destination&&routes);
 const vars=scene.bricks.filter(b=>b.g===g&&has(b,C.Var.NAME)),scrap=vars.find(b=>has(b,C.Var.NAME).data.Value?.value==='Scrap'),min=vars.find(b=>has(b,C.Var.NAME).data.Value?.value===600),max=vars.find(b=>has(b,C.Var.NAME).data.Value?.value===3600),status=vars.find(b=>String(has(b,C.Var.NAME).data.Value?.value).includes('Validate Catalogues'));assert(scrap&&min&&max&&status);
 const editable=[vehicle,cargo,pickup,destination,routes,scrap,min,max],rowText=[
  'VEHICLES — Leaderboard Key = Name|Owned Value|Capability',
  'CARGO — Cargo ID = Display Name|Required Capability',
  'PICKUPS — Numeric Pickup ID = Visible Name',
  'DESTINATIONS — Numeric Destination ID = Visible Name',
  'ROUTES — Cargo ID|Pickup ID|Destination ID = Min|Max',
  'PAYOUT KEY — Leaderboard value paid after delivery',
  'MIN ROTATION — Minimum offer lifetime in seconds',
  'MAX ROTATION — Maximum offer lifetime in seconds'
 ];
 for(let i=0;i<editable.length;i++){editable[i].data.position=[655,165+i*10,6];editable[i].data.direction=4;editable[i].data.rotation=1;has(labels[i],C.TextDisplay.NAME).data.Text=rowText[i];}
 const validate=labels[8],validateText=has(validate,C.TextDisplay.NAME);validateText.data.Text='VALIDATE CATALOGUES — Click after editing';const buttonSource=scene.bricks.flatMap(b=>b.comps).find(c=>c.type===C.Button.NAME);assert(buttonSource);validate.comps.push({type:C.Button.NAME,data:{...structuredClone(buttonSource.data),bAllowNearbyInteraction:true,bHiddenInteraction:false,PromptCustomLabel:'Validate Catalogues'}});has(labels[9],C.TextDisplay.NAME).data.Text='EDITING FORMATS — Full examples are shown in the side panel';
 const diagnostic=scene.bricks.find(b=>b.g===g&&has(b,C.TextDisplay.NAME)&&String(has(b,C.TextDisplay.NAME).data.Text).startsWith('Diagnostic Menu'));assert(diagnostic);has(status,C.Var.NAME).data.Value=S('CATALOGUE DIAGNOSTIC\nREADY — Click Validate Catalogues after editing.');
 const help=scene.bricks.find(b=>b.g===g&&has(b,C.TextDisplay.NAME)&&String(has(b,C.TextDisplay.NAME).data.Text).startsWith('Anything else'));assert(help);has(help,C.TextDisplay.NAME).data.Text='LOAD SETTINGS FORMAT\n\nVehicles:\nCarOwned = Car|1|1\nTruckOwned = Truck|1|2\n\nCargo:\n0 = Cheap Crate|1\n1 = Fuel|2\n\nLocations:\n1 = Pickup Depot\n1 = Delivery Depot\n\nRoutes:\nCargo|Pickup|Destination = Min|Max\n0|1|1 = 250|250\n\nUse whole numbers. Equal Min and Max gives a fixed payout.';
 const edge=scene.bricks.find(b=>b.g===g&&has(b,C.Expr_EdgeDetectorExec.NAME)),send=scene.bricks.find(b=>b.g===g&&has(b,C.Exec_SendCustomEventGlobal.NAME)&&has(b,C.Exec_SendCustomEventGlobal.NAME).data.EventName==='LB1.Request'&&has(b,C.Exec_SendCustomEventGlobal.NAME).data.DataIn3?.value===7);assert(edge&&send);assert(scene.edges.some(e=>e.a===edge.key&&e.p==='OnRisingEdge'&&e.z===send.key));scene.edges.push({a:status.key,at:C.Var.NAME,p:'Value',z:diagnostic.key,zt:C.TextDisplay.NAME,q:'Text'},{a:validate.key,at:C.Button.NAME,p:'bHeld',z:edge.key,zt:C.Expr_EdgeDetectorExec.NAME,q:'Input'});
 const embedded=scene.r.prefabPaths().map(path=>scene.r.readPrefab(path)),out=write(scene,{embedded,name:'Load Board - Native Settings UI'});return {scene,bytes:out.bytes,g,labels,editable,validate,diagnostic,help,status,edge,send,input};
};
if(require.main===module){const [input,output]=process.argv.slice(2);try{const r=module.exports(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,settingsGrid:r.g,editableRows:r.editable.length,wires:r.scene.edges.length}));}catch(e){console.error(e.stack);process.exitCode=1;}}

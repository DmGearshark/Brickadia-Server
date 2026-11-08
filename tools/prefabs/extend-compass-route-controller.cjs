'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const {C,N,B,S}=require('./loadboard-lib.cjs');
const INPUT='BrickComponentType_Internal_MicrochipInput',OUTPUT='BrickComponentType_Internal_MicrochipOutput';
function extend(input){
 const donor=fs.readFileSync(input),scene=read(donor);
 const link=scene.links.find(l=>scene.bricks.some(br=>br.g===l.grid&&br.comps.some(c=>c.data.PortLabel==='Compass Bearing Current Angle')));assert(link,'Route chip');
 const grid=link.grid,existing=scene.bricks.filter(br=>br.g===grid),main=scene.bricks.find(br=>br.key===link.key).g;
 const labeled=(label,type)=>{const hits=existing.filter(br=>br.comps.some(c=>c.type===type&&c.data.PortLabel===label));assert.equal(hits.length,1,label);return {br:hits[0],type};};
 const record=labeled('Record Coordinates',INPUT),remove=labeled('Delete Coordinates',INPUT),vehicle=labeled('Vehicle Grid (Internal)',INPUT),compass=labeled('Compass Bearing Current Angle',INPUT),steering=labeled('Steering',OUTPUT),arrow=labeled('Arrow pointing to next Waypoint',OUTPUT);
 const desiredBr=existing.find(br=>br.data.position.join()=== '-55,25,2'&&br.comps.some(c=>c.type===C.Var.NAME));assert(desiredBr,'Desired bearing variable');const desired={br:desiredBr,type:C.Var.NAME};
 const centeredBr=existing.find(br=>br.data.position.join()==='20,25,2'&&br.comps.some(c=>c.type===C.Expr_MathSubtract.NAME));assert(centeredBr,'Wrapped heading error');const centered={br:centeredBr,type:C.Expr_MathSubtract.NAME};
 const outsideBr=existing.find(br=>br.data.position.join()==='5,10,2'&&br.comps.some(c=>c.type===C.Expr_CompareGreater.NAME)),selectBr=existing.find(br=>br.data.position.join()==='20,10,2'&&br.comps.some(c=>c.type===C.Expr_Select.NAME));assert(outsideBr&&selectBr,'Existing steering selector');
 const destDisplay=scene.bricks.find(br=>br.g===main&&br.data.position.join()==='34,-1,18'&&br.comps.some(c=>c.type===C.TextDisplay.NAME)),curDisplay=scene.bricks.find(br=>br.g===main&&br.data.position.join()==='34,-1,20'&&br.comps.some(c=>c.type===C.TextDisplay.NAME));assert(destDisplay&&curDisplay,'Coordinate displays');
 let serial=0,layout=0;
 function gate(kind,data={},position=null,color=[55,90,135]){const def=C[kind];assert(def,kind);if(!position){position=[-55+(layout%12)*15,-100+Math.floor(layout/12)*15,2];layout++;}const br={key:`route-v1:${serial++}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position,size:[0,0,0],direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:true,physics:false},visibility:true,material_intensity:0,color,owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(br);return {br,type:def.NAME,kind};}
 function wire(a,port,z,inputPort){assert(!scene.edges.some(e=>e.z===z.br.key&&e.zt===z.type&&e.q===inputPort),`Duplicate ${z.type}.${inputPort}`);scene.edges.push({a:a.br.key,at:a.type,p:port,z:z.br.key,zt:z.type,q:inputPort});}
 const points=gate('ArrayVar',{Value:{$elementType:'Vector',$array:[]}},null,[45,160,95]),index=gate('Var',{Value:N(0)}),target=gate('Var',{Value:{$variant:'Vector',value:{X:0,Y:0,Z:0}}}),current=gate('Var',{Value:{$variant:'Vector',value:{X:0,Y:0,Z:0}}}),lengthHold=gate('Var',{Value:N(0)}),ready=gate('Var',{Value:B(false)}),arrivalRadius=gate('Var',{Value:N(50)},null,[190,125,45]);

 // Record one world coordinate per button press. Point zero becomes the initial target.
 const recordEdge=gate('Expr_EdgeDetectorExec',{Input:B(false)});wire(record,'RER_Output',recordEdge,'Input');
 const recordLocation=gate('Exec_Entity_GetLocationRotation',{});wire(vehicle,'RER_Output',recordLocation,'Entity');wire(recordEdge,'OnRisingEdge',recordLocation,'Exec');
 const recordWait=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(recordLocation,'ExecOut',recordWait,'Input');
 const push=gate('Exec_ArrayVar_Push',{});wire(points,'ArrayVarRef',push,'ArrayVarRef');wire(recordLocation,'Vector',push,'Value');wire(recordWait,'Output',push,'Exec');
 const recordLength=gate('Exec_ArrayVar_GetLength',{});wire(points,'ArrayVarRef',recordLength,'ArrayVarRef');wire(push,'ExecOut',recordLength,'Exec');
 const recordLengthWait=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(recordLength,'ExecOut',recordLengthWait,'Input');
 const saveRecordLength=gate('Exec_Var_Set',{});wire(lengthHold,'VarRef',saveRecordLength,'VarRef');wire(recordLength,'Length',saveRecordLength,'Value');wire(recordLengthWait,'Output',saveRecordLength,'Exec');
 const firstPoint=gate('Expr_CompareEqual',{InputA:N(0),InputB:N(1)});wire(recordLength,'Length',firstPoint,'InputA');
 const firstBranch=gate('Exec_Branch',{});wire(firstPoint,'bOutput',firstBranch,'bCond');wire(saveRecordLength,'ExecOut',firstBranch,'Exec');
 const firstIndex=gate('Exec_Var_Set',{Value:N(0)});wire(index,'VarRef',firstIndex,'VarRef');wire(firstBranch,'ExecOutA',firstIndex,'Exec');
 const firstTarget=gate('Exec_Var_Set',{});wire(target,'VarRef',firstTarget,'VarRef');wire(recordLocation,'Vector',firstTarget,'Value');wire(firstIndex,'ExecOut',firstTarget,'Exec');

 // Delete clears all points and leaves steering disabled until a new two-point route exists.
 const deleteEdge=gate('Expr_EdgeDetectorExec',{Input:B(false)});wire(remove,'RER_Output',deleteEdge,'Input');
 const clear=gate('Exec_ArrayVar_Clear',{});wire(points,'ArrayVarRef',clear,'ArrayVarRef');wire(deleteEdge,'OnRisingEdge',clear,'Exec');
 const clearLength=gate('Exec_Var_Set',{Value:N(0)});wire(lengthHold,'VarRef',clearLength,'VarRef');wire(clear,'ExecOut',clearLength,'Exec');
 const clearIndex=gate('Exec_Var_Set',{Value:N(0)});wire(index,'VarRef',clearIndex,'VarRef');wire(clearLength,'ExecOut',clearIndex,'Exec');
 const clearReady=gate('Exec_Var_Set',{Value:B(false)});wire(ready,'VarRef',clearReady,'VarRef');wire(clearIndex,'ExecOut',clearReady,'Exec');

 // Once per second, latch the vehicle position and the live route length.
 const clock=gate('Clock',{IntervalSeconds:1,bEnabled:true}),location=gate('Exec_Entity_GetLocationRotation',{});wire(vehicle,'RER_Output',location,'Entity');wire(clock,'Pulse',location,'Exec');
 const locationWait=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(location,'ExecOut',locationWait,'Input');
 const saveCurrent=gate('Exec_Var_Set',{});wire(current,'VarRef',saveCurrent,'VarRef');wire(location,'Vector',saveCurrent,'Value');wire(locationWait,'Output',saveCurrent,'Exec');
 const routeLength=gate('Exec_ArrayVar_GetLength',{});wire(points,'ArrayVarRef',routeLength,'ArrayVarRef');wire(saveCurrent,'ExecOut',routeLength,'Exec');
 const routeLengthWait=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(routeLength,'ExecOut',routeLengthWait,'Input');
 const saveLength=gate('Exec_Var_Set',{});wire(lengthHold,'VarRef',saveLength,'VarRef');wire(routeLength,'Length',saveLength,'Value');wire(routeLengthWait,'Output',saveLength,'Exec');
 const sampleSettled=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(saveLength,'ExecOut',sampleSettled,'Input');
 const hasRoute=gate('Expr_CompareGreaterOrEqual',{InputA:N(0),InputB:N(2)});wire(lengthHold,'Value',hasRoute,'InputA');
 const routeBranch=gate('Exec_Branch',{});wire(hasRoute,'bOutput',routeBranch,'bCond');wire(sampleSettled,'Output',routeBranch,'Exec');

 // Convert the selected coordinate into the base bearing needed by the existing compass steering.
 const delta=gate('Expr_MathSubtract',{});wire(target,'Value',delta,'InputA');wire(current,'Value',delta,'InputB');
 const targetRotation=gate('Expr_DirectionToRotation',{});wire(delta,'Output',targetRotation,'Direction');
 const targetAngles=gate('Expr_SplitRotation',{});wire(targetRotation,'Output',targetAngles,'Input');
 const desiredBase=gate('Expr_MathAdd',{InputB:N(90)});wire(targetAngles,'Yaw',desiredBase,'InputA');
 const setDesired=gate('Exec_Var_Set',{});wire(desired,'VarRef',setDesired,'VarRef');wire(desiredBase,'Output',setDesired,'Value');wire(routeBranch,'ExecOutA',setDesired,'Exec');
 const setReady=gate('Exec_Var_Set',{Value:B(true)});wire(ready,'VarRef',setReady,'VarRef');wire(setDesired,'ExecOut',setReady,'Exec');
 const distance=gate('Expr_VecDistance',{});wire(current,'Value',distance,'InputA');wire(target,'Value',distance,'InputB');
 const arrived=gate('Expr_CompareLessOrEqual',{});wire(distance,'Output',arrived,'InputA');wire(arrivalRadius,'Value',arrived,'InputB');
 const arrivalBranch=gate('Exec_Branch',{});wire(arrived,'bOutput',arrivalBranch,'bCond');wire(setReady,'ExecOut',arrivalBranch,'Exec');
 const safeLength=gate('Expr_MathMax',{InputB:N(1)});wire(lengthHold,'Value',safeLength,'InputA');
 const plusOne=gate('Expr_MathAdd',{InputB:N(1)});wire(index,'Value',plusOne,'InputA');
 const wrappedIndex=gate('Expr_MathModuloFloored',{});wire(plusOne,'Output',wrappedIndex,'InputA');wire(safeLength,'Output',wrappedIndex,'InputB');
 const setNextIndex=gate('Exec_Var_Set',{});wire(index,'VarRef',setNextIndex,'VarRef');wire(wrappedIndex,'Output',setNextIndex,'Value');wire(arrivalBranch,'ExecOutA',setNextIndex,'Exec');
 const getNext=gate('Exec_ArrayVar_Get',{});wire(points,'ArrayVarRef',getNext,'ArrayVarRef');wire(wrappedIndex,'Output',getNext,'Index');wire(setNextIndex,'ExecOut',getNext,'Exec');
 const nextWait=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(getNext,'ExecOut',nextWait,'Input');
 const setNextTarget=gate('Exec_Var_Set',{});wire(target,'VarRef',setNextTarget,'VarRef');wire(getNext,'Value',setNextTarget,'Value');wire(nextWait,'Output',setNextTarget,'Exec');
 const nextSettled=gate('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});wire(setNextTarget,'ExecOut',nextSettled,'Input');
 const setNextDesired=gate('Exec_Var_Set',{});wire(desired,'VarRef',setNextDesired,'VarRef');wire(desiredBase,'Output',setNextDesired,'Value');wire(nextSettled,'Output',setNextDesired,'Exec');

 // Gate the proven steering chain until the route has two points and a computed bearing.
 const routeEnabled=gate('Expr_LogicalAND',{});wire(hasRoute,'bOutput',routeEnabled,'bInputA');wire(ready,'Value',routeEnabled,'bInputB');
 const priorEnable=scene.edges.find(e=>e.a===outsideBr.key&&e.z===selectBr.key&&e.q==='bSelectB');assert(priorEnable,'Existing steering enable');scene.edges=scene.edges.filter(e=>e!==priorEnable);
 const activeAndError=gate('Expr_LogicalAND',{});wire(routeEnabled,'bOutput',activeAndError,'bInputA');scene.edges.push({a:outsideBr.key,at:C.Expr_CompareGreater.NAME,p:'bOutput',z:activeAndError.br.key,zt:activeAndError.type,q:'bInputB'});scene.edges.push({a:activeAndError.br.key,at:activeAndError.type,p:'bOutput',z:selectBr.key,zt:C.Expr_Select.NAME,q:'bSelectB'});
 const arrowSelect=gate('Expr_Select',{InputA:N(0)});wire(centered,'Output',arrowSelect,'InputB');wire(routeEnabled,'bOutput',arrowSelect,'bSelectB');wire(arrowSelect,'Output',arrow,'RER_Input');

 // Coordinate displays use rounded XYZ values and explicit chip outputs.
 const currentSplit=gate('Expr_SplitVector',{}),targetSplit=gate('Expr_SplitVector',{});wire(current,'Value',currentSplit,'Input');wire(target,'Value',targetSplit,'Input');
 const round=(split,port)=>{const n=gate('Expr_Round',{});wire(split,port,n,'Input');return n;};
 const cx=round(currentSplit,'X'),cy=round(currentSplit,'Y'),cz=round(currentSplit,'Z'),tx=round(targetSplit,'X'),ty=round(targetSplit,'Y'),tz=round(targetSplit,'Z');
 const currentText=gate('Expr_String_FormatText',{FormatString:'{A}, {B}, {C}'});wire(cx,'Output',currentText,'InputA');wire(cy,'Output',currentText,'InputB');wire(cz,'Output',currentText,'InputC');
 const destinationText=gate('Expr_String_FormatText',{FormatString:'{A}, {B}, {C}'},[0,-25,2]);wire(tx,'Output',destinationText,'InputA');wire(ty,'Output',destinationText,'InputB');wire(tz,'Output',destinationText,'InputC');
 const destinationSelect=gate('Expr_Select',{InputA:S('No route')},[25,-25,2]);wire(destinationText,'Output',destinationSelect,'InputB');wire(routeEnabled,'bOutput',destinationSelect,'bSelectB');
 const currentOut=gate('MicrochipOutput',{PortLabel:'Current Location Text',PortOrder:3,CallableDefault:S(''),CallableResult:S('')},[-35,45,2]),destinationOut=gate('MicrochipOutput',{PortLabel:'Destination Text',PortOrder:4,CallableDefault:S(''),CallableResult:S('')},[-25,45,2]);wire(currentText,'Output',currentOut,'RER_Input');wire(destinationSelect,'Output',destinationOut,'RER_Input');
 scene.edges.push({a:currentOut.br.key,at:currentOut.type,p:'RER_Output',z:curDisplay.key,zt:C.TextDisplay.NAME,q:'Text'});scene.edges.push({a:destinationOut.br.key,at:destinationOut.type,p:'RER_Output',z:destDisplay.key,zt:C.TextDisplay.NAME,q:'Text'});

 const generated=write(scene,{name:'Vehicle - Compass Coordinate Route',description:'Working compass steering extended with coordinate recording, deletion, cyclic waypoint advancement, arrow aiming, and live coordinate displays.'}).bytes;
 const bytes=repack(generated,donor,{name:'Vehicle - Compass Coordinate Route',description:'Working compass steering extended with coordinate recording, deletion, cyclic waypoint advancement, arrow aiming, and live coordinate displays.'});return {bytes,added:serial,grid,main};
}
module.exports=extend;if(require.main===module){const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: node extend-compass-route-controller.cjs input.brz output.brz');const r=extend(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,addedGates:r.added,grid:r.grid,bytes:r.bytes.length},null,2));}

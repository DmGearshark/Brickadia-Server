'use strict';
const {C,S,R}=require('./loadboard-lib.cjs');
// One packed argument and one result avoid unverified multi-port ordering.
module.exports=function listingFunction(c){
 const def=c.n('Microchip_FunctionDefinition',{},[880,0,2]),grid=c.b.w.addBrickGrid({type:'Entity_MicrochipDynamicBrickGrid',location:{X:40,Y:0,Z:40},data:{bCollapsed:true,PlaneCenter:{X:0,Y:0,Z:0},PlaneExtent:{X:14,Y:14,Z:2}}});c.b.w.registerMicrochipLink(def.handle,grid);
 const f=c.b.circuit(grid,'listingFunction'),entry=f.n('CallableEntry_Function'),noop=f.n('Exec_Union');f.link(entry,noop,'Body','ExecA');
 const input=f.n('FunctionInput',{PortLabel:'Record',PortOrder:1,DefaultValue:S(''),Value:S('')}),parts=f.split(R(input),10),rule=f.num(parts[2]),available=f.cmp('Greater',f.num(parts[7]),0),owns=f.or(f.cmp('Greater',f.num(parts[9]),0),f.and(f.cmp('Equal',rule,1),f.cmp('Greater',f.num(parts[8]),0))),label=f.sel(f.cmp('Equal',rule,2),'Car / Truck','Truck'),requirement=f.sel(owns,f.fmt('{A} (not owned)',label),label),result=f.fmt('{A}^{B}^{C}^{D}^{E}',f.sel(available,'Taken',parts[0]),f.num(parts[1]),requirement,parts[5],parts[6]);
 const output=f.n('FunctionOutput',{PortLabel:'Row',PortOrder:1,DefaultValue:S('Unused'),Value:result});return {def,grid,entry,input,output,nodes:c.b.nodes.filter(n=>n.grid===grid)};
};

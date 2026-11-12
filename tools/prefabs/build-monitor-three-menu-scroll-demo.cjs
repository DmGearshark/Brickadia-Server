'use strict';
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {read,write}=require('./reskin-loadboard.cjs');
const repack=require('./repack-with-donor-metadata.cjs');
const validate=require('./validate-placement.cjs');
const {C,N,S,B}=require('./loadboard-lib.cjs');
function one(xs,label){assert.equal(xs.length,1,`Expected one ${label}, found ${xs.length}`);return xs[0];}
function build(input){
 const donor=fs.readFileSync(input),scene=read(donor),link=one(scene.links,'chip link'),grid=link.grid;
 const background=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)),'display');
 const splitterBrick=one(scene.bricks.filter(b=>b.comps.some(c=>c.type===C.InputSplitter.NAME)),'seat splitter');
 const splitter={key:splitterBrick.key,type:C.InputSplitter.NAME};
 const nodes=[];let seq=0;
 function node(kind,data={}){const def=C[kind],i=seq++,brick={key:`three-menu:${i}:${kind}`,g:grid,data:{asset:def.BRICK,material:'BMC_Plastic',position:[(i%9)*48,Math.floor(i/9)*48+48,2],size:[0,0,0],direction:4,rotation:0,collision:{player:true,weapon:true,interaction:true,tool:true,physics:true},visibility:true,material_intensity:0,color:[45,115,175],owner_index:0},comps:[{type:def.NAME,data}]};scene.bricks.push(brick);const n={key:brick.key,type:def.NAME};nodes.push(n);return n;}
 function wire(a,p,z,q){const ac=Object.values(C).find(c=>c.NAME===a.type),zc=Object.values(C).find(c=>c.NAME===z.type);assert(ac?.PORTS[p]||Object.values(ac?.PORTS||{}).includes(p),`${a.type}.${p}`);assert(zc?.PORTS[q]||Object.values(zc?.PORTS||{}).includes(q),`${z.type}.${q}`);assert(!scene.edges.some(e=>e.z===z.key&&e.zt===z.type&&e.q===q),`Duplicate ${z.type}.${q}`);scene.edges.push({a:a.key,at:a.type,p,z:z.key,zt:z.type,q});}
 function math(kind,a,ap,data={}){const n=node('Expr_Math'+kind,data);wire(a,ap,n,'InputA');return n;}
 function set(variable,value,exec,port='OnRisingEdge'){const n=node('Exec_Var_Set',{Value:N(0),bChangeType:false});wire(variable,'VarRef',n,'VarRef');wire(value[0],value[1],n,'Value');wire(exec,port,n,'Exec');return n;}
 function setConst(variable,value,exec,port='ExecOutA'){const n=node('Exec_Var_Set',{Value:value,bChangeType:false});wire(variable,'VarRef',n,'VarRef');wire(exec,port,n,'Exec');return n;}
 function edge(inputPort,kind,threshold){const cmp=node('Expr_Compare'+kind,{InputB:N(threshold)});wire(splitter,inputPort,cmp,'InputA');const e=node('Expr_EdgeDetectorExec',{Input:0,InputLast:0,bSeeded:true});wire(cmp,'bOutput',e,'Input');return e;}
 const selection=node('Var',{Value:N(0)}),menu=node('Var',{Value:N(0)}),counts=[node('Var',{Value:N(0)}),node('Var',{Value:N(0)}),node('Var',{Value:N(0)})];
 // Spatial navigation for the actual layout:
 //   0 (top item)       3 (up arrow)
 //   1 (middle item)
 //   2 (bottom item)    4 (down arrow)
 function mappedValue(entries){let value=selection;let port='Value';for(const [from,to] of entries){const eq=node('Expr_CompareEqual',{InputB:N(from)});wire(selection,'Value',eq,'InputA');const pick=node('Expr_Select',{InputA:N(0),InputB:N(to),bSelectB:false});wire(value,port,pick,'InputA');wire(eq,'bOutput',pick,'bSelectB');value=pick;port='Output';}return [value,port];}
 const moveUp=mappedValue([[0,2],[1,0],[2,1],[3,4],[4,3]]);   // wrap each column
 const moveDown=mappedValue([[0,1],[1,2],[2,0],[3,4],[4,3]]); // wrap each column
 const moveLeft=mappedValue([[0,3],[3,0],[2,4],[4,2]]);       // wrap each row
 const moveRight=mappedValue([[0,3],[3,0],[2,4],[4,2]]);      // wrap each row; middle stays
 set(selection,moveUp,edge('InputForward','Greater',.5));
 set(selection,moveDown,edge('InputForward','Less',-.5));
 set(selection,moveLeft,edge('InputRight','Less',-.5));
 set(selection,moveRight,edge('InputRight','Greater',.5));
 const space=edge('InputUp','Greater',.5),branches=[];
 for(let i=0;i<5;i++){const eq=node('Expr_CompareEqual',{InputB:N(i)});wire(selection,'Value',eq,'InputA');const b=node('Exec_Branch',{bCond:false});wire(eq,'bOutput',b,'bCond');wire(space,'OnRisingEdge',b,'Exec');branches.push(b);}
 // Slots 0 and 2 demonstrate successful actions. Slot 1 deliberately fails
 // so its red unavailable feedback can be tested.
 for(const i of [0,2]){const inc=math('Add',counts[i],'Value',{InputB:N(1)});set(counts[i],[inc,'Output'],branches[i],'ExecOutA');}
 const menuMinus=math('Subtract',menu,'Value',{InputB:N(1)}),menuPlus=math('Add',menu,'Value',{InputB:N(1)});
 const menuFirst=node('Expr_CompareEqual',{InputB:N(0)});wire(menu,'Value',menuFirst,'InputA');const menuLast=node('Expr_CompareEqual',{InputB:N(2)});wire(menu,'Value',menuLast,'InputA');
 const menuPrev=node('Expr_Select',{InputA:N(0),InputB:N(2),bSelectB:false});wire(menuMinus,'Output',menuPrev,'InputA');wire(menuFirst,'bOutput',menuPrev,'bSelectB');
 const menuNext=node('Expr_Select',{InputA:N(0),InputB:N(0),bSelectB:false});wire(menuPlus,'Output',menuNext,'InputA');wire(menuLast,'bOutput',menuNext,'bSelectB');
 set(menu,[menuPrev,'Output'],branches[3],'ExecOutA');set(menu,[menuNext,'Output'],branches[4],'ExecOutA');

 const baseData=background.comps.find(c=>c.type===C.TextDisplay.NAME).data;baseData.Text='WASD  SELECT       SPACE  ACTIVATE';baseData.Anchor={X:.5,Y:.06};baseData.Offset={X:0,Y:0,Z:0};baseData.LineHeight=1.05;baseData.WidthScale=.85;baseData.LineOffset=0;
 function display(key,pos,text,lineHeight=1.2,size=[11,1,2]){const data=structuredClone(baseData);Object.assign(data,{Text:text,Anchor:{X:.5,Y:.5},Offset:{X:0,Y:0,Z:0},LineHeight:lineHeight,WidthScale:1,LineOffset:0,Kerning:0});const b={key,g:1,data:{asset:'PB_DefaultMicroBrick',material:'BMC_Glow',position:pos,size,direction:4,rotation:0,collision:{player:false,weapon:false,interaction:false,tool:false,physics:false},visibility:false,material_intensity:0,color:[0,0,0],owner_index:0},comps:[{type:C.TextDisplay.NAME,data}]};scene.bricks.push(b);return {key,type:C.TextDisplay.NAME};}
 const header=display('three-menu:page',[6118,-75361,11052],'MENU 1 / 3',1,[18,1,2]);const labels=[display('three-menu:item0',[6110,-75361,11045],'ITEM',1.2,[8,1,2]),display('three-menu:item1',[6110,-75361,11038],'ITEM',1.2,[8,1,2]),display('three-menu:item2',[6110,-75361,11031],'ITEM',1.2,[8,1,2])];
 const countDisplays=[display('three-menu:count0',[6121,-75361,11045],'0',.8,[2,1,2]),display('three-menu:count1',[6121,-75361,11038],'0',.8,[2,1,2]),display('three-menu:count2',[6121,-75361,11031],'0',.8,[2,1,2])];
 const arrows=[display('three-menu:up',[6131,-75361,11045],'▲ UP',1.5,[5,1,3]),display('three-menu:down',[6131,-75361,11031],'▼ DOWN',1.5,[5,1,3])];
 const pageNum=math('Add',menu,'Value',{InputB:N(1)}),pageText=node('Expr_String_FormatText',{FormatString:'MENU {A} / 3'});wire(pageNum,'Output',pageText,'InputA');wire(pageText,'Output',header,'Text');
 const names=[['🍪 GENERATORS','⚡ UPGRADES (LOCKED)','📊 STATISTICS'],['🍪 COOKIE','⚙ FACTORY (TOO EXPENSIVE)','💎 MINE'],['⚡ POWER','⏱ SPEED (LOCKED)','💰 DISCOUNT']];
 const invalidFlashes=Array.from({length:5},()=>node('Var',{Value:B(false)}));
 const pressed=Array.from({length:5},()=>node('Var',{Value:B(false)}));
 function selectionColor(displayNode,selectedSignal,invalidSignal){for(const [channel,normal,orange,red] of [['R',255,255,255],['G',255,135,25],['B',255,20,20]]){const selectedColor=node('Expr_Select',{InputA:N(normal),InputB:N(orange),bSelectB:false});wire(selectedSignal,'bOutput',selectedColor,'bSelectB');const finalColor=node('Expr_Select',{InputA:N(normal),InputB:N(red),bSelectB:false});wire(selectedColor,'Output',finalColor,'InputA');wire(invalidSignal,'Value',finalColor,'bSelectB');wire(finalColor,'Output',displayNode,`Color.${channel}`);}}
 const selectedSignals=[];
 for(let i=0;i<3;i++){
  const isMenu1=node('Expr_CompareEqual',{InputB:N(1)});wire(menu,'Value',isMenu1,'InputA');const isMenu2=node('Expr_CompareEqual',{InputB:N(2)});wire(menu,'Value',isMenu2,'InputA');
  const choose1=node('Expr_Select',{InputA:S(names[0][i]),InputB:S(names[1][i]),bSelectB:false});wire(isMenu1,'bOutput',choose1,'bSelectB');const choose2=node('Expr_Select',{InputA:S(''),InputB:S(names[2][i]),bSelectB:false});wire(choose1,'Output',choose2,'InputA');wire(isMenu2,'bOutput',choose2,'bSelectB');
  const selected=node('Expr_CompareEqual',{InputB:N(i)});wire(selection,'Value',selected,'InputA');selectedSignals[i]=selected;const marked=node('Expr_String_FormatText',{FormatString:'> {A} <'});wire(choose2,'Output',marked,'InputA');const final=node('Expr_Select',{InputA:S(''),InputB:S(''),bSelectB:false});wire(choose2,'Output',final,'InputA');wire(marked,'Output',final,'InputB');wire(selected,'bOutput',final,'bSelectB');wire(final,'Output',labels[i],'Text');selectionColor(labels[i],selected,invalidFlashes[i]);
  const ct=node('Expr_String_FormatText',{FormatString:'x{A}'});wire(counts[i],'Value',ct,'InputA');wire(ct,'Output',countDisplays[i],'Text');
 }
 ['▲ UP','▼ DOWN'].forEach((text,i)=>{const slot=i+3,selected=node('Expr_CompareEqual',{InputB:N(slot)});wire(selection,'Value',selected,'InputA');selectedSignals[slot]=selected;const choice=node('Expr_Select',{InputA:S(`  ${text}  `),InputB:S(`> ${text} <`),bSelectB:false});wire(selected,'bOutput',choice,'bSelectB');wire(choice,'Output',arrows[i],'Text');selectionColor(arrows[i],selected,invalidFlashes[slot]);});
 [...labels,...arrows].forEach((d,i)=>{
  const highlighted=node('Expr_Select',{InputA:N(1),InputB:N(1.2),bSelectB:false});wire(selectedSignals[i],'bOutput',highlighted,'bSelectB');
  const visualScale=node('Expr_Select',{InputA:N(1),InputB:N(1),bSelectB:false});wire(highlighted,'Output',visualScale,'InputA');wire(pressed[i],'Value',visualScale,'bSelectB');wire(visualScale,'Output',d,'WidthScale');
  const h=math('Multiply',visualScale,'Output',{InputB:N(i<3?1.2:1.5)});wire(h,'Output',d,'LineHeight');
  const down=setConst(pressed[i],B(true),branches[i]),wait=node('BufferTicks',{TicksToWait:30,ZeroTicksToWait:0}),restore=setConst(pressed[i],B(false),wait,'Output');wire(down,'ExecOut',wait,'Input');
 });
 // The middle entry is the unavailable example. It remains unpurchased and
 // overrides orange with red for the duration of the click depression.
 const failOn=setConst(invalidFlashes[1],B(true),branches[1]),failWait=node('BufferTicks',{TicksToWait:30,ZeroTicksToWait:0}),failOff=setConst(invalidFlashes[1],B(false),failWait,'Output');wire(failOn,'ExecOut',failWait,'Input');
 const entity=one([...scene.r.entities()].filter(e=>e.persistentIndex===grid),'chip entity');scene.entityOverrides=new Map([[grid,{...entity,data:{...structuredClone(entity.data),bCollapsed:true,PlaneCenter:{X:216,Y:216,Z:2},PlaneExtent:{X:260,Y:260,Z:8}}}]]);
 const name='Monitor Frame - Three Menu Feedback Demo V4',description='Three-page spatial menu: selected controls are orange and 20% larger; clicks depress for half a second; unavailable middle entries flash red.';
 const generated=write(scene,{assets:scene.r.externalAssets(),name,description}).bytes,bytes=repack(generated,donor,{name,description}),placement=validate(bytes);assert(placement.strictOk,JSON.stringify(placement,null,2));return {bytes,placement,summary:{bricks:scene.bricks.length,gates:nodes.length,wires:scene.edges.length,textDisplays:scene.bricks.filter(b=>b.comps.some(c=>c.type===C.TextDisplay.NAME)).length,buttons:0,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
module.exports=build;if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-monitor-three-menu-scroll-demo.cjs input.brz output.brz');const r=build(input);fs.writeFileSync(output,r.bytes);console.log(JSON.stringify({output,bytes:r.bytes.length,...r.summary,strictPlacement:r.placement.strictOk,warnings:r.placement.warnings||[]},null,2));}

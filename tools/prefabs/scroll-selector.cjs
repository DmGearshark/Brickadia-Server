const fs = require('node:fs');
const assert = require('node:assert/strict');
const {World, WorldReader, brdb:b} = require('brs-js');
const C=b.COMPONENTS, w=new World(), nodes=[], links=[];
const names=['Avery','Blake','Casey','Dakota','Emery','Finley','Harper','Jordan','Kai','Logan','Morgan','Nova','Oakley','Parker','Quinn','Riley','Rowan','Sage','Skyler','Taylor'];
const N=value=>({$variant:'f64',value});
const S=value=>({$variant:'str',value});
function node(key,data={},opts={}){
 const c=C[key]; assert(c,key);
 const i=nodes.length;
 const position=opts.position||[-160+(i%12)*25,35,20+Math.floor(i/12)*25];
 const input={asset:c.BRICK||'PB_DefaultBrick',position,color:[100,120,145],components:[{type:c.NAME,data}],...opts};
 if(key==='Button')input.components.push({type:C.TextDisplay.NAME,data:{Text:data.PromptCustomLabel==='Scroll up'?'UP':data.PromptCustomLabel==='Scroll down'?'DOWN':'SELECT',Face:3,LineHeight:7,Offset:{X:0,Y:-0.5,Z:0},bForeground:true}});
 if(input.asset.startsWith('PB_')&&!input.size)input.size=[8,4,8];
 const brick=w.addBrick(input); const n={brick,key,data};nodes.push(n);return n;
}
function wire(a,port,z,input){
 const sourceType=C[a.key].NAME,targetType=C[z.key].NAME;
 assert(b.COMPONENT_WIRE_PORTS.get(sourceType).outputs.includes(port),`${a.key}.${port}`);
 assert(b.COMPONENT_WIRE_PORTS.get(targetType).inputs.includes(input),`${z.key}.${input}`);
 w.addWire({brick:a.brick,component_type:sourceType,port},{brick:z.brick,component_type:targetType,port:input});
 links.push({a:nodes.indexOf(a),port,z:nodes.indexOf(z),input});
}
function label(text,x,z,size=9,color=[32,40,55]){
 return node('TextDisplay',{Text:text,Face:3,LineHeight:size,Offset:{X:0,Y:-0.5,Z:0},bForeground:true},{asset:'PB_DefaultBrick',size:[52,2,9],position:[x,-7,z],color});
}
// Upright panel: front faces negative Y. Logic remains accessible on the back.
w.addBrick({size:[190,6,120],position:[0,0,125],color:[20,25,36]});
w.addBrick({size:[200,30,5],position:[0,0,5],color:[35,43,58]});
const up=node('Button',{PromptCustomLabel:'Scroll up'},{position:[-70,-12,220],size:[35,5,10],color:[40,110,165]});
const down=node('Button',{PromptCustomLabel:'Scroll down'},{position:[-70,-12,30],size:[35,5,10],color:[40,110,165]});
const select=node('Button',{PromptCustomLabel:'Select middle name'},{position:[30,-12,125],size:[25,5,14],color:[30,145,95]});
label('NAME SELECTOR',-70,245,8);label('SELECTED',125,165,8);
const diff=node('Expr_MathSubtract'); wire(down,'PressCount',diff,'InputA');wire(up,'PressCount',diff,'InputB');
const center=node('Expr_MathAdd',{InputB:N(2)});wire(diff,'Output',center,'InputA');
const packed=names.map(n=>n.padEnd(8)).join('');
const rows=[];
for(let offset=-2;offset<=2;offset++){
 const add=node('Expr_MathAdd',{InputB:N(offset)});wire(center,'Output',add,'InputA');
 const mod=node('Expr_MathModuloFloored',{InputB:N(20)});wire(add,'Output',mod,'InputA');
 const mul=node('Expr_MathMultiply',{InputB:N(8)});wire(mod,'Output',mul,'InputA');
 const sub=node('Expr_String_Substring',{Input:packed,Length:8});wire(mul,'Output',sub,'Start');
 const trim=node('Expr_String_Trim');wire(sub,'Output',trim,'Input');
 const display=label(names[offset+2],-70,125-offset*30,10,offset===0?[25,90,145]:[32,40,55]);
 wire(trim,'Output',display,'Text');rows.push(trim);
}
const selected=node('Var',{Value:S('(none)')});
const edge=node('Expr_EdgeDetectorExec');wire(select,'bHeld',edge,'Input');
const set=node('Exec_Var_Set',{bChangeType:false,Value:S('')});
wire(edge,'OnRisingEdge',set,'Exec');wire(rows[2],'Output',set,'Value');wire(selected,'VarRef',set,'VarRef');
const result=label('(none)',125,125,10);wire(selected,'Value',result,'Text');
label('>',-5,125,12);
w.makePrefab({snap:10});
const bytes=w.toBrz({bundle:{name:'Scrolling Name Selector',description:'20-name wrapping selector. Up/down browse; Select latches the middle name. Front faces negative Y.'}});
const r=WorldReader.from(bytes);let nc=0,nw=0;
for(const chunk of r.brickChunkIndex()){
 if(chunk.numComponents)nc+=r.componentChunk(1,chunk.index).components.length;
 if(chunk.numWires){const v=r.wireChunk(1,chunk.index);nw+=v.local.length+v.remote.length;}
}
assert.equal(nc,nodes.length+3);assert.equal(nw,links.length);assert(r.prefabJson());
// Evaluate the generated expression graph for every row at each wrap boundary.
function value(n,port,upCount,downCount){
 const idx=nodes.indexOf(n);
 function input(p){const l=links.find(l=>l.z===idx&&l.input===p);if(l)return value(nodes[l.a],l.port,upCount,downCount);const v=n.data[p];return v&&typeof v==='object'&&'$variant'in v?v.value:v;}
 if(n===up)return upCount;if(n===down)return downCount;
 switch(n.key){
 case 'Expr_MathSubtract':return input('InputA')-input('InputB');
 case 'Expr_MathAdd':return (input('InputA')||0)+(input('InputB')||0);
 case 'Expr_MathMultiply':return input('InputA')*input('InputB');
 case 'Expr_MathModuloFloored':return ((input('InputA')%input('InputB'))+input('InputB'))%input('InputB');
 case 'Expr_String_Substring':return input('Input').substr(input('Start'),input('Length'));
 case 'Expr_String_Trim':return input('Input').trim();
 default:throw Error(n.key);
 }
}
for(let u=0;u<45;u++)for(let d=0;d<45;d++)rows.forEach((n,i)=>assert.equal(value(n,'Output',u,d),names[((d-u+i)%20+20)%20]));
const out=process.argv[2]||'/workspace/outputs/scrolling-name-selector.brz';
fs.writeFileSync(out,bytes);
console.log(JSON.stringify({output:out,bricks:[...r.bricks()].length,components:nc,wires:nw,expressionChecks:45*45*5,bytes:bytes.length},null,2));

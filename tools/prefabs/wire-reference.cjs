const fs = require('node:fs');
const assert = require('node:assert/strict');
const {World, WorldReader, brdb:b} = require('brs-js');
const C=b.COMPONENTS, w=new World(), nodes=[], links=[];
const inputPath=process.argv[2];
if(!inputPath||!process.argv[3])throw Error('Usage: node wire-reference.cjs reference.brz output.brz');
const reference=WorldReader.from(fs.readFileSync(inputPath));
assert.deepEqual(reference.gridIds(),[1]);
assert.equal([...reference.entities()].length,0);
const originals=[...reference.bricks()];
const referenceComponents=[];
for(const chunk of reference.brickChunkIndex()){
 assert.equal(chunk.numWires,0);
 // This labeled reference has one chunk; indices are chunk-local.
 assert.equal(reference.brickChunkIndex().length,1);
 referenceComponents.push(...reference.componentChunk(1,chunk.index).components);
}
const lookup=new Map();
const expectedComponents=[];
for(let i=0;i<originals.length;i++){
 const original=originals[i];
 const components=referenceComponents.filter(c=>c.brickIndex===i).map(c=>({type:c.typeName,data:structuredClone(c.data)}));
 const text=components.find(c=>c.type===C.TextDisplay.NAME)?.data.Text;
 const match=/^Name ([1-5])$/.exec(text||'');
 if(match)components.find(c=>c.type===C.TextDisplay.NAME).data.Text=namesPlaceholder(Number(match[1])-1);
 if(text==='Selected Name')components.find(c=>c.type===C.TextDisplay.NAME).data.Text='(none)';
 const brick=w.addBrick({...original,asset:reference.brickAssets()[original.asset_name_index],material:reference.materials()[original.material_index],components});
 expectedComponents.push(components);
 for(const c of components){
  const key=Object.keys(C).find(k=>C[k].NAME===c.type);assert(key,c.type);
  const n={brick,key,data:c.data};nodes.push(n);
  lookup.set(`${text}|${key}`,n);
 }
}
function namesPlaceholder(i){return ['Avery','Blake','Casey','Dakota','Emery'][i];}
const up=lookup.get('Scroll Up button|Button');
const down=lookup.get('Scroll Down Button|Button');
const select=lookup.get('Select\r\nbutton|Button');
assert(up&&down&&select,'Expected three labeled buttons');
const origin=originals.find((_,i)=>referenceComponents.some(c=>c.brickIndex===i&&c.data?.Text==='Name 3')).position;

const names=['Avery','Blake','Casey','Dakota','Emery','Finley','Harper','Jordan','Kai','Logan','Morgan','Nova','Oakley','Parker','Quinn','Riley','Rowan','Sage','Skyler','Taylor'];
const N=value=>({$variant:'f64',value});
const S=value=>({$variant:'str',value});
function node(key,data={},opts={}){
 const c=C[key]; assert(c,key);
 const i=nodes.length;
 const position=opts.position||[origin[0]-150+(i%10)*20,origin[1]+30,origin[2]-30+Math.floor(i/10)*20];
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
 const display=lookup.get(`Name ${offset+3}|TextDisplay`);assert(display);
 wire(trim,'Output',display,'Text');rows.push(trim);
}
const selected=node('Var',{Value:S('(none)')});
const edge=node('Expr_EdgeDetectorExec');wire(select,'bHeld',edge,'Input');
const set=node('Exec_Var_Set',{bChangeType:false,Value:S('')});
wire(edge,'OnRisingEdge',set,'Exec');wire(rows[2],'Output',set,'Value');wire(selected,'VarRef',set,'VarRef');
const result=lookup.get('Selected Name|TextDisplay');wire(selected,'Value',result,'Text');
const bytes=w.toBrz({bundle:{...reference.bundle(),name:'Display Reference - Wired'},prefab:reference.prefabJson(),externalAssets:reference.externalAssets(),thumbnail:reference.thumbnail()});
const r=WorldReader.from(bytes);let nc=0,nw=0;
for(const chunk of r.brickChunkIndex()){
 if(chunk.numComponents)nc+=r.componentChunk(1,chunk.index).components.length;
 if(chunk.numWires){const v=r.wireChunk(1,chunk.index);nw+=v.local.length+v.remote.length;}
}
assert.equal(nc,nodes.length);assert.equal(nw,links.length);assert.deepEqual(r.prefabJson(),reference.prefabJson());
// Confirm every reference brick survives with exact geometry, materials and styling.
const decoded=[...r.bricks()];
for(let i=0;i<originals.length;i++){
 const match=decoded.filter(br=>br.position.join(',')===originals[i].position.join(','));
 assert.equal(match.length,1);
 const actual={...match[0],asset: r.brickAssets()[match[0].asset_name_index],material:r.materials()[match[0].material_index]};
 const expected={...originals[i],asset:reference.brickAssets()[originals[i].asset_name_index],material:reference.materials()[originals[i].material_index]};
 delete actual.asset_name_index;delete actual.material_index;delete expected.asset_name_index;delete expected.material_index;
 assert.deepEqual(actual,expected);
}
for(const chunk of r.brickChunkIndex()){
 const soa=r.brickChunkSoa(1,chunk.index);
 const comps=r.componentChunk(1,chunk.index).components;
 for(const c of comps){
  const pos=soa.RelativePositions[c.brickIndex];
  const coords=[chunk.index.x*2048+1024+pos.X,chunk.index.y*2048+1024+pos.Y,chunk.index.z*2048+1024+pos.Z];
  const index=originals.findIndex(br=>br.position.join(',')===coords.join(','));
  if(index>=0){const expected=expectedComponents[index].find(e=>e.type===c.typeName);assert(expected);assert.deepEqual(c.data,expected.data);}
 }
}
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
const out=process.argv[3];
fs.writeFileSync(out,bytes);
console.log(JSON.stringify({output:out,bricks:[...r.bricks()].length,components:nc,wires:nw,expressionChecks:45*45*5,bytes:bytes.length},null,2));

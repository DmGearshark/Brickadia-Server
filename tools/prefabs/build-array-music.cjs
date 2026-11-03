'use strict';
const fs=require('fs'),assert=require('assert/strict');const {World,WorldReader,brdb:b}=require('brs-js');
const [score,presetPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: node build-array-music.cjs notes.json preset.brz output.brz');
const notes=JSON.parse(fs.readFileSync(score)).sort((a,z)=>a.time-z.time),preset=WorldReader.from(fs.readFileSync(presetPath));
const presetComponent=preset.componentChunk(1,preset.brickChunkIndex()[0].index).components.find(c=>c.typeName==='Component_OneShotAudioEmitter');assert(presetComponent);
const voices=[];for(const n of notes){let v=voices.find(v=>v.at(-1).time+v.at(-1).duration<=n.time+1e-7);if(!v){v=[];voices.push(v);}v.push(n);}assert.equal(voices.length,6);
const duration=Math.max(...notes.map(n=>n.time+n.duration)),w=new World(),C=b.COMPONENTS,N=value=>({$variant:'f64',value}),B=value=>({$variant:'Bool',value});
const chip=w.addMicrochip({position:[0,0,2],color:[65,110,150]});let count=0;const nodes=[],links=[],inputs=new Set(),arrays=[];
function node(k,data={},main=false,pos){const c=C[k],i=count++;assert(c,k);const tiny=k==='OneShotAudioEmitter';const brick=w.addBrick({asset:tiny?'PB_DefaultMicroBrick':c.BRICK||'PB_DefaultMicroBrick',...(tiny||!c.BRICK?{size:[1,1,1]}:{}),position:pos||[(i%20)*12,Math.floor(i/20)*12,2],color:[65,100,145],components:[{type:c.NAME,data}]},main?undefined:chip.grid);const z={brick,k,data,id:nodes.length};nodes.push(z);return z;}
function wire(a,p,z,q){const key=z.id+':'+q;assert(!inputs.has(key),'Multiple sources for '+z.k+'.'+q);inputs.add(key);assert(b.COMPONENT_WIRE_PORTS.get(C[a.k].NAME).outputs.includes(p),a.k+'.'+p);assert(b.COMPONENT_WIRE_PORTS.get(C[z.k].NAME).inputs.includes(q),z.k+'.'+q);w.addWire({brick:a.brick,component_type:C[a.k].NAME,port:p},{brick:z.brick,component_type:C[z.k].NAME,port:q});links.push({source:a.id,port:p,target:z.id,input:q});}
function op(k,a,p,z,q){const n=node(k);wire(a,p,n,q);return n;}
function binary(k,a,p,z,q){const n=node(k);wire(a,p,n,'bInputA');wire(z,q,n,'bInputB');return n;}
function setter(ref,value){const n=node('Exec_Var_Set',{Value:value});wire(ref,'VarRef',n,'VarRef');return n;}
function button(label,x,color){const brick=w.addBrick({asset:'PB_DefaultMicroBrick',size:[12,8,2],position:[x,-18,2],color,components:[{type:C.Button.NAME,data:{PromptCustomLabel:label}},{type:C.TextDisplay.NAME,data:{Text:label,Face:4,LineHeight:6}}]});const n={brick,k:'Button',id:nodes.length};nodes.push(n);return n;}
function label(t,x,y){w.addBrick({asset:'PB_DefaultMicroBrick',size:[20,5,1],position:[x,y,1],color:[25,30,40],components:[{type:C.TextDisplay.NAME,data:{Text:t,Face:4,LineHeight:3}}]});}
const play=button('PLAY',-17,[30,150,70]),stop=button('STOP',17,[180,45,40]);
const tune=node('Var',{Value:N(1)},true,[-17,-38,2]),volume=node('Var',{Value:N(.15)},true,[17,-38,2]);label('MASTER PITCH',-24,-50);label('MASTER VOLUME',24,-50);label('VIVA LA VIDA / 6 VOICES',0,-62);
const running=node('Var',{Value:B(false)}),start=node('Var',{Value:N(0)}),clock=node('Stopwatch',{Time:0,Limit:1e9,bRunning:true});
const elapsed=node('Expr_MathSubtract');wire(clock,'Time',elapsed,'InputA');wire(start,'Value',elapsed,'InputB');
const idle=op('Expr_LogicalNOT',running,'Value',null,'bInput'),allowed=binary('Expr_LogicalAND',play,'bHeld',idle,'bOutput');const playEdge=op('Expr_EdgeDetectorExec',allowed,'bOutput',null,'Input');
const capture=node('Exec_Var_Set');wire(start,'VarRef',capture,'VarRef');wire(clock,'Time',capture,'Value');wire(playEdge,'OnRisingEdge',capture,'Exec');
const go=setter(running,B(true));wire(capture,'ExecOut',go,'Exec');
const finish=node('Expr_CompareGreaterOrEqual',{InputB:N(duration+.25)});wire(elapsed,'Output',finish,'InputA');const finishPlaying=binary('Expr_LogicalAND',finish,'bOutput',running,'Value');const stopSignal=binary('Expr_LogicalOR',stop,'bHeld',finishPlaying,'bOutput');const stopEdge=op('Expr_EdgeDetectorExec',stopSignal,'bOutput',null,'Input');const halt=setter(running,B(false));wire(stopEdge,'OnRisingEdge',halt,'Exec');
for(let v=0;v<voices.length;v++){
 const list=voices[v],sentinel=duration+10000;
 const columns=[list.map(n=>n.time).concat(sentinel),list.map(n=>n.time+n.duration).concat(sentinel+1),list.map(n=>2**((n.pitch-69)/12)).concat(1),list.map(n=>n.velocity/127).concat(0)];
 const index=node('Var',{Value:N(0)}),active=node('Var',{Value:B(false)}),loaded=node('Var',{Value:B(false)});
 const reset=setter(index,N(0));wire(go,'ExecOut',reset,'Exec');const advance=node('Exec_Var_Increment',{Value:N(1)});wire(index,'VarRef',advance,'VarRef');
 const load=node('Exec_Union');wire(reset,'ExecOut',load,'ExecA');wire(advance,'ExecOut',load,'ExecB');
 const unload=setter(loaded,B(false));wire(load,'ExecOut',unload,'Exec');
 const getters=[];let previous=unload;
 for(const column of columns){const a=node('ArrayVar',{Value:{$elementType:'f64',$array:column}});arrays.push(column);const get=node('Exec_ArrayVar_Get');wire(a,'ArrayVarRef',get,'ArrayVarRef');wire(index,'Value',get,'Index');wire(previous,'ExecOut',get,'Exec');previous=get;getters.push(get);}
 const ready=setter(loaded,B(true));wire(previous,'ExecOut',ready,'Exec');
 const begin=node('Expr_CompareGreaterOrEqual');wire(elapsed,'Output',begin,'InputA');wire(getters[0],'Value',begin,'InputB');
 const end=node('Expr_CompareGreaterOrEqual');wire(elapsed,'Output',end,'InputA');wire(getters[1],'Value',end,'InputB');
 const inactive=op('Expr_LogicalNOT',active,'Value',null,'bInput');
 const canPlay=binary('Expr_LogicalAND',running,'Value',loaded,'Value');const due=binary('Expr_LogicalAND',begin,'bOutput',canPlay,'bOutput');const fire=binary('Expr_LogicalAND',due,'bOutput',inactive,'bOutput');
 const on=op('Expr_EdgeDetectorExec',fire,'bOutput',null,'Input');const setOn=setter(active,B(true));wire(on,'OnRisingEdge',setOn,'Exec');
 const endOrStop=binary('Expr_LogicalOR',end,'bOutput',idle,'bOutput');const ending=binary('Expr_LogicalAND',endOrStop,'bOutput',active,'Value');const off=op('Expr_EdgeDetectorExec',ending,'bOutput',null,'Input');const setOff=setter(active,B(false));wire(off,'OnRisingEdge',setOff,'Exec');
 // Break the immediate feedback path and disarm the voice while advancing.
 const invalidate=setter(loaded,B(false));wire(setOff,'ExecOut',invalidate,'Exec');
 const deferred=node('BufferTicks',{TicksToWait:1,ZeroTicksToWait:0});
 wire(invalidate,'ExecOut',deferred,'Input');wire(deferred,'Output',advance,'Exec');
 const emitter=node('OneShotAudioEmitter',{...presetComponent.data,bSpatialization:false,bEnableRepeat:false,VolumeMultiplier:.15},true,[v*4-10,12,1]);wire(setOn,'ExecOut',emitter,'Play');wire(setOff,'ExecOut',emitter,'Stop');
 const pitch=node('Expr_MathMultiply');wire(getters[2],'Value',pitch,'InputA');wire(tune,'Value',pitch,'InputB');wire(pitch,'Output',emitter,'PitchMultiplier');
 const gain=node('Expr_MathMultiply');wire(getters[3],'Value',gain,'InputA');wire(volume,'Value',gain,'InputB');wire(gain,'Output',emitter,'VolumeMultiplier');
}
w.makePrefab({snap:10});const bytes=w.toBrz({bundle:{name:'Viva La Vida - Array Sequencer',description:'Full supplied MIDI stored in 24 arrays, six reusable polyphonic voices. Play/Stop. OBA_Beep_1; absolute pitch uncalibrated.'},externalAssets:preset.externalAssets()});
const r=WorldReader.from(bytes);let components=0,emitters=0,arrayCount=0,wireCount=0;const decodedInputs=new Set();for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g)){if(ch.numComponents)for(const c of r.componentChunk(g,ch.index).components){components++;if(c.typeName===C.OneShotAudioEmitter.NAME)emitters++;if(c.typeName===C.ArrayVar.NAME){assert.deepEqual(c.data.Value.$elementType,'f64');arrayCount++;assert(arrays.some(a=>JSON.stringify(a)===JSON.stringify(c.data.Value.$array)));}}if(ch.numWires){const ws=r.wireChunk(g,ch.index);for(const e of [...ws.local,...ws.remote]){const key=JSON.stringify([g,ch.index,e.target]);assert(!decodedInputs.has(key),'Duplicate saved input');decodedInputs.add(key);wireCount++;}}}
assert.equal(emitters,6);assert.equal(arrayCount,24);assert.equal(wireCount,links.length);
// Reconstruct every real note from stored columns, not just a note count.
for(let v=0;v<voices.length;v++)for(let i=0;i<voices[v].length;i++){const n=voices[v][i];assert.equal(arrays[v*4][i],n.time);assert.equal(arrays[v*4+1][i],n.time+n.duration);assert.equal(arrays[v*4+2][i],2**((n.pitch-69)/12));assert.equal(arrays[v*4+3][i],n.velocity/127);if(i)assert(voices[v][i-1].time+voices[v][i-1].duration<=n.time+1e-7);}
fs.writeFileSync(out,bytes);console.log(JSON.stringify({out,notes:notes.length,voices:voices.length,arrays:arrayCount,components,bricks:r.gridIds().reduce((n,g)=>n+[...r.bricks(g)].length,0),wires:wireCount,bytes:bytes.length,singleSourceInputs:true},null,2));

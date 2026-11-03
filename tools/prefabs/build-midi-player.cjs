const fs=require('fs'),assert=require('assert/strict');
const {World,WorldReader,brdb:b}=require('brs-js');
const [notesFile,presetFile,output]=process.argv.slice(2);if(!output)throw Error('Usage: node build-midi-player.cjs notes.json preset.brz output.brz');
const notes=JSON.parse(fs.readFileSync(notesFile));const preset=WorldReader.from(fs.readFileSync(presetFile));
const sample=preset.componentChunk(1,preset.brickChunkIndex()[0].index).components.find(c=>c.typeName==='Component_OneShotAudioEmitter');assert(sample);
const w=new World(),C=b.COMPONENTS,N=value=>({$variant:'f64',value}),B=value=>({$variant:'Bool',value});
const chip=w.addMicrochip({position:[0,0,2],color:[50,100,150]});let count=0,wireCount=0;const all=[];
function node(k,data={},main=false,pos){const c=C[k];assert(c,k);const i=count++;const small=k==='OneShotAudioEmitter';const brick=w.addBrick({asset:small?'PB_DefaultMicroBrick':c.BRICK||'PB_DefaultMicroBrick',...(small||!c.BRICK?{size:[1,1,1]}:{}),position:pos||[(i%90)*12,Math.floor(i/90)*12,2],color:[70,100,130],components:[{type:c.NAME,data}]},main?undefined:chip.grid);const n={brick,k,data};all.push(n);return n;}
function wire(a,p,z,q){assert(b.COMPONENT_WIRE_PORTS.get(C[a.k].NAME).outputs.includes(p),a.k+'.'+p);assert(b.COMPONENT_WIRE_PORTS.get(C[z.k].NAME).inputs.includes(q),z.k+'.'+q);w.addWire({brick:a.brick,component_type:C[a.k].NAME,port:p},{brick:z.brick,component_type:C[z.k].NAME,port:q});wireCount++;}
function button(label,x,color){const brick=w.addBrick({asset:'PB_DefaultMicroBrick',size:[12,8,2],position:[x,-18,2],color,components:[{type:C.Button.NAME,data:{PromptCustomLabel:label}},{type:C.TextDisplay.NAME,data:{Text:label,LineHeight:6,Face:4}}]});const n={brick,k:'Button'};all.push(n);return n;}
const play=button('PLAY',-17,[35,150,80]),stop=button('STOP',17,[180,45,45]);
const running=node('Var',{Value:B(false)}),start=node('Var',{Value:N(0)}),tune=node('Var',{Value:N(1)},true,[-17,-40,2]),volume=node('Var',{Value:N(0.15)},true,[17,-40,2]);
function label(text,x,y){w.addBrick({asset:'PB_DefaultMicroBrick',size:[22,6,1],position:[x,y,1],color:[25,30,40],components:[{type:C.TextDisplay.NAME,data:{Text:text,Face:4,LineHeight:4}}]});}
label('PITCH x1 (A4 = preset)',-28,-53);label('VOLUME x0.15',28,-53);label('VIVA LA VIDA - MIDI BEEP PLAYER',0,-67);
const clock=node('Stopwatch',{Limit:1e9,Time:0,bRunning:true}),elapsed=node('Expr_MathSubtract');wire(clock,'Time',elapsed,'InputA');wire(start,'Value',elapsed,'InputB');
const notRunning=node('Expr_LogicalNOT');wire(running,'Value',notRunning,'bInput');const allowPlay=node('Expr_LogicalAND');wire(play,'bHeld',allowPlay,'bInputA');wire(notRunning,'bOutput',allowPlay,'bInputB');const playEdge=node('Expr_EdgeDetectorExec');wire(allowPlay,'bOutput',playEdge,'Input');
const capture=node('Exec_Var_Set');wire(playEdge,'OnRisingEdge',capture,'Exec');wire(start,'VarRef',capture,'VarRef');wire(clock,'Time',capture,'Value');
const go=node('Exec_Var_Set',{Value:B(true)});wire(capture,'ExecOut',go,'Exec');wire(running,'VarRef',go,'VarRef');
const stopEdge=node('Expr_EdgeDetectorExec');wire(stop,'bHeld',stopEdge,'Input');const halt=node('Exec_Var_Set',{Value:B(false)});wire(stopEdge,'OnRisingEdge',halt,'Exec');wire(running,'VarRef',halt,'VarRef');
const times=new Map();
function event(t){const key=t.toFixed(6);if(times.has(key))return times.get(key);const cmp=node('Expr_CompareGreaterOrEqual',{InputB:N(+key)});wire(elapsed,'Output',cmp,'InputA');const gate=node('Expr_LogicalAND');wire(cmp,'bOutput',gate,'bInputA');wire(running,'Value',gate,'bInputB');const edge=node('Expr_EdgeDetectorExec');wire(gate,'bOutput',edge,'Input');times.set(key,edge);return edge;}
const pitches=new Map(),velocities=new Map();function pitch(n){if(!pitches.has(n)){const z=node('Expr_MathMultiply',{InputA:N(2**((n-69)/12))});wire(tune,'Value',z,'InputB');pitches.set(n,z);}return pitches.get(n);}
function gain(v){if(!velocities.has(v)){const z=node('Expr_MathMultiply',{InputA:N(v/127)});wire(volume,'Value',z,'InputB');velocities.set(v,z);}return velocities.get(v);}
notes.forEach((n,i)=>{const s=node('OneShotAudioEmitter',{...sample.data,bSpatialization:false,bEnableRepeat:false,VolumeMultiplier:n.velocity/127*.15,PitchMultiplier:2**((n.pitch-69)/12)},true,[(i%60)*2,8+Math.floor(i/60)*2,1]);wire(event(n.time),'OnRisingEdge',s,'Play');wire(event(n.time+n.duration),'OnRisingEdge',s,'Stop');wire(halt,'ExecOut',s,'Stop');wire(pitch(n.pitch),'Output',s,'PitchMultiplier');wire(gain(n.velocity),'Output',s,'VolumeMultiplier');});
const duration=Math.max(...notes.map(n=>n.time+n.duration));wire(event(duration+0.25),'OnRisingEdge',halt,'Exec');
w.makePrefab({snap:10});const bytes=w.toBrz({bundle:{name:'Viva La Vida - MIDI Logic Player',description:'2658-note user-supplied MIDI arranged for OBA_Beep_1. Play/Stop. Master pitch x1 anchors MIDI69 to default beep; absolute tuning uncalibrated. One-shot sample cannot sustain beyond its own length.'},externalAssets:preset.externalAssets()});
const r=WorldReader.from(bytes);let emitters=0,wires=0,components=0;for(const g of r.gridIds())for(const ch of r.brickChunkIndex(g)){if(ch.numComponents){const c=r.componentChunk(g,ch.index).components;components+=c.length;emitters+=c.filter(c=>c.typeName===C.OneShotAudioEmitter.NAME).length;}if(ch.numWires){const v=r.wireChunk(g,ch.index);wires+=v.local.length+v.remote.length;}}
assert.equal(emitters,notes.length);assert.equal(wires,wireCount);assert.equal(notes.length,2658);
// Check schedule identity, duration and note pitch ratios rather than claiming game playback.
for(const n of notes){assert(times.has(n.time.toFixed(6)));assert(times.has((n.time+n.duration).toFixed(6)));assert(n.duration>0);assert(Math.abs(pitches.get(n.pitch).data.InputA.value-2**((n.pitch-69)/12))<1e-12);}
const outer=[...r.bricks()].map(br=>{const asset=r.brickAssets()[br.asset_name_index];let size=br.size;if(asset.startsWith('B_')){assert(['B_1x1_Gate_Variable','B_1x1_Microchip'].includes(asset),asset);size=[5,5,2];}return {...br,asset,size};}).sort((a,z)=>(a.position[0]-a.size[0])-(z.position[0]-z.size[0]));
for(let i=0;i<outer.length;i++)for(let j=i+1;j<outer.length;j++){const a=outer[i],z=outer[j];if(z.position[0]-z.size[0]>=a.position[0]+a.size[0])break;assert(!a.position.every((v,k)=>Math.abs(v-z.position[k])<a.size[k]+z.size[k]),'Outer brick overlap');}
assert.equal(outer.filter(br=>br.asset==='PB_DefaultMicroBrick').length,notes.length+5);
fs.writeFileSync(output,bytes);console.log(JSON.stringify({output,notes:notes.length,duration,eventTimes:times.size,pitches:pitches.size,components,wires,grids:r.gridIds().length,bytes:bytes.length,absolutePitchCalibrated:false},null,2));

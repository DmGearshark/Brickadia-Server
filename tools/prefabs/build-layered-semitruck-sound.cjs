'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {WorldReader}=require('./node_modules/brs-js');
const {Build,C,N,B,R}=require('./loadboard-lib.cjs');

function build(presetPath){
 const preset=WorldReader.from(fs.readFileSync(presetPath));let sample=null;
 for(const g of preset.gridIds())for(const ch of preset.brickChunkIndex(g))if(ch.numComponents)for(const x of preset.componentChunk(g,ch.index).components)if(x.typeName===C.OneShotAudioEmitter.NAME)sample=x;
 assert(sample,'Preset needs a OneShotAudioEmitter');
 const b=new Build('Layered Dynamic Semitruck Engine',preset.externalAssets()),chip=b.w.addMicrochip({position:[0,0,2],color:[55,105,165]}),c=b.circuit(chip.grid,'truck'),nodes=[];let index=0;
 function node(k,data={}){const n=c.n(k,data,[(index%6)*48,Math.floor(index++/6)*48,2]);nodes.push(n);return n;}
 function soundEmitter(name,data,color){const pos=[(index%6)*48,Math.floor(index++/6)*48,2],saved=Object.fromEntries(Object.entries(data).filter(([,v])=>!Array.isArray(v))),n={id:`truck_sound_${nodes.length}`,type:C.OneShotAudioEmitter.NAME,data:saved,pos,grid:chip.grid};b.add(n,{asset:C.OneShotAudioEmitter.BRICK,position:pos,color,components:[{type:n.type,data:saved},{type:C.Interact.NAME,data:{Message:`EDIT SOUND: ${name}`,PromptCustomLabel:`${name} sound gate`,bAllowNearbyInteraction:true,bHiddenInteraction:false}}]},chip.grid);for(const [port,v]of Object.entries(data))if(Array.isArray(v))b.wire(v[0],v[1],n,port);nodes.push(n);return n;}
 const value=node('MicrochipInput',{PortLabel:'External Engine Value',CallableDefault:N(0),CallableMirror:N(0)}),enabled=node('MicrochipInput',{PortLabel:'Enabled',CallableDefault:B(true),CallableMirror:B(true)}),manualMode=node('MicrochipInput',{PortLabel:'Use Button Value',CallableDefault:B(true),CallableMirror:B(true)}),stepUp=node('MicrochipInput',{PortLabel:'Step Up +0.05',CallableDefault:B(false),CallableMirror:B(false)}),stepDown=node('MicrochipInput',{PortLabel:'Step Down -0.05',CallableDefault:B(false),CallableMirror:B(false)});
 const manual=node('Var',{Value:N(0)}),upValue=node('Expr_MathAdd',{InputA:R(manual,'Value'),InputB:N(.05)}),upClamp=node('Expr_MathMin',{InputA:R(upValue,'Output'),InputB:N(1)}),upEdge=node('Expr_EdgeDetectorExec',{Input:R(stepUp,'RER_Output')}),upSet=node('Exec_Var_Set',{VarRef:R(manual,'VarRef'),Value:R(upClamp,'Output')});b.wire(upEdge,'OnRisingEdge',upSet,'Exec');
 const downValue=node('Expr_MathSubtract',{InputA:R(manual,'Value'),InputB:N(.05)}),downClamp=node('Expr_MathMax',{InputA:R(downValue,'Output'),InputB:N(0)}),downEdge=node('Expr_EdgeDetectorExec',{Input:R(stepDown,'RER_Output')}),downSet=node('Exec_Var_Set',{VarRef:R(manual,'VarRef'),Value:R(downClamp,'Output')});b.wire(downEdge,'OnRisingEdge',downSet,'Exec');
 const selected=node('Expr_Select',{InputA:R(value,'RER_Output'),InputB:R(manual,'Value'),bSelectB:R(manualMode,'RER_Output')});
 const clamp=node('Expr_MathClamp',{Input:R(selected,'Output'),Min:N(0),Max:N(1)}),divide=node('Expr_MathDivide',{InputA:R(clamp,'Output'),InputB:N(.05)}),round=node('Expr_Round',{Input:R(divide,'Output')}),quantized=node('Expr_MathMultiply',{InputA:R(round,'Output'),InputB:N(.05)});
 function mul(source,factor){return node('Expr_MathMultiply',{InputA:R(source,'Output'),InputB:N(factor)});}
 function add(source,amount){return node('Expr_MathAdd',{InputA:R(source,'Output'),InputB:N(amount)});}
 function interval(scale,start){return node('Expr_MathSubtract',{InputA:N(start),InputB:R(scale,'Output')});}
 function excess(threshold,factor){const sub=node('Expr_MathSubtract',{InputA:R(quantized,'Output'),InputB:N(threshold)}),max=node('Expr_MathMax',{InputA:R(sub,'Output'),InputB:N(0)});return mul(max,factor);}
 const layers=[];
 function layer(name,color,pitchBase,pitchRange,volumeSource,volumeBase,intervalStart,intervalRange){
  const pitch=add(mul(quantized,pitchRange),pitchBase),volume=volumeBase?add(volumeSource,volumeBase):volumeSource,rate=interval(mul(quantized,intervalRange),intervalStart),clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:R(rate,'Output')});c.bind(clock,'bEnabled',R(enabled,'RER_Output'));
  const emitter=soundEmitter(name,{...sample.data,bSpatialization:true,bEnableRepeat:false,RepeatCount:1,RepeatTime:1,RepeatVariance:0,InnerRadius:15,MaxDistance:600,PitchMultiplier:R(pitch,'Output'),VolumeMultiplier:R(volume,'Output')},color);b.wire(clock,'Pulse',emitter,'Play');layers.push({name,emitter,clock,pitch,volume,rate});
 }
 layer('1 COMBUSTION / IDLE',[120,70,35],.65,.65,mul(quantized,.35),.25,.19,.12);
 layer('2 EXHAUST / LOAD',[175,65,30],.75,.70,mul(quantized,.65),.05,.22,.13);
 layer('3 TURBO / AIR',[35,120,190],.90,1.00,excess(.30,.65),0,.28,.13);
 layer('4 MECHANICAL / HIGH RPM',[120,120,135],.85,.90,excess(.65,.85),0,.16,.09);
 const output=node('MicrochipOutput',{PortLabel:'Current Engine Value',CallableDefault:N(0),CallableResult:N(0)});b.wire(quantized,'Output',output,'RER_Input');
 const labelXs=[0,85,170,255];layers.forEach((layer,i)=>b.w.addBrick({asset:'PB_DefaultTile',size:[40,5,2],position:[labelXs[i],-20,2],color:i===0?[70,45,25]:i===1?[95,40,25]:i===2?[25,65,95]:[55,55,65],components:[{type:C.TextDisplay.NAME,data:{Text:layer.name,Font:0,Face:4,LineHeight:1.35,WidthScale:.68,bEnabled:true,Color:{R:240,G:245,B:255,A:255},bOverrideColor:true}}]},chip.grid));
 b.w.addBrick({asset:'PB_DefaultTile',size:[90,5,2],position:[120,-34,2],color:[20,55,35],components:[{type:C.TextDisplay.NAME,data:{Text:'BUTTON MODE DEFAULT: ON  |  STEP UP / DOWN = 0.05  |  CHANGE EACH LABELED SOUND EMITTER',Font:0,Face:4,LineHeight:1.2,WidthScale:.62,bEnabled:true,Color:{R:225,G:255,B:225,A:255},bOverrideColor:true}}]},chip.grid);
 b.w.makePrefab({snap:10});const bytes=b.finish({x:210,y:210,z:10},'Four labeled one-shot layers. Manual Step Up/Down inputs adjust a clamped 0.00-1.00 value by 0.05 per rising click. Use Button Value defaults on; disable it to use External Engine Value.');return {bytes,gateCount:b.nodes.length,wires:b.edges.length,layers:layers.length};
}
module.exports=build;if(require.main===module){const [preset,out]=process.argv.slice(2);if(!out)throw Error('Usage: node build-layered-semitruck-sound.cjs preset.brz output.brz');const r=build(preset);fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gateCount:r.gateCount,wires:r.wires,layers:r.layers,bytes:r.bytes.length},null,2));}

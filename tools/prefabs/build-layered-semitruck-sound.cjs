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
 const value=node('MicrochipInput',{PortLabel:'Engine Value',CallableDefault:N(0),CallableMirror:N(0)}),enabled=node('MicrochipInput',{PortLabel:'Enabled',CallableDefault:B(true),CallableMirror:B(true)});
 const clamp=node('Expr_MathClamp',{Input:R(value,'RER_Output'),Min:N(0),Max:N(1)}),divide=node('Expr_MathDivide',{InputA:R(clamp,'Output'),InputB:N(.05)}),round=node('Expr_Round',{Input:R(divide,'Output')}),quantized=node('Expr_MathMultiply',{InputA:R(round,'Output'),InputB:N(.05)});
 function mul(source,factor){return node('Expr_MathMultiply',{InputA:R(source,'Output'),InputB:N(factor)});}
 function add(source,amount){return node('Expr_MathAdd',{InputA:R(source,'Output'),InputB:N(amount)});}
 function interval(scale,start){return node('Expr_MathSubtract',{InputA:N(start),InputB:R(scale,'Output')});}
 function excess(threshold,factor){const sub=node('Expr_MathSubtract',{InputA:R(quantized,'Output'),InputB:N(threshold)}),max=node('Expr_MathMax',{InputA:R(sub,'Output'),InputB:N(0)});return mul(max,factor);}
 const layers=[];
 function layer(name,pitchBase,pitchRange,volumeSource,volumeBase,intervalStart,intervalRange){
  const pitch=add(mul(quantized,pitchRange),pitchBase),volume=volumeBase?add(volumeSource,volumeBase):volumeSource,rate=interval(mul(quantized,intervalRange),intervalStart),clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:R(rate,'Output')});c.bind(clock,'bEnabled',R(enabled,'RER_Output'));
  const emitter=node('OneShotAudioEmitter',{...sample.data,bSpatialization:true,bEnableRepeat:false,RepeatCount:1,RepeatTime:1,RepeatVariance:0,InnerRadius:15,MaxDistance:600,PitchMultiplier:R(pitch,'Output'),VolumeMultiplier:R(volume,'Output')});b.wire(clock,'Pulse',emitter,'Play');layers.push({name,emitter,clock,pitch,volume,rate});
 }
 layer('1 COMBUSTION / IDLE',.65,.65,mul(quantized,.35),.25,.19,.12);
 layer('2 EXHAUST / LOAD',.75,.70,mul(quantized,.65),.05,.22,.13);
 layer('3 TURBO / AIR',.90,1.00,excess(.30,.65),0,.28,.13);
 layer('4 MECHANICAL / HIGH RPM',.85,.90,excess(.65,.85),0,.16,.09);
 const output=node('MicrochipOutput',{PortLabel:'Quantized Value',CallableDefault:N(0),CallableResult:N(0)});b.wire(quantized,'Output',output,'RER_Input');
 const labelXs=[0,85,170,255];layers.forEach((layer,i)=>b.w.addBrick({asset:'PB_DefaultTile',size:[40,5,2],position:[labelXs[i],-20,2],color:i===0?[70,45,25]:i===1?[95,40,25]:i===2?[25,65,95]:[55,55,65],components:[{type:C.TextDisplay.NAME,data:{Text:layer.name,Font:0,Face:4,LineHeight:1.35,WidthScale:.68,bEnabled:true,Color:{R:240,G:245,B:255,A:255},bOverrideColor:true}}]},chip.grid));
 b.w.addBrick({asset:'PB_DefaultTile',size:[80,5,2],position:[120,-34,2],color:[20,55,35],components:[{type:C.TextDisplay.NAME,data:{Text:'CHANGE EACH ONE-SHOT EMITTER SOUND  |  ENGINE INPUT 0.00-1.00 IN 0.05 STEPS',Font:0,Face:4,LineHeight:1.2,WidthScale:.65,bEnabled:true,Color:{R:225,G:255,B:225,A:255},bOverrideColor:true}}]},chip.grid);
 b.w.makePrefab({snap:10});const bytes=b.finish({x:180,y:180,z:10},'Four editable one-shot layers: combustion, loaded exhaust, turbo/air, and high-RPM mechanical. Shared 0.00-1.00 input quantized to 0.05. Each layer has its own pitch, volume, and cadence curve.');return {bytes,gateCount:b.nodes.length,wires:b.edges.length,layers:layers.length};
}
module.exports=build;if(require.main===module){const [preset,out]=process.argv.slice(2);if(!out)throw Error('Usage: node build-layered-semitruck-sound.cjs preset.brz output.brz');const r=build(preset);fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,gateCount:r.gateCount,wires:r.wires,layers:r.layers,bytes:r.bytes.length},null,2));}

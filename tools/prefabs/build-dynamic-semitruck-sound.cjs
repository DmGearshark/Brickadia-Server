'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {WorldReader}=require('./node_modules/brs-js');
const {Build,C,N,B,R}=require('./loadboard-lib.cjs');

function build(presetPath){
 const preset=WorldReader.from(fs.readFileSync(presetPath));
 let sample=null;
 for(const g of preset.gridIds())for(const ch of preset.brickChunkIndex(g))if(ch.numComponents)for(const c of preset.componentChunk(g,ch.index).components)if(c.typeName===C.OneShotAudioEmitter.NAME){sample=c;break;}
 assert(sample,'Preset needs a OneShotAudioEmitter');
 const b=new Build('Dynamic Semitruck One-Shot Engine',preset.externalAssets()),chip=b.w.addMicrochip({position:[0,0,2],color:[55,105,165]}),c=b.circuit(chip.grid,'engine');let i=0;
 const node=(k,data={})=>c.n(k,data,[(i%4)*48,Math.floor(i++/4)*48,2]);
 const value=node('MicrochipInput',{PortLabel:'Engine Value',CallableDefault:N(0),CallableMirror:N(0)});
 const enabled=node('MicrochipInput',{PortLabel:'Enabled',CallableDefault:B(true),CallableMirror:B(true)});
 const clamp=node('Expr_MathClamp',{Input:R(value,'RER_Output'),Min:N(0),Max:N(1)});
 const divide=node('Expr_MathDivide',{InputA:R(clamp,'Output'),InputB:N(.05)});
 const round=node('Expr_Round',{Input:R(divide,'Output')});
 const quantized=node('Expr_MathMultiply',{InputA:R(round,'Output'),InputB:N(.05)});
 const pitchScale=node('Expr_MathMultiply',{InputA:R(quantized,'Output'),InputB:N(.8)});
 const pitch=node('Expr_MathAdd',{InputA:R(pitchScale,'Output'),InputB:N(.7)});
 const volumeScale=node('Expr_MathMultiply',{InputA:R(quantized,'Output'),InputB:N(.65)});
 const volume=node('Expr_MathAdd',{InputA:R(volumeScale,'Output'),InputB:N(.2)});
 const speedScale=node('Expr_MathMultiply',{InputA:R(quantized,'Output'),InputB:N(.12)});
 const interval=node('Expr_MathSubtract',{InputA:N(.18),InputB:R(speedScale,'Output')});
 const clock=node('Clock',{bEnabled:true,bPulseOn:false,OnTimeSeconds:1,OffTimeSeconds:1,IntervalSeconds:R(interval,'Output')});c.bind(clock,'bEnabled',R(enabled,'RER_Output'));
 const emitter=node('OneShotAudioEmitter',{...sample.data,bSpatialization:true,bEnableRepeat:false,RepeatCount:1,RepeatTime:1,RepeatVariance:0,InnerRadius:15,MaxDistance:500,PitchMultiplier:R(pitch,'Output'),VolumeMultiplier:R(volume,'Output')});b.wire(clock,'Pulse',emitter,'Play');
 const output=node('MicrochipOutput',{PortLabel:'Quantized Value',CallableDefault:N(0),CallableResult:N(0)});b.wire(quantized,'Output',output,'RER_Input');
 b.w.addBrick({asset:'PB_DefaultTile',size:[65,5,2],position:[72,-20,2],color:[20,55,35],components:[{type:C.TextDisplay.NAME,data:{Text:'EDIT THE ONE-SHOT AUDIO EMITTER SOUND  |  INPUT STEPS: 0.05',Font:0,Face:4,LineHeight:1.5,WidthScale:.7,bEnabled:true,Color:{R:225,G:255,B:225,A:255},bOverrideColor:true}}]},chip.grid);
 b.w.makePrefab({snap:10});
 const result=b.finish({x:120,y:100,z:10},'0.00-1.00 engine input quantized to 0.05 steps. Pitch 0.70-1.50, volume 0.20-0.85, trigger interval 0.18-0.06 seconds. Swap the OneShotAudioEmitter sound inside the chip.');
 return {bytes:result,gateCount:b.nodes.length,wires:b.edges.length};
}
module.exports=build;
if(require.main===module){const [preset,out]=process.argv.slice(2);if(!out)throw Error('Usage: node build-dynamic-semitruck-sound.cjs preset.brz output.brz');const r=build(preset);fs.writeFileSync(out,r.bytes);console.log(JSON.stringify({output:out,...r,bytes:r.bytes.length},null,2));}

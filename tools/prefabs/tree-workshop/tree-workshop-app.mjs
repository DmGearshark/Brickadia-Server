import {generateNursery} from './tree-workshop-core.mjs';
const $=s=>document.querySelector(s),status=$('#status');let last=null;
function value(id){return $('#'+id).value;}
function download(data,name,type){const blob=new Blob([data],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function generate(){try{last=generateNursery({seed:value('seed'),count:value('count'),style:value('style'),scale:value('scale'),variation:value('variation'),spacing:value('spacing')});const m=last.manifest;status.innerHTML=`Generated <strong>${m.count}</strong> numbered trees using <strong>${last.bricks}</strong> bricks.<br>Seed ${m.seed}; ${m.style}; scale ${m.scale}; variation ${m.variation}.`;$('#downloadBrz').disabled=false;$('#downloadManifest').disabled=false;$('#treeList').textContent=m.trees.map(t=>`#${t.id}  ${t.style.padEnd(9)}  ${t.bricks} bricks  seed ${t.seed}`).join('\n');}catch(e){status.textContent='Generation failed: '+e.message;console.error(e);}}
$('#generate').addEventListener('click',generate);
$('#randomSeed').addEventListener('click',()=>{$('#seed').value=crypto.getRandomValues(new Uint32Array(1))[0];generate();});
$('#downloadBrz').addEventListener('click',()=>last&&download(last.bytes,`tree-nursery-${last.manifest.seed}.brz`,'application/octet-stream'));
$('#downloadManifest').addEventListener('click',()=>last&&download(JSON.stringify(last.manifest,null,2),`tree-nursery-${last.manifest.seed}-manifest.json`,'application/json'));
for(const id of ['scale','variation'])$('#'+id).addEventListener('input',e=>$('#'+id+'Value').textContent=e.target.value);
generate();

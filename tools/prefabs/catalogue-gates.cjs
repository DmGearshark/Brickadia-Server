'use strict';
// Inventory metadata only. Does not create a game prefab or assert engine behavior.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {brdb:b}=require('brs-js'),pkg=require('brs-js/package.json'),schemaName='BRSavedComponentChunkSoA_max',s=b.embeddedSchema(schemaName);
function category(k){
 if(/^(CallableEntry_|Function|Microchip_)/.test(k)||k==='Exec_CallableBreak'||k==='Microchip')return 'Functions, loops and chip definitions';
 if(/^Microchip(Input|Output)$|^Rerouter$|^ReadBrick/.test(k))return 'Chip ports and brick references';
 if(/^Event_|ZoneEvent_/.test(k))return 'Events';
 if(/^Exec_ArrayVar_|^ArrayVar$/.test(k))return 'Arrays';
 if(/^Exec_MapVar_|^MapVar$/.test(k))return 'Maps';
 if(/^Exec_Var_|^Var$/.test(k))return 'Scalar variables';
 if(/^(Buffer|Queue)|^(Clock|Stopwatch|Tween|Dampen)$|^Expr_(DeltaTime|ServerUptime|GetUnixEpoch|FormatDate)$/.test(k))return 'Timing and interpolation';
 if(/^Expr_(Compare|Logical|Bitwise|NearlyEqual|Select|Swap|EdgeDetector|ChangeDetector|ContainerChangeDetector)/.test(k))return 'Logic, comparisons and change detection';
 if(/^Expr_String_/.test(k))return 'Strings';
 if(/^Expr_(Math|Ceil|Floor|Round|Remap)/.test(k)||k==='Exec_Random')return 'Mathematics';
 if(/^Expr_(Vec|Quat|MakeVector|SplitVector|MakeQuaternion|SplitQuaternion|MakeRotation|SplitRotation|InvertRotation|RotateVector|RotationToDirection|DirectionToRotation)/.test(k))return 'Vectors and rotations';
 if(/^Expr_.*Color/.test(k))return 'Colors';
 if(/^Expr_/.test(k))return 'Type conversion and team predicates';
 if(/^Exec_Character_/.test(k))return 'Character and inventory operations';
 if(/^Exec_PlayerState_|^Exec_FindPlayer$|^Exec_GetInputs$|^InputSplitter$/.test(k))return 'Player identity, input and messages';
 if(/^Exec_Gamemode_/.test(k))return 'Gamemode, teams and leaderboard stats';
 if(/^Exec_Entity_/.test(k)||k==='TeleportDestination')return 'Entities, transforms and custom properties';
 if(/^Exec_Zone_|ZoneEvent_|^AttachedZone$/.test(k))return 'Zones';
 if(/^Exec_(Get|Set|Add|Remove)(Brick|Component|Environment)|^Exec_GetOwnTransform$/.test(k))return 'Brick, component and environment access';
 if(/^Exec_(SendCustomEvent|PrintToConsole|Branch|Cycle|Toggle|Union)/.test(k))return 'Execution flow and event sending';
 if(/Reference$/.test(k))return 'Asset references';
 if(/Audio|^PlayAudioAt$/.test(k))return 'Audio';
 if(/Prefab|Explosion|ProjectileSpawner|^ItemSpawn$|^BotSpawn$/.test(k))return 'Spawning';
 if(/Sweep/.test(k))return 'Collision queries';
 if(/Aerodynamic|Bearing|Gyroscope|Joint_|Motor|Rigid|^Seat$|Servo|Slider|Socket|Thruster|WeightBrick|WheelEngine/.test(k))return 'Vehicles and physical joints';
 if(/Button|PressurePlate|Switch|Touch|Target|Interact|Light|TextDisplay|BrickPropertyChanger|CheckPoint|GoalPoint|Damage|SpawnPoint/.test(k))return 'Interactions, display and world components';
 throw Error('Unclassified component '+k);
}
const definitions=Object.entries(b.COMPONENTS).map(([key,c])=>{
 const struct=b.COMPONENT_TYPE_STRUCTS.get(c.NAME),fields=s.structs.get(struct),ports=b.COMPONENT_WIRE_PORTS.get(c.NAME);assert(struct&&fields&&ports,key+' metadata');
 const aliases=Object.values(c.PORTS);assert.deepEqual([...new Set(aliases)].sort(),[...new Set([...ports.inputs,...ports.outputs])].sort(),key+' port coverage');
 const defaults=b.COMPONENT_STRUCT_DEFAULTS[struct]??b.COMPONENT_STRUCT_DEFAULTS.get?.(struct)??{};
 for(const k of Object.keys(defaults))assert(fields.has(k),key+' default '+k);
 return {key,component:c.NAME,category:category(key),canonicalBrick:c.BRICK??null,brickVariants:c.BRICKS,ports:{inputs:ports.inputs,outputs:ports.outputs,aliases:c.PORTS},savedStruct:struct,savedFields:Object.fromEntries(fields),knownDefaults:defaults};
}).sort((a,z)=>a.category.localeCompare(z.category)||a.key.localeCompare(z.key));
assert.equal(definitions.length,b.COMPONENT_TYPE_STRUCTS.size);assert.equal(definitions.length,b.COMPONENT_WIRE_PORTS.size);
const enums=Object.fromEntries([...s.enums].filter(([k])=>definitions.some(d=>Object.values(d.savedFields).some(f=>f.type===k))).map(([k,v])=>[k,Object.fromEntries(v)]));
const groups=[...new Set(definitions.map(d=>d.category))],counts=Object.fromEntries(groups.map(g=>[g,definitions.filter(d=>d.category===g).length]));
const inventory={source:{package:'brs-js',version:pkg.version,schema:schemaName,repository:'https://github.com/meshiest/brs-js',reviewDate:'2026-11-05',scope:'All registered component definitions in this library; not proof of every gate in every installed Brickadia build or runtime execution semantics.'},counts:{definitions:definitions.length,standaloneBrickDefinitions:definitions.filter(d=>d.canonicalBrick).length,withoutCanonicalBrick:definitions.filter(d=>!d.canonicalBrick).length,uniqueSavedStructs:new Set(definitions.map(d=>d.savedStruct)).size,categories:counts},definitions,referencedEnums:enums};
const dir=path.join(__dirname,'gate-reference');fs.mkdirSync(dir,{recursive:true});const json=JSON.stringify(inventory,null,2)+'\n';fs.writeFileSync(path.join(dir,'gates.json'),json);
const code=x=>'`'+x+'`',list=xs=>xs.length?xs.map(code).join(', '):'—',md=['# Complete available gate and component inventory','','Generated by `node tools/prefabs/catalogue-gates.cjs` from **brs-js '+pkg.version+'**, embedded schema `'+schemaName+'`.','','**'+definitions.length+' definitions**: '+inventory.counts.standaloneBrickDefinitions+' have a canonical brick asset; '+inventory.counts.withoutCanonicalBrick+' are attached/internal/other definitions with no canonical asset listed. Some have multiple brick variants. This count includes wireable world components, not just freestanding logic gates.','','Reviewed alongside [the study notes](../GATE-STUDY.md). [gates.json](gates.json) retains full field descriptors, known defaults, brick variants, exact port aliases and directly referenced enum values. The following tables list every definition exactly once.','','Names below are library identifiers and may differ from editor labels. Saved fields include configuration, cached outputs and runtime state: presence in that column does not imply an editable/wireable setting. Only the input/output columns identify declared wire ports. Missing defaults or missing canonical assets must not be invented. Runtime timing, coercion, ownership scope and special chip assembly still need engine confirmation.','','| Category | Definitions |','| --- | ---: |',...groups.map(g=>'| '+g+' | '+counts[g]+' |'),''];
for(const g of groups){md.push('## '+g,'','| Definition | Inputs | Outputs | Saved fields (`field:type`; arrays marked `[]`) |','| --- | --- | --- | --- |');for(const d of definitions.filter(d=>d.category===g))md.push('| '+code(d.key)+' | '+list(d.ports.inputs)+' | '+list(d.ports.outputs)+' | '+(Object.entries(d.savedFields).map(([k,v])=>code(k+':'+v.type+(v.kind==='array'?'[]':v.kind==='type'?'':' ('+v.kind+')'))).join(', ')||'—')+' |');md.push('');}
fs.writeFileSync(path.join(dir,'GATES.md'),md.join('\n')+'\n');console.log(JSON.stringify({counts:inventory.counts,sha256:crypto.createHash('sha256').update(json).digest('hex'),files:['gate-reference/gates.json','gate-reference/GATES.md']},null,2));

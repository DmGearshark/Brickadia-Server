'use strict';
const {C,N,S,B,O,R}=require('./loadboard-lib.cjs');
module.exports=function command(c,path,{fast=false}={}){
 const chat=c.n('Event_ChatCommand',{CommandName:'loadboard',HelpText:'Open your personal load board.'}),adapter=c.n('QueueTicks',{TicksToWait:1,DataIn1:R(chat,'PlayerState')});c.link(chat,adapter,'ExecOut','ExecIn');const inbox=c.inbox(adapter,[O(null)]),player=inbox.vars[0];
 const boards=c.map('str','weak_object'),previous=c.v(O(null)),root=c.v(O(null));
 const valid=c.branch(inbox.start,c.cmp('NotEqual',R(player),O(null)),'Output');const getId=c.n('Exec_PlayerState_GetUserId',{PlayerState:R(player)});c.link(valid,getId,'ExecOutA');const lookup=c.mo('Get',boards,{Key:R(getId,'UserId')});c.later(getId,lookup);
 const hasOld=c.branch(c.wait(lookup),c.and(R(lookup,'bFound'),c.cmp('NotEqual',R(lookup,'Value'),O(null))),'Output'),destroy=c.n('Exec_Entity_DestroySpawnedPrefab',{Entity:R(lookup,'Value')});c.link(hasOld,destroy,'ExecOutA');
 const getChar=c.n('Exec_Character_GetFromController',{PlayerState:R(player)});c.to([[destroy,'ExecOut'],[hasOld,'ExecOutB']],getChar);const alive=c.branch(c.wait(getChar,3),c.cmp('NotEqual',R(getChar,'Character'),O(null)),'Output');
 const transform=c.n('Exec_Entity_GetLocationRotation',{Entity:R(getChar,'Character')});c.link(alive,transform,'ExecOutA');
 const spawner=c.n('Exec_PrefabSpawner',{Prefab:path,Lifetime:0,Limit:128,SpawnOffset:{X:0,Y:0,Z:0},SpawnOffsetRotation:{Pitch:0,Yaw:0,Roll:0},SpawnVelocity:{X:0,Y:0,Z:0}});
 const split=c.n('Expr_SplitRotation',{Input:R(transform,'Rotation')}),flat=c.n('Expr_MakeRotation',{Pitch:0,Roll:0,Yaw:R(split,'Yaw')}),forward=c.n('Expr_RotationToDirection',{Rotation:R(flat,'Output')});
 const ahead=c.math('Add',R(transform,'Vector'),c.math('Multiply',R(forward,'Output'),60)),lift=c.n('Expr_MakeVector',{X:0,Y:0,Z:16}),desired=c.math('Add',ahead,R(lift,'Output'));
 const facing=c.n('Expr_MakeRotation',{Pitch:0,Roll:0,Yaw:c.math('Add',R(split,'Yaw'),180)});
 const remember=c.set(previous,R(spawner,'Entity'));c.later(transform,remember,2);c.later(remember,spawner,2);const spawned=c.branch(c.wait(spawner,3),c.and(c.cmp('NotEqual',R(spawner,'Entity'),O(null)),c.cmp('NotEqual',R(spawner,'Entity'),R(previous))),'Output');const save=c.set(root,R(spawner,'Entity'));c.link(spawned,save,'ExecOutA');
 const mapSet=c.mo('Set',boards,{Key:R(getId,'UserId'),Value:R(root)});if(fast)c.link(save,mapSet);else c.later(save,mapSet,2);const init=c.send('LB1.BoardInit',[R(player),R(root),true],R(root));const orient=c.n('Exec_Entity_SetLocationRotation',{Entity:R(root),Vector:desired,Rotation:R(facing,'Output')});c.later(mapSet,orient);c.later(orient,init,3,'ExecOut','ExecIn');
 const failed=c.n('Exec_PlayerState_ShowChatMessage',{PlayerState:R(player),Message:'Load board could not open. Respawn or try /loadboard again.'});c.to([[alive,'ExecOutB'],[spawned,'ExecOutB']],failed);c.to([[valid,'ExecOutB'],[failed,'ExecOut'],[init,'ExecOut']],inbox.done,'ExecA');
 return {chat,inbox,spawner,boards,init,orient,transform,desired,facing};
};

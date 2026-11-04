'use strict';
const {C,N,S,B,O,R}=require('./loadboard-lib.cjs');
module.exports=function bindZone(c,zone,transactionBusy){
 const owner=c.v(O(null)),within=c.v(false),occupants=c.arr('weak_object');
 const data={Zone:R(zone,'ZoneRef'),TagFilter:'',bCollisionEnabled_Player:true,bCollisionEnabled_Player1:true,bCollisionEnabled_Player2:true,bCollisionEnabled_Player3:true};
 const enter=c.n('CharacterZoneEvent_Entered',data),leave=c.n('CharacterZoneEvent_Left',data);
 const adapt=(event,dir)=>{const q=c.n('QueueTicks',{TicksToWait:1,DataIn1:R(event,'Character'),DataIn2:dir});c.link(event,q,'Exec','ExecIn');return q;};
 const en=adapt(enter,1),ex=adapt(leave,0),box=c.inbox(en,[O(null),N(0)]),late=c.queue(ex,[O(null),N(0)]);let a=late;box.arrays.forEach((arr,i)=>{const push=c.ao('Push',arr,{Value:R(late,'DataOut'+(i+1))});c.link(a,push);a=push;});// Both event adapters enqueue; the inbox clock serializes them.
 const [who,dir]=box.vars,find=c.ao('Find',occupants,{Value:R(who)});c.link(box.start,find,'Output');const entering=c.branch(c.wait(find),c.cmp('Equal',R(dir),1),'Output'),duplicate=c.branch(entering,R(find,'bFound'),'ExecOutA'),present=c.branch(entering,R(find,'bFound'),'ExecOutB');
 const push=c.ao('Push',occupants,{Value:R(who)});c.link(duplicate,push,'ExecOutB');const remove=c.ao('RemoveAtIndex',occupants,{Index:R(find,'Index')});c.link(present,remove,'ExecOutA');
 const reconcile=c.n('Exec_Union');c.to([[duplicate,'ExecOutA'],[push,'ExecOut'],[present,'ExecOutB'],[remove,'ExecOut']],reconcile,'ExecA');
 const free=c.branch(reconcile,c.not(R(transactionBusy))),retry=c.wait(free,5,'ExecOutB');c.link(retry,reconcile,'Output','ExecB');
 const current=c.ao('Find',occupants,{Value:R(owner)});c.link(free,current,'ExecOutA');const retain=c.branch(c.wait(current),c.and(c.cmp('NotEqual',R(owner),O(null)),R(current,'bFound')),'Output');const stays=c.set(within,true);c.link(retain,stays,'ExecOutA');c.link(stays,box.done,'ExecOut','ExecA');
 const first=c.ao('Get',occupants,{Index:0});c.link(retain,first,'ExecOutB');const candidate=c.v(O(null)),snapshot=c.set(candidate,c.sel(R(first,'bOutOfBounds'),R(first,'Value'),O(null)));c.later(first,snapshot);
 const valid=c.branch(c.wait(snapshot,2),c.or(R(first,'bOutOfBounds'),c.cmp('NotEqual',R(candidate),O(null))),'Output');
 const dead=c.ao('RemoveAtIndex',occupants,{Index:0});c.link(valid,dead,'ExecOutB');const again=c.wait(dead),retryInput=c.b.edges.find(e=>e.z===reconcile&&e.q==='ExecB');c.b.edges=c.b.edges.filter(e=>e!==retryInput);c.to([[retryInput.a,retryInput.p],[again,'Output']],reconcile,'ExecB');
 const changed=c.branch(valid,c.cmp('NotEqual',R(owner),R(candidate)),'ExecOutA'),assign=c.set(owner,R(candidate));c.link(changed,assign,'ExecOutA');const enable=c.set(within,c.cmp('NotEqual',R(candidate),O(null)));c.link(assign,enable);const notify=c.wait(enable,2);c.link(changed,box.done,'ExecOutB','ExecB');
 // A departed owner loses controls immediately, even while a pickup is in flight.
 const outOwner=c.branch(ex,c.cmp('Equal',R(ex,'DataOut1'),R(owner)));const hide=c.set(within,false);c.link(outOwner,hide,'ExecOutA');
 return {owner,within,notify,done:box.done,box,enter,leave};
};

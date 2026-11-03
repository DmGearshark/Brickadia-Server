from pathlib import Path
import struct,json,sys
p=Path(sys.argv[1]); destination=Path(sys.argv[2]); destination.mkdir(parents=True,exist_ok=True)
b=p.read_bytes();assert b[:4]==b'MThd';n=struct.unpack_from('>I',b,4)[0];fmt,nt,division=struct.unpack_from('>HHH',b,8);assert not division&0x8000
pos=8+n;tracks=[];tempos=[(0,500000)];events=[]
def vl(data,i):
 v=0
 while True:
  c=data[i];i+=1;v=(v<<7)|(c&127)
  if not c&128:return v,i
for t in range(nt):
 assert b[pos:pos+4]==b'MTrk';n=struct.unpack_from('>I',b,pos+4)[0];d=b[pos+8:pos+8+n];pos+=8+n;i=0;tick=0;running=None;name='';programs={};notes=[];active={}
 while i<len(d):
  dt,i=vl(d,i);tick+=dt;s=d[i]
  if s>=128:i+=1
  else:assert running is not None;s=running
  if s==255:
   typ=d[i];i+=1;ln,i=vl(d,i);v=d[i:i+ln];i+=ln
   if typ==3:name=v.decode('latin1')
   if typ==81:tempos.append((tick,int.from_bytes(v,'big')))
   continue
  if s in (240,247):ln,i=vl(d,i);i+=ln;continue
  running=s;kind=s>>4;ch=s&15;ln=1 if kind in (12,13) else 2;v=d[i:i+ln];i+=ln
  if kind==12:programs[ch]=v[0]
  if kind==9 and v[1]:active.setdefault((ch,v[0]),[]).append((tick,v[1]))
  elif kind==8 or kind==9:
   q=active.get((ch,v[0]),[])
   if q:
    start,vel=q.pop(0);notes.append({'tick':start,'endTick':tick,'pitch':v[0],'velocity':vel,'channel':ch,'track':t})
 tracks.append({'track':t,'name':name,'notes':len(notes),'programs':programs,'range':[min((x['pitch'] for x in notes),default=0),max((x['pitch'] for x in notes),default=0)]});events+=notes
T=sorted(dict(tempos).items())
def seconds(tick):
 total=0;prev=0;tempo=500000
 for at,rate in T:
  if at>tick:break
  total+=(at-prev)*tempo/1e6/division;prev=at;tempo=rate
 return total+(tick-prev)*tempo/1e6/division
for e in events:e['time']=seconds(e['tick']);e['duration']=seconds(e['endTick'])-e['time']
report={'format':fmt,'ticksPerQuarter':division,'tracks':tracks,'noteCount':len(events),'durationSeconds':max((e['time']+e['duration'] for e in events),default=0),'tempoChanges':len(T),'initialBPM':60e6/T[0][1]}
(destination/'midi-summary.json').write_text(json.dumps(report,indent=2));(destination/'notes.json').write_text(json.dumps(sorted(events,key=lambda e:e['time'])));print(json.dumps(report,indent=2))

import {World} from 'brs-js';

const palettes=[
 {wood:[[76,40,25],[91,49,28]],leaf:[[27,68,35],[37,82,41],[49,96,46]]},
 {wood:[[70,38,24],[87,48,28]],leaf:[[43,72,31],[55,87,36],[67,101,42]]},
 {wood:[[81,43,28],[98,54,32]],leaf:[[28,61,43],[36,75,51],[47,89,57]]},
 {wood:[[72,37,23],[89,46,26]],leaf:[[58,72,28],[72,87,34],[84,100,41]]}
];
const clamp=(n,a,z)=>Math.max(a,Math.min(z,n));
function rng(seed){let x=(seed>>>0)||1;return()=>((x=Math.imul(x^x>>>15,1|x),x^=x+Math.imul(x^x>>>7,61|x),((x^x>>>14)>>>0)/4294967296));}
function metadata(ext){const pivot={center:{x:0,y:0,z:0},halfExtent:ext};return {pivots:{bottomStudsPivot:pivot,studsExpandedPivot:pivot,topStudsPivot:pivot,boundsPivot:pivot,bottomStudsDirection:'Z_Negative',topStudsDirection:'Z_Positive',bBottomStudsValid:true,bTopStudsValid:true},addedGlobalGridOffset:{x:0,y:0,z:0},bIsPhysicsGrid:false,bFreezePhysicsGrid:false,bFreezeGlobalGrid:false,bIsMicrochipPrefab:false};}

function add(w,record,asset,size,position,color,direction=4,rotation=0){w.addBrick({asset,size,position,color,material:'BMC_Plastic',direction,rotation});record.push({asset,size,position,direction,rotation});}
function conifer(w,record,cx,cy,p,r,scale,variation){
 const trunkHalf=r()<.45?10:15,trunkZ=scale>=1.15?30:20;
 add(w,record,'PB_DefaultBrick',[trunkHalf,trunkHalf,trunkZ],[cx,cy,trunkZ],p.wood[0]);
 const tiers=clamp(Math.round(3+variation*2+r()),3,5),base=clamp(Math.round((35+scale*10)/5)*5,35,55);
 let bottom=trunkZ*2;
 for(let i=0;i<tiers;i++){
  const t=i/(tiers-1),half=clamp(Math.round((base*(1-.58*t)+(r()-.5)*variation*8)/5)*5,15,60);
  const hz=clamp(Math.round((25-10*t+scale*5)/5)*5,15,30),ox=Math.round((r()-.5)*variation*20/5)*5,oy=Math.round((r()-.5)*variation*20/5)*5;
  add(w,record,'PB_DefaultStudded',[half,half,hz],[cx+ox,cy+oy,bottom+hz],p.leaf[Math.min(2,Math.floor(t*3))]);bottom+=hz*2;
 }
 return {style:'Conifer',height:bottom,width:base*2,tiers};
}
function broadleaf(w,record,cx,cy,p,r,scale,variation){
 const trunkHalf=scale>1.1?15:10,trunkZ=clamp(Math.round((30+scale*15)/10)*10,30,50);
 add(w,record,'PB_DefaultBrick',[trunkHalf,trunkHalf,trunkZ],[cx,cy,trunkZ],p.wood[0]);
 const baseZ=trunkZ*2,mainX=clamp(Math.round((30+scale*10)/5)*5,35,50),mainY=clamp(Math.round((25+scale*8)/5)*5,30,45),lowH=20;
 add(w,record,'PB_DefaultStudded',[mainX,mainY,lowH],[cx,cy,baseZ+lowH],p.leaf[0]);
 const sides=[[-1,0],[1,0],[0,-1],[0,1]],keep=3+(r()>.45?1:0);
 for(let i=sides.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[sides[i],sides[j]]=[sides[j],sides[i]];}
 for(let i=0;i<keep;i++){const [ax,ay]=sides[i],sx=ax?clamp(Math.round((15+r()*10)/5)*5,15,25):clamp(Math.round((18+r()*8)/5)*5,20,25),sy=ay?clamp(Math.round((15+r()*10)/5)*5,15,25):clamp(Math.round((18+r()*8)/5)*5,20,25);const x=cx+ax*(mainX+sx),y=cy+ay*(mainY+sy);add(w,record,'PB_DefaultStudded',[sx,sy,15],[x,y,baseZ+15],p.leaf[0]);}
 const upperX=mainX-10,upperY=mainY-10,upperBottom=baseZ+lowH*2,shiftX=Math.round((r()-.5)*variation*20/5)*5,shiftY=Math.round((r()-.5)*variation*20/5)*5;
 add(w,record,'PB_DefaultStudded',[upperX,upperY,20],[cx+shiftX,cy+shiftY,upperBottom+20],p.leaf[1]);
 const crownBottom=upperBottom+40,crown=clamp(Math.round((18+scale*5)/5)*5,20,30);
 add(w,record,'PB_DefaultStudded',[crown,crown,15],[cx+shiftX+5,cy+shiftY,crownBottom+15],p.leaf[2]);
 return {style:'Broadleaf',height:crownBottom+30,width:(mainX+25)*2,tiers:3};
}

const seg={a:[0,0,12],b:[6,0,6],c:[6,0,-6],d:[0,0,-12],e:[-6,0,-6],f:[-6,0,6],g:[0,0,0]},digits={0:'abcdef',1:'bc',2:'abdeg',3:'abcdg',4:'bcfg',5:'acdfg',6:'acdefg',7:'abc',8:'abcdefg',9:'abcdfg'};
function label(w,record,n,cx,cy){const str=String(n),start=-((str.length-1)*18)/2;for(const [di,ch] of [...str].entries())for(const s of digits[ch]){const [x,y,z]=seg[s],horizontal='adg'.includes(s);add(w,record,'PB_DefaultMicroBrick',horizontal?[5,1,1]:[1,1,5],[cx+start+di*18+x,cy-105+y,z+20],[235,205,78]);}}

export function generateNursery(options={}){
 const seed=(Number(options.seed)||1)>>>0,count=clamp(Math.round(Number(options.count)||12),1,20),style=['Mixed','Conifer','Broadleaf'].includes(options.style)?options.style:'Mixed',scale=clamp(Number(options.scale)||1,.7,1.4),variation=clamp(Number(options.variation)||.65,0,1),spacing=clamp(Math.round(Number(options.spacing)||260),220,360);
 const r=rng(seed),w=new World(),manifest={version:1,seed,count,style,scale,variation,spacing,trees:[]},all=[];
 const cols=Math.ceil(Math.sqrt(count));
 for(let i=0;i<count;i++){
  const row=Math.floor(i/cols),col=i%cols,cx=col*spacing,cy=row*spacing,p=palettes[Math.floor(r()*palettes.length)],treeSeed=Math.floor(r()*0xffffffff),tr=rng(treeSeed),chosen=style==='Mixed'?(tr()<.52?'Conifer':'Broadleaf'):style,record=[];
  const info=chosen==='Conifer'?conifer(w,record,cx,cy,p,tr,scale,variation):broadleaf(w,record,cx,cy,p,tr,scale,variation);label(w,record,i+1,cx,cy);all.push(...record);manifest.trees.push({id:i+1,seed:treeSeed,...info,bricks:record.length,center:[cx,cy]});
 }
 const maxX=(Math.min(cols,count)-1)*spacing+100,maxY=(Math.ceil(count/cols)-1)*spacing+120,maxZ=Math.max(...manifest.trees.map(t=>t.height))+10;
 const bytes=w.toBrz({prefab:metadata({x:maxX,y:maxY,z:maxZ}),bundle:{name:`Tree Workshop Nursery ${seed}`,description:`Numbered ${count}-tree procedural nursery. Seed ${seed}; ${style}; scale ${scale}; variation ${variation}. Keep the manifest to reproduce selected trees.`}});
 return {bytes,manifest,bricks:all.length};
}

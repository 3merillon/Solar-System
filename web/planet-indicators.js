// Planet indicators for the solar viewer.
// The same number formats as the panel (web/solar.js): SI digit groups, m, km, au (IAU 2012 B2), light-years.
const AU=1.495978707e11,LY=9.4607304725808e15,group=(v,d=0)=>{const [i,f]=Math.abs(v).toFixed(d).split('.');return (v<0?'−':'')+i.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(f?'.'+f:'');};
const metres=v=>{const a=Math.abs(v);if(a<1000)return `${group(v,a<10?1:0)} m`;if(a<1e5)return `${group(v/1e3,1)} km`;if(a<0.1*AU)return `${group(v/1e3)} km`;if(a<0.1*LY)return `${group(v/AU,a<10*AU?3:a<100*AU?2:1)} au`;return `${group(v/LY,2)} ly`;};
export const PLACES=[[10,'Sun'],[199,'Mercury'],[299,'Venus'],[399,'Earth'],[301,'Moon'],[499,'Mars'],[401,'Phobos'],[402,'Deimos'],[599,'Jupiter'],[501,'Io'],[502,'Europa'],[503,'Ganymede'],[504,'Callisto'],[699,'Saturn'],[601,'Mimas'],[602,'Enceladus'],[603,'Tethys'],[604,'Dione'],[605,'Rhea'],[606,'Titan'],[608,'Iapetus'],[799,'Uranus'],[701,'Ariel'],[702,'Umbriel'],[703,'Titania'],[704,'Oberon'],[705,'Miranda'],[899,'Neptune'],[801,'Triton'],[999,'Pluto'],[901,'Charon']];
const nameOf=id=>PLACES.find(p=>p[0]===id)?.[1]??'—';
export function installPlanetIndicators({canvas,id="solar-overlay",onSelect=()=>{}}){
 const overlay=document.createElement('canvas');overlay.id=id;document.body.append(overlay);
 const ink=overlay.getContext('2d');
 const PARENT={301:399,401:499,402:499,501:599,502:599,503:599,504:599,601:699,602:699,603:699,604:699,605:699,606:699,608:699,701:799,702:799,703:799,704:799,705:799,801:899,901:999};
 const moonOf=id=>PARENT[id]!==undefined;
 let hits=[];
 function draw({markers=[],width=canvas.width,height=canvas.height,target=0,frameBody=0,enabled=true}={}){
  const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
  if(overlay.width!==W||overlay.height!==H){overlay.width=W;overlay.height=H;}
  ink.clearRect(0,0,W,H);hits=[];
  if(!enabled)return;
  // The image fills the window keeping its own shape, with bars at the sides or top: positions are worked out in the image, and placed where it shows.
  const cw=width,ch=height,fit=Math.min(W/cw,H/ch),ox=(W-cw*fit)/2,oy=(H-ch*fit)/2;
  const m=markers,rows=[];for(let i=0;i<m.length;i+=6)rows.push({id:m[i],x:(m[i+5]&1)?ox+m[i+1]*fit:m[i+1],y:(m[i+5]&1)?oy+m[i+2]*fit:m[i+2],r:m[i+3]*fit,d:m[i+4],flags:m[i+5]});
  // Disks that can hide an indicator, as circles on screen. A body filling most of the view is left to the exact test on its centre.
  const disks=rows.filter(r=>(r.flags&1)&&r.r>1.5&&r.r<Math.max(W,H));
  const byId=Object.fromEntries(rows.map(r=>[r.id,r])),chosen=target;
  const size=10.5*dpr,pad=4*dpr;ink.font=`${size}px ui-monospace,Consolas,monospace`;ink.lineWidth=Math.max(1,dpr*0.75);ink.textBaseline='alphabetic';
  // Target first, then the Sun, planets, and moons, so that when labels would collide the lesser is the one left out.
  const rank=r=>r.id===chosen?0:r.id===10?1:!moonOf(r.id)?2:3;
  const taken=[];
  for(const b of rows.sort((p,q)=>rank(p)-rank(q)||q.r-p.r)){
   const isTarget=b.id===chosen;
   if(moonOf(b.id)&&!isTarget){
    // A moon shows when the eye is in its planet's system, far enough from the planet on screen to tell apart.
    const parent=byId[PARENT[b.id]];const near=PARENT[b.id]===frameBody||b.id===frameBody||PARENT[frameBody]===PARENT[b.id];
    if(!near||!parent||Math.hypot(b.x-parent.x,b.y-parent.y)<26*dpr)continue;
   }
   // The disk filling the view needs no marker, and neither does the ground under the eye.
   if(b.r>Math.min(W,H)*0.42&&!isTarget)continue;
   const shown=(b.flags&2)!==0,hidden=(b.flags&4)!==0;
   if(!shown&&!isTarget)continue;
   // Behind a body it is not there to be seen, whichever one it is.
   if(hidden&&shown)continue;
   const colour=isTarget?'255,196,92':b.id===10?'255,226,160':moonOf(b.id)?'170,214,190':'176,212,255',alpha=0.92;
   ink.strokeStyle=ink.fillStyle=`rgba(${colour},${alpha})`;
   // And where its lines cross a nearer body they stop there: each nearer disk is cut out of what this one can draw on.
   ink.save();
   for(const n of disks){if(n.d>=b.d||n.id===b.id)continue;ink.beginPath();ink.rect(0,0,W,H);ink.arc(n.x,n.y,n.r,0,Math.PI*2,true);ink.clip('evenodd');}
   if(!shown){
    // Off screen, or behind: a chevron on the screen's edge toward it.
    let dx=b.x-W/2,dy=b.y-H/2;if((b.flags&1)===0){dx=b.x;dy=b.y;}
    const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    const margin=38*dpr,t=Math.min((W/2-margin)/Math.max(Math.abs(dx),1e-6),(H/2-margin)/Math.max(Math.abs(dy),1e-6)),cx=W/2+dx*t,cy=H/2+dy*t,arm=9*dpr,nx=-dy,ny=dx;
    ink.beginPath();ink.moveTo(cx-dx*arm+nx*arm,cy-dy*arm+ny*arm);ink.lineTo(cx,cy);ink.lineTo(cx-dx*arm-nx*arm,cy-dy*arm-ny*arm);ink.stroke();
    const text=`${nameOf(b.id).toUpperCase()} ${metres(b.d)}`,tw=ink.measureText(text).width;
    ink.fillText(text,Math.max(pad,Math.min(W-tw-pad,cx-tw/2-dx*22*dpr)),Math.max(size+pad,Math.min(H-pad,cy+size*0.35-dy*22*dpr)));
    hits.push({id:b.id,x:cx,y:cy});
    ink.restore();
    continue;
   }
   // Corner brackets, with room around a disk and a floor so a point of light is still framed.
   const s=Math.max(b.r*1.18,9*dpr),arm=Math.max(4*dpr,Math.min(s*0.42,16*dpr));
   ink.beginPath();
   for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const cx=b.x+sx*s,cy=b.y+sy*s;ink.moveTo(cx-sx*arm,cy);ink.lineTo(cx,cy);ink.lineTo(cx,cy-sy*arm);}
   ink.stroke();
   // A leader off the top right corner to a shelf the name stands on.
   const line1=nameOf(b.id).toUpperCase(),line2=metres(b.d),tw=Math.max(ink.measureText(line1).width,ink.measureText(line2).width);
   const ox=b.x+s,oy=b.y-s,left=ox+tw+22*dpr<W;const dir=left?1:-1,ex=ox*(left?1:0)+(left?0:b.x-s)+dir*12*dpr,ey=oy-12*dpr,shelf=ex+dir*(tw+pad*2);
   const boxX=Math.min(ex,shelf),box=[boxX,ey-size-2*dpr,tw+pad*2,size*2+6*dpr];
   if(!isTarget&&taken.some(t=>box[0]<t[0]+t[2]&&t[0]<box[0]+box[2]&&box[1]<t[1]+t[3]&&t[1]<box[1]+box[3])){hits.push({id:b.id,x:b.x,y:b.y});ink.restore();continue;}
   taken.push(box);
   ink.beginPath();ink.moveTo(left?ox:b.x-s,oy);ink.lineTo(ex,ey);ink.lineTo(shelf,ey);ink.stroke();
   ink.fillText(line1,boxX+pad,ey-3*dpr);
   ink.fillStyle=`rgba(${colour},${alpha*0.72})`;ink.fillText(line2,boxX+pad,ey+size+1*dpr);
   ink.restore();
   hits.push({id:b.id,x:b.x,y:b.y});
  }
 }
 // A click on a marker makes it the target.
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,x=(e.clientX-rect.left)*dpr,y=(e.clientY-rect.top)*dpr;
  let best=null,reach=22*dpr;for(const h of hits){const d=Math.hypot(h.x-x,h.y-y);if(d<reach){reach=d;best=h;}}
  if(best){onSelect(best.id);}
 });
 return {draw};
}

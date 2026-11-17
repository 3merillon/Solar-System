// Adapted from Planets src/gpu/free-fly-camera.ts (14516cd): camera-local
// quaternion look/roll and normalized, immediate displacement. JS numbers keep
// body-local positions in f64; orientation never gets rebuilt from radial up.
export const add=(a,b)=>a.map((x,i)=>x+b[i]);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const mul=(a,s)=>a.map(x=>x*s);
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const len=a=>Math.hypot(...a);
export const norm=a=>mul(a,1/len(a));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const product=(a,b)=>[
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
];
function transform(q,v){const u=q.slice(0,3),t=mul(cross(u,v),2);return add(add(v,mul(t,q[3])),cross(u,t));}
function lookRotation(forward,up){
  const z=mul(norm(forward),-1);
  if(!up||len(up)<1e-9||Math.abs(dot(norm(up),z))>.9999)up=Math.abs(z[2])<.9?[0,0,1]:[0,1,0];
  const x=norm(cross(up,z)),y=cross(z,x),m=[x,y,z],q=[0,0,0,0];
  const trace=x[0]+y[1]+z[2];
  if(trace>0){const s=Math.sqrt(trace+1)*2;q[3]=s/4;q[0]=(y[2]-z[1])/s;q[1]=(z[0]-x[2])/s;q[2]=(x[1]-y[0])/s;}
  else{let i=x[0]>y[1]?0:1;if(z[2]>m[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+m[i][i]-m[j][j]-m[k][k])*2;q[i]=s/4;q[j]=(m[i][j]+m[j][i])/s;q[k]=(m[i][k]+m[k][i])/s;q[3]=(m[j][k]-m[k][j])/s;}
  return norm(q);
}
export class Flight {
  constructor(camera){this.setCamera(camera);}
  setCamera(camera,up){this.position=[...camera[0]];this.orientation=lookRotation(sub(camera[1],camera[0]),up||camera[2]||norm(camera[0]));}
  get forward(){return transform(this.orientation,[0,0,-1]);}
  get right(){return transform(this.orientation,[1,0,0]);}
  get up(){return transform(this.orientation,[0,1,0]);}
  get camera(){return [[...this.position],add(this.position,mul(this.forward,1000)),this.up];}
  turn(axis,angle){this.orientation=norm(product([...mul(axis,Math.sin(angle/2)),Math.cos(angle/2)],this.orientation));}
  look(dx,dy){this.turn(this.up,-dx*.002);this.turn(this.right,-dy*.002);}
  // analog: optional {x, y, z, boost} from touch controls; its deflection
  // scales the displacement, keys stay binary. Both feed one vector.
  move(keys,dt,speed,ground=false,analog=null){
    if(!ground)this.turn(this.forward,((keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0))*dt);
    let f=this.forward,r=this.right,u=this.up;
    if(ground){u=norm(this.position);f=sub(f,mul(u,dot(f,u)));if(len(f)<1e-7)f=cross(r,u);f=norm(f);r=norm(cross(f,u));}
    let d=[0,0,0];
    for(const [key,v]of [['KeyW',f],['KeyS',mul(f,-1)],['KeyD',r],['KeyA',mul(r,-1)],...ground?[]:[['Space',u],['KeyC',mul(u,-1)]]])if(keys.has(key))d=add(d,v);
    if(analog){d=add(d,mul(f,analog.y));d=add(d,mul(r,analog.x));if(!ground)d=add(d,mul(u,analog.z));}
    const boost=(keys.has('ShiftLeft')||keys.has('ShiftRight')||analog?.boost)?3:1;
    if(len(d)>1e-9)this.position=add(this.position,mul(norm(d),speed*dt*boost*Math.min(1,len(d))));
    // Walking transports its upright frame along the sphere, without changing
    // the pitch. Flight has no such radial constraint, even at either pole.
    if(ground){const next=norm(this.position),axis=cross(u,next),s=len(axis);if(s>1e-12)this.turn(mul(axis,1/s),Math.atan2(s,dot(u,next)));}
  }
}
// Presentation time survives GPU backpressure; simulation may use its own
// smaller stable step. A one-second backlog already finishes all visual fades.
export class RenderClock {
 constructor(){this.pending=0;}
 advance(seconds){if(Number.isFinite(seconds))this.pending=Math.min(1,this.pending+Math.max(0,seconds));}
 submit(render){if(!render(this.pending))return false;this.pending=0;return true;}
 reset(){this.pending=0;}
}

// Real asteroid orbits for the space pass, from JPL's Small-Body Database, recorded once. Each row: 12 floats.
// a (au), e, mean anomaly at J2000 (rad), mean motion (rad per Julian century); then the orbit's P axis in ICRF
// and absolute magnitude H; then its Q axis and radius (km). Precomputed axes save the vertex shader the angles.
// A body's radius is its catalogued diameter, or from H with albedo 0.14 where it has none, marked by a negative value.
//   node tools/Bake-Asteroids.mjs IN.json OUT.bin
import {readFileSync,writeFileSync} from 'node:fs';
const [input,out]=process.argv.slice(2);if(!input||!out)throw Error('usage: Bake-Asteroids.mjs IN.json OUT.bin');
const j=JSON.parse(readFileSync(input,'utf8')),f=Object.fromEntries(j.fields.map((n,i)=>[n,i]));
const D=Math.PI/180,OB=23.4392911*D,J2000=2451545,GAUSS=0.01720209895; // rad/day for a in au
const rows=[];let kept=0,estimated=0;const classes={};
for(const r of j.data){
 // Pluto is a body of its own here.
 if(/^\s*134340 /.test(r[f.full_name]))continue;
 const a=+r[f.a],e=+r[f.e],inc=+r[f.i]*D,om=+r[f.om]*D,w=+r[f.w]*D,ma=+r[f.ma]*D,epoch=+r[f.epoch],H=+r[f.H],d=r[f.diameter]==null?NaN:+r[f.diameter];
 if(!(a>0&&e>=0&&e<1&&Number.isFinite(H)&&Number.isFinite(ma)))continue;
 const n=GAUSS/Math.pow(a,1.5),m0=(ma+n*(J2000-epoch))%(2*Math.PI);
 // Ecliptic J2000 axes, then to ICRF.
 const co=Math.cos(om),so=Math.sin(om),cw=Math.cos(w),sw=Math.sin(w),ci=Math.cos(inc),si=Math.sin(inc);
 const P=[co*cw-so*sw*ci,so*cw+co*sw*ci,sw*si],Q=[-co*sw-so*cw*ci,-so*sw+co*cw*ci,cw*si];
 const icrf=v=>[v[0],v[1]*Math.cos(OB)-v[2]*Math.sin(OB),v[1]*Math.sin(OB)+v[2]*Math.cos(OB)];
 const p=icrf(P),q=icrf(Q);
 const known=Number.isFinite(d)&&d>0;
 const radius=known?d/2:-(1329/Math.sqrt(0.14)*Math.pow(10,-0.2*H))/2;if(!known)estimated++;
 rows.push(a,e,m0,n*36525,p[0],p[1],p[2],H,q[0],q[1],q[2],radius);kept++;classes[r[f.class]]=(classes[r[f.class]]||0)+1;
}
writeFileSync(out,Buffer.from(new Float32Array(rows).buffer));
console.log(JSON.stringify({asteroids:kept,estimated_radius:estimated,classes,bytes:rows.length*4,api:j.signature}));

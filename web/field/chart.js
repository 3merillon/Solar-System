// The exact chart of docs/M1-LIVE-EARTH.md: cube faces, gnomonic page grid, texel rules.
// Pure double-precision functions. Angles are radians. No DOM, no network, no GPU.
export const R=6371000,PAGE_TEXELS=264,GRID=256,HEIGHT_GUTTER=3,ALBEDO_GUTTER=4;
// Cube faces follow cube_key in terrain_gpu.wgsl: direction before normalisation.
const FACES=[(u,v)=>[1,v,-u],(u,v)=>[-1,v,u],(u,v)=>[u,1,-v],(u,v)=>[u,-1,v],(u,v)=>[u,v,1],(u,v)=>[-u,v,-1]];
export const FACE_TABLE=['(1, v, -u)','(-1, v, u)','(u, 1, -v)','(u, -1, v)','(u, v, 1)','(-u, v, -1)'];
// u, v may lie beyond [-1,1]: the gnomonic plane extends past the face, and gutters use it.
export function chartToDirection(face,u,v){const a=FACES[face](u,v),n=Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);return [a[0]/n,a[1]/n,a[2]/n];}
// Inverse for the face that owns the direction (largest absolute component, ties to the lower face).
export function directionToChart(d){
 const [x,y,z]=d,ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);
 if(ax>=ay&&ax>=az)return x>0?{face:0,u:-z/x,v:y/x}:{face:1,u:z/-x,v:y/-x};
 if(ay>=az)return y>0?{face:2,u:x/y,v:-z/y}:{face:3,u:x/-y,v:z/-y};
 return z>0?{face:4,u:x/z,v:y/z}:{face:5,u:x/z,v:y/-z};
}
// lat = asin(y), lon = atan2(x,z): +Y north, lon 0 on +Z, east on +X.
export const directionToLonLat=d=>[Math.atan2(d[0],d[2]),Math.asin(Math.max(-1,Math.min(1,d[1])))];
export const lonLatToDirection=(lon,lat)=>[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)];
// Web Mercator in [0,1]; Y=0 at the north limit. ln(tan(pi/4+lat/2)) = atanh(sin lat), finite for |lat|<90.
export const lonLatToMercator=(lon,lat)=>[0.5+lon/(2*Math.PI),0.5-Math.atanh(Math.sin(lat))/(2*Math.PI)];
export const mercatorToLonLat=(X,Y)=>[(X-0.5)*2*Math.PI,Math.atan(Math.sinh(Math.PI*(1-2*Y)))];
// Same as lonLatToMercator(directionToLonLat(d)) without the trig round trip. Y is -/+Infinity at the poles.
export const directionToMercator=d=>[0.5+Math.atan2(d[0],d[2])/(2*Math.PI),0.5-Math.atanh(Math.max(-1,Math.min(1,d[1])))/(2*Math.PI)];
// Texel (i,j): i runs along u (page x), j along v (page y); storage is row-major j*264+i.
// Height is vertex aligned: texel i is grid point i-3 of 0..256. Albedo is cell centred: texel i is cell i-4.
export function heightTexelToChart(page,i,j){const s=2/2**page.level;return [-1+s*(page.x+(i-HEIGHT_GUTTER)/GRID),-1+s*(page.y+(j-HEIGHT_GUTTER)/GRID)];}
export function albedoTexelToChart(page,i,j){const s=2/2**page.level;return [-1+s*(page.x+(i-ALBEDO_GUTTER+0.5)/GRID),-1+s*(page.y+(j-ALBEDO_GUTTER+0.5)/GRID)];}
export const texelToChart=(channel,page,i,j)=>(channel==='height'?heightTexelToChart:albedoTexelToChart)(page,i,j);
// Longitude/latitude extent of the page including both gutters, sampled on a 17x17 lattice and padded 5%
// of the span (lat is smooth between samples but not monotone). Longitudes are unwrapped around the page
// centre, so lonMax-lonMin <= 2*pi and a page across the antimeridian reports wraps=true with lonMax>pi
// or lonMin<-pi. A page containing a pole reports the full longitude range.
export function pageLonLatBounds(page){
 const s=2/2**page.level,u0=-1+s*(page.x-ALBEDO_GUTTER/GRID),u1=-1+s*(page.x+1+ALBEDO_GUTTER/GRID),v0=-1+s*(page.y-ALBEDO_GUTTER/GRID),v1=-1+s*(page.y+1+ALBEDO_GUTTER/GRID);
 const c=directionToLonLat(chartToDirection(page.face,(u0+u1)/2,(v0+v1)/2));
 let lonMin=Infinity,lonMax=-Infinity,latMin=Infinity,latMax=-Infinity;
 for(let a=0;a<=16;a++)for(let b=0;b<=16;b++){
  const [lon,lat]=directionToLonLat(chartToDirection(page.face,u0+(u1-u0)*a/16,v0+(v1-v0)*b/16));
  const l=lon+2*Math.PI*Math.round((c[0]-lon)/(2*Math.PI));
  lonMin=Math.min(lonMin,l);lonMax=Math.max(lonMax,l);latMin=Math.min(latMin,lat);latMax=Math.max(latMax,lat);
 }
 const pad=(a,b)=>0.05*(b-a),pl=pad(lonMin,lonMax),pa=pad(latMin,latMax);
 lonMin-=pl;lonMax+=pl;latMin=Math.max(-Math.PI/2,latMin-pa);latMax=Math.min(Math.PI/2,latMax+pa);
 let containsPole=false;
 if(page.face===2||page.face===3){if(u0<=0&&u1>=0&&v0<=0&&v1>=0){containsPole=true;if(page.face===2)latMax=Math.PI/2;else latMin=-Math.PI/2;lonMin=-Math.PI;lonMax=Math.PI;}}
 return {lonMin,lonMax,latMin,latMax,wraps:lonMax>Math.PI||lonMin<-Math.PI,containsPole};
}

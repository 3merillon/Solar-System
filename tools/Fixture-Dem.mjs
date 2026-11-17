// Coarser DEM tiles for recorded fixtures that hold one zoom: the box average of the finer tiles under each pixel,
// as the tile host serves its lower zooms. A tile with any finer tile missing is missing. For harnesses only.
export function withCoarserTiles(tiles,fz){
 const made=new Map();
 return (z,x,y)=>{const key=z+'/'+x+'/'+y,own=tiles.get(key);if(own||z>=fz)return own;if(made.has(key))return made.get(key);
  const f=2**(fz-z),out=new Float32Array(65536),raw=new Float32Array(65536);let ok=true,hasRaw=false;
  for(let cy=0;cy<f&&ok;cy++)for(let cx=0;cx<f;cx++){const t=tiles.get(fz+'/'+(x*f+cx)+'/'+(y*f+cy));if(!t){ok=false;break;}if(t.riverHeights)hasRaw=true;
   for(let j=0;j<256;j++)for(let i=0;i<256;i++){const gi=cx*256+i,gj=cy*256+j,o=Math.floor(gj/f)*256+Math.floor(gi/f);out[o]+=t.heights[j*256+i];raw[o]+=(t.riverHeights||t.heights)[j*256+i];}}
  let tile=null;if(ok){const w=1/(f*f);for(let o=0;o<65536;o++){out[o]*=w;raw[o]*=w;}tile={z,x,y,width:256,height:256,heights:out,...(hasRaw?{riverHeights:raw}:{})};}
  made.set(key,tile);return tile;};
}

// What preparing a height tile for water computes, as pure functions of plain data, so that they can run in the decoder pool. A tile takes
// about 10 ms of this, and on the field worker it held up every fetch behind it: a cut at 100 Mbit reached 89% of pixels by 1 s, where it
// reaches 97% with water off. Each step changes nothing it is given, apart from the sea it hands back. Only the worker fetches, so the
// tiles a step needs are in its arguments, and the order of the steps stays in field-worker.js.
import {findSea,mayHoldShore,seaHasZeros,shoreFromImage,tileSeeds,seaColour} from './seabed.js';
import {flatRegions,isLake,applyWater} from './water.js';
export const WATER_STEPS={
 // The sea of a tile from its heights alone, and whether imagery could add to it.
 scan({tile,z,x,y}){const sea=findSea(tile,z,x,y);return {sea,holdsShore:mayHoldShore(tile,sea,z,y),own:sea.mask.includes(1)};},
 // Where this tile's sea may start, from the sea of the tile above.
 seeds({parentMask,parentWidth,z,x,y,parentZ,width,height}){const seeds=tileSeeds(parentMask,parentWidth,z,x,y,parentZ,width,height);return {seeds,any:seeds.includes(1)};},
 // The shoreline from imagery. The colour handed back is the sea's own, read before the shore moved.
 shore({tile,sea,image,z,y,seeds,colour}){const own=seaColour(image,sea.mask,tile.width,tile.height);shoreFromImage(tile,sea,image,z,y,seeds,colour);return {sea,colour:own};},
 // What is left to fetch: a floor from the coarser tile if any sea reads as a flat zero, and imagery if anything could be a lake.
 regions({tile,z,y,sea}){return {zeros:seaHasZeros(tile,sea),regions:flatRegions(tile,z,y,sea.mask)};},
 // The heights and levels a page reads. No heights means the raw ones stand.
 finish({tile,z,x,y,zoom,sea,parent,regions,image,imageZ}){
  const lakes=image?regions.filter(r=>isLake(r,tile,z,x,y,image,imageZ)):[];
  const final={heights:tile.heights.slice(),width:tile.width,height:tile.height};
  applyWater(final,{z,x,y,seabedZoom:zoom,sea,parent,lakes});
  const raw=tile.heights;let same=true;for(let o=0;o<raw.length;o++)if(raw[o]!==final.heights[o]){same=false;break;}
  return {heights:same?null:final.heights,water:final.water,width:final.width,height:final.height};
 },
};
// The buffers a step's answer can hand over instead of copying.
export function stepTransfer(out){
 const list=[],add=a=>{if(a?.buffer&&!list.includes(a.buffer))list.push(a.buffer);};
 const sea=out.sea;if(sea)for(const k of ['mask','levels','basins','ramp','beach'])add(sea[k]);
 add(out.seeds);add(out.heights);add(out.water);
 if(out.regions)for(const r of out.regions)add(r.cells);
 return list;
}

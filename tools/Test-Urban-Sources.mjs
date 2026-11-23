import assert from 'node:assert/strict';
import {buildingMetadata,buildingSources} from '../web/field/buildings.js';
import {clipRoad,ROAD_LIMIT} from '../web/field/roads.js';
const meta=buildingMetadata({height:'24 m','building:levels':3,'roof:shape':'gabled','roof:height':4,'building:material':'brick','building:colour':'#cc6644'},9);
assert.equal(meta.height,24);assert.equal(meta.roofKind,2);assert.equal(meta.roofHeight,4);assert.equal(meta.style,1);assert.equal(meta.estimated,false);
assert.equal(buildingMetadata({'building:levels':4},9).height,12.4);
const ring=coords=>Object.assign(coords,{closed:true});
const rectangle=ring([[100,100],[200,100],[200,150],[100,150]]);
const courtyard=ring([[125,115],[125,135],[150,135],[150,115]]);
function edgeFlags(paths,properties={}){
 const tile={z:14,x:8516,y:5467,layers:{building:{extent:4096,features:[{id:17,properties,paths}]}}};
 const source=buildingSources([tile]);const words=new Uint32Array(source.points);
 return Array.from({length:words.length/4},(_,i)=>words[4*i+3]);
}
const flags=edgeFlags([rectangle,courtyard]);
assert.equal(flags.slice(0,4).filter(v=>v===2).length,1,'one exterior wall has an entrance');
assert.ok(flags.slice(4).every(v=>v===0),'courtyard walls retain windows');
assert.ok(edgeFlags([rectangle],{min_height:3,height:9}).every(v=>v===0),'no doors on raised parts');
const clippedFlags=edgeFlags([ring([[-10,100],[200,100],[200,150],[-10,150]])]);
assert.ok(clippedFlags.includes(1)&&!clippedFlags.includes(2),'clipped fragments retain cut walls without duplicating entrances');
assert.deepEqual(clipRoad([-20,50],[120,50],100),[[0,50],[100,50]]);
assert.equal(clipRoad([-20,-10],[-10,50],100),null);
const feature={properties:{class:'primary',width:8},paths:[[[100,200],[300,200]]]};
const tile={z:14,x:8516,y:5467,layers:{transportation:{extent:4096,features:[feature]}}};
const one=buildingSources([tile]);assert.equal(one.stats.roads,1);assert.equal(one.stats.buildings,0);assert.equal(one.stats.roadWidthsEstimated,0);
const floats=new Float32Array(one.records);assert.equal(floats[11],8);assert.equal(floats[27],-1);assert.ok(floats.every(Number.isFinite));
// Dash phase continues across source vertices, including a tile-clipped start.
tile.layers.transportation.features=[{...feature,paths:[[[100,200],[300,200],[500,200]]]}];
const joined=buildingSources([tile]),jr=new Float32Array(joined.records),jp=new Float32Array(joined.points);
const firstLength=Math.hypot(jp[4]-jp[0],jp[5]-jp[1]);
assert.ok(Math.abs(jr[28+15]-firstLength%6)<.001);
tile.layers.transportation.features=[{...feature,paths:[[[-100,200],[100,200],[300,200]]]}];
const clipped=new Float32Array(buildingSources([tile]).records);assert.ok(clipped[15]>0);
assert.ok(Math.abs(clipped[28+15]-firstLength%6)<.001);
tile.layers.transportation.features=[{...feature,properties:{class:'primary',brunnel:'bridge'}},{...feature,properties:{class:'primary',brunnel:'tunnel'}}];
assert.equal(buildingSources([tile]).stats.roads,0);
tile.layers.transportation.features=Array(ROAD_LIMIT+50).fill(feature);const bounded=buildingSources([tile]);assert.equal(bounded.stats.roads,ROAD_LIMIT);assert.equal(bounded.stats.roadOverflow,50);
assert.equal(bounded.records.byteLength,ROAD_LIMIT*112);assert.equal(bounded.points.byteLength,ROAD_LIMIT*2*16);
console.log('Urban sources: mapped heights, materials, roofs, road ownership, widths, excluded spans and capacity passed.');

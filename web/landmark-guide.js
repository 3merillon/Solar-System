// Reference material is consulted on selection, never during projection or flight.
const radians = Math.PI / 180;
const compass = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const glossary = 'https://planetarynames.wr.usgs.gov/DescriptorTerms';
const wikiLicense = 'https://creativecommons.org/licenses/by-sa/4.0/';
const dataLicense = 'https://creativecommons.org/licenses/by/4.0/';
const segments = new Intl.Segmenter('en', {granularity:'sentence'});
const sizeFormat = new Intl.NumberFormat('en',{maximumSignificantDigits:3});

function compact(text) {
  if (text.length <= 440) return text;
  let end = 0;
  for (const {index, segment} of segments.segment(text)) {
    if (end && index + segment.length > 440) break;
    end = index + segment.length;
  }
  return text.slice(0, end).trim();
}

function offset(from, to) {
  const a = from[1]*radians, b = to[1]*radians, lon = (to[2]-from[2])*radians;
  const x = Math.cos(b)*Math.sin(lon);
  const y = Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(lon);
  const dot = Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos(lon);
  return {arc:Math.atan2(Math.hypot(x,y), dot), bearing:compass[(Math.round(Math.atan2(x,y)*4/Math.PI)+8)%8]};
}

const km = value => value < 1 ? Math.max(1,Math.round(value*1000))+' m'
  : sizeFormat.format(value)+' km';

export function landmarkNeighborhood(features, notes) {
  const names = new Map(), anchors = [];
  for (const f of features) {
    if (!names.has(f[0])) names.set(f[0],f);
    if (notes[f[5]]) anchors.push(f);
  }
  if (anchors.length < 2) {
    for (const f of features.slice().sort((a,b)=>b[3]-a[3]).slice(0,8)) {
      if (!anchors.includes(f)) anchors.push(f);
    }
  }
  return {names, anchors};
}

function neighborhoodText(f, places, radius) {
  if (!places || !radius) return '';
  const parentName = f[0].replace(/ [A-Z](?: (?:Outer|Inner))?$/, '');
  const parent = f[4]==='SF' && parentName!==f[0] && places.names.get(parentName);
  let nearby = parent, where;
  for (const ref of parent ? [parent] : places.anchors) {
    if (ref[0]===f[0]) continue;
    const delta = offset(ref,f);
    if (!where || delta.arc<where.arc) { nearby=ref; where=delta; }
  }
  if (!where || where.arc < 1e-6) return '';
  const separation = km(where.arc*radius/1000);
  if (parent) {
    const ratio = parent[3]>0 && f[3]>0 ? Math.round(100*f[3]/parent[3]) : 0;
    return `${f[0]} takes its name from ${parent[0]}. Their mapped centers are about ${separation} apart, with ${f[0]} to the ${where.bearing}.`+
      (ratio>0 ? ` Its cataloged span is about ${ratio}% of ${parent[0]}'s.` : '');
  }
  return `For orientation, the center of ${f[0]} lies about ${separation} ${where.bearing} of the center of ${nearby[0]}.`;
}

function surveyText(body, record) {
  if (!record) return '';
  if (body===301) {
    const metres = record[1];
    const depth = metres<1000 ? Math.max(10,Math.round(metres/10)*10)+' m' : (metres/1000).toFixed(1)+' km';
    return `Measurements from a digital elevation model put the crater floor about ${depth} below the rim. This is the relief preserved today, measured by comparing elevations around the rim with points on the floor.`;
  }
  if (body===299) {
    const [,shape,wall,floor,parabola] = record;
    const morphology = {
      '0':'a flat floor', '1':'a bowl-shaped interior', '2':'knobs across the floor', '3':'a central peak',
      '4':'several central peaks', '5':'a ring of peaks inside the rim', '6':'multiple rings inside the basin'
    }[shape];
    const findings = [];
    if (morphology) findings.push(morphology);
    if (wall==='t') findings.push('terraces on the crater walls');
    let text = findings.length ? 'Magellan radar mapping identified '+findings.join(' and ')+' here.' : '';
    if (floor==='d'||floor==='b') text += ` The floor appears ${floor==='d'?'dark':'bright'} at radar wavelengths.`;
    if (parabola==='y') text += ' A parabolic marking extends across the surrounding terrain.';
    return text.trim();
  }
  return '';
}

function mappedUnit(body, f, geology) {
  if (body===299) {
    const metres=geology?.elevations[f[5]];
    if (!Number.isFinite(metres)) return '';
    const height=Math.abs(metres)<50 ? 'close to' : `about ${(Math.abs(metres)/1000).toFixed(1)} km ${metres>0?'above':'below'}`;
    return `At the mapped center of ${f[0]}, Magellan's radar altimetry places the surface ${height} the survey's 6,051 km reference radius. Each grid cell spans roughly 5 km, so this reading describes the surrounding terrain at that scale.`;
  }
  const code=geology?.centers?.[f[5]], unit=geology?.units?.[code];
  if (!unit) return '';
  const map=body===301?'lunar':'Martian';
  let text=`On the USGS ${map} geologic map, the center of ${f[0]} falls in the unit labeled “${unit}” (${code}).`;
  if (body===499) {
    if (unit.includes('Noachian')) text+=' The Noachian is the oldest of the three major periods used to map Mars.';
    else if (unit.includes('Hesperian')) text+=' The Hesperian falls between the older Noachian and the younger Amazonian in the Martian geologic record.';
    else if (unit.includes('Amazonian')) text+=' The Amazonian is the youngest of the three major periods in Martian geology.';
  } else if (unit.includes('Mare')) {
    text+=' Mare units record episodes of volcanic flooding across the lunar lowlands.';
  } else if (unit.includes('Copernican')) {
    text+=' Copernican terrain belongs to the youngest period in the lunar geologic record.';
  } else if (unit.includes('Nectarian') && !unit.includes('Pre-')) {
    text+=' The Nectarian was a time of great basin-forming impacts, early in lunar history.';
  }
  return text;
}

export function describeLandmark(body, f, {guide, notes, articles, survey, geology, places, radius, bodyName}) {
  const id=f[5], authored=notes?.[id], article=articles?.[id], observation=survey?.[id];
  // Some encyclopedia leads consist entirely of the feature name, descriptor
  // and body. Measurements or the guide give a better opening in that case.
  const articleLead=article && article[2].length>=110;
  const finding=surveyText(body,observation), links=[], paragraphs=[];
  const typeText=guide?.overrides[body+':'+f[4]] || guide?.types[f[4]];
  const world=guide?.worlds[body], mapping=mappedUnit(body,f,geology);
  const region=f[8] ? `Its center is on the ${f[8]} map sheet${f[9]?' ('+f[9]+')':''}.` : '';
  const nearby=neighborhoodText(f,places,radius);
  if (authored) {
    paragraphs.push(authored[0]);
    links.push([authored[1],authored[2]]);
  } else if (articleLead) {
    paragraphs.push(article[2]);
  }
  if (article) {
    links.push(['Wikipedia contributors · '+article[0], 'https://en.wikipedia.org/w/index.php?oldid='+article[1]],['CC BY-SA 4.0',wikiLicense]);
  }
  if (finding) {
    paragraphs.push(finding);
    if (body===301) links.push(['Rachael Hoover · Lunar crater depths ('+observation[0]+')','https://doi.org/10.5281/zenodo.21500453']);
    if (body===299) links.push(['Robert Herrick · Venus crater survey (entry '+observation[0]+')','https://www.lpi.usra.edu/resources/vc/']);
    links.push(['CC BY 4.0',dataLicense]);
  }
  if (mapping) {
    paragraphs.push(mapping);
    const mapSources={
      299:['USGS · Magellan global topography','https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m'],
      301:['USGS · Unified Geologic Map of the Moon','https://astrogeology.usgs.gov/search/map/Moon/Geology/Unified_Geologic_Map_of_the_Moon_GIS_v2/'],
      499:['USGS · Geologic Map of Mars','https://pubs.usgs.gov/sim/3292/']
    };
    links.push(mapSources[body]);
  }
  const specific=!!(authored || articleLead || finding || mapping);
  if (!specific) {
    let identity='';
    if (f[3]>0 && bodyName) {
      identity=f[4]==='AA' ? `${f[0]} is a crater about ${km(f[3])} across on ${bodyName}.`
        : `The Gazetteer gives ${f[0]} a span of about ${km(f[3])} on ${bodyName}.`;
    }
    if (identity || nearby) paragraphs.push([identity,nearby].filter(Boolean).join(' '));
  }
  if ((!specific || (!authored && !finding && (article?.[2]?.length??0)<150)) && typeText) {
    paragraphs.push(typeText);
    links.push(['IAU landform terminology',glossary]);
  }
  if (!specific && world) {
    paragraphs.push(world[0]);links.push(['NASA · Surface science','https://science.nasa.gov/'+world[1]]);
  }
  const orientation=[specific && nearby,region].filter(Boolean).join(' ');
  if (orientation) paragraphs.push(orientation);
  if (id) links.push(['USGS Gazetteer · '+f[0], 'https://planetarynames.wr.usgs.gov/Feature/'+id]);
  const naming = [f[6], f[7] ? `The IAU adopted this name in ${f[7]}.` : ''].filter(Boolean).join(' ');
  // A reader can finish the selected article with the menu closed. Short
  // entries have room for the first measurement or regional observation too.
  const lead=paragraphs[0] || naming;
  const summary=(authored || articleLead) && lead.length>440 ? lead : compact(paragraphs.slice(0,2).join(' ') || naming);
  const credits=[];
  if (!authored && articleLead) credits.push('Wikipedia contributors · CC BY-SA 4.0');
  if (finding && summary.includes(finding.split('.')[0])) credits.push((body===301?'R. Hoover':'R. Herrick')+' · CC BY 4.0');
  return {paragraphs,links,naming,summary,credit:credits.join(' / '),furtherReading:article && (authored || !articleLead) ? article[2] : ''};
}

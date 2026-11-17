// Keep provider attribution visible; long licence text lives in a keyboard-
// accessible native disclosure. Updates preserve its open state and focus.
export function installCredits(host){
 const details=document.createElement('details'),summary=document.createElement('summary');
 const line=document.createElement('span'),label=document.createElement('span');
 line.className='credit-providers';label.textContent='Credits';label.className='credit-toggle';
 summary.append(line,label);details.append(summary);
 const panel=document.createElement('div');panel.className='credit-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','Data and asset credits');details.append(panel);host.replaceChildren(details);
 details.addEventListener('keydown',e=>{if(e.key==='Escape'&&details.open){details.open=false;summary.focus();e.preventDefault();}e.stopPropagation();});
 for(const type of ['pointerdown','pointerup','wheel'])details.addEventListener(type,e=>e.stopPropagation());
 // The game's document gesture guard otherwise cancels scrolling outside its
 // control deck. Keep one-finger licence scrolling local to this disclosure.
 details.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();e.stopPropagation();},{passive:false});
 let key='';
 return (attribution,procedural,space=false)=>{
  const next=JSON.stringify([attribution,procedural,space]);if(next===key)return;key=next;
  const providers=attribution.flatMap(a=>{const known=[[/OpenStreetMap/i,'© OpenStreetMap'],[/swisstopo/i,'© swisstopo'],[/EOX/i,'EOX'],[/Terrain Tiles/i,'Terrain Tiles']].filter(([pattern])=>pattern.test(a)).map(([,name])=>name);return known.length?known:[String(a).split(/https?:|[;(]/)[0].trim()];});
  line.textContent=space?'Solar-System v2':procedural?'Procedural world':providers.length?[...new Set(providers)].join(' · '):'Map data';
  const focused=panel.contains(document.activeElement),href=focused?document.activeElement.getAttribute('href'):null;
  panel.replaceChildren();
  for(const a of procedural?['Procedural world · simulated terrain and orbits']:attribution.length?attribution:['Map data: loading source list…']){
   const p=document.createElement('p');let i=0;
   for(const m of String(a).matchAll(/(?:https?:\/\/|github\.com\/)[^\s)>,;]+/g)){
    p.append(a.slice(i,m.index));const link=document.createElement('a');link.href=m[0].startsWith('http')?m[0]:'https://'+m[0];link.textContent=m[0];link.target='_blank';link.rel='noopener noreferrer';p.append(link);i=m.index+m[0].length;
   }
   p.append(String(a).slice(i));panel.append(p);
  }
  const notices=document.createElement('p');
  for(const [text,path] of [['Third-party notices','THIRD-PARTY-NOTICES.txt']]){
   if(notices.childNodes.length)notices.append(' · ');const a=document.createElement('a');a.textContent=text;a.href=path;a.target='_blank';a.rel='noopener noreferrer';notices.append(a);
  }
  panel.append(notices);
  if(focused)([...panel.querySelectorAll('a')].find(a=>a.getAttribute('href')===href)||summary).focus();
 };
}

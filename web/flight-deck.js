import {installCelestialMusic} from './celestial-music.js';

// The page's soundtrack control, always in view at the top of the panel (#sound-section, before the navigation). The car's flight deck (helm, navigation computer, stellar
// atlas, target card and hyperdrive) was removed with the car on 14 November 2026; navigation is in the panel (web/solar.js).
export function installFlightDeck(){
 const $=id=>document.getElementById(id),music=installCelestialMusic();
 const title=document.createElement('div');title.className='group-title';title.innerHTML='<span>Soundtrack</span>';
 const sound=document.createElement('div');sound.id='deck-audio';
 sound.innerHTML=`<div class="audio-orbit" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><span class="eyebrow" id="music-place">Celestial radio</span><button id="music-toggle" aria-pressed="false">Play</button></div><label class="sr-only" for="music-volume">Music volume</label><input id="music-volume" aria-label="Music volume" type="range" min="0" max=".7" step=".01" value="${music.volume}">`;
 // What is playing, in words: the place and its note as a fraction of the Sun's, then the piece. It changes with the music.
 const line=document.createElement('p');line.id='music-line';line.className='small';line.title='Composed as it plays. Every pitch is an exact fraction of the Sun’s note; nothing is tempered.';
 ($('sound-section')||document.body).append(title,sound,line);
 music.onChange(text=>{const parts=text.split(' · ');$('music-place').textContent=parts.slice(0,2).join(' · ');line.textContent=parts.slice(2).join(' · ');});
 const syncMusic=()=>{$('music-toggle').textContent=music.enabled?'Pause':'Play';$('music-toggle').setAttribute('aria-pressed',String(music.enabled));sound.classList.toggle('playing',music.enabled);};
 $('music-toggle').onclick=async()=>{await music.toggle();syncMusic();};$('music-volume').oninput=e=>music.setVolume(Number(e.target.value));syncMusic();
 return {music};
}

// The page is a game: the browser's own menus, shortcuts and gestures stay out of it. tools/Test-Game-Input.mjs holds each of these to it.
// Left alone on purpose: reloading, the developer tools, changing tab and Alt+F4. Ctrl+W, Ctrl+T and Ctrl+N a page cannot refuse except in full screen,
// so F11 goes through here to get the keyboard lock; Esc stays the browser's way out.
const NOT_TEXT=['range','checkbox','radio','button','file','color'];
// Only where text is being entered does a key not belong to the game.
export const typing=el=>el?.tagName==='TEXTAREA'||(el?.tagName==='INPUT'&&!NOT_TEXT.includes(el.type));
// Ctrl+H is not H: a chord is never one of the game's keys.
export const forGame=e=>!e.target?.closest?.('#attribution')&&!typing(e.target)&&!e.ctrlKey&&!e.altKey&&!e.metaKey;
const REFUSED=new Set(['F1','F3','F6','F7','F10','Slash','Quote']);
const WITH_CONTROL=/^(KeyR|F5|Digit[1-9]|Tab|PageUp|PageDown)$/,TOOLS=/^Key[IJC]$/;
function refuse(e){
 if(e.altKey||e.code==='AltLeft'||e.code==='AltRight')return e.code!=='F4'&&e.code!=='Tab';
 if(e.ctrlKey||e.metaKey)return !WITH_CONTROL.test(e.code)&&!(e.shiftKey&&TOOLS.test(e.code));
 return REFUSED.has(e.code);
}
function fullScreen(){
 if(document.fullscreenElement){navigator.keyboard?.unlock?.();document.exitFullscreen().catch(e=>console.warn('full screen',e));return;}
 document.documentElement.requestFullscreen({navigationUI:'hide'}).then(()=>navigator.keyboard?.lock?.(['KeyW','KeyT','KeyN'])).catch(e=>console.warn('full screen',e));
}
export function guardBrowser(){
 const stop=e=>e.preventDefault();
 // Wherever a right press ends: Chrome opens its menu on the release, over whatever is under the cursor by then.
 window.addEventListener('contextmenu',stop,{capture:true});
 for(const type of ['dragstart','dragover','drop'])window.addEventListener(type,stop,{capture:true});
 window.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{capture:true,passive:false});
 // Middle for autoscroll, and the mouse's own back and forward, which would leave the game.
 for(const type of ['mousedown','mouseup','auxclick'])window.addEventListener(type,e=>{if(e.button===1||e.button===3||e.button===4)e.preventDefault();},{capture:true});
 window.addEventListener('keydown',e=>{
  if(e.target.closest?.('#attribution'))return;
  if(typing(e.target)){if(e.code==='Enter'||e.code==='Escape')e.target.blur();return;}
  if(e.code==='F11'){e.preventDefault();if(!e.repeat)fullScreen();return;}
  if(refuse(e))e.preventDefault();
  // A focused dropdown must not choose by the letters the craft flies with.
  if(e.target.tagName==='SELECT'&&e.key.length===1)e.preventDefault();
 },{capture:true});
 // Space presses a focused button on its release, and Alt opens the browser's menu on its release.
 window.addEventListener('keyup',e=>{if(!e.target.closest?.('#attribution')&&!typing(e.target)&&(e.code==='Space'||refuse(e)))e.preventDefault();},{capture:true});
 // A control used with the mouse hands the keys straight back. By keyboard it keeps them: Tab still reaches the panel.
 window.addEventListener('pointerup',e=>{if(!e.target.closest?.('#attribution')&&document.activeElement?.matches('button,summary,a[href],input[type=range],input[type=checkbox]'))document.activeElement.blur();});
}

// Quality presets and device tiering. Ultra is the full-size, 128-sample
// cloud reference; high renders clouds at half size with 64 samples (the
// composite upsamples them with the depth-guided bilinear filter) and is the
// default on capable hardware. Presets are plain settings patches for
// the renderer; every value remains individually adjustable (Custom). Device
// detection only chooses a starting preset and canvas size; it never hides a
// setting. The allocation tier (resident caches) is chosen once at startup.
export const PRESETS={
 ultra:{taa:true,ground_cover:true,cover_reach:260,scenery_budget:4096,render_scale:1,cloud_scale:1,reference:true,cloud_steps:128,cloud_far_scale:1,cloud_far_distance:16000,cloud_refresh:4,shadows:true,shadow_steps:64,shadow_cascades:6,profile_quality:1,atmosphere_steps:12,water_bands:10,water_reflections:true,caustics:true,relief_steps:5,bloom_levels:6,surface_detail:true,ground_detail:true,lod_distance:4,scenery_density:1,scenery_detail:1,trees:true,rocks:true,clouds:true,water:true,atmosphere:true,foam:1},
 high:{taa:true,ground_cover:true,cover_reach:220,scenery_budget:4096,render_scale:1,cloud_scale:2,reference:false,cloud_steps:64,cloud_far_scale:2,cloud_far_distance:16000,cloud_refresh:8,shadows:true,shadow_steps:64,shadow_cascades:6,profile_quality:1,atmosphere_steps:12,water_bands:10,water_reflections:true,caustics:true,relief_steps:5,bloom_levels:6,surface_detail:true,ground_detail:true,lod_distance:4,scenery_density:1,scenery_detail:1,trees:true,rocks:true,clouds:true,water:true,atmosphere:true,foam:1},
 medium:{taa:true,ground_cover:true,cover_reach:140,scenery_budget:2048,render_scale:1,cloud_scale:2,reference:false,cloud_steps:48,cloud_far_scale:2,cloud_far_distance:12000,cloud_refresh:8,shadows:true,shadow_steps:48,shadow_cascades:5,profile_quality:.5,atmosphere_steps:8,water_bands:8,water_reflections:true,caustics:true,relief_steps:3,bloom_levels:5,surface_detail:true,ground_detail:true,lod_distance:2,scenery_density:1,scenery_detail:1,trees:true,rocks:true,clouds:true,water:true,atmosphere:true,foam:1},
 low:{taa:false,ground_cover:true,cover_reach:70,scenery_budget:1024,render_scale:.75,cloud_scale:4,reference:false,cloud_steps:48,cloud_far_scale:2,cloud_far_distance:8000,cloud_refresh:8,shadows:true,shadow_steps:24,shadow_cascades:3,profile_quality:.25,atmosphere_steps:4,water_bands:6,water_reflections:false,caustics:false,relief_steps:1,bloom_levels:4,surface_detail:true,ground_detail:true,lod_distance:1,scenery_density:.7,scenery_detail:.8,trees:true,rocks:true,clouds:true,water:true,atmosphere:true,foam:1},
 minimal:{taa:false,ground_cover:false,cover_reach:70,scenery_budget:512,render_scale:.5,cloud_scale:4,reference:false,cloud_steps:32,cloud_far_scale:4,cloud_far_distance:6000,cloud_refresh:8,shadows:false,shadow_steps:8,shadow_cascades:2,profile_quality:.25,atmosphere_steps:2,water_bands:4,water_reflections:false,caustics:false,relief_steps:0,bloom_levels:3,surface_detail:false,ground_detail:false,lod_distance:.5,scenery_density:.5,scenery_detail:.6,trees:true,rocks:true,clouds:true,water:true,atmosphere:true,foam:0}
};
export const PRESET_KEYS=Object.keys(PRESETS.high);
export function presetOf(settings){
 for(const [name,preset] of Object.entries(PRESETS)){if(PRESET_KEYS.every(k=>k==='reference'||Object.is(preset[k],settings[k])||preset[k]===settings[k]))return name;}
 return 'custom';
}
// Starting preset from the adapter the page can see. Mobile class devices and
// small storage/buffer limits start minimal; weak desktops start low; the
// user's saved choice wins on capable hardware.
export async function detectDevice(){
 const result={mobile:false,weak:false,limits:null,info:null,reason:'default'};
 try{
  const ua=navigator.userAgent||'';
  result.mobile=!!(navigator.userAgentData?.mobile)||/Android|iPhone|iPad|iPod|Mobile Safari|Mobi/i.test(ua)||(navigator.maxTouchPoints>1&&Math.min(screen.width,screen.height)<900);
  const adapter=navigator.gpu?await navigator.gpu.requestAdapter({powerPreference:'high-performance'}):null;
  if(adapter){
   const l=adapter.limits;result.limits={maxBufferSize:l.maxBufferSize,maxStorageBufferBindingSize:l.maxStorageBufferBindingSize,maxTextureDimension3D:l.maxTextureDimension3D,maxComputeWorkgroupStorageSize:l.maxComputeWorkgroupStorageSize,maxComputeInvocationsPerWorkgroup:l.maxComputeInvocationsPerWorkgroup,maxStorageBuffersPerShaderStage:l.maxStorageBuffersPerShaderStage};
   try{const info=adapter.info||(adapter.requestAdapterInfo?await adapter.requestAdapterInfo():null);if(info)result.info={vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description};}catch{}
   result.weak=l.maxStorageBufferBindingSize<256*1024*1024||l.maxBufferSize<512*1024*1024||/\b(adreno|mali|apple gpu|powervr|xclipse)\b/i.test(JSON.stringify(result.info||{}));
  }
  if((navigator.hardwareConcurrency||8)<=4)result.weak=true;
  result.reason=result.mobile?'mobile class device':result.weak?'limited adapter':'capable adapter';
 }catch(error){result.reason='detection failed: '+error;}
 return result;
}
export function startingPreset(device,saved){
 if(device.mobile)return 'minimal';
 if(device.weak)return saved&&saved!=='high'?saved:'low';
 return saved||'high';
}
// Canvas pixels: the image has the window's shape, so it fills the window on every device and follows it when the
// window is resized or the device turned (web/explorer.js fitWorld). Desktops render at most the pixels of
// 1920x1080, the bounded allocation of every measurement, and never more than the window shows; mobile devices
// at most 1280 on the long side, so the renderer never allocates a 1080p target set behind a phone screen.
// fixed: a test page keeps the 1920x1080 image the measurement tools expect, whatever the window.
export function canvasSize(device,fixed=false,cssWidth=innerWidth,cssHeight=innerHeight){
 if(fixed&&!device.mobile)return [1920,1080];
 const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,cssWidth*dpr),h=Math.max(1,cssHeight*dpr);
 const scale=Math.min(1,(device.mobile?1280:4096)/Math.max(w,h),Math.sqrt(1920*1080/(w*h)));
 let cw=Math.max(2,Math.round(w*scale/2)*2),ch=Math.max(2,Math.round(h*scale/2)*2);
 if(!device.mobile)while(cw*ch>1920*1080){if(cw>=ch)cw-=2;else ch-=2;}
 return [cw,ch];
}
// The size the world image is rendered at now. The canvas element cannot say: its drawing belongs to the worker.
export const world={width:1920,height:1080};
// Resident-cache allocation tier for the worker (chosen once; a change needs a reload).
export function allocationTier(device){return device.mobile?'minimal':device.weak?'reduced':'full';}

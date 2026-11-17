// Roughly where a visitor is, from the time zone their browser reports (Intl), without asking for their location or sending a
// request anywhere: each zone's main city, latitude and east longitude in degrees (rounded). A zone not listed falls back to the
// longitude of its UTC offset (15 degrees an hour) at 30 degrees north, where most people live. A starting view, not a position.
const ZONES={
 'Europe/London':[51.5,-0.1],'Europe/Dublin':[53.3,-6.3],'Europe/Lisbon':[38.7,-9.1],'Europe/Madrid':[40.4,-3.7],'Europe/Paris':[48.9,2.4],
 'Europe/Brussels':[50.8,4.4],'Europe/Amsterdam':[52.4,4.9],'Europe/Berlin':[52.5,13.4],'Europe/Zurich':[47.4,8.5],'Europe/Rome':[41.9,12.5],
 'Europe/Vienna':[48.2,16.4],'Europe/Prague':[50.1,14.4],'Europe/Warsaw':[52.2,21.0],'Europe/Stockholm':[59.3,18.1],'Europe/Oslo':[59.9,10.8],
 'Europe/Copenhagen':[55.7,12.6],'Europe/Helsinki':[60.2,24.9],'Europe/Athens':[38.0,23.7],'Europe/Istanbul':[41.0,29.0],'Europe/Kiev':[50.5,30.5],
 'Europe/Kyiv':[50.5,30.5],'Europe/Bucharest':[44.4,26.1],'Europe/Budapest':[47.5,19.0],'Europe/Moscow':[55.8,37.6],'Atlantic/Reykjavik':[64.1,-21.9],
 'Atlantic/Azores':[37.7,-25.7],'Atlantic/Canary':[28.1,-15.4],'Africa/Casablanca':[33.6,-7.6],'Africa/Lagos':[6.5,3.4],'Africa/Cairo':[30.0,31.2],
 'Africa/Johannesburg':[-26.2,28.0],'Africa/Nairobi':[-1.3,36.8],'Africa/Algiers':[36.8,3.1],'Africa/Abidjan':[5.3,-4.0],'Africa/Kinshasa':[-4.3,15.3],
 'Asia/Dubai':[25.2,55.3],'Asia/Tehran':[35.7,51.4],'Asia/Karachi':[24.9,67.0],'Asia/Kolkata':[22.6,88.4],'Asia/Calcutta':[22.6,88.4],
 'Asia/Dhaka':[23.8,90.4],'Asia/Bangkok':[13.8,100.5],'Asia/Jakarta':[-6.2,106.8],'Asia/Singapore':[1.3,103.8],'Asia/Kuala_Lumpur':[3.1,101.7],
 'Asia/Manila':[14.6,121.0],'Asia/Shanghai':[31.2,121.5],'Asia/Hong_Kong':[22.3,114.2],'Asia/Taipei':[25.0,121.6],'Asia/Seoul':[37.6,127.0],
 'Asia/Tokyo':[35.7,139.7],'Asia/Jerusalem':[31.8,35.2],'Asia/Riyadh':[24.7,46.7],'Asia/Almaty':[43.2,76.9],'Asia/Tashkent':[41.3,69.3],
 'Asia/Ho_Chi_Minh':[10.8,106.7],'Asia/Saigon':[10.8,106.7],'Asia/Kathmandu':[27.7,85.3],'Asia/Yangon':[16.9,96.2],'Asia/Vladivostok':[43.1,131.9],
 'Australia/Sydney':[-33.9,151.2],'Australia/Melbourne':[-37.8,145.0],'Australia/Brisbane':[-27.5,153.0],'Australia/Perth':[-31.95,115.9],
 'Australia/Adelaide':[-34.9,138.6],'Pacific/Auckland':[-36.8,174.8],'Pacific/Honolulu':[21.3,-157.9],'Pacific/Fiji':[-18.1,178.4],
 'America/New_York':[40.7,-74.0],'America/Toronto':[43.7,-79.4],'America/Chicago':[41.9,-87.6],'America/Denver':[39.7,-105.0],
 'America/Phoenix':[33.4,-112.1],'America/Los_Angeles':[34.1,-118.2],'America/Vancouver':[49.3,-123.1],'America/Anchorage':[61.2,-149.9],
 'America/Halifax':[44.6,-63.6],'America/St_Johns':[47.6,-52.7],'America/Mexico_City':[19.4,-99.1],'America/Bogota':[4.7,-74.1],
 'America/Lima':[-12.0,-77.0],'America/Caracas':[10.5,-66.9],'America/Santiago':[-33.4,-70.7],'America/Buenos_Aires':[-34.6,-58.4],
 'America/Argentina/Buenos_Aires':[-34.6,-58.4],'America/Sao_Paulo':[-23.6,-46.6],'America/Montevideo':[-34.9,-56.2],'America/Havana':[23.1,-82.4],
 'America/Panama':[9.0,-79.5],'America/Guatemala':[14.6,-90.5],'America/Edmonton':[53.5,-113.5],'America/Winnipeg':[49.9,-97.1],
 'America/Detroit':[42.3,-83.0],'America/Puerto_Rico':[18.5,-66.1],
};
export function approximatePlace(){
 try{
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  if(ZONES[zone])return ZONES[zone];
  const offset=-new Date().getTimezoneOffset()/60;
  if(Number.isFinite(offset))return [30,((offset*15+540)%360)-180];
 }catch{}
 return null;
}

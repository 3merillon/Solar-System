// Serialize the shared flight path so the same shots can run on older snapshots.
import {giantFlightPath} from '../web/giant-flight.js';

export const giantShot = (id, fraction) => `
 solarFlight.setTime(Date.parse('2013-10-10T12:00:00Z') / 1000 + 3 - 946727935.816);
 solarFlight.setRate(0);
 for(const key of ['solar-trails','solar-labels'])document.getElementById(key).checked=false;
 window.giantFlight=(${giantFlightPath.toString()})(solarFlight.flight,${id});
 window.giantFlight(${fraction});`;

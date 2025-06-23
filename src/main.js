import { RetroSolarSystemApp } from './app.js';

// WebGL setup
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2');
if (!gl) { 
    alert('WebGL2 not supported'); 
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
}

window.addEventListener('resize', resize);
resize();

// Start the app and make it globally accessible
const app = new RetroSolarSystemApp(gl);
window.solarSystemApp = app; // Make it accessible to camera
app.run();
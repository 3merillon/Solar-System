import { earthVertexShaderSource, earthFragmentShaderSource, createEarthUniformSetup } from './planet_shaders/earth-shaders.js';
import { marsVertexShaderSource, marsFragmentShaderSource, createMarsUniformSetup } from './planet_shaders/mars-shaders.js';
import { venusVertexShaderSource, venusFragmentShaderSource, createVenusUniformSetup } from './planet_shaders/venus-shaders.js';
import { moonVertexShaderSource, moonFragmentShaderSource, createMoonUniformSetup } from './planet_shaders/moon-shaders.js';
import { mercuryVertexShaderSource, mercuryFragmentShaderSource, createMercuryUniformSetup } from './planet_shaders/mercury-shaders.js';
import { jupiterVertexShaderSource, jupiterFragmentShaderSource, createJupiterUniformSetup } from './planet_shaders/jupiter-shaders.js';
import { saturnVertexShaderSource, saturnFragmentShaderSource, createSaturnUniformSetup } from './planet_shaders/saturn-shaders.js';
import { uranusVertexShaderSource, uranusFragmentShaderSource, createUranusUniformSetup } from './planet_shaders/uranus-shaders.js';
import { neptuneVertexShaderSource, neptuneFragmentShaderSource, createNeptuneUniformSetup } from './planet_shaders/neptune-shaders.js';
import { plutoVertexShaderSource, plutoFragmentShaderSource, createPlutoUniformSetup } from './planet_shaders/pluto-shaders.js';
import { phobosVertexShaderSource, phobosFragmentShaderSource, createPhobosUniformSetup } from './planet_shaders/phobos-shaders.js';
import { deimosVertexShaderSource, deimosFragmentShaderSource, createDeimosUniformSetup } from './planet_shaders/deimos-shaders.js';
import { ioVertexShaderSource, ioFragmentShaderSource, createIoUniformSetup } from './planet_shaders/io-shaders.js';
import { europaVertexShaderSource, europaFragmentShaderSource, createEuropaUniformSetup } from './planet_shaders/europa-shaders.js';
import { ganymedeVertexShaderSource, ganymedeFragmentShaderSource, createGanymedeUniformSetup } from './planet_shaders/ganymede-shaders.js';
import { callistoVertexShaderSource, callistoFragmentShaderSource, createCallistoUniformSetup } from './planet_shaders/callisto-shaders.js';
import { titanVertexShaderSource, titanFragmentShaderSource, createTitanUniformSetup } from './planet_shaders/titan-shaders.js';
import { charonVertexShaderSource, charonFragmentShaderSource, createCharonUniformSetup } from './planet_shaders/charon-shaders.js';

export function setupPlanetShaders(shaderManager) {
    console.log('Setting up custom planet shaders...');
    
    // Register Earth shader
    const earthSuccess = shaderManager.registerCustomShader(
        'earth',
        earthVertexShaderSource,
        earthFragmentShaderSource,
        createEarthUniformSetup()
    );
    
    // Register Mars shader
    const marsSuccess = shaderManager.registerCustomShader(
        'mars',
        marsVertexShaderSource,
        marsFragmentShaderSource,
        createMarsUniformSetup()
    );

    // Register Phobos shader
    const phobosSuccess = shaderManager.registerCustomShader(
        'phobos',
        phobosVertexShaderSource,
        phobosFragmentShaderSource,
        createPhobosUniformSetup()
    );

    // Register Deimos shader
    const deimosSuccess = shaderManager.registerCustomShader(
        'deimos',
        deimosVertexShaderSource,
        deimosFragmentShaderSource,
        createDeimosUniformSetup()
    );
    
    // Register Venus shader
    const venusSuccess = shaderManager.registerCustomShader(
        'venus',
        venusVertexShaderSource,
        venusFragmentShaderSource,
        createVenusUniformSetup()
    );
    
    // Register Moon shader
    const moonSuccess = shaderManager.registerCustomShader(
        'moon',
        moonVertexShaderSource,
        moonFragmentShaderSource,
        createMoonUniformSetup()
    );
    
    // Mercury
    const mercurySuccess = shaderManager.registerCustomShader(
        'mercury',
        mercuryVertexShaderSource,
        mercuryFragmentShaderSource,
        createMercuryUniformSetup()
    );
    // Jupiter
    const jupiterSuccess = shaderManager.registerCustomShader(
        'jupiter',
        jupiterVertexShaderSource,
        jupiterFragmentShaderSource,
        createJupiterUniformSetup()
    );
    // Io
    const ioSuccess = shaderManager.registerCustomShader(
        'io',
        ioVertexShaderSource,
        ioFragmentShaderSource,
        createIoUniformSetup()
    );
    // Europa
    const europaSuccess = shaderManager.registerCustomShader(
        'europa',
        europaVertexShaderSource,
        europaFragmentShaderSource,
        createEuropaUniformSetup()
    );
    // Ganymede
    const ganymedeSuccess = shaderManager.registerCustomShader(
        'ganymede',
        ganymedeVertexShaderSource,
        ganymedeFragmentShaderSource,
        createGanymedeUniformSetup()
    );
    // Europa
    const callistoSuccess = shaderManager.registerCustomShader(
        'callisto',
        callistoVertexShaderSource,
        callistoFragmentShaderSource,
        createCallistoUniformSetup()
    );
    // Saturn
    const saturnSuccess = shaderManager.registerCustomShader(
        'saturn',
        saturnVertexShaderSource,
        saturnFragmentShaderSource,
        createSaturnUniformSetup()
    );
    // Titan
    const titanSuccess = shaderManager.registerCustomShader(
        'titan',
        titanVertexShaderSource,
        titanFragmentShaderSource,
        createTitanUniformSetup()
    );
    // Uranus
    const uranusSuccess = shaderManager.registerCustomShader(
        'uranus',
        uranusVertexShaderSource,
        uranusFragmentShaderSource,
        createUranusUniformSetup()
    );
    // Neptune
    const neptuneSuccess = shaderManager.registerCustomShader(
        'neptune',
        neptuneVertexShaderSource,
        neptuneFragmentShaderSource,
        createNeptuneUniformSetup()
    );
    // Pluto
    const plutoSuccess = shaderManager.registerCustomShader(
        'pluto',
        plutoVertexShaderSource,
        plutoFragmentShaderSource,
        createPlutoUniformSetup()
    );
    // Charon
    const charonSuccess = shaderManager.registerCustomShader(
        'charon',
        charonVertexShaderSource,
        charonFragmentShaderSource,
        createCharonUniformSetup()
    );
    
    console.log('Planet shader registration results:', {
        earth: earthSuccess,
        mars: marsSuccess,
        phobos: phobosSuccess,
        deimos: deimosSuccess,
        venus: venusSuccess,
        moon: moonSuccess,
        mercury: mercurySuccess,
        jupiter: jupiterSuccess,
        io: ioSuccess,
        europa: europaSuccess,
        saturn: saturnSuccess,
        titan: titanSuccess,
        uranus: uranusSuccess,
        neptune: neptuneSuccess,
        pluto: plutoSuccess,
        charon: charonSuccess
    });
    return earthSuccess && marsSuccess && phobosSuccess && deimosSuccess && venusSuccess && moonSuccess &&
        mercurySuccess && jupiterSuccess && ioSuccess && europaSuccess && saturnSuccess && titanSuccess &&
        uranusSuccess && neptuneSuccess && plutoSuccess && charonSuccess;
}
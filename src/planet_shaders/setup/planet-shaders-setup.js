import { earthVertexShaderSource, earthFragmentShaderSource, createEarthUniformSetup } from '../earth-shaders.js';
import { marsVertexShaderSource, marsFragmentShaderSource, createMarsUniformSetup } from '../mars-shaders.js';
import { venusVertexShaderSource, venusFragmentShaderSource, createVenusUniformSetup } from '../venus-shaders.js';
import { moonVertexShaderSource, moonFragmentShaderSource, createMoonUniformSetup } from '../moon-shaders.js';
import { mercuryVertexShaderSource, mercuryFragmentShaderSource, createMercuryUniformSetup } from '../mercury-shaders.js';
import { jupiterVertexShaderSource, jupiterFragmentShaderSource, createJupiterUniformSetup } from '../jupiter-shaders.js';
import { saturnVertexShaderSource, saturnFragmentShaderSource, createSaturnUniformSetup } from '../saturn-shaders.js';
import { uranusVertexShaderSource, uranusFragmentShaderSource, createUranusUniformSetup } from '../uranus-shaders.js';
import { neptuneVertexShaderSource, neptuneFragmentShaderSource, createNeptuneUniformSetup } from '../neptune-shaders.js';
import { plutoVertexShaderSource, plutoFragmentShaderSource, createPlutoUniformSetup } from '../pluto-shaders.js';
import { phobosVertexShaderSource, phobosFragmentShaderSource, createPhobosUniformSetup } from '../phobos-shaders.js';
import { deimosVertexShaderSource, deimosFragmentShaderSource, createDeimosUniformSetup } from '../deimos-shaders.js';
import { ioVertexShaderSource, ioFragmentShaderSource, createIoUniformSetup } from '../io-shaders.js';
import { europaVertexShaderSource, europaFragmentShaderSource, createEuropaUniformSetup } from '../europa-shaders.js';
import { ganymedeVertexShaderSource, ganymedeFragmentShaderSource, createGanymedeUniformSetup } from '../ganymede-shaders.js';
import { callistoVertexShaderSource, callistoFragmentShaderSource, createCallistoUniformSetup } from '../callisto-shaders.js';
import { titanVertexShaderSource, titanFragmentShaderSource, createTitanUniformSetup } from '../titan-shaders.js';
import { charonVertexShaderSource, charonFragmentShaderSource, createCharonUniformSetup } from '../charon-shaders.js';

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
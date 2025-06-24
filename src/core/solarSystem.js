import { mat4Identity, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Translate, mat4Multiply, mat3FromMat4, mat3Transpose, mat3Inverse, mat3Identity } from './utils.js';

export class CelestialBody {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.radius = config.radius * 10;
        this.color = config.color;
        this.parent = null;
        this.children = [];
        this.orbitRadius = (config.orbitRadius || 0) * 10;
        this.orbitSpeed = config.orbitSpeed || 0;
        this.orbitTilt = config.orbitTilt || 0;
        this.orbitPhase = config.orbitPhase || 0;
        this.rotationSpeed = config.rotationSpeed || 0;
        this.rotationTilt = config.rotationTilt || 0;
        this.rotationPhase = config.rotationPhase || 0;
        
        this.initialOrbitPhase = this.orbitPhase;
        this.initialRotationPhase = this.rotationPhase;
        
        this.orbitAngle = this.orbitPhase;
        this.rotationAngle = this.rotationPhase;
        this.orbitMatrix = mat4Identity();
        this.worldMatrix = mat4Identity();
        this.normalMatrix = mat3Identity();
        this.position = [0, 0, 0];
        this.waveType = config.waveType || 0;
        this.noiseScale = config.noiseScale || 10.0;
        this.noiseOffset = config.noiseOffset || 0.0;
        this.lodMultiplier = config.lodMultiplier || 1.0;
        
        this.timeMultiplier = 1.0;
    }

    addChild(child) {
        child.parent = this;
        this.children.push(child);
    }

    setTimeMultiplier(multiplier) {
        this.timeMultiplier = multiplier;
        for (const child of this.children) {
            child.setTimeMultiplier(multiplier);
        }
    }

    setPositionForDate(date, referenceDate) {
        const daysDiff = (date.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
        
        const orbitPeriodDays = this.getOrbitalPeriodDays();
        if (orbitPeriodDays > 0) {
            const orbitProgress = (daysDiff / orbitPeriodDays) * 2 * Math.PI;
            this.orbitAngle = this.initialOrbitPhase + orbitProgress;
        }
        
        const rotationPeriodDays = this.getRotationPeriodDays();
        if (rotationPeriodDays > 0) {
            const rotationProgress = (daysDiff / rotationPeriodDays) * 2 * Math.PI;
            this.rotationAngle = this.initialRotationPhase + rotationProgress;
        }
        
        this.updateMatrices();
        
        for (const child of this.children) {
            child.setPositionForDate(date, referenceDate);
        }
    }

    getOrbitalPeriodDays() {
        if (this.orbitSpeed === 0) return 0;
        return (2 * Math.PI) / Math.abs(this.orbitSpeed);
    }

    getRotationPeriodDays() {
        if (this.rotationSpeed === 0) return 0;
        return (2 * Math.PI) / Math.abs(this.rotationSpeed);
    }

    updateAnimation(time, deltaTime, systemPaused) {
        const deltaDays = (deltaTime / 86400) * this.timeMultiplier;
        const effectiveDeltaDays = systemPaused ? 0 : deltaDays;
        
        this.orbitAngle += this.orbitSpeed * effectiveDeltaDays;
        this.rotationAngle += this.rotationSpeed * effectiveDeltaDays;
        
        this.updateMatrices();
        for (const c of this.children) c.updateAnimation(time, deltaTime, systemPaused);
    }

    updateMatrices() {
        let parentMatrix = this.parent ? this.parent.orbitMatrix : mat4Identity();

        let orbitTiltMat = this.orbitTilt !== 0 ? mat4RotateX(this.orbitTilt) : mat4Identity();
        let orbitRotMat = mat4RotateY(this.orbitAngle);
        let orbitTransMat = mat4Translate(this.orbitRadius, 0, 0);

        let orbit = mat4Multiply(orbitTiltMat, parentMatrix);
        orbit = mat4Multiply(orbitRotMat, orbit);
        orbit = mat4Multiply(orbitTransMat, orbit);

        this.orbitMatrix = orbit;
        this.orbitCenter = [orbit[12], orbit[13], orbit[14]];
        this.position = [orbit[12], orbit[13], orbit[14]];

        let worldAxisTilt = mat4Identity();
        if (this.rotationTilt !== 0) {
            worldAxisTilt = mat4RotateZ(this.rotationTilt);
        }

        let worldSpin = mat4RotateY(this.rotationAngle);
        let fixedAxisRotation = mat4Multiply(worldSpin, worldAxisTilt);

        this.worldMatrix = mat4Multiply(fixedAxisRotation, mat4Translate(this.position[0], this.position[1], this.position[2]));

        this.normalMatrix = mat3FromMat4(this.worldMatrix);
        this.normalMatrix = mat3Transpose(mat3Inverse(this.normalMatrix));
    }
}

const DEG = Math.PI / 180;

export const SOLAR_SYSTEM_CONFIG = {
    sun: { 
        id: 'sun', name: 'Sun', radius: 2.0, color: [1, 0.8, 0.2], 
        rotationSpeed: 2 * Math.PI / 25.4,
        rotationTilt: 7.25 * DEG, 
        rotationPhase: 0,
        waveType: 2, noiseScale: 3.0,
        maxDisplacement: 0.30
    },
    mercury: { 
        id: 'mercury', name: 'Mercury', radius: 0.07, color: [0.7, 0.7, 0.6], 
        orbitRadius: 3.9, 
        orbitSpeed: 2 * Math.PI / 87.97,
        orbitTilt: 7.0 * DEG, 
        orbitPhase: 174.8 * DEG,
        rotationSpeed: 2 * Math.PI / 58.646,
        rotationTilt: 0.034 * DEG,
        rotationPhase: 0,
        waveType: 6, noiseScale: 25.0, parent: 'sun',
        maxDisplacement: 0.05
    },
    venus: { 
        id: 'venus', name: 'Venus', radius: 0.17, color: [1, 0.8, 0.3], 
        orbitRadius: 7.2, 
        orbitSpeed: 2 * Math.PI / 224.7,
        orbitTilt: 3.4 * DEG, 
        orbitPhase: 336.0 * DEG,
        rotationSpeed: -2 * Math.PI / 243.025,
        rotationTilt: 177.4 * DEG,
        rotationPhase: 0,
        waveType: 3, noiseScale: 8.0, parent: 'sun',
        maxDisplacement: 0.10
    },
    earth: { 
        id: 'earth', name: 'Earth', radius: 0.18, color: [0.2, 0.7, 1], 
        orbitRadius: 10.0, 
        orbitSpeed: 2 * Math.PI / 365.256,
        orbitTilt: 0.0, 
        orbitPhase: 100.5 * DEG,
        rotationSpeed: 2 * Math.PI / 0.99726968,
        rotationTilt: 23.44 * DEG,
        rotationPhase: 280.16 * DEG,
        waveType: 1, noiseScale: 8.0, parent: 'sun',
        maxDisplacement: 0.10
    },
    moon: { 
        id: 'moon', name: 'Moon', radius: 0.05, color: [0.8, 0.8, 0.7], 
        orbitRadius: 0.5, 
        orbitSpeed: 2 * Math.PI / 27.322,
        orbitTilt: 5.145 * DEG, 
        orbitPhase: 201.0 * DEG,
        rotationSpeed: 2 * Math.PI / 27.322,
        rotationTilt: 6.68 * DEG,
        rotationPhase: 0,
        waveType: 5, noiseScale: 30.0, parent: 'earth',
        maxDisplacement: 0.05
    },
    mars: { 
        id: 'mars', name: 'Mars', radius: 0.08, color: [1, 0.4, 0.2], 
        orbitRadius: 15.2, 
        orbitSpeed: 2 * Math.PI / 686.98,
        orbitTilt: 1.85 * DEG, 
        orbitPhase: 19.4 * DEG,
        rotationSpeed: 2 * Math.PI / 1.025957,
        rotationTilt: 25.19 * DEG,
        rotationPhase: 0,
        waveType: 3, noiseScale: 12.0, parent: 'sun',
        maxDisplacement: 0.16
    },
    phobos: { 
        id: 'phobos', name: 'Phobos', radius: 0.01, color: [0.6, 0.5, 0.4], 
        orbitRadius: 0.12, 
        orbitSpeed: 2 * Math.PI / 0.31891,
        orbitTilt: 1.08 * DEG, 
        orbitPhase: 90 * DEG,
        rotationSpeed: 2 * Math.PI / 0.31891,
        rotationTilt: 0.0,
        rotationPhase: 0,
        waveType: 5, noiseScale: 40.0, parent: 'mars',
        maxDisplacement: 0.10
    },
    deimos: { 
        id: 'deimos', name: 'Deimos', radius: 0.006, color: [0.5, 0.4, 0.3], 
        orbitRadius: 0.2, 
        orbitSpeed: 2 * Math.PI / 1.263,
        orbitTilt: 0.93 * DEG, 
        orbitPhase: 270 * DEG,
        rotationSpeed: 2 * Math.PI / 1.263,
        rotationTilt: 0.0,
        rotationPhase: 0,
        waveType: 5, noiseScale: 50.0, parent: 'mars',
        maxDisplacement: 0.10
    },
    jupiter: { 
        id: 'jupiter', name: 'Jupiter', radius: 0.20, color: [0.9, 0.7, 0.4], 
        orbitRadius: 52.0, 
        orbitSpeed: 2 * Math.PI / (11.862 * 365.25),
        orbitTilt: 1.3 * DEG, 
        orbitPhase: 34.3 * DEG,
        rotationSpeed: 2 * Math.PI / 0.41354,
        rotationTilt: 3.13 * DEG,
        rotationPhase: 0,
        waveType: 4, noiseScale: 4.0, parent: 'sun',
        maxDisplacement: 0.04
    },
    io: { 
        id: 'io', name: 'Io', radius: 0.02, color: [1, 1, 0.6], 
        orbitRadius: 0.3, 
        orbitSpeed: 2 * Math.PI / 1.769,
        orbitTilt: 0.04 * DEG, 
        orbitPhase: 0 * DEG,
        rotationSpeed: 2 * Math.PI / 1.769,
        rotationTilt: 0.0,
        rotationPhase: 0,
        waveType: 3, noiseScale: 20.0, parent: 'jupiter',
        maxDisplacement: 0.12
    },
    europa: { 
        id: 'europa', name: 'Europa', radius: 0.018, color: [0.9, 0.9, 1], 
        orbitRadius: 0.48, 
        orbitSpeed: 2 * Math.PI / 3.551,
        orbitTilt: 0.47 * DEG, 
        orbitPhase: 120 * DEG,
        rotationSpeed: 2 * Math.PI / 3.551,
        rotationTilt: 0.1 * DEG,
        rotationPhase: 0,
        waveType: 1, noiseScale: 15.0, parent: 'jupiter',
        maxDisplacement: 0.05
    },
    ganymede: { 
        id: 'ganymede', name: 'Ganymede', radius: 0.026, color: [0.7, 0.6, 0.5], 
        orbitRadius: 0.76, 
        orbitSpeed: 2 * Math.PI / 7.155,
        orbitTilt: 0.2 * DEG, 
        orbitPhase: 240 * DEG,
        rotationSpeed: 2 * Math.PI / 7.155,
        rotationTilt: 0.33 * DEG,
        rotationPhase: 0,
        waveType: 5, noiseScale: 18.0, parent: 'jupiter',
        maxDisplacement: 0.06
    },
    callisto: { 
        id: 'callisto', name: 'Callisto', radius: 0.024, color: [0.4, 0.4, 0.4], 
        orbitRadius: 1.35, 
        orbitSpeed: 2 * Math.PI / 16.689,
        orbitTilt: 0.28 * DEG, 
        orbitPhase: 60 * DEG,
        rotationSpeed: 2 * Math.PI / 16.689,
        rotationTilt: 0.0,
        rotationPhase: 0,
        waveType: 5, noiseScale: 22.0, parent: 'jupiter',
        maxDisplacement: 0.06
    },
    saturn: { 
        id: 'saturn', name: 'Saturn', radius: 0.17, color: [1, 0.9, 0.6], 
        orbitRadius: 95.0, 
        orbitSpeed: 2 * Math.PI / (29.457 * 365.25),
        orbitTilt: 2.49 * DEG, 
        orbitPhase: 320.3 * DEG,
        rotationSpeed: 2 * Math.PI / 0.444,
        rotationTilt: 26.73 * DEG,
        rotationPhase: 0,
        waveType: 4, noiseScale: 5.0, parent: 'sun',
        maxDisplacement: 0.04
    },
    titan: { 
        id: 'titan', name: 'Titan', radius: 0.02, color: [0.8, 0.6, 0.4], 
        orbitRadius: 0.8, 
        orbitSpeed: 2 * Math.PI / 15.945,
        orbitTilt: 0.33 * DEG, 
        orbitPhase: 300 * DEG,
        rotationSpeed: 2 * Math.PI / 15.945,
        rotationTilt: 0.3 * DEG,
        rotationPhase: 0,
        waveType: 1, noiseScale: 16.0, parent: 'saturn',
        maxDisplacement: 0.05
    },
    uranus: { 
        id: 'uranus', name: 'Uranus', radius: 0.07, color: [0.4, 0.8, 0.9], 
        orbitRadius: 191.0, 
        orbitSpeed: 2 * Math.PI / (84.011 * 365.25),
        orbitTilt: 0.77 * DEG, 
        orbitPhase: 44.8 * DEG,
        rotationSpeed: -2 * Math.PI / 0.71833,
        rotationTilt: 97.77 * DEG,
        rotationPhase: 0,
        waveType: 4, noiseScale: 6.0, parent: 'sun',
        maxDisplacement: 0.03
    },
    neptune: { 
        id: 'neptune', name: 'Neptune', radius: 0.07, color: [0.2, 0.4, 1], 
        orbitRadius: 300.0, 
        orbitSpeed: 2 * Math.PI / (164.8 * 365.25),
        orbitTilt: 1.77 * DEG, 
        orbitPhase: 304.3 * DEG,
        rotationSpeed: 2 * Math.PI / 0.6713,
        rotationTilt: 28.32 * DEG,
        rotationPhase: 0,
        waveType: 4, noiseScale: 7.0, parent: 'sun',
        maxDisplacement: 0.04
    },
    pluto: { 
        id: 'pluto', name: 'Pluto', radius: 0.035, color: [0.8, 0.7, 0.6], 
        orbitRadius: 395.0, 
        orbitSpeed: 2 * Math.PI / (248.09 * 365.25),
        orbitTilt: 17.16 * DEG, 
        orbitPhase: 115.0 * DEG,
        rotationSpeed: -2 * Math.PI / 6.387,
        rotationTilt: 122.53 * DEG,
        rotationPhase: 0,
        waveType: 5, noiseScale: 40.0, parent: 'sun',
        maxDisplacement: 0.12
    },
    charon: { 
        id: 'charon', name: 'Charon', radius: 0.018, color: [0.6, 0.6, 0.6], 
        orbitRadius: 0.08, 
        orbitSpeed: 2 * Math.PI / 6.387,
        orbitTilt: 0.0, 
        orbitPhase: 0 * DEG,
        rotationSpeed: 2 * Math.PI / 6.387,
        rotationTilt: 0.0,
        rotationPhase: 0,
        waveType: 5, noiseScale: 45.0, parent: 'pluto',
        maxDisplacement: 0.08
    }
};

export class SolarSystem {
    constructor() {
        this.bodies = new Map();
        this.rootBodies = [];
        this.time = 0;
        this.paused = true;
        this.timeMultiplier = 0;
        
        this.astronomicalReferenceDate = new Date('2024-01-01T00:00:00.000Z');
        this.currentSimulationDate = new Date();

        this.buildHierarchy();
        this.initializePositions();
    }

    buildHierarchy() {
        for (const [id, config] of Object.entries(SOLAR_SYSTEM_CONFIG)) {
            const body = new CelestialBody(config);
            this.bodies.set(id, body);
        }

        for (const [id, config] of Object.entries(SOLAR_SYSTEM_CONFIG)) {
            const body = this.bodies.get(id);

            if (config.parent) {
                const parent = this.bodies.get(config.parent);
                if (parent) {
                    parent.addChild(body);
                }
            } else {
                this.rootBodies.push(body);
            }
        }
    }

    initializePositions() {
        for (const rootBody of this.rootBodies) {
            rootBody.setPositionForDate(this.currentSimulationDate, this.astronomicalReferenceDate);
        }
    }

    setTimeMultiplier(multiplier) {
        this.timeMultiplier = multiplier;
        this.paused = (multiplier === 0);
        for (const rootBody of this.rootBodies) {
            rootBody.setTimeMultiplier(multiplier);
        }
    }

    setSimulationDate(date) {
        this.currentSimulationDate = new Date(date);
        for (const rootBody of this.rootBodies) {
            rootBody.setPositionForDate(this.currentSimulationDate, this.astronomicalReferenceDate);
        }
    }

    resetToCurrentDate() {
        this.currentSimulationDate = new Date();
        for (const rootBody of this.rootBodies) {
            rootBody.setPositionForDate(this.currentSimulationDate, this.astronomicalReferenceDate);
        }
    }

    updateSimulationTime(deltaTimeSeconds) {
        if (!this.paused && this.timeMultiplier > 0) {
            const deltaMilliseconds = deltaTimeSeconds * this.timeMultiplier * 1000;
            this.currentSimulationDate = new Date(this.currentSimulationDate.getTime() + deltaMilliseconds);
        }
    }

    update(deltaTime) {
        if (!this.paused) {
            this.time += deltaTime;
            this.updateSimulationTime(deltaTime);
            
            for (const rootBody of this.rootBodies) {
                rootBody.setPositionForDate(this.currentSimulationDate, this.astronomicalReferenceDate);
            }
        }
        
        const dt = this.paused ? 0 : deltaTime;
        for (const rootBody of this.rootBodies) {
            rootBody.updateAnimation(this.time, dt, this.paused);
        }
    }

    getCurrentSimulationDate() {
        return new Date(this.currentSimulationDate);
    }

    togglePause() {
        this.paused = !this.paused;
    }

    getAllBodies() {
        return Array.from(this.bodies.values());
    }

    getBody(id) {
        return this.bodies.get(id);
    }

    getSunPosition() {
        const sun = this.getBody('sun');
        return sun ? sun.position : [0, 0, 0];
    }
}
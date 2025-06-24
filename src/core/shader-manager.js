// shader-manager.js
export class ShaderManager {
    constructor(gl) {
        this.gl = gl;
        this.customShaders = new Map();
        this.defaultShader = null;
        this.currentProgram = null;
    }

    // Register a custom shader for a specific planet type
    registerCustomShader(planetId, vertexSource, fragmentSource, uniformSetup = null) {
        const gl = this.gl;
        
        try {
            const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
            const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
            const program = this.createProgram(vertexShader, fragmentShader);
            
            // Get all uniform locations
            const uniforms = this.getUniformLocations(program);
            
            const shaderData = {
                program,
                vertexShader,
                fragmentShader,
                uniforms,
                uniformSetup: uniformSetup || this.getDefaultUniformSetup()
            };
            
            this.customShaders.set(planetId, shaderData);
            console.log(`Custom shader registered for ${planetId}`);
            return true;
        } catch (error) {
            console.error(`Failed to register custom shader for ${planetId}:`, error);
            return false;
        }
    }

    // Get shader for a specific planet (custom or default)
    getShaderForPlanet(planetId) {
        if (this.customShaders.has(planetId)) {
            return this.customShaders.get(planetId);
        }
        return this.defaultShader;
    }

    // Set the default shader (existing system)
    setDefaultShader(program, uniforms) {
        this.defaultShader = {
            program,
            uniforms,
            uniformSetup: this.getDefaultUniformSetup()
        };
    }

    // Get uniform locations for a program
    getUniformLocations(program) {
        const gl = this.gl;
        return {
            uModel: gl.getUniformLocation(program, 'uModel'),
            uView: gl.getUniformLocation(program, 'uView'),
            uProj: gl.getUniformLocation(program, 'uProj'),
            uNormalMatrix: gl.getUniformLocation(program, 'uNormalMatrix'),
            uShowLod: gl.getUniformLocation(program, 'uShowLod'),
            uTime: gl.getUniformLocation(program, 'uTime'),
            uPlanetColor: gl.getUniformLocation(program, 'uPlanetColor'),
            uPlanetRadius: gl.getUniformLocation(program, 'uPlanetRadius'),
            uCameraPos: gl.getUniformLocation(program, 'uCameraPos'),
            uHasWaves: gl.getUniformLocation(program, 'uHasWaves'),
            uNoiseScale: gl.getUniformLocation(program, 'uNoiseScale'),
            uNoiseOffset: gl.getUniformLocation(program, 'uNoiseOffset'),
            uSunPosition: gl.getUniformLocation(program, 'uSunPosition'),
            uLodDistances: gl.getUniformLocation(program, 'uLodDistances'),
            uMaxLod: gl.getUniformLocation(program, 'uMaxLod'),
            uLogDepthBufFC: gl.getUniformLocation(program, 'uLogDepthBufFC'),
            // Enhanced custom uniforms
            uIntensity: gl.getUniformLocation(program, 'uIntensity'),
            uFlareScale: gl.getUniformLocation(program, 'uFlareScale'),
            uCoronaIntensity: gl.getUniformLocation(program, 'uCoronaIntensity'),
            uTemperature: gl.getUniformLocation(program, 'uTemperature'),
            uExposure: gl.getUniformLocation(program, 'uExposure'),
            uBubblingIntensity: gl.getUniformLocation(program, 'uBubblingIntensity')
        };
    }

    // Default uniform setup function
    getDefaultUniformSetup() {
        return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
            gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
            gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
            gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
            gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
            gl.uniform1i(uniforms.uShowLod, showLod ? 1 : 0);
            gl.uniform1f(uniforms.uTime, animateWaves ? time : 0);
            gl.uniform3fv(uniforms.uPlanetColor, new Float32Array(body.color));
            gl.uniform1f(uniforms.uPlanetRadius, body.radius);
            gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
            gl.uniform1i(uniforms.uHasWaves, body.waveType || 0);
            gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 10.0);
            gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
            gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
            gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
        };
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compilation error: ${error}`);
        }
        
        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program linking error: ${error}`);
        }
        
        return program;
    }

    cleanup() {
        const gl = this.gl;
        
        // Clean up custom shaders
        for (const [planetId, shaderData] of this.customShaders) {
            gl.deleteProgram(shaderData.program);
            gl.deleteShader(shaderData.vertexShader);
            gl.deleteShader(shaderData.fragmentShader);
        }
        
        this.customShaders.clear();
    }
}
import { mat4Multiply, mat4RotateX, mat4Identity } from './utils.js';
import { ShaderManager } from './shader-manager.js';
import { sunVertexShaderSource, sunFragmentShaderSource, createSunUniformSetup } from './planet_shaders/sun-shaders.js';
import { setupPlanetShaders } from './planet-shaders-setup.js';
import { RingSystem } from './ring-system.js';
import { 
    logDepthVertexShaderSource, 
    logDepthFragmentShaderSource, 
    logDepthLineVertexShaderSource, 
    logDepthLineFragmentShaderSource 
} from './shaders.js';

export class LineRenderer {
    constructor(gl) {
        this.gl = gl;
        this.camera = null; // Add camera reference
        this.setupShaders();
        this.setupBuffers();
        
        // Calculate logarithmic depth constant for 10x scale
        this.logDepthBufFC = 2.0 / (Math.log(20000.0 + 1.0) / Math.LN2);
    }

    // Add method to set camera reference
    setCamera(camera) {
        this.camera = camera;
    }

    setupShaders() {
        const gl = this.gl;
        this.vs = this.createShader(gl.VERTEX_SHADER, logDepthLineVertexShaderSource);
        this.fs = this.createShader(gl.FRAGMENT_SHADER, logDepthLineFragmentShaderSource);
        this.program = this.createProgram(this.vs, this.fs);

        this.uniforms = {
            uModel: gl.getUniformLocation(this.program, 'uModel'),
            uView: gl.getUniformLocation(this.program, 'uView'),
            uProj: gl.getUniformLocation(this.program, 'uProj'),
            uColor: gl.getUniformLocation(this.program, 'uColor'),
            uLogDepthBufFC: gl.getUniformLocation(this.program, 'uLogDepthBufFC')
        };
    }

    setupBuffers() {
        const gl = this.gl;

        this.vao = gl.createVertexArray();
        this.positionBuffer = gl.createBuffer();
        this.alphaBuffer = gl.createBuffer();

        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }
        return program;
    }

    renderAxis(body, viewMatrix, projMatrix) {
        if (!this.camera) {
            console.error('Camera not set on LineRenderer. Call setCamera() first.');
            return;
        }

        const gl = this.gl;
        const vertices = new Float32Array([
            0, -body.radius * 2.5, 0,
            0, body.radius * 2.5, 0
        ]);
        const alphas = new Float32Array([0.8, 0.8]);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, alphas, gl.DYNAMIC_DRAW);

        // CAMERA-CENTERED: Use camera-relative world matrix
        const cameraRelativeBodyPos = this.camera.worldToCameraRelative(body.position);
        const cameraRelativeWorldMatrix = [...body.worldMatrix];
        cameraRelativeWorldMatrix[12] = cameraRelativeBodyPos[0];
        cameraRelativeWorldMatrix[13] = cameraRelativeBodyPos[1];
        cameraRelativeWorldMatrix[14] = cameraRelativeBodyPos[2];

        gl.uniformMatrix4fv(this.uniforms.uModel, false, new Float32Array(cameraRelativeWorldMatrix));
        gl.uniformMatrix4fv(this.uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(this.uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniform1f(this.uniforms.uLogDepthBufFC, this.logDepthBufFC);

        gl.uniform3fv(this.uniforms.uColor, new Float32Array([0.1, 1.0, 0.3]));
        gl.drawArrays(gl.LINES, 0, 2);

        gl.bindVertexArray(null);
    }

    renderOrbit(body, viewMatrix, projMatrix, currentTime) {
        if (!this.camera) {
            console.error('Camera not set on LineRenderer. Call setCamera() first.');
            return;
        }

        if (!body.parent || body.orbitRadius === 0) return;

        const gl = this.gl;
        const baseSegments = 128;
        const maxSegments = 1024;
        const segmentMultiplier = Math.max(1, Math.min(8, body.orbitRadius / 5));
        const segments = Math.min(maxSegments, Math.floor(baseSegments * segmentMultiplier));

        const vertices = [];
        const alphas = [];

        const currentAngle = ((body.orbitAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const currentPosition = currentAngle / (Math.PI * 2);

        const trailLength = 0.3;
        const baseAlpha = 0.1;
        const maxAlpha = 0.9;

        for (let i = 0; i <= segments; i++) {
            let segmentFrac = i / segments;
            let orbitFrac = (currentPosition - segmentFrac + 1.0) % 1.0;
            let angle = -orbitFrac * Math.PI * 2;
            let x = Math.cos(angle) * body.orbitRadius;
            let z = Math.sin(angle) * body.orbitRadius;
            vertices.push(x, 0, z);

            let distance = segmentFrac;
            let alpha = baseAlpha;
            if (distance <= trailLength) {
                let trailFactor = 1.0 - (distance / trailLength);
                let sharpFalloff = trailFactor * trailFactor * trailFactor;
                alpha = baseAlpha + (maxAlpha - baseAlpha) * sharpFalloff;
            }
            alphas.push(alpha);
        }

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alphas), gl.DYNAMIC_DRAW);

        // CAMERA-CENTERED: Create camera-relative orbit matrix
        const parentMatrix = body.parent ? body.parent.orbitMatrix : mat4Identity();
        const orbitTiltMat = body.orbitTilt !== 0 ? mat4RotateX(body.orbitTilt) : mat4Identity();
        let orbitMatrix = mat4Multiply(orbitTiltMat, parentMatrix);
        
        // Convert to camera-relative coordinates
        const orbitWorldPos = [orbitMatrix[12], orbitMatrix[13], orbitMatrix[14]];
        const cameraRelativeOrbitPos = this.camera.worldToCameraRelative(orbitWorldPos);
        orbitMatrix[12] = cameraRelativeOrbitPos[0];
        orbitMatrix[13] = cameraRelativeOrbitPos[1];
        orbitMatrix[14] = cameraRelativeOrbitPos[2];

        gl.uniformMatrix4fv(this.uniforms.uModel, false, new Float32Array(orbitMatrix));
        gl.uniformMatrix4fv(this.uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(this.uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniform1f(this.uniforms.uLogDepthBufFC, this.logDepthBufFC);

        gl.uniform3fv(this.uniforms.uColor, new Float32Array([0, 0.8, 0.8]));

        gl.drawArrays(gl.LINE_STRIP, 0, vertices.length / 3);

        gl.bindVertexArray(null);
    }
}

// Enhanced patch culling utilities
class PatchCuller {
    constructor() {
        this.frustumPlanes = new Array(6);
        for (let i = 0; i < 6; i++) {
            this.frustumPlanes[i] = [0, 0, 0, 0];
        }
    }

    extractFrustumPlanes(viewProjMatrix) {
        const m = viewProjMatrix;
        
        // Left plane
        this.frustumPlanes[0][0] = m[3] + m[0];
        this.frustumPlanes[0][1] = m[7] + m[4];
        this.frustumPlanes[0][2] = m[11] + m[8];
        this.frustumPlanes[0][3] = m[15] + m[12];
        
        // Right plane
        this.frustumPlanes[1][0] = m[3] - m[0];
        this.frustumPlanes[1][1] = m[7] - m[4];
        this.frustumPlanes[1][2] = m[11] - m[8];
        this.frustumPlanes[1][3] = m[15] - m[12];
        
        // Bottom plane
        this.frustumPlanes[2][0] = m[3] + m[1];
        this.frustumPlanes[2][1] = m[7] + m[5];
        this.frustumPlanes[2][2] = m[11] + m[9];
        this.frustumPlanes[2][3] = m[15] + m[13];
        
        // Top plane
        this.frustumPlanes[3][0] = m[3] - m[1];
        this.frustumPlanes[3][1] = m[7] - m[5];
        this.frustumPlanes[3][2] = m[11] - m[9];
        this.frustumPlanes[3][3] = m[15] - m[13];
        
        // Near plane
        this.frustumPlanes[4][0] = m[3] + m[2];
        this.frustumPlanes[4][1] = m[7] + m[6];
        this.frustumPlanes[4][2] = m[11] + m[10];
        this.frustumPlanes[4][3] = m[15] + m[14];
        
        // Far plane
        this.frustumPlanes[5][0] = m[3] - m[2];
        this.frustumPlanes[5][1] = m[7] - m[6];
        this.frustumPlanes[5][2] = m[11] - m[10];
        this.frustumPlanes[5][3] = m[15] - m[14];
        
        // Normalize planes
        for (let i = 0; i < 6; i++) {
            const length = Math.sqrt(
                this.frustumPlanes[i][0] * this.frustumPlanes[i][0] +
                this.frustumPlanes[i][1] * this.frustumPlanes[i][1] +
                this.frustumPlanes[i][2] * this.frustumPlanes[i][2]
            );
            if (length > 0) {
                this.frustumPlanes[i][0] /= length;
                this.frustumPlanes[i][1] /= length;
                this.frustumPlanes[i][2] /= length;
                this.frustumPlanes[i][3] /= length;
            }
        }
    }

    isPatchInFrustum(patchCenter, patchRadius, body, cameraPos, patchLOD = 0) {
        const worldCenter = this.transformPoint(body.worldMatrix, [
            patchCenter[0] * body.radius,
            patchCenter[1] * body.radius,
            patchCenter[2] * body.radius
        ]);

        const distanceToCamera = Math.hypot(
            worldCenter[0] - cameraPos[0],
            worldCenter[1] - cameraPos[1],
            worldCenter[2] - cameraPos[2]
        );

        let radiusMultiplier = 2.0;
        
        if (distanceToCamera < body.radius * 3) {
            radiusMultiplier = 4.0;
        } else if (distanceToCamera < body.radius * 10) {
            radiusMultiplier = 3.0;
        }

        if (patchLOD >= 6) {
            radiusMultiplier *= 1.5;
        } else if (patchLOD >= 4) {
            radiusMultiplier *= 1.2;
        }

        const maxDisplacement = body.maxDisplacement || 0.08; // fallback for Earth
        const worldRadius = patchRadius * body.radius * radiusMultiplier + maxDisplacement * body.radius;

        for (let i = 0; i < 6; i++) {
            const plane = this.frustumPlanes[i];
            const distance = plane[0] * worldCenter[0] + plane[1] * worldCenter[1] + plane[2] * worldCenter[2] + plane[3];
            
            let threshold = worldRadius * 1.5;
            
            if (i === 4) {
                if (distanceToCamera < body.radius * 2 && patchLOD >= 5) {
                    threshold = worldRadius * 8.0;
                } else if (distanceToCamera < body.radius * 5) {
                    threshold = worldRadius * 5.0;
                } else {
                    threshold = worldRadius * 3.0;
                }
            } else if (i >= 0 && i <= 3) {
                if (distanceToCamera < body.radius * 2 && patchLOD >= 5) {
                    threshold = worldRadius * 3.0;
                } else if (distanceToCamera < body.radius * 5) {
                    threshold = worldRadius * 2.5;
                } else {
                    threshold = worldRadius * 2.0;
                }
            }
            
            if (distance < -threshold) {
                return false;
            }
        }
        return true;
    }

    isPatchBackfacing(patchCenter, cameraPos, body, bias = -0.3) {
        const worldCenter = this.transformPoint(body.worldMatrix, [
            patchCenter[0] * body.radius,
            patchCenter[1] * body.radius,
            patchCenter[2] * body.radius
        ]);

        const planetCenter = [body.worldMatrix[12], body.worldMatrix[13], body.worldMatrix[14]];
        
        let noiseReduction = 0.05;
        if (body.waveType === 1) {
            noiseReduction = 0.08;
        } else if (body.waveType === 2) {
            noiseReduction = 0.15;
        } else if (body.waveType === 3) {
            noiseReduction = 0.06;
        } else if (body.waveType === 4) {
            noiseReduction = 0.04;
        }
        
        const effectiveRadius = body.radius * (1.0 - noiseReduction);
        
        const cameraToPlanet = [
            planetCenter[0] - cameraPos[0],
            planetCenter[1] - cameraPos[1],
            planetCenter[2] - cameraPos[2]
        ];
        const distanceToPlanet = Math.sqrt(
            cameraToPlanet[0] * cameraToPlanet[0] + 
            cameraToPlanet[1] * cameraToPlanet[1] + 
            cameraToPlanet[2] * cameraToPlanet[2]
        );
        
        if (distanceToPlanet <= effectiveRadius * 1.1) {
            return false;
        }
        
        const cameraToPlanetNorm = [
            cameraToPlanet[0] / distanceToPlanet,
            cameraToPlanet[1] / distanceToPlanet,
            cameraToPlanet[2] / distanceToPlanet
        ];
        
        const sinTangentAngle = effectiveRadius / distanceToPlanet;
        const cosTangentAngle = Math.sqrt(1.0 - sinTangentAngle * sinTangentAngle);
        
        const cameraToPatch = [
            worldCenter[0] - cameraPos[0],
            worldCenter[1] - cameraPos[1],
            worldCenter[2] - cameraPos[2]
        ];
        const distanceToPatch = Math.sqrt(
            cameraToPatch[0] * cameraToPatch[0] + 
            cameraToPatch[1] * cameraToPatch[1] + 
            cameraToPatch[2] * cameraToPatch[2]
        );
        
        if (distanceToPatch < 0.001) return false;
        
        const cameraToPatchNorm = [
            cameraToPatch[0] / distanceToPatch,
            cameraToPatch[1] / distanceToPatch,
            cameraToPatch[2] / distanceToPatch
        ];
        
        const dotProduct = 
            cameraToPlanetNorm[0] * cameraToPatchNorm[0] + 
            cameraToPlanetNorm[1] * cameraToPatchNorm[1] + 
            cameraToPlanetNorm[2] * cameraToPatchNorm[2];
        
        if (dotProduct < cosTangentAngle) {
            return false;
        }
        
        const tangentDistance = distanceToPlanet * cosTangentAngle;
        const tangentPoint = [
            cameraPos[0] + cameraToPlanetNorm[0] * tangentDistance,
            cameraPos[1] + cameraToPlanetNorm[1] * tangentDistance,
            cameraPos[2] + cameraToPlanetNorm[2] * tangentDistance
        ];
        
        const tangentPlaneNormal = [
            -cameraToPlanetNorm[0],
            -cameraToPlanetNorm[1],
            -cameraToPlanetNorm[2]
        ];
        
        const patchToTangentPoint = [
            worldCenter[0] - tangentPoint[0],
            worldCenter[1] - tangentPoint[1],
            worldCenter[2] - tangentPoint[2]
        ];
        
        const distanceToTangentPlane = 
            patchToTangentPoint[0] * tangentPlaneNormal[0] + 
            patchToTangentPoint[1] * tangentPlaneNormal[1] + 
            patchToTangentPoint[2] * tangentPlaneNormal[2];
        
        let adaptiveBias = bias;
        
        if (distanceToPatch < body.radius * 2.0) {
            adaptiveBias *= 0.5;
        }
        
        return distanceToTangentPlane < adaptiveBias * body.radius;
    }

    transformPoint(matrix, point) {
        const x = point[0], y = point[1], z = point[2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        return [
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
        ];
    }
}

// Screen-space LOD system classes
class ScreenSpaceLOD {
    static calculateLODDistances(body, viewMatrix, projMatrix, canvasWidth, canvasHeight, targetPixelSizes = [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
        const distances = [];
        
        const fovY = Math.PI / 3;
        const halfHeight = canvasHeight * 0.5;
        
        for (let i = 0; i < targetPixelSizes.length; i++) {
            const targetPixelSize = targetPixelSizes[i];
            const patchWorldSize = body.radius / Math.pow(2, i);
            const focalLength = halfHeight / Math.tan(fovY * 0.5);
            const distance = (patchWorldSize * focalLength) / targetPixelSize;
            distances.push(distance * body.lodMultiplier);
        }
        
        return distances;
    }
    
    static getScreenSpaceSize(worldPos, worldSize, viewMatrix, projMatrix, canvasWidth, canvasHeight) {
        const viewPos = this.transformPoint(viewMatrix, worldPos);
        const clipPos = this.transformPoint(projMatrix, viewPos);
        
        if (clipPos[2] <= 0) return 0;
        
        const fovY = Math.PI / 3;
        const distance = -viewPos[2];
        const halfHeight = canvasHeight * 0.5;
        const focalLength = halfHeight / Math.tan(fovY * 0.5);
        
        return (worldSize * focalLength) / distance;
    }
    
    static transformPoint(matrix, point) {
        const x = point[0], y = point[1], z = point[2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        return [
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
        ];
    }
}

// SMART FIX: Planet rotation state tracker
class PlanetRotationTracker {
    constructor() {
        this.planetStates = new Map();
    }
    
    // Enhanced rotation detection that considers camera distance and LOD level
    hasRotatedSignificantly(bodyId, worldMatrix, cameraPos, body, maxLod, threshold = 0.02) {
        const lastState = this.planetStates.get(bodyId);
        
        if (!lastState) {
            // First time seeing this planet, store its state
            this.planetStates.set(bodyId, {
                matrix: [...worldMatrix],
                timestamp: performance.now()
            });
            return false;
        }
        
        // Calculate distance from camera to planet surface
        const planetCenter = [worldMatrix[12], worldMatrix[13], worldMatrix[14]];
        const distanceToCenter = Math.hypot(
            cameraPos[0] - planetCenter[0],
            cameraPos[1] - planetCenter[1],
            cameraPos[2] - planetCenter[2]
        );
        const distanceToSurface = Math.max(0.1, distanceToCenter - body.radius);
        
        // SMART FIX: Adaptive threshold based on distance and LOD
        let adaptiveThreshold = threshold;
        
        // More aggressive for close distances
        const closenessFactor = Math.max(0.1, Math.min(1.0, distanceToSurface / (body.radius * 3)));
        adaptiveThreshold *= closenessFactor;
        
        // More aggressive for high LOD levels (more detailed geometry)
        const lodFactor = Math.max(0.3, Math.min(1.0, (12 - maxLod) / 8));
        adaptiveThreshold *= lodFactor;
        
        // Extra aggressive when very close to surface
        if (distanceToSurface < body.radius * 0.5) {
            adaptiveThreshold *= 0.2; // 5x more sensitive when very close
        } else if (distanceToSurface < body.radius * 1.5) {
            adaptiveThreshold *= 0.5; // 2x more sensitive when close
        }
        
        // Compare rotation components of the matrix
        // Focus on the rotation part (upper 3x3) of the 4x4 matrix
        let maxDiff = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const index = i * 4 + j;
                const diff = Math.abs(lastState.matrix[index] - worldMatrix[index]);
                maxDiff = Math.max(maxDiff, diff);
            }
        }
        
        if (maxDiff > adaptiveThreshold) {
            // Planet has rotated significantly, update stored state
            this.planetStates.set(bodyId, {
                matrix: [...worldMatrix],
                timestamp: performance.now()
            });
            return true;
        }
        
        return false;
    }
    
    // Force update a planet's state (useful when cache is manually invalidated)
    updatePlanetState(bodyId, worldMatrix) {
        this.planetStates.set(bodyId, {
            matrix: [...worldMatrix],
            timestamp: performance.now()
        });
    }
    
    // Get debug info about current thresholds
    getDebugInfo(bodyId, worldMatrix, cameraPos, body, maxLod, baseThreshold = 0.02) {
        const planetCenter = [worldMatrix[12], worldMatrix[13], worldMatrix[14]];
        const distanceToCenter = Math.hypot(
            cameraPos[0] - planetCenter[0],
            cameraPos[1] - planetCenter[1],
            cameraPos[2] - planetCenter[2]
        );
        const distanceToSurface = Math.max(0.1, distanceToCenter - body.radius);
        
        const closenessFactor = Math.max(0.1, Math.min(1.0, distanceToSurface / (body.radius * 3)));
        const lodFactor = Math.max(0.3, Math.min(1.0, (12 - maxLod) / 8));
        
        let adaptiveThreshold = baseThreshold * closenessFactor * lodFactor;
        
        if (distanceToSurface < body.radius * 0.5) {
            adaptiveThreshold *= 0.2;
        } else if (distanceToSurface < body.radius * 1.5) {
            adaptiveThreshold *= 0.5;
        }
        
        return {
            distanceToSurface,
            closenessFactor,
            lodFactor,
            adaptiveThreshold,
            baseThreshold
        };
    }
}

// Geometry cache entry with improved validation
class GeometryCacheEntry {
    constructor(geometry, cameraPos, cameraForward, lodDistances, maxLod) {
        this.geometry = geometry;
        this.cameraPos = [...cameraPos];
        this.cameraForward = [...cameraForward];
        this.lodDistances = [...lodDistances];
        this.maxLod = maxLod;
        this.timestamp = performance.now();
        this.hitCount = 0;
    }
    
    isValid(cameraPos, cameraForward, lodDistances, maxLod, posThreshold = 0.1, rotThreshold = 0.05) {
        // Check if camera moved significantly
        const cameraDist = Math.hypot(
            this.cameraPos[0] - cameraPos[0],
            this.cameraPos[1] - cameraPos[1],
            this.cameraPos[2] - cameraPos[2]
        );
        
        // More sensitive to movement - especially important for backwards movement
        if (cameraDist > posThreshold * 0.5) return false; // Reduced threshold
        
        // Check if camera rotation changed significantly
        const forwardDot = this.cameraForward[0] * cameraForward[0] + 
                          this.cameraForward[1] * cameraForward[1] + 
                          this.cameraForward[2] * cameraForward[2];
        
        if (forwardDot < (1.0 - rotThreshold * 0.5)) return false; // More sensitive to rotation
        
        if (this.maxLod !== maxLod) return false;
        
        // Check if LOD distances changed significantly
        for (let i = 0; i < Math.min(this.lodDistances.length, lodDistances.length); i++) {
            const distRatio = Math.abs(this.lodDistances[i] - lodDistances[i]) / this.lodDistances[i];
            if (distRatio > 0.03) return false; // More sensitive to LOD changes
        }
        
        return true;
    }
    
    touch() {
        this.hitCount++;
        this.timestamp = performance.now();
    }
}

class Patch {
    constructor(a, b, c, l = 0) {
        this.v = [a, b, c];
        this.l = l;
        this.ch = null;
        this.c = this.nrm([(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3]);
        this._centerDistanceCache = null;
        this._lastCameraPos = null;
        
        // Calculate patch bounding radius for culling - be more generous
        this.boundingRadius = Math.max(
            Math.hypot(a[0] - this.c[0], a[1] - this.c[1], a[2] - this.c[2]),
            Math.hypot(b[0] - this.c[0], b[1] - this.c[1], b[2] - this.c[2]),
            Math.hypot(c[0] - this.c[0], c[1] - this.c[1], c[2] - this.c[2])
        ) * 1.5; // Increased multiplier for safety margin
    }
    
    nrm(v) { 
        let l = Math.hypot(...v); 
        return l ? v.map(x=>x/l) : [0,0,1]; 
    }
    
    sub(a,b) { 
        return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; 
    }
    
    distanceToCamera(cameraPos, body, viewMatrix, projMatrix, canvasWidth, canvasHeight) {
        const worldPatchCenter = [
            this.c[0] * body.radius,
            this.c[1] * body.radius,
            this.c[2] * body.radius
        ];
        
        const transformedCenter = this.transformPoint(body.worldMatrix, worldPatchCenter);
        
        return Math.hypot(
            transformedCenter[0] - cameraPos[0],
            transformedCenter[1] - cameraPos[1],
            transformedCenter[2] - cameraPos[2]
        );
    }
    
    transformPoint(matrix, point) {
        const x = point[0], y = point[1], z = point[2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        return [
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
        ];
    }
    
    split() {
        if(this.ch) return;
        const [a,b,c] = this.v;
        const ab = this.nrm([(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2]);
        const bc = this.nrm([(b[0]+c[0])/2, (b[1]+c[1])/2, (b[2]+c[2])/2]);
        const ca = this.nrm([(c[0]+a[0])/2, (c[1]+a[1])/2, (c[2]+a[2])/2]);
        this.ch = [
            new Patch(a, ab, ca, this.l+1),
            new Patch(ab, b, bc, this.l+1),
            new Patch(ca, bc, c, this.l+1),
            new Patch(ab, bc, ca, this.l+1)
        ];
    }
    
    leaves(cameraPos, body, viewMatrix, projMatrix, canvasWidth, canvasHeight, lodDistances, maxLod, patchCuller, viewProjMatrix, cullStats) {
        // Only perform culling for patches at LOD 3 and above to avoid overhead on small patches
        if (this.l >= 3) {
            // Frustum culling - now pass camera position for distance-based adjustments
            if (!patchCuller.isPatchInFrustum(this.c, this.boundingRadius, body, cameraPos)) {
                cullStats.frustumCulled++;
                return [];
            }
            
            // Backface culling - keep it enabled but make it more conservative for close patches
            if (this.l >= 4) {
                const worldCenter = this.transformPoint(body.worldMatrix, [
                    this.c[0] * body.radius,
                    this.c[1] * body.radius,
                    this.c[2] * body.radius
                ]);
                const distanceToCamera = Math.hypot(
                    worldCenter[0] - cameraPos[0],
                    worldCenter[1] - cameraPos[1],
                    worldCenter[2] - cameraPos[2]
                );
                
                // Use more conservative backface culling when close
                let isBackfacing = false;
                if (distanceToCamera < body.radius * 3) {
                    // Very conservative for close patches - only cull if really facing away
                    isBackfacing = patchCuller.isPatchBackfacing(this.c, cameraPos, body, -0.5); // Much more conservative bias
                } else if (distanceToCamera < body.radius * 10) {
                    // Moderately conservative for medium distance
                    isBackfacing = patchCuller.isPatchBackfacing(this.c, cameraPos, body, -0.4);
                } else {
                    // Normal backface culling for distant patches
                    isBackfacing = patchCuller.isPatchBackfacing(this.c, cameraPos, body, -0.3);
                }
                
                if (isBackfacing) {
                    cullStats.backfaceCulled++;
                    return [];
                }
            }
        }
        
        if(this.l < maxLod && this.l < lodDistances.length) {
            const distanceToCamera = this.distanceToCamera(cameraPos, body, viewMatrix, projMatrix, canvasWidth, canvasHeight);
            
            if(distanceToCamera < lodDistances[this.l]) {
                this.split();
                return this.ch.flatMap(p => p.leaves(cameraPos, body, viewMatrix, projMatrix, canvasWidth, canvasHeight, lodDistances, maxLod, patchCuller, viewProjMatrix, cullStats));
            }
        }
        return [this];
    }
    
    clearCache() {
        this._centerDistanceCache = null;
        this._lastCameraPos = null;
        if(this.ch) {
            this.ch.forEach(child => child.clearCache());
        }
    }
}

export class ScreenSpaceGPULODRenderer {
    constructor(gl) {
        this.gl = gl;
        if (!this.gl) {
            alert('WebGL2 not supported');
            return;
        }
        
        // Store camera reference
        this.camera = null;
        
        // Initialize ring system
        this.ringSystem = new RingSystem(gl);
        
        this.near = 0.0001;
        this.far = 10000.0;
        this.logDepthBufFC = 2.0 / (Math.log(this.far + 1.0) / Math.LN2);
        
        this.shaderManager = new ShaderManager(gl);
        
        this.setupShaders();
        this.setupCustomShaders();
        this.setupBuffers();
        this.stats = { patches: 0, drawCalls: 0, vertices: 0, totalPatches: 0 };

        this.ringSystem = new RingSystem(gl);
        
        this.geometryCache = new Map();
        this.frameCount = 0;
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            totalEntries: 0
        };
        
        this.planetRotationTracker = new PlanetRotationTracker();
        
        this.patchCuller = new PatchCuller();
        this.cullStats = {
            frustumCulled: 0,
            backfaceCulled: 0,
            totalPatches: 0
        };
        
        this.maxCacheEntries = 30;
        this.cacheThreshold = 0.1;
        this.rotationThreshold = 0.1;
        this.maxCacheAge = 2000;
        
        this.icoData = this.icosahedron();
        this.rootPatches = null;
        
        this.targetPixelSizes = [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25];
        this.currentTargetIndex = 6;
    }

    // Add method to set camera reference
    setCamera(camera) {
        this.camera = camera;
        this.ringSystem.setCamera(camera);
        // Sync logarithmic depth constant
        this.ringSystem.setLogDepthBufFC(this.logDepthBufFC);
    }

    setupCustomShaders() {
        // Existing sun shader setup
        this.shaderManager.registerCustomShader(
            'sun',
            sunVertexShaderSource,
            sunFragmentShaderSource,
            createSunUniformSetup()
        );
        
        // NEW: Setup planet shaders
        setupPlanetShaders(this.shaderManager);
        
        console.log('All custom shaders registered successfully');
    }
    
    setupShaders() {
        const gl = this.gl;
        this.mainVS = this.createShader(gl.VERTEX_SHADER, logDepthVertexShaderSource);
        this.mainFS = this.createShader(gl.FRAGMENT_SHADER, logDepthFragmentShaderSource);
        this.mainProgram = this.createProgram(this.mainVS, this.mainFS);
        
        this.mainUniforms = {
            uModel: gl.getUniformLocation(this.mainProgram, 'uModel'),
            uView: gl.getUniformLocation(this.mainProgram, 'uView'),
            uProj: gl.getUniformLocation(this.mainProgram, 'uProj'),
            uNormalMatrix: gl.getUniformLocation(this.mainProgram, 'uNormalMatrix'),
            uShowLod: gl.getUniformLocation(this.mainProgram, 'uShowLod'),
            uTime: gl.getUniformLocation(this.mainProgram, 'uTime'),
            uPlanetColor: gl.getUniformLocation(this.mainProgram, 'uPlanetColor'),
            uPlanetRadius: gl.getUniformLocation(this.mainProgram, 'uPlanetRadius'),
            uCameraPos: gl.getUniformLocation(this.mainProgram, 'uCameraPos'),
            uHasWaves: gl.getUniformLocation(this.mainProgram, 'uHasWaves'),
            uNoiseScale: gl.getUniformLocation(this.mainProgram, 'uNoiseScale'),
            uNoiseOffset: gl.getUniformLocation(this.mainProgram, 'uNoiseOffset'),
            uSunPosition: gl.getUniformLocation(this.mainProgram, 'uSunPosition'),
            uLodDistances: gl.getUniformLocation(this.mainProgram, 'uLodDistances'),
            uMaxLod: gl.getUniformLocation(this.mainProgram, 'uMaxLod'),
            uLogDepthBufFC: gl.getUniformLocation(this.mainProgram, 'uLogDepthBufFC')
        };
        
        this.shaderManager.setDefaultShader(this.mainProgram, this.mainUniforms);
    }
    
    setupBuffers() {
        const gl = this.gl;
        
        const maxVertices = 2000000;
        const maxIndices = 6000000;
        
        this.buffers = {
            position: gl.createBuffer(),
            morphable: gl.createBuffer(),
            lod: gl.createBuffer(),
            morphFactor: gl.createBuffer(),
            edge0: gl.createBuffer(),
            edge1: gl.createBuffer(),
            indices: gl.createBuffer()
        };
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 3 * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphable);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lod);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphFactor);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge0);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 3 * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge1);
        gl.bufferData(gl.ARRAY_BUFFER, maxVertices * 3 * 4, gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxIndices * 4, gl.DYNAMIC_DRAW);
        
        this.mainVAO = gl.createVertexArray();
        gl.bindVertexArray(this.mainVAO);
        this.setupMainVAO();
        gl.bindVertexArray(null);
    }
    
    setupMainVAO() {
        const gl = this.gl;
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphable);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lod);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphFactor);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge0);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge1);
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
    }
    
    // Generate cache key for geometry caching - now includes camera direction
    generateCacheKey(bodyId, cameraPos, cameraForward, maxLod, targetIndex) {
        // Much finer quantization to be more sensitive to movement
        const quantize = (val, step) => Math.round(val / step) * step;
        const posStep = this.cacheThreshold * 0.5; // Even finer position steps
        const rotStep = this.rotationThreshold * 0.5; // Even finer rotation steps
        
        const qPos = [
            quantize(cameraPos[0], posStep),
            quantize(cameraPos[1], posStep),
            quantize(cameraPos[2], posStep)
        ];
        
        const qForward = [
            quantize(cameraForward[0], rotStep),
            quantize(cameraForward[1], rotStep),
            quantize(cameraForward[2], rotStep)
        ];
        
        return `${bodyId}_${qPos.join(',')}_${qForward.join(',')}_${maxLod}_${targetIndex}`;
    }
    
    // Clean up old cache entries
    cleanupCache() {
        const now = performance.now();
        const entriesToRemove = [];
        
        for (const [key, entry] of this.geometryCache) {
            if (now - entry.timestamp > this.maxCacheAge || 
                this.geometryCache.size > this.maxCacheEntries) {
                entriesToRemove.push(key);
            }
        }
        
        // Remove least recently used entries if over limit
        if (this.geometryCache.size > this.maxCacheEntries) {
            const sortedEntries = Array.from(this.geometryCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const removeCount = this.geometryCache.size - this.maxCacheEntries + 5;
            for (let i = 0; i < removeCount && i < sortedEntries.length; i++) {
                entriesToRemove.push(sortedEntries[i][0]);
            }
        }
        
        for (const key of entriesToRemove) {
            this.geometryCache.delete(key);
            this.cacheStats.evictions++;
        }
    }
    
    icosahedron() {
        const t = (1 + Math.sqrt(5)) / 2;
        let verts = [
            [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
            [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
            [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1]
        ].map(v => {
            const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
            return [v[0]/len, v[1]/len, v[2]/len];
        });
        
        let faces = [
            [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
            [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
            [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
            [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
        ];
        
        return {verts, faces};
    }
    
    nrm(v) { 
        let l = Math.hypot(...v); 
        return l ? v.map(x=>x/l) : [0,0,1]; 
    }
    
    sub(a,b) { 
        return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; 
    }
    
    buildPatches(cameraPos, cameraForward, body, viewMatrix, projMatrix, canvasWidth, canvasHeight, maxLod = 12, viewProjMatrix, cameraRelativeWorldMatrix = null) {
        if(!this.rootPatches) {
            this.rootPatches = this.icoData.faces.map(f => {
                const v = this.icoData.verts; 
                return new Patch(v[f[0]], v[f[1]], v[f[2]]);
            });
        }
        
        const lodDistances = ScreenSpaceLOD.calculateLODDistances(
            body, viewMatrix, projMatrix, canvasWidth, canvasHeight, 
            [this.targetPixelSizes[this.currentTargetIndex]]
        );
        
        const fullLodDistances = [];
        for (let i = 0; i < 12; i++) {
            const pixelSize = this.targetPixelSizes[this.currentTargetIndex] * Math.pow(2, i);
            const patchWorldSize = body.radius / Math.pow(2, i);
            const fovY = Math.PI / 3;
            const halfHeight = canvasHeight * 0.5;
            const focalLength = halfHeight / Math.tan(fovY * 0.5);
            const distance = (patchWorldSize * focalLength) / pixelSize;
            fullLodDistances.push(distance * body.lodMultiplier);
        }
        
        // Setup patch culler with camera-relative coordinates
        this.patchCuller.extractFrustumPlanes(viewProjMatrix);
        
        // Reset culling stats
        this.cullStats.frustumCulled = 0;
        this.cullStats.backfaceCulled = 0;
        this.cullStats.totalPatches = 0;
        
        let leaves = [];
        for(const r of this.rootPatches) {
            // CAMERA-CENTERED: Use camera-relative world matrix if provided
            const worldMatrix = cameraRelativeWorldMatrix || body.worldMatrix;
            const bodyWithCameraRelativeMatrix = { ...body, worldMatrix };
            leaves.push(...r.leaves(cameraPos, bodyWithCameraRelativeMatrix, viewMatrix, projMatrix, canvasWidth, canvasHeight, fullLodDistances, maxLod, this.patchCuller, viewProjMatrix, this.cullStats));
        }
        
        this.cullStats.totalPatches = leaves.length + this.cullStats.frustumCulled + this.cullStats.backfaceCulled;
        
        return leaves;
    }
    
    generateGeometry(patches, cameraPos, body, viewMatrix, projMatrix, canvasWidth, canvasHeight, cameraRelativeWorldMatrix = null) {
        const maxVertices = patches.length * 6;
        const V = new Float32Array(maxVertices * 3);
        const M = new Float32Array(maxVertices);
        const L = new Float32Array(maxVertices);
        const MF = new Float32Array(maxVertices);
        const E0 = new Float32Array(maxVertices * 3);
        const E1 = new Float32Array(maxVertices * 3);
        const I = new Uint32Array(patches.length * 12);
        
        let vIdx = 0, iIdx = 0, vertexOffset = 0;
        
        const fullLodDistances = [];
        for (let i = 0; i < 12; i++) {
            const pixelSize = this.targetPixelSizes[this.currentTargetIndex] * Math.pow(2, i);
            const patchWorldSize = body.radius / Math.pow(2, i);
            const fovY = Math.PI / 3;
            const halfHeight = canvasHeight * 0.5;
            const focalLength = halfHeight / Math.tan(fovY * 0.5);
            const distance = (patchWorldSize * focalLength) / pixelSize;
            fullLodDistances.push(distance * body.lodMultiplier);
        }
        
        // CAMERA-CENTERED: Use camera-relative world matrix if provided
        const worldMatrix = cameraRelativeWorldMatrix || body.worldMatrix;
        
        for(let patchIdx = 0; patchIdx < patches.length; patchIdx++) {
            const p = patches[patchIdx];
            const [A, B, C] = p.v;
            
            const AB = this.nrm([(A[0]+B[0])/2, (A[1]+B[1])/2, (A[2]+B[2])/2]);
            const BC = this.nrm([(B[0]+C[0])/2, (B[1]+C[1])/2, (B[2]+C[2])/2]);
            const CA = this.nrm([(C[0]+A[0])/2, (C[1]+A[1])/2, (C[2]+A[2])/2]);
            
            const vertices = [A, B, C, AB, BC, CA];
            const morphable = [0, 0, 0, 1, 1, 1];
            const lod = p.l;
            
            let morphFactors = [0, 0, 0];
            
            if(lod > 0 && lod < fullLodDistances.length) {
                const hi = fullLodDistances[lod - 1];
                const lo = fullLodDistances[lod];
                
                for(let i = 0; i < 3; i++) {
                    const edgeVertices = [[A, B], [B, C], [C, A]];
                    const [v0, v1] = edgeVertices[i];
                    
                    const worldV0 = this.transformPoint(worldMatrix, [v0[0] * body.radius, v0[1] * body.radius, v0[2] * body.radius]);
                    const worldV1 = this.transformPoint(worldMatrix, [v1[0] * body.radius, v1[1] * body.radius, v1[2] * body.radius]);
                    
                    const d0 = Math.hypot(...this.sub(worldV0, cameraPos));
                    const d1 = Math.hypot(...this.sub(worldV1, cameraPos));
                    const dEdge = (d0 + d1) / 2;
                    
                    let mf = Math.max(0, Math.min(1, (dEdge - lo) / (hi - lo)));
                    mf = mf * mf * (3.0 - 2.0 * mf);
                    morphFactors.push(mf);
                }
            } else {
                morphFactors.push(0, 0, 0);
            }
            
            for(let i = 0; i < vertices.length; i++) {
                const baseIdx = vIdx * 3;
                V[baseIdx] = vertices[i][0];
                V[baseIdx + 1] = vertices[i][1];
                V[baseIdx + 2] = vertices[i][2];
                
                M[vIdx] = morphable[i];
                L[vIdx] = lod;
                MF[vIdx] = morphFactors[i];
                
                if(morphable[i]) {
                    if(i === 3) {
                        E0[baseIdx] = A[0]; E0[baseIdx+1] = A[1]; E0[baseIdx+2] = A[2];
                        E1[baseIdx] = B[0]; E1[baseIdx+1] = B[1]; E1[baseIdx+2] = B[2];
                    } else if(i === 4) {
                        E0[baseIdx] = B[0]; E0[baseIdx+1] = B[1]; E0[baseIdx+2] = B[2];
                        E1[baseIdx] = C[0]; E1[baseIdx+1] = C[1]; E1[baseIdx+2] = C[2];
                    } else if(i === 5) {
                        E0[baseIdx] = C[0]; E0[baseIdx+1] = C[1]; E0[baseIdx+2] = C[2];
                        E1[baseIdx] = A[0]; E1[baseIdx+1] = A[1]; E1[baseIdx+2] = A[2];
                    }
                } else {
                    E0[baseIdx] = vertices[i][0]; E0[baseIdx+1] = vertices[i][1]; E0[baseIdx+2] = vertices[i][2];
                    E1[baseIdx] = vertices[i][0]; E1[baseIdx+1] = vertices[i][1]; E1[baseIdx+2] = vertices[i][2];
                }
                vIdx++;
            }
            
            const patchIndices = [0, 3, 5, 3, 1, 4, 4, 2, 5, 3, 4, 5];
            for(let i = 0; i < patchIndices.length; i++) {
                I[iIdx++] = patchIndices[i] + vertexOffset;
            }
            
            vertexOffset += vertices.length;
        }
        
        return { 
            V: V.subarray(0, vIdx * 3), 
            M: M.subarray(0, vIdx), 
            L: L.subarray(0, vIdx), 
            MF: MF.subarray(0, vIdx), 
            E0: E0.subarray(0, vIdx * 3), 
            E1: E1.subarray(0, vIdx * 3), 
            I: I.subarray(0, iIdx),
            lodDistances: fullLodDistances
        };
    }
    
    transformPoint(matrix, point) {
        const x = point[0], y = point[1], z = point[2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        return [
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
        ];
    }
    
    updateBuffers(geometry) {
        const gl = this.gl;
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.V);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphable);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.M);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lod);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.L);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.morphFactor);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.MF);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge0);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.E0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edge1);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.E1);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, geometry.I);
        
        return geometry.I.length;
    }
    
    renderBody(body, cameraPos, cameraForward, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, maxLod = 8) {
        const gl = this.gl;
        const canvasWidth = gl.canvas.width;
        const canvasHeight = gl.canvas.height;
        
        // Check if camera is available
        if (!this.camera) {
            console.error('Camera not set on renderer. Call setCamera() first.');
            return { patches: 0, vertices: 0, cullStats: this.cullStats, ringData: null };
        }
        
        // CAMERA-CENTERED: Convert all positions to camera-relative coordinates
        const cameraRelativeBodyPos = this.camera.worldToCameraRelative(body.position);
        const cameraRelativeSunPos = this.camera.worldToCameraRelative(sunPosition);
        
        // Create camera-relative world matrix
        const cameraRelativeWorldMatrix = [...body.worldMatrix];
        cameraRelativeWorldMatrix[12] = cameraRelativeBodyPos[0];
        cameraRelativeWorldMatrix[13] = cameraRelativeBodyPos[1]; 
        cameraRelativeWorldMatrix[14] = cameraRelativeBodyPos[2];
        
        // Create view-projection matrix for patch culling (using camera-relative coordinates)
        const viewProjMatrix = this.mat4MultiplyViewProj(viewMatrix, projMatrix);
        
        // Check if planet has rotated significantly with distance/LOD awareness
        const planetRotated = this.planetRotationTracker.hasRotatedSignificantly(
            body.id, 
            body.worldMatrix, 
            cameraPos, 
            body, 
            maxLod
        );
        
        // Generate cache key including camera direction
        const cacheKey = this.generateCacheKey(body.id, cameraPos, cameraForward, maxLod, this.currentTargetIndex);
        
        let geometry;
        let patches;
        
        // Check cache first, but invalidate if planet has rotated
        const cachedEntry = this.geometryCache.get(cacheKey);
        if (cachedEntry && !planetRotated) {
            const lodDistances = ScreenSpaceLOD.calculateLODDistances(
                body, viewMatrix, projMatrix, canvasWidth, canvasHeight, 
                [this.targetPixelSizes[this.currentTargetIndex]]
            );
            
            const fullLodDistances = [];
            for (let i = 0; i < 12; i++) {
                const pixelSize = this.targetPixelSizes[this.currentTargetIndex] * Math.pow(2, i);
                const patchWorldSize = body.radius / Math.pow(2, i);
                const fovY = Math.PI / 3;
                const halfHeight = canvasHeight * 0.5;
                const focalLength = halfHeight / Math.tan(fovY * 0.5);
                const distance = (patchWorldSize * focalLength) / pixelSize;
                fullLodDistances.push(distance * body.lodMultiplier);
            }
            
            // Enhanced cache validation for close surfaces
            const planetCenter = [cameraRelativeWorldMatrix[12], cameraRelativeWorldMatrix[13], cameraRelativeWorldMatrix[14]];
            const distanceToCenter = Math.hypot(
                planetCenter[0], // Camera is at origin in camera-relative space
                planetCenter[1],
                planetCenter[2]
            );
            const distanceToSurface = Math.max(0.1, distanceToCenter - body.radius);
            
            // Adaptive validation thresholds based on distance
            let posThreshold = this.cacheThreshold;
            let rotThreshold = this.rotationThreshold;
            
            if (distanceToSurface < body.radius * 0.5) {
                posThreshold *= 0.1;
                rotThreshold *= 0.1;
            } else if (distanceToSurface < body.radius * 2.0) {
                posThreshold *= 0.3;
                rotThreshold *= 0.3;
            }
            
            if (cachedEntry.isValid([0, 0, 0], cameraForward, fullLodDistances, maxLod, posThreshold, rotThreshold)) {
                cachedEntry.touch();
                geometry = cachedEntry.geometry;
                this.cacheStats.hits++;
            } else {
                this.geometryCache.delete(cacheKey);
                geometry = null;
            }
        } else if (planetRotated) {
            // Planet rotated, remove cache entries for this planet
            const keysToRemove = [];
            for (const [key, entry] of this.geometryCache) {
                if (key.startsWith(body.id + '_')) {
                    keysToRemove.push(key);
                }
            }
            
            for (const key of keysToRemove) {
                this.geometryCache.delete(key);
                this.cacheStats.evictions++;
            }
            geometry = null;
        }
        
        // Generate geometry if not cached or invalid
        if (!geometry) {
            // CAMERA-CENTERED: Pass camera at origin for geometry generation
            patches = this.buildPatches([0, 0, 0], cameraForward, body, viewMatrix, projMatrix, canvasWidth, canvasHeight, maxLod, viewProjMatrix, cameraRelativeWorldMatrix);
            geometry = this.generateGeometry(patches, [0, 0, 0], body, viewMatrix, projMatrix, canvasWidth, canvasHeight, cameraRelativeWorldMatrix);
            
            // Cache the new geometry with camera direction
            const cacheEntry = new GeometryCacheEntry(geometry, [0, 0, 0], cameraForward, geometry.lodDistances, maxLod);
            this.geometryCache.set(cacheKey, cacheEntry);
            this.cacheStats.misses++;
            
            // Clean up cache more frequently when close to surfaces
            const planetCenter = [cameraRelativeWorldMatrix[12], cameraRelativeWorldMatrix[13], cameraRelativeWorldMatrix[14]];
            const distanceToCenter = Math.hypot(planetCenter[0], planetCenter[1], planetCenter[2]);
            const distanceToSurface = Math.max(0.1, distanceToCenter - body.radius);
            
            const cleanupFrequency = distanceToSurface < body.radius * 1.0 ? 10 : 30;
            if (this.frameCount % cleanupFrequency === 0) {
                this.cleanupCache();
            }
        }
        
        const indexCount = this.updateBuffers(geometry);
        
        // Get the appropriate shader for this planet
        const shaderData = this.shaderManager.getShaderForPlanet(body.id);
        const program = shaderData.program;
        const uniforms = shaderData.uniforms;
        const uniformSetup = shaderData.uniformSetup;
        
        gl.useProgram(program);
        gl.bindVertexArray(this.mainVAO);
        
        // CAMERA-CENTERED: Create temporary body object with camera-relative matrix
        const cameraRelativeBody = {
            ...body,
            worldMatrix: cameraRelativeWorldMatrix
        };
        
        // CAMERA-CENTERED: Pass camera at origin and camera-relative sun position
        uniformSetup(gl, uniforms, cameraRelativeBody, [0, 0, 0], viewMatrix, projMatrix, time, showLod, animateWaves, cameraRelativeSunPos, this.logDepthBufFC);
        
        // RENDER THE PLANET
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
        
        this.frameCount++;
        
        // Calculate patches count from geometry if not already available
        const patchCount = patches ? patches.length : Math.floor(geometry.I.length / 12);
        
        // COLLECT RING DATA for deferred rendering (instead of rendering rings immediately)
        const ringData = this.ringSystem.collectRingData(body, viewMatrix, projMatrix, time, sunPosition);
        
        return { 
            patches: patchCount, 
            vertices: geometry.V.length / 3,
            cullStats: this.cullStats,
            ringData: ringData  // Return ring data for deferred rendering
        };
    }
    
    mat4MultiplyViewProj(view, proj) {
        const result = new Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                result[i * 4 + j] =
                    view[i * 4 + 0] * proj[0 * 4 + j] +
                    view[i * 4 + 1] * proj[1 * 4 + j] +
                    view[i * 4 + 2] * proj[2 * 4 + j] +
                    view[i * 4 + 3] * proj[3 * 4 + j];
            }
        }
        return result;
    }
    
    cycleTargetPixelSize() {
        this.currentTargetIndex = (this.currentTargetIndex + 1) % this.targetPixelSizes.length;
        // Clear cache when pixel size changes as it affects LOD calculations
        this.geometryCache.clear();
    }
    
    getCurrentTargetPixelSize() {
        return this.targetPixelSizes[this.currentTargetIndex];
    }
    
    getFrameStats() {
        return { 
            ...this.stats,
            cache: {
                ...this.cacheStats,
                totalEntries: this.geometryCache.size,
                hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0
            },
            culling: this.cullStats
        };
    }
    
    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    }
    
    createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }
        return program;
    }
    
    perspective(fovy, aspect, near, far) {
        // Update near/far for logarithmic depth with 10x scale
        this.near = near;
        this.far = far;
        this.logDepthBufFC = 2.0 / (Math.log(far + 1.0) / Math.LN2);
        
        const f = 1/Math.tan(fovy/2), nf = 1/(near-far);
        return [
            f/aspect,0,0,0,
            0,f,0,0,
            0,0,(far+near)*nf,-1,
            0,0,2*far*near*nf,0
        ];
    }
}

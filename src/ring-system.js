export class RingSystem {
    constructor(gl) {
        this.gl = gl;
        this.camera = null;
        this.setupShaders();
        this.setupBuffers();
        this.logDepthBufFC = 2.0 / (Math.log(20000.0 + 1.0) / Math.LN2);
        
        // Ring configurations (same as before)
        this.ringConfigs = {
            jupiter: {
                innerRadiusMultiplier: 1.15,
                outerRadiusMultiplier: 1.6,
                segments: 128,
                rings: 4,
                opacity: 0.3,
                color: [0.8, 0.7, 0.5],
                dustDensity: 0.4,
                particleSize: 0.002,
                brightness: 0.8
            },
            saturn: {
                innerRadiusMultiplier: 1.25,
                outerRadiusMultiplier: 2.2,
                segments: 256,
                rings: 10,
                opacity: 0.5,
                color: [0.9, 0.85, 0.7],
                dustDensity: 0.7,
                particleSize: 0.001,
                brightness: 1.2,
                gaps: [
                    { start: 1.95, end: 2.02 },
                    { start: 2.15, end: 2.18 }
                ]
            },
            uranus: {
                innerRadiusMultiplier: 1.2,
                outerRadiusMultiplier: 1.6,
                segments: 128,
                rings: 11,
                opacity: 0.3,
                color: [0.5, 0.7, 0.9],
                dustDensity: 0.5,
                particleSize: 0.002,
                brightness: 1.0,
                narrow: true
            },
            neptune: {
                innerRadiusMultiplier: 1.15,
                outerRadiusMultiplier: 1.45,
                segments: 96,
                rings: 6,
                opacity: 0.25,
                color: [0.4, 0.6, 0.8],
                dustDensity: 0.4,
                particleSize: 0.003,
                brightness: 0.9,
                arcs: true
            }
        };
    }

    setCamera(camera) {
        this.camera = camera;
    }

    setLogDepthBufFC(logDepthBufFC) {
        this.logDepthBufFC = logDepthBufFC;
    }

    setupShaders() {
        const gl = this.gl;
        
        // VERTEX SHADER - EXACT match to planet logarithmic depth calculation
        const vertexShaderSource = `#version 300 es
        precision mediump float;
        layout(location=0) in vec3 aPosition;
        layout(location=1) in vec2 aTexCoord;
        layout(location=2) in float aOpacity;
        layout(location=3) in float aRingIndex;

        uniform mat4 uModel, uView, uProj;
        uniform float uTime;
        uniform float uLogDepthBufFC;

        out vec2 vTexCoord;
        out float vOpacity;
        out float vRingIndex;
        out float vLogDepth;
        out vec3 vWorldPos;
        out float vDistanceFromCenter;

        void main() {
            vec4 worldPos = uModel * vec4(aPosition, 1.0);
            vWorldPos = worldPos.xyz;
            
            vDistanceFromCenter = length(aPosition.xz);
            vTexCoord = aTexCoord;
            vOpacity = aOpacity;
            vRingIndex = aRingIndex;
            
            // EXACT SAME LOGARITHMIC DEPTH AS PLANETS
            vec4 clipPos = uProj * uView * worldPos;
            gl_Position = clipPos;
            
            // This is EXACTLY what Jupiter shader does:
            vLogDepth = 1.0 + clipPos.w;
            gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
            gl_Position.z *= clipPos.w;
        }
        `;

        // FRAGMENT SHADER - EXACT match to planet logarithmic depth calculation
        const fragmentShaderSource = `#version 300 es
        #extension GL_EXT_frag_depth : enable
        precision mediump float;

        in vec2 vTexCoord;
        in float vOpacity;
        in float vRingIndex;
        in float vLogDepth;
        in vec3 vWorldPos;
        in float vDistanceFromCenter;

        out vec4 fragColor;

        uniform float uTime;
        uniform vec3 uRingColor;
        uniform float uLogDepthBufFC;
        uniform vec3 uSunPosition;
        uniform vec3 uCameraPos;
        uniform float uDustDensity;
        uniform float uParticleSize;
        uniform int uHasGaps;
        uniform int uIsNarrow;
        uniform int uHasArcs;
        uniform float uPlanetRadius;
        uniform float uBrightness;

        // Simple noise function for ring texture
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            float frequency = 1.0;
            
            for(int i = 0; i < 3; i++) {
                value += amplitude * noise(p * frequency);
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            
            return value;
        }

        void main() {
            // EXACT SAME LOGARITHMIC DEPTH AS PLANETS
            // This is EXACTLY what Jupiter fragment shader does:
            gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
            
            // Ring density calculation (same as before)
            float ringDensity = 1.0;
            
            float radialNoise = fbm(vec2(vDistanceFromCenter * 12.0, vTexCoord.y * 20.0 + uTime * 0.08));
            ringDensity *= (0.85 + 0.15 * radialNoise);
            
            float angularNoise = fbm(vec2(vTexCoord.x * 60.0 + uTime * 0.03, vDistanceFromCenter * 6.0));
            ringDensity *= (0.95 + 0.05 * angularNoise);
            
            if (uIsNarrow == 1) {
                float ringBand = fract(vDistanceFromCenter * 5.0);
                ringDensity *= smoothstep(0.25, 0.35, ringBand) * (1.0 - smoothstep(0.65, 0.75, ringBand));
                ringDensity = max(ringDensity, 0.2);
            }
            
            if (uHasArcs == 1) {
                float arcPattern = sin(vTexCoord.x * 6.28318 * 2.5) * 0.5 + 0.5;
                ringDensity *= mix(0.2, 1.0, smoothstep(0.25, 0.75, arcPattern));
            }
            
            if (uHasGaps == 1) {
                float gapFactor = 1.0;
                
                if (vDistanceFromCenter > 1.9 && vDistanceFromCenter < 2.1) {
                    gapFactor *= 0.15;
                }
                
                float smallGaps = sin(vDistanceFromCenter * 20.0) * 0.5 + 0.5;
                gapFactor *= mix(0.85, 1.0, smoothstep(0.3, 0.7, smallGaps));
                
                ringDensity *= gapFactor;
            }
            
            // Lighting calculation
            vec3 lightDir = normalize(uSunPosition - vWorldPos);
            vec3 viewDir = normalize(uCameraPos - vWorldPos);
            vec3 ringNormal = vec3(0.0, 1.0, 0.0);
            
            float NdotL = abs(dot(ringNormal, lightDir));
            float lighting = 0.3 + 0.5 * NdotL;
            
            float scattering = pow(max(0.0, dot(lightDir, viewDir)), 2.0);
            lighting += scattering * 0.3;
            
            // Distance-based opacity with proper falloff for 10x scale
            float distanceToCamera = length(uCameraPos - vWorldPos);
            float distanceFalloff = 1.0 / (1.0 + distanceToCamera * distanceToCamera * 0.000001);
            
            vec3 finalColor = uRingColor * lighting * uBrightness;
            float finalOpacity = vOpacity * ringDensity * uDustDensity * distanceFalloff;
            
            if (finalOpacity < 0.008) discard;
            
            fragColor = vec4(finalColor, finalOpacity);
        }
        `;

        this.vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        this.fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        this.program = this.createProgram(this.vertexShader, this.fragmentShader);

        this.uniforms = {
            uModel: gl.getUniformLocation(this.program, 'uModel'),
            uView: gl.getUniformLocation(this.program, 'uView'),
            uProj: gl.getUniformLocation(this.program, 'uProj'),
            uTime: gl.getUniformLocation(this.program, 'uTime'),
            uLogDepthBufFC: gl.getUniformLocation(this.program, 'uLogDepthBufFC'),
            uCameraPos: gl.getUniformLocation(this.program, 'uCameraPos'),
            uRingColor: gl.getUniformLocation(this.program, 'uRingColor'),
            uSunPosition: gl.getUniformLocation(this.program, 'uSunPosition'),
            uDustDensity: gl.getUniformLocation(this.program, 'uDustDensity'),
            uParticleSize: gl.getUniformLocation(this.program, 'uParticleSize'),
            uHasGaps: gl.getUniformLocation(this.program, 'uHasGaps'),
            uIsNarrow: gl.getUniformLocation(this.program, 'uIsNarrow'),
            uHasArcs: gl.getUniformLocation(this.program, 'uHasArcs'),
            uPlanetRadius: gl.getUniformLocation(this.program, 'uPlanetRadius'),
            uBrightness: gl.getUniformLocation(this.program, 'uBrightness')
        };
    }

    setupBuffers() {
        const gl = this.gl;
        
        this.vao = gl.createVertexArray();
        this.positionBuffer = gl.createBuffer();
        this.texCoordBuffer = gl.createBuffer();
        this.opacityBuffer = gl.createBuffer();
        this.ringIndexBuffer = gl.createBuffer();
        this.indexBuffer = gl.createBuffer();
        
        gl.bindVertexArray(this.vao);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.opacityBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ringIndexBuffer);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bindVertexArray(null);
    }

    generateRingGeometry(config, planetRadius) {
        const innerRadius = planetRadius * config.innerRadiusMultiplier;
        const outerRadius = planetRadius * config.outerRadiusMultiplier;
        const segments = config.segments;
        const rings = config.rings;

        const vertices = [];
        const texCoords = [];
        const opacities = [];
        const ringIndices = [];
        const indices = [];
        let vertexIndex = 0;

        for (let ring = 0; ring < rings; ring++) {
            const ringStart = innerRadius + (outerRadius - innerRadius) * (ring / rings);
            const ringEnd = innerRadius + (outerRadius - innerRadius) * ((ring + 1) / rings);
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                vertices.push(ringStart * cos, 0, ringStart * sin);
                texCoords.push(i / segments, ring / rings);
                opacities.push(config.opacity);
                ringIndices.push(ring);

                vertices.push(ringEnd * cos, 0, ringEnd * sin);
                texCoords.push(i / segments, (ring + 1) / rings);
                opacities.push(config.opacity);
                ringIndices.push(ring);

                if (i < segments) {
                    const base = vertexIndex;
                    indices.push(base, base + 1, base + 2);
                    indices.push(base + 1, base + 3, base + 2);
                }
                vertexIndex += 2;
            }
        }

        return {
            vertices: new Float32Array(vertices),
            texCoords: new Float32Array(texCoords),
            opacities: new Float32Array(opacities),
            ringIndices: new Float32Array(ringIndices),
            indices: new Uint32Array(indices)
        };
    }
    generateRingGeometryTorus(config, planetRadius) {
        const innerRadius = planetRadius * config.innerRadiusMultiplier;
        const outerRadius = planetRadius * config.outerRadiusMultiplier;
        const segments = config.segments;
        const rings = config.rings;
        const torusTube = planetRadius * 0.005; // Small thickness

        const vertices = [];
        const texCoords = [];
        const opacities = [];
        const ringIndices = [];
        const indices = [];
        let vertexIndex = 0;

        for (let ring = 0; ring < rings; ring++) {
            const ringStart = innerRadius + (outerRadius - innerRadius) * (ring / rings);
            const ringEnd = innerRadius + (outerRadius - innerRadius) * ((ring + 1) / rings);

            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                // Two points: one just above the ring plane, one just below
                for (let j = 0; j <= 1; j++) {
                    const y = (j === 0 ? -1 : 1) * torusTube;
                    vertices.push(ringStart * cos, y, ringStart * sin);
                    texCoords.push(i / segments, ring / rings);
                    opacities.push(config.opacity);
                    ringIndices.push(ring);

                    vertices.push(ringEnd * cos, y, ringEnd * sin);
                    texCoords.push(i / segments, (ring + 1) / rings);
                    opacities.push(config.opacity);
                    ringIndices.push(ring);
                }

                if (i < segments) {
                    const base = vertexIndex;
                    // Lower quad
                    indices.push(base, base + 2, base + 1);
                    indices.push(base + 2, base + 3, base + 1);
                }
                vertexIndex += 4;
            }
        }

        return {
            vertices: new Float32Array(vertices),
            texCoords: new Float32Array(texCoords),
            opacities: new Float32Array(opacities),
            ringIndices: new Float32Array(ringIndices),
            indices: new Uint32Array(indices)
        };
    }

    collectRingData(body, viewMatrix, projMatrix, time, sunPosition) {
        if (!this.camera) return null;

        const config = this.ringConfigs[body.id];
        if (!config) return null;

        const cameraRelativeBodyPos = this.camera.worldToCameraRelative(body.position);
        const cameraRelativeSunPos = this.camera.worldToCameraRelative(sunPosition);
        
        const cameraRelativeWorldMatrix = [...body.worldMatrix];
        cameraRelativeWorldMatrix[12] = cameraRelativeBodyPos[0];
        cameraRelativeWorldMatrix[13] = cameraRelativeBodyPos[1];
        cameraRelativeWorldMatrix[14] = cameraRelativeBodyPos[2];

        return {
            body,
            config,
            cameraRelativeWorldMatrix,
            cameraRelativeSunPos,
            viewMatrix,
            projMatrix,
            time
        };
    }

    renderSingleRing(ringData) {
        const gl = this.gl;
        const { body, config, cameraRelativeWorldMatrix, cameraRelativeSunPos, viewMatrix, projMatrix, time } = ringData;
        
        if (!this.geometryCache) {
            this.geometryCache = new Map();
        }
        
        let geometry = this.geometryCache.get(body.id);
        if (!geometry) {
            geometry = this.generateRingGeometry(config, body.radius);
            this.geometryCache.set(body.id, geometry);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.texCoords, gl.STATIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.opacityBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.opacities, gl.STATIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ringIndexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.ringIndices, gl.STATIC_DRAW);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Set uniforms with EXACT same logDepthBufFC as planets
        gl.uniformMatrix4fv(this.uniforms.uModel, false, new Float32Array(cameraRelativeWorldMatrix));
        gl.uniformMatrix4fv(this.uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(this.uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniform1f(this.uniforms.uTime, time);
        gl.uniform1f(this.uniforms.uLogDepthBufFC, this.logDepthBufFC); // CRITICAL: Same value as planets
        gl.uniform3fv(this.uniforms.uCameraPos, new Float32Array([0, 0, 0]));
        gl.uniform3fv(this.uniforms.uRingColor, new Float32Array(config.color));
        gl.uniform3fv(this.uniforms.uSunPosition, new Float32Array(cameraRelativeSunPos));
        gl.uniform1f(this.uniforms.uDustDensity, config.dustDensity);
        gl.uniform1f(this.uniforms.uParticleSize, config.particleSize);
        gl.uniform1f(this.uniforms.uPlanetRadius, body.radius);
        gl.uniform1f(this.uniforms.uBrightness, config.brightness || 1.0);
        
        gl.uniform1i(this.uniforms.uHasGaps, config.gaps ? 1 : 0);
        gl.uniform1i(this.uniforms.uIsNarrow, config.narrow ? 1 : 0);
        gl.uniform1i(this.uniforms.uHasArcs, config.arcs ? 1 : 0);

        gl.drawElements(gl.TRIANGLES, geometry.indices.length, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
    }

    renderAllRings(ringDataArray) {
        if (!ringDataArray || ringDataArray.length === 0) return;

        const gl = this.gl;
        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        
        ringDataArray.sort((a, b) => {
            const distA = Math.hypot(
                a.cameraRelativeWorldMatrix[12],
                a.cameraRelativeWorldMatrix[13], 
                a.cameraRelativeWorldMatrix[14]
            );
            const distB = Math.hypot(
                b.cameraRelativeWorldMatrix[12],
                b.cameraRelativeWorldMatrix[13],
                b.cameraRelativeWorldMatrix[14]
            );
            return distB - distA;
        });

        for (const ringData of ringDataArray) {
            this.renderSingleRing(ringData);
        }
        
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Ring shader compilation error: ${error}`);
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
            throw new Error(`Ring program linking error: ${error}`);
        }
        
        return program;
    }

    cleanup() {
        const gl = this.gl;
        
        if (this.program) gl.deleteProgram(this.program);
        if (this.vertexShader) gl.deleteShader(this.vertexShader);
        if (this.fragmentShader) gl.deleteShader(this.fragmentShader);
        if (this.vao) gl.deleteVertexArray(this.vao);
        
        const buffers = [
            this.positionBuffer, this.texCoordBuffer, 
            this.opacityBuffer, this.ringIndexBuffer, this.indexBuffer
        ];
        
        buffers.forEach(buffer => {
            if (buffer) gl.deleteBuffer(buffer);
        });
    }
}
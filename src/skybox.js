export class SkyboxRenderer {
    constructor(gl) {
        this.gl = gl;
        this.setupShaders();
        this.setupGeometry();
        this.cubemapTexture = null;
        this.isReady = false;
        this.opacity = 0.0;
        this.fadeSpeed = 0.03;
        this.worker = null;
        
        this.generateSkyboxAsync();
    }
    
    setupShaders() {
        const gl = this.gl;
        
        const vertexShaderSource = `#version 300 es
        precision highp float;
        layout(location=0) in vec3 aPosition;
        
        uniform mat4 uView;
        uniform mat4 uProj;
        
        out vec3 vTexCoord;
        
        void main() {
            mat4 rotationOnlyView = mat4(
                uView[0][0], uView[0][1], uView[0][2], 0.0,
                uView[1][0], uView[1][1], uView[1][2], 0.0,
                uView[2][0], uView[2][1], uView[2][2], 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            
            vec4 pos = uProj * rotationOnlyView * vec4(aPosition, 1.0);
            gl_Position = pos.xyww;
            vTexCoord = aPosition;
        }`;
        
        const fragmentShaderSource = `#version 300 es
        precision highp float;
        
        uniform samplerCube uSkybox;
        uniform float uOpacity;
        
        in vec3 vTexCoord;
        out vec4 fragColor;
        
        void main() {
            vec3 color = texture(uSkybox, vTexCoord).rgb;
            color = color / (color + vec3(1.0));
            color = pow(color, vec3(1.0/2.2));
            fragColor = vec4(color, uOpacity);
        }`;
        
        this.vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        this.fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        this.program = this.createProgram(this.vertexShader, this.fragmentShader);
        
        this.uniforms = {
            uView: gl.getUniformLocation(this.program, 'uView'),
            uProj: gl.getUniformLocation(this.program, 'uProj'),
            uSkybox: gl.getUniformLocation(this.program, 'uSkybox'),
            uOpacity: gl.getUniformLocation(this.program, 'uOpacity')
        };
    }
    
    setupGeometry() {
        const gl = this.gl;
        
        const vertices = new Float32Array([
            -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,  1,
            -1, -1, -1, -1,  1, -1,  1,  1, -1,  1, -1, -1,
            -1,  1, -1, -1,  1,  1,  1,  1,  1,  1,  1, -1,
            -1, -1, -1,  1, -1, -1,  1, -1,  1, -1, -1,  1,
             1, -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,
            -1, -1, -1, -1, -1,  1, -1,  1,  1, -1,  1, -1
        ]);
        
        const indices = new Uint16Array([
            0,  1,  2,    0,  2,  3,    4,  5,  6,    4,  6,  7,
            8,  9,  10,   8,  10, 11,   12, 13, 14,   12, 14, 15,
            16, 17, 18,   16, 18, 19,   20, 21, 22,   20, 22, 23
        ]);
        
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        
        gl.bindVertexArray(null);
        this.indexCount = indices.length;
    }
    
    generateSkyboxAsync() {
        const workerBlob = new Blob([this.getWorkerScript()], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(workerBlob));
        
        this.worker.onmessage = (e) => {
            const { type, data, progress, face } = e.data;
            
            switch (type) {
                case 'started':
                    this.showGenerationProgress(0);
                    break;
                case 'progress':
                    this.showGenerationProgress(progress);
                    break;
                case 'completed':
                    this.createCubemapTexture(data);
                    this.hideGenerationProgress();
                    this.worker.terminate();
                    this.worker = null;
                    break;
            }
        };
        
        this.worker.postMessage({ type: 'generate' });
    }
    
    createCubemapTexture(cubemapData) {
        const gl = this.gl;
        
        this.cubemapTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemapTexture);
        
        const faces = [
            { target: gl.TEXTURE_CUBE_MAP_POSITIVE_X, data: cubemapData.px },
            { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, data: cubemapData.nx },
            { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, data: cubemapData.py },
            { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, data: cubemapData.ny },
            { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, data: cubemapData.pz },
            { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, data: cubemapData.nz }
        ];
        
        faces.forEach(face => {
            gl.texImage2D(face.target, 0, gl.RGBA, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, face.data);
        });
        
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        
        this.isReady = true;
        this.opacity = 0.0;
    }
    
    showGenerationProgress(progress) {
        let progressElement = document.getElementById('skyboxProgress');
        if (!progressElement) {
            progressElement = document.createElement('div');
            progressElement.id = 'skyboxProgress';
            progressElement.style.cssText = `
                position: fixed; bottom: 20px; right: 20px;
                background: rgba(15, 23, 42, 0.85); color: #e0e6ed;
                padding: 12px 16px; border-radius: 6px;
                font-family: 'Inter', sans-serif; font-size: 12px;
                z-index: 1000; backdrop-filter: blur(10px);
                border: 1px solid rgba(71, 85, 105, 0.3);
                display: flex; align-items: center; gap: 10px;
                max-width: 200px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            `;
            document.body.appendChild(progressElement);
        }
        
        progressElement.innerHTML = `
            <div style="font-size: 14px;">🌌</div>
            <div style="flex: 1;">
                <div style="margin-bottom: 4px; font-weight: 500;">Generating Universe</div>
                <div style="width: 100%; height: 2px; background: rgba(71, 85, 105, 0.3); border-radius: 1px; overflow: hidden;">
                    <div style="width: ${progress}%; height: 100%; background: linear-gradient(90deg, #60a5fa, #3b82f6); transition: width 0.3s ease;"></div>
                </div>
            </div>
            <div style="font-size: 11px; color: #94a3b8; min-width: 30px; text-align: right;">${progress.toFixed(0)}%</div>
        `;
    }
    
    hideGenerationProgress() {
        const progressElement = document.getElementById('skyboxProgress');
        if (progressElement) {
            progressElement.style.opacity = '0';
            progressElement.style.transform = 'translateY(10px)';
            progressElement.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                if (progressElement.parentNode) {
                    progressElement.parentNode.removeChild(progressElement);
                }
            }, 300);
        }
    }
    
    update() {
        if (this.isReady && this.opacity < 1.0) {
            this.opacity = Math.min(1.0, this.opacity + this.fadeSpeed);
        }
    }
    
    render(viewMatrix, projMatrix) {
        if (!this.isReady || !this.cubemapTexture) return;
        
        const gl = this.gl;
        this.update();
        
        const currentDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
        const currentDepthFunc = gl.getParameter(gl.DEPTH_FUNC);
        const currentCullFace = gl.getParameter(gl.CULL_FACE);
        
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemapTexture);
        gl.uniform1i(this.uniforms.uSkybox, 0);
        
        gl.uniformMatrix4fv(this.uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(this.uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniform1f(this.uniforms.uOpacity, this.opacity);
        
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
        
        gl.depthMask(currentDepthMask);
        gl.depthFunc(currentDepthFunc);
        if (currentCullFace) gl.enable(gl.CULL_FACE);
        
        gl.bindVertexArray(null);
    }
    
    getWorkerScript() {
        return `
        ${this.getSimplexNoiseScript()}
        ${this.getSkyboxGeneratorScript()}
        
        self.onmessage = function(e) {
            if (e.data.type === 'generate') {
                self.postMessage({ type: 'started' });
                const generator = new SkyboxGenerator();
                const cubemapData = generator.generateCubemap();
                self.postMessage({ type: 'completed', data: cubemapData });
            }
        };
        `;
    }
    
    getSimplexNoiseScript() {
        return `
        class SimplexNoise {
            constructor() {
                this.grad3 = [
                    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
                    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
                    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
                ];
                
                this.p = [];
                for (let i = 0; i < 256; i++) {
                    this.p[i] = Math.floor(Math.random() * 256);
                }
                
                this.perm = [];
                for (let i = 0; i < 512; i++) {
                    this.perm[i] = this.p[i & 255];
                }
            }
            
            dot(g, x, y) {
                return g[0] * x + g[1] * y;
            }
            
            noise2D(xin, yin) {
                let n0, n1, n2;
                
                const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
                const s = (xin + yin) * F2;
                const i = Math.floor(xin + s);
                const j = Math.floor(yin + s);
                
                const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
                const t = (i + j) * G2;
                const X0 = i - t;
                const Y0 = j - t;
                const x0 = xin - X0;
                const y0 = yin - Y0;
                
                let i1, j1;
                if (x0 > y0) {
                    i1 = 1; j1 = 0;
                } else {
                    i1 = 0; j1 = 1;
                }
                
                const x1 = x0 - i1 + G2;
                const y1 = y0 - j1 + G2;
                const x2 = x0 - 1.0 + 2.0 * G2;
                const y2 = y0 - 1.0 + 2.0 * G2;
                
                const ii = i & 255;
                const jj = j & 255;
                const gi0 = this.perm[ii + this.perm[jj]] % 12;
                const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
                const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
                
                let t0 = 0.5 - x0 * x0 - y0 * y0;
                if (t0 < 0) n0 = 0.0;
                else {
                    t0 *= t0;
                    n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0);
                }
                
                let t1 = 0.5 - x1 * x1 - y1 * y1;
                if (t1 < 0) n1 = 0.0;
                else {
                    t1 *= t1;
                    n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1);
                }
                
                let t2 = 0.5 - x2 * x2 - y2 * y2;
                if (t2 < 0) n2 = 0.0;
                else {
                    t2 *= t2;
                    n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2);
                }
                
                return 70.0 * (n0 + n1 + n2);
            }
        }
        `;
    }
    
    getSkyboxGeneratorScript() {
        return `
        class SkyboxGenerator {
            constructor() {
                this.size = 2048;
                this.noise = new SimplexNoise();
                this.masterSeed = Math.floor(Math.random() * 1000000);
                
                // Galactic coordinates: center at (l=0°, b=0°) in galactic longitude/latitude
                // Convert to equatorial coordinates (approximate)
                this.galacticCenter = this.normalize({ x: 0.8, y: -0.4, z: 0.4 });
                this.galacticNorth = this.normalize({ x: -0.1, y: 0.9, z: 0.4 });
                
                // Pre-generate optimized star distributions
                this.globalStars = this.generateGlobalStars();
                this.milkyWayStars = this.generateMilkyWayStars();
                this.bulgeStars = this.generateBulgeStars();
                this.globalNebulae = this.generateGlobalNebulae();
            }
            
            normalize(v) {
                const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                return { x: v.x / len, y: v.y / len, z: v.z / len };
            }
            
            seededRandom(seed) {
                const x = Math.sin(seed) * 10000;
                return x - Math.floor(x);
            }
            
            generateGlobalStars() {
                const stars = [];
                const numStars = 12000;
                
                let seed = this.masterSeed + 1000;
                for (let i = 0; i < numStars; i++) {
                    const u = this.seededRandom(seed++);
                    const v = this.seededRandom(seed++);
                    
                    const theta = 2 * Math.PI * u;
                    const phi = Math.acos(2 * v - 1);
                    
                    const x = Math.sin(phi) * Math.cos(theta);
                    const y = Math.sin(phi) * Math.sin(theta);
                    const z = Math.cos(phi);
                    
                    const brightness = Math.pow(this.seededRandom(seed++), 4) * 0.8 + 0.1;
                    const temperature = this.seededRandom(seed++);
                    
                    let r, g, b;
                    if (temperature < 0.2) {
                        r = 255 * brightness;
                        g = 140 * brightness;
                        b = 90 * brightness;
                    } else if (temperature < 0.5) {
                        r = 255 * brightness;
                        g = 220 * brightness;
                        b = 160 * brightness;
                    } else if (temperature < 0.8) {
                        r = 255 * brightness;
                        g = 255 * brightness;
                        b = 240 * brightness;
                    } else {
                        r = 200 * brightness;
                        g = 220 * brightness;
                        b = 255 * brightness;
                    }
                    
                    stars.push({
                        x, y, z, r, g, b, brightness,
                        size: brightness > 0.6 ? 0.8 : 0.4
                    });
                }
                
                return stars;
            }
            
            generateMilkyWayStars() {
                const stars = [];
                const numStars = 6000;
                
                let seed = this.masterSeed + 2000;
                for (let i = 0; i < numStars; i++) {
                    // Generate stars in galactic disk
                    const diskRadius = Math.sqrt(this.seededRandom(seed++)) * 1.8;
                    const diskAngle = 2 * Math.PI * this.seededRandom(seed++);
                    const diskHeight = (this.seededRandom(seed++) - 0.5) * 0.15;
                    
                    // Create local coordinates
                    let localX = diskRadius * Math.cos(diskAngle);
                    let localY = diskHeight;
                    let localZ = diskRadius * Math.sin(diskAngle);
                    
                    // Normalize to unit sphere
                    const localLen = Math.sqrt(localX * localX + localY * localY + localZ * localZ);
                    if (localLen > 0) {
                        localX /= localLen;
                        localY /= localLen;
                        localZ /= localLen;
                    }
                    
                    // Transform to align with galactic plane
                    const normal = this.galacticNorth;
                    let tangent1 = { x: 1, y: 0, z: 0 };
                    
                    const dot = tangent1.x * normal.x + tangent1.y * normal.y + tangent1.z * normal.z;
                    tangent1.x -= dot * normal.x;
                    tangent1.y -= dot * normal.y;
                    tangent1.z -= dot * normal.z;
                    
                    let len = Math.sqrt(tangent1.x * tangent1.x + tangent1.y * tangent1.y + tangent1.z * tangent1.z);
                    if (len > 0.001) {
                        tangent1.x /= len;
                        tangent1.y /= len;
                        tangent1.z /= len;
                    } else {
                        tangent1 = { x: 0, y: 1, z: 0 };
                    }
                    
                    const tangent2 = {
                        x: normal.y * tangent1.z - normal.z * tangent1.y,
                        y: normal.z * tangent1.x - normal.x * tangent1.z,
                        z: normal.x * tangent1.y - normal.y * tangent1.x
                    };
                    
                    const worldX = localX * tangent1.x + localY * normal.x + localZ * tangent2.x;
                    const worldY = localX * tangent1.y + localY * normal.y + localZ * tangent2.y;
                    const worldZ = localX * tangent1.z + localY * normal.z + localZ * tangent2.z;
                    
                    const brightness = Math.pow(this.seededRandom(seed++), 3) * 0.6 + 0.2;
                    const temperature = this.seededRandom(seed++);
                    
                    let r, g, b;
                    if (temperature < 0.3) {
                        r = 255 * brightness;
                        g = 180 * brightness;
                        b = 120 * brightness;
                    } else if (temperature < 0.7) {
                        r = 255 * brightness;
                        g = 240 * brightness;
                        b = 200 * brightness;
                    } else {
                        r = 220 * brightness;
                        g = 240 * brightness;
                        b = 255 * brightness;
                    }
                    
                    stars.push({
                        x: worldX, y: worldY, z: worldZ,
                        r, g, b, brightness, size: 0.5
                    });
                }
                
                return stars;
            }
            
            generateBulgeStars() {
                const stars = [];
                const numStars = 800;
                
                let seed = this.masterSeed + 3000;
                for (let i = 0; i < numStars; i++) {
                    // Generate around galactic center with spherical distribution
                    const u = this.seededRandom(seed++);
                    const v = this.seededRandom(seed++);
                    const w = this.seededRandom(seed++);
                    
                    const theta = 2 * Math.PI * u;
                    const phi = Math.acos(2 * v - 1);
                    const radius = Math.pow(w, 0.3) * 0.4; // Concentrated distribution
                    
                    let x = radius * Math.sin(phi) * Math.cos(theta);
                    let y = radius * Math.sin(phi) * Math.sin(theta);
                    let z = radius * Math.cos(phi);
                    
                    // FIXED: Only offset toward ONE side of galactic center
                    // Check dot product to ensure we're only on one side
                    const testDot = x * this.galacticCenter.x + y * this.galacticCenter.y + z * this.galacticCenter.z;
                    if (testDot < 0) {
                        // If on wrong side, flip to correct side
                        x = -x;
                        y = -y;
                        z = -z;
                    }
                    
                    // Offset toward galactic center
                    x += this.galacticCenter.x * 0.6;
                    y += this.galacticCenter.y * 0.6;
                    z += this.galacticCenter.z * 0.6;
                    
                    // Normalize to sphere
                    const len = Math.sqrt(x * x + y * y + z * z);
                    x /= len;
                    y /= len;
                    z /= len;
                    
                    const brightness = Math.pow(this.seededRandom(seed++), 2) * 0.9 + 0.3;
                    const temperature = this.seededRandom(seed++);
                    
                    let r, g, b;
                    // Bulge stars tend to be redder/older
                    if (temperature < 0.4) {
                        r = 255 * brightness;
                        g = 160 * brightness;
                        b = 100 * brightness;
                    } else if (temperature < 0.7) {
                        r = 255 * brightness;
                        g = 200 * brightness;
                        b = 140 * brightness;
                    } else {
                        r = 255 * brightness;
                        g = 240 * brightness;
                        b = 180 * brightness;
                    }
                    
                    stars.push({
                        x, y, z, r, g, b, brightness,
                        size: brightness > 0.7 ? 2.0 : 1.2 // Larger stars in bulge
                    });
                }
                
                return stars;
            }
            
            generateGlobalNebulae() {
                const nebulae = [];
                const numNebulae = 6;
                
                let seed = this.masterSeed + 4000;
                for (let i = 0; i < numNebulae; i++) {
                    const u = this.seededRandom(seed++);
                    const v = this.seededRandom(seed++);
                    
                    const theta = 2 * Math.PI * u;
                    const phi = Math.acos(2 * v - 1);
                    
                    const x = Math.sin(phi) * Math.cos(theta);
                    const y = Math.sin(phi) * Math.sin(theta);
                    const z = Math.cos(phi);
                    
                    const nebulaType = Math.floor(this.seededRandom(seed++) * 4);
                    
                    // ENHANCED: Generate varied shapes
                    const shapeType = Math.floor(this.seededRandom(seed++) * 4);
                    const elongationX = 0.3 + this.seededRandom(seed++) * 2.5; // 0.3 to 2.8
                    const elongationY = 0.3 + this.seededRandom(seed++) * 2.5;
                    const elongationZ = 0.3 + this.seededRandom(seed++) * 2.5;
                    const rotation = this.seededRandom(seed++) * Math.PI * 2;
                    const twist = this.seededRandom(seed++) * 3; // For spiral shapes
                    
                    let config;
                    
                    switch(nebulaType) {
                        case 0: // Emission nebula - more muted reds/oranges
                            config = {
                                hue: 15 + this.seededRandom(seed++) * 25,
                                saturation: 0.4 + this.seededRandom(seed++) * 0.3,
                                intensity: (0.3 + this.seededRandom(seed++) * 0.3) * 0.75,
                                size: 0.2 + this.seededRandom(seed++) * 0.4,
                                type: 'emission'
                            };
                            break;
                        case 1: // Reflection nebula - muted blues
                            config = {
                                hue: 200 + this.seededRandom(seed++) * 40,
                                saturation: 0.3 + this.seededRandom(seed++) * 0.3,
                                intensity: (0.2 + this.seededRandom(seed++) * 0.3) * 0.75,
                                size: 0.15 + this.seededRandom(seed++) * 0.3,
                                type: 'reflection'
                            };
                            break;
                        case 2: // Planetary nebula - muted greens/cyans
                            config = {
                                hue: 160 + this.seededRandom(seed++) * 60,
                                saturation: 0.4 + this.seededRandom(seed++) * 0.3,
                                intensity: (0.4 + this.seededRandom(seed++) * 0.3) * 0.75,
                                size: 0.08 + this.seededRandom(seed++) * 0.2,
                                type: 'planetary'
                            };
                            break;
                        case 3: // Dark nebula
                            config = {
                                hue: 30 + this.seededRandom(seed++) * 30,
                                saturation: 0.2 + this.seededRandom(seed++) * 0.2,
                                intensity: -(0.3 + this.seededRandom(seed++) * 0.2) * 0.75,
                                size: 0.25 + this.seededRandom(seed++) * 0.5,
                                type: 'dark'
                            };
                            break;
                    }
                    
                    nebulae.push({
                        x, y, z, ...config,
                        seed: this.masterSeed + i * 1000,
                        // Shape parameters
                        shapeType: shapeType,
                        elongationX: elongationX,
                        elongationY: elongationY,
                        elongationZ: elongationZ,
                        rotation: rotation,
                        twist: twist
                    });
                }
                
                return nebulae;
            }
            
            generateCubemap() {
                const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
                const textures = {};
                
                for (let i = 0; i < faces.length; i++) {
                    const face = faces[i];
                    textures[face] = this.generateFace(face);
                    
                    self.postMessage({
                        type: 'progress',
                        face: face,
                        progress: ((i + 1) / faces.length) * 100
                    });
                }
                
                return textures;
            }
            
            generateFace(face) {
                const imageData = new Uint8ClampedArray(this.size * this.size * 4);
                
                // FIXED: Much darker base color (almost black)
                for (let i = 0; i < imageData.length; i += 4) {
                    imageData[i] = 0;     // R
                    imageData[i + 1] = 0; // G  
                    imageData[i + 2] = 2; // B - very slight blue tint
                    imageData[i + 3] = 255; // A
                }
                
                // Render in optimized order
                this.generateMilkyWay3D(face, imageData);
                this.generateNebulae3D(face, imageData);
                this.renderStars3D(face, imageData, this.globalStars);
                this.renderStars3D(face, imageData, this.milkyWayStars);
                this.renderStars3D(face, imageData, this.bulgeStars);
                
                return imageData;
            }
            
            cubeToSphere(face, u, v) {
                const uc = 2.0 * u - 1.0;
                const vc = 2.0 * v - 1.0;
                
                let x, y, z;
                
                switch(face) {
                    case 'px': x = 1.0; y = -vc; z = -uc; break;
                    case 'nx': x = -1.0; y = -vc; z = uc; break;
                    case 'py': x = uc; y = 1.0; z = vc; break;
                    case 'ny': x = uc; y = -1.0; z = -vc; break;
                    case 'pz': x = uc; y = -vc; z = 1.0; break;
                    case 'nz': x = -uc; y = -vc; z = -1.0; break;
                }
                
                const length = Math.sqrt(x * x + y * y + z * z);
                return { x: x / length, y: y / length, z: z / length };
            }
            
            generateMilkyWay3D(face, data) {
                const step = 2;
                
                for (let y = 0; y < this.size; y += step) {
                    for (let x = 0; x < this.size; x += step) {
                        const u = x / (this.size - 1);
                        const v = y / (this.size - 1);
                        
                        const dir = this.cubeToSphere(face, u, v);
                        
                        // Calculate distance from galactic plane
                        const distanceFromPlane = Math.abs(
                            dir.x * this.galacticNorth.x + 
                            dir.y * this.galacticNorth.y + 
                            dir.z * this.galacticNorth.z
                        );
                        
                        const dotWithCenter = dir.x * this.galacticCenter.x + 
                                             dir.y * this.galacticCenter.y + 
                                             dir.z * this.galacticCenter.z;
                        const distanceFromCenter = Math.acos(Math.max(-1, Math.min(1, Math.abs(dotWithCenter))));
                        
                        const diskFalloff = Math.exp(-distanceFromPlane * 12);
                        const radialFalloff = Math.exp(-distanceFromCenter * 1.2);
                        
                        // Optimized noise
                        let noise = 0;
                        noise += this.noise3D(dir.x * 4, dir.y * 4, dir.z * 4) * 0.5;
                        noise += this.noise3D(dir.x * 8, dir.y * 8, dir.z * 8) * 0.3;
                        noise += this.noise3D(dir.x * 16, dir.y * 16, dir.z * 16) * 0.2;
                        
                        const baseIntensity = (noise * 0.5 + 0.5) * diskFalloff * radialFalloff * 0.25;
                        
                        // FIXED: Single-sided bulge - only add bulge intensity where dot product is positive
                        let bulgeIntensity = 0;
                        if (dotWithCenter > 0) { // Only on the correct side
                            bulgeIntensity = Math.exp(-distanceFromCenter * 4) * 0.4;
                        }
                        
                        const totalIntensity = (baseIntensity + bulgeIntensity) * 0.75;
                        
                        if (totalIntensity > 0.01) {
                            const r = totalIntensity * 140;
                            const g = totalIntensity * 125;
                            const b = totalIntensity * 110;
                            
                            for (let dy = 0; dy < step && y + dy < this.size; dy++) {
                                for (let dx = 0; dx < step && x + dx < this.size; dx++) {
                                    const index = ((y + dy) * this.size + (x + dx)) * 4;
                                    data[index] = Math.max(0, Math.min(255, data[index] + r));
                                    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + g));
                                    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + b));
                                }
                            }
                        }
                    }
                }
            }
            
            generateNebulae3D(face, data) {
                const step = 3;
                
                for (let y = 0; y < this.size; y += step) {
                    for (let x = 0; x < this.size; x += step) {
                        const u = x / (this.size - 1);
                        const v = y / (this.size - 1);
                        
                        const dir = this.cubeToSphere(face, u, v);
                        
                        let totalR = 0, totalG = 0, totalB = 0;
                        
                        for (const nebula of this.globalNebulae) {
                            const dx = dir.x - nebula.x;
                            const dy = dir.y - nebula.y;
                            const dz = dir.z - nebula.z;
                            
                            // ENHANCED: Apply shape transformations
                            const transformedDistance = this.applyNebulaShapeTransform(dx, dy, dz, nebula);
                            const angularDistance = 2 * Math.asin(Math.min(1, transformedDistance / 2));
                            
                            if (angularDistance < nebula.size) {
                                let intensity = 0;
                                
                                // Simplified noise patterns for performance
                                const noise1 = Math.abs(this.noise3D(
                                    dir.x * 8 + nebula.seed,
                                    dir.y * 8 + nebula.seed,
                                    dir.z * 8 + nebula.seed
                                ));
                                
                                const noise2 = Math.abs(this.noise3D(
                                    dir.x * 16 + nebula.seed + 100,
                                    dir.y * 16 + nebula.seed + 100,
                                    dir.z * 16 + nebula.seed + 100
                                ));
                                
                                const structure = noise1 * 0.7 + noise2 * 0.3;
                                const falloff = Math.pow(Math.max(0, 1 - angularDistance / nebula.size), 2);
                                intensity = structure * falloff * Math.abs(nebula.intensity);
                                
                                if (nebula.type === 'dark') {
                                    const absorption = intensity;
                                    for (let dy = 0; dy < step && y + dy < this.size; dy++) {
                                        for (let dx = 0; dx < step && x + dx < this.size; dx++) {
                                            const index = ((y + dy) * this.size + (x + dx)) * 4;
                                            data[index] = Math.max(0, data[index] * (1 - absorption));
                                            data[index + 1] = Math.max(0, data[index + 1] * (1 - absorption));
                                            data[index + 2] = Math.max(0, data[index + 2] * (1 - absorption));
                                        }
                                    }
                                } else if (intensity > 0.01) {
                                    const [r, g, b] = this.hslToRgb(nebula.hue, nebula.saturation, 0.4);
                                    totalR += r * intensity;
                                    totalG += g * intensity;
                                    totalB += b * intensity;
                                }
                            }
                        }
                        
                        if (totalR > 0 || totalG > 0 || totalB > 0) {
                            for (let dy = 0; dy < step && y + dy < this.size; dy++) {
                                for (let dx = 0; dx < step && x + dx < this.size; dx++) {
                                    const index = ((y + dy) * this.size + (x + dx)) * 4;
                                    data[index] = Math.max(0, Math.min(255, data[index] + totalR));
                                    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + totalG));
                                    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + totalB));
                                }
                            }
                        }
                    }
                }
            }
            
            // ENHANCED: Apply varied nebula shapes
            applyNebulaShapeTransform(dx, dy, dz, nebula) {
                // Apply rotation
                const cosR = Math.cos(nebula.rotation);
                const sinR = Math.sin(nebula.rotation);
                const rotatedDx = dx * cosR - dy * sinR;
                const rotatedDy = dx * sinR + dy * cosR;
                const rotatedDz = dz;
                
                // Apply elongation based on shape type
                let stretchedDx, stretchedDy, stretchedDz;
                
                switch(nebula.shapeType) {
                    case 0: // Elliptical
                        stretchedDx = rotatedDx / nebula.elongationX;
                        stretchedDy = rotatedDy / nebula.elongationY;
                        stretchedDz = rotatedDz / nebula.elongationZ;
                        break;
                    case 1: // Elongated along one axis
                        stretchedDx = rotatedDx / Math.max(nebula.elongationX, 1);
                        stretchedDy = rotatedDy / 1;
                        stretchedDz = rotatedDz / 1;
                        break;
                    case 2: // Disk-like (flat)
                        stretchedDx = rotatedDx / nebula.elongationX;
                        stretchedDy = rotatedDy / nebula.elongationY;
                        stretchedDz = rotatedDz / 0.3; // Very flat
                        break;
                    case 3: // Spiral/twisted
                        const radius = Math.sqrt(rotatedDx * rotatedDx + rotatedDy * rotatedDy);
                        const angle = Math.atan2(rotatedDy, rotatedDx);
                        const spiralAngle = angle + radius * nebula.twist;
                        stretchedDx = (radius * Math.cos(spiralAngle)) / nebula.elongationX;
                        stretchedDy = (radius * Math.sin(spiralAngle)) / nebula.elongationY;
                        stretchedDz = rotatedDz / nebula.elongationZ;
                        break;
                }
                
                return Math.sqrt(stretchedDx * stretchedDx + stretchedDy * stretchedDy + stretchedDz * stretchedDz);
            }
            
            renderStars3D(face, data, stars) {
                for (const star of stars) {
                    const uv = this.sphereToFace(face, star.x, star.y, star.z);
                    if (uv) {
                        const x = Math.floor(uv.u * (this.size - 1));
                        const y = Math.floor(uv.v * (this.size - 1));
                        
                        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
                            this.addStar(data, x, y, star.r, star.g, star.b, star.brightness, star.size);
                        }
                    }
                }
            }
            
            sphereToFace(face, x, y, z) {
                let u, v;
                let onFace = false;
                
                switch(face) {
                    case 'px':
                        if (x > 0 && Math.abs(y/x) <= 1 && Math.abs(z/x) <= 1) {
                            u = (-z/x + 1) / 2;
                            v = (-y/x + 1) / 2;
                            onFace = true;
                        }
                        break;
                    case 'nx':
                        if (x < 0 && Math.abs(y/x) <= 1 && Math.abs(z/x) <= 1) {
                            u = (z/x + 1) / 2;
                            v = (-y/x + 1) / 2;
                            onFace = true;
                        }
                        break;
                    case 'py':
                        if (y > 0 && Math.abs(x/y) <= 1 && Math.abs(z/y) <= 1) {
                            u = (x/y + 1) / 2;
                            v = (z/y + 1) / 2;
                            onFace = true;
                        }
                        break;
                    case 'ny':
                        if (y < 0 && Math.abs(x/y) <= 1 && Math.abs(z/y) <= 1) {
                            u = (x/y + 1) / 2;
                            v = (-z/y + 1) / 2;
                            onFace = true;
                        }
                        break;
                    case 'pz':
                        if (z > 0 && Math.abs(x/z) <= 1 && Math.abs(y/z) <= 1) {
                            u = (x/z + 1) / 2;
                            v = (-y/z + 1) / 2;
                            onFace = true;
                        }
                        break;
                    case 'nz':
                        if (z < 0 && Math.abs(x/z) <= 1 && Math.abs(y/z) <= 1) {
                            u = (-x/z + 1) / 2;
                            v = (-y/z + 1) / 2;
                            onFace = true;
                        }
                        break;
                }
                
                return onFace ? { u, v } : null;
            }
            
            addStar(data, x, y, r, g, b, brightness, size) {
                const pixelSize = Math.max(0.3, size);
                
                if (pixelSize < 1) {
                    const index = (y * this.size + x) * 4;
                    data[index] = Math.max(0, Math.min(255, data[index] + r * brightness));
                    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + g * brightness));
                    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + b * brightness));
                } else {
                    const radius = Math.floor(pixelSize);
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dy = -radius; dy <= radius; dy++) {
                            const px = x + dx;
                            const py = y + dy;
                            
                            if (px >= 0 && px < this.size && py >= 0 && py < this.size) {
                                const distance = Math.sqrt(dx * dx + dy * dy);
                                const falloff = Math.max(0, 1 - distance / (radius + 0.5));
                                const alpha = brightness * falloff;
                                
                                const index = (py * this.size + px) * 4;
                                data[index] = Math.max(0, Math.min(255, data[index] + r * alpha));
                                data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + g * alpha));
                                data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + b * alpha));
                            }
                        }
                    }
                }
            }
            
            noise3D(x, y, z) {
                const xy = this.noise.noise2D(x, y) * 0.6;
                const xz = this.noise.noise2D(x + 100, z) * 0.4;
                return xy + xz;
            }
            
            hslToRgb(h, s, l) {
                h /= 360;
                const a = s * Math.min(l, 1 - l);
                const f = n => {
                    const k = (n + h * 12) % 12;
                    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                };
                return [f(0) * 255, f(8) * 255, f(4) * 255];
            }
        }
        `;
    }
    
    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
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
            console.error('Program linking error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }
}
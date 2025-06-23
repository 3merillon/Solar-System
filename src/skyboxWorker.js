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

class SkyboxGenerator {
    constructor() {
        this.size = 2048;
        this.noise = new SimplexNoise();
    }

    cubeTexelToDirection(face, x, y, size) {
        // u, v in [-1, 1]
        const u = 2 * (x + 0.5) / size - 1;
        const v = 2 * (y + 0.5) / size - 1;
        let dir;
        switch(face) {
            case 'px': dir = [ 1,   -v,   -u ]; break;
            case 'nx': dir = [-1,   -v,    u ]; break;
            case 'py': dir = [  u,   1,    v ]; break;
            case 'ny': dir = [  u,  -1,   -v ]; break;
            case 'pz': dir = [  u,  -v,    1 ]; break;
            case 'nz': dir = [-u,  -v,   -1 ]; break;
        }
        const len = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);
        return [dir[0]/len, dir[1]/len, dir[2]/len];
    }
    
    generateCubemap() {
        const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
        const textures = {};
        
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            textures[face] = this.generateFace(face);
            
            // Send progress update
            self.postMessage({
                type: 'progress',
                face: face,
                completed: i + 1,
                total: faces.length,
                progress: ((i + 1) / faces.length) * 100
            });
        }
        
        return textures;
    }
    
    generateFace(face) {
        const imageData = new Uint8ClampedArray(this.size * this.size * 4);
        
        // Fill with deep space color
        for (let i = 0; i < imageData.length; i += 4) {
            imageData[i] = 255;     // R
            imageData[i + 1] = 5; // G
            imageData[i + 2] = 16; // B
            imageData[i + 3] = 255; // A
        }
        
        this.generateStarField(face, imageData);
        this.generateMilkyWay(face, imageData);
        this.generateNebulae(face, imageData);
        this.generateDistantGalaxies(face, imageData);
        
        return imageData;
    }
    
    generateStarField(face, data) {
        const baseDensity = this.getStarDensityForFace(face);
        const numStars = Math.floor(baseDensity * this.size * this.size * 0.0008);
        
        for (let i = 0; i < numStars; i++) {
            const x = Math.floor(Math.random() * this.size);
            const y = Math.floor(Math.random() * this.size);
            
            const brightness = Math.pow(Math.random(), 3);
            const temperature = Math.random();
            
            let r, g, b;
            if (temperature < 0.3) {
                r = 255 * brightness;
                g = 180 * brightness * temperature / 0.3;
                b = 120 * brightness * temperature / 0.3;
            } else if (temperature < 0.6) {
                r = 255 * brightness;
                g = 255 * brightness;
                b = 200 * brightness * (temperature - 0.3) / 0.3;
            } else {
                r = 200 * brightness * (1 - (temperature - 0.6) / 0.4);
                g = 220 * brightness;
                b = 255 * brightness;
            }
            
            this.addStar(data, x, y, r, g, b, brightness);
        }
    }
    
    addStar(data, x, y, r, g, b, brightness) {
        const size = brightness > 0.7 ? 2 : 1;
        
        for (let dx = -size; dx <= size; dx++) {
            for (let dy = -size; dy <= size; dy++) {
                const px = x + dx;
                const py = y + dy;
                
                if (px >= 0 && px < this.size && py >= 0 && py < this.size) {
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const falloff = Math.max(0, 1 - distance / (size + 1));
                    const alpha = brightness * falloff;
                    
                    const index = (py * this.size + px) * 4;
                    data[index] = Math.min(255, data[index] + r * alpha);
                    data[index + 1] = Math.min(255, data[index + 1] + g * alpha);
                    data[index + 2] = Math.min(255, data[index + 2] + b * alpha);
                }
            }
        }
    }
    
    generateMilkyWay(face, data) {
        const size = this.size;
        const scale = 6;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const d = this.cubeTexelToDirection(face, x, y, size);

                // Galactic plane = xy plane (z = 0)
                // Milky Way band centered at galactic latitude 0
                const galacticLat = Math.asin(d[2]); // lat = arcsin(z)
                const dist = Math.abs(galacticLat); // radians from plane

                if (dist < 0.5) {
                    // Use 3D-like noise for structure
                    let noise = 0;
                    noise += this.noise.noise2D(d[0]*scale, d[1]*scale) * 0.7;
                    noise += this.noise.noise2D(d[1]*scale, d[2]*scale) * 0.5;
                    noise += this.noise.noise2D(d[2]*scale, d[0]*scale) * 0.3;
                    const bandFalloff = Math.pow(1 - dist/0.5, 2.5);
                    const intensity = Math.max(0, (noise * 0.5 + 0.5)) * bandFalloff * 0.45;

                    data[idx] = Math.min(255, data[idx] + intensity * 200);
                    data[idx+1] = Math.min(255, data[idx+1] + intensity * 180);
                    data[idx+2] = Math.min(255, data[idx+2] + intensity * 160);
                }
            }
        }
    }
    
    generateNebulae(face, data) {
        // Parameters
        const numNebulae = 6;
        const nebulaRadius = 0.6; // radians, ~34 deg
        const size = this.size;
        const scale = 8; // noise scale

        // Precompute random nebula directions/colors
        const nebulae = [];
        let seed = 123456;
        function seededRandom() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        }
        for (let n = 0; n < numNebulae; n++) {
            // Random direction on sphere
            const theta = Math.acos(2 * seededRandom() - 1);
            const phi = 2 * Math.PI * seededRandom();
            const dir = [
                Math.sin(theta) * Math.cos(phi),
                Math.sin(theta) * Math.sin(phi),
                Math.cos(theta)
            ];
            // Random color
            const hue = seededRandom() * 360;
            const [r, g, b] = this.hslToRgb(hue, 0.7, 0.5);
            nebulae.push({dir, r, g, b});
        }

        // For each texel
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const d = this.cubeTexelToDirection(face, x, y, size);

                // For each nebula, sum if close enough
                let nebR = 0, nebG = 0, nebB = 0;
                for (let n = 0; n < nebulae.length; n++) {
                    const neb = nebulae[n];
                    // Angular distance
                    const dot = d[0]*neb.dir[0] + d[1]*neb.dir[1] + d[2]*neb.dir[2];
                    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                    if (angle < nebulaRadius) {
                        // Use 3D-like noise (hack)
                        const noise = Math.abs(this.noise.noise2D(d[0]*scale + n*20, d[1]*scale + n*20));
                        const falloff = Math.pow(1 - angle/nebulaRadius, 2.5);
                        const intensity = noise * falloff * 0.6;
                        nebR += neb.r * intensity;
                        nebG += neb.g * intensity;
                        nebB += neb.b * intensity;
                    }
                }

                data[idx] = Math.min(255, data[idx] + nebR);
                data[idx+1] = Math.min(255, data[idx+1] + nebG);
                data[idx+2] = Math.min(255, data[idx+2] + nebB);
            }
        }
    }
    
    generateDistantGalaxies(face, data) {
        const numGalaxies = Math.floor(Math.random() * 2);
        
        for (let g = 0; g < numGalaxies; g++) {
            const centerX = Math.floor(Math.random() * this.size);
            const centerY = Math.floor(Math.random() * this.size);
            const size = Math.floor(Math.random() * 20 + 10);
            
            for (let y = Math.max(0, centerY - size); y < Math.min(this.size, centerY + size); y++) {
                for (let x = Math.max(0, centerX - size/3); x < Math.min(this.size, centerX + size/3); x++) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < size) {
                        const intensity = Math.max(0, 1 - distance / size) * 0.1;
                        const index = (y * this.size + x) * 4;
                        data[index] = Math.min(255, data[index] + 255 * intensity);
                        data[index + 1] = Math.min(255, data[index + 1] + 240 * intensity);
                        data[index + 2] = Math.min(255, data[index + 2] + 200 * intensity);
                    }
                }
            }
        }
    }
    
    getStarDensityForFace(face) {
        const densities = {
            'px': 1.2, 'nx': 0.8, 'py': 1.0, 'ny': 1.0, 'pz': 1.5, 'nz': 0.9
        };
        return densities[face] || 1.0;
    }
    
    getMilkyWayIntensityForFace(face) {
        const intensities = {
            'px': 0.8, 'nx': 0.6, 'py': 0.3, 'ny': 0.3, 'pz': 1.0, 'nz': 0.7
        };
        return intensities[face] || 0.5;
    }
    
    getMilkyWayBandCenter(face, x, y) {
        const baseCenter = 0.5;
        const curve = Math.sin(x * Math.PI * 2) * 0.1;
        return baseCenter + curve;
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

// Worker message handler
self.onmessage = function(e) {
    if (e.data.type === 'generate') {
        self.postMessage({ type: 'started' });
        
        const generator = new SkyboxGenerator();
        const cubemapData = generator.generateCubemap();
        
        self.postMessage({
            type: 'completed',
            data: cubemapData
        });
    }
};
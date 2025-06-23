export const callistoVertexShaderSource = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPosition;
layout(location=1) in float aMorphable;
layout(location=2) in float aLod;
layout(location=3) in float aMorphFactor;
layout(location=4) in vec3 aEdge0;
layout(location=5) in vec3 aEdge1;

uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;
uniform mediump int uShowLod;
uniform float uTime;
uniform vec3 uPlanetColor;
uniform float uPlanetRadius;
uniform mediump int uHasWaves;
uniform float uNoiseScale;
uniform float uNoiseOffset;
uniform vec3 uCameraPos;
uniform float uLodDistances[12];
uniform int uMaxLod;
uniform float uLogDepthBufFC;

out vec3 vColour;
out vec3 vPos;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out float vLogDepth;
out vec3 vLocalPos;
out float vElevation;
out float vAncientness;
out float vCraterDepth;
out float vMysticAura;

vec3 getLodColor(float l) {
    if(l<.5)      return vec3(0,1,0);
    else if(l<1.5)return vec3(1,1,0);
    else if(l<2.5)return vec3(1,.6,0);
    else if(l<3.5)return vec3(1,0,1);
    else if(l<4.5)return vec3(0.3,0.7,1);
    else if(l<5.5)return vec3(0,1,1);
    else if(l<6.5)return vec3(1,1,1);
    else if(l<7.5)return vec3(1,0.5,0.5);
    else if(l<8.5)return vec3(0.5,1,0.5);
    else if(l<9.5)return vec3(0.5,0.5,1);
    else if(l<10.5)return vec3(1,0.8,0.2);
    else          return vec3(1,0,0);
}

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Ancient cathedral spires! 🏰
float gothicSpire(vec3 n, vec3 center, float radius, float height) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Gothic arch profile
    float archHeight = height * (1.0 - t * t * t);
    
    // Add gothic details
    float gothic = sin(atan(n.z - center.z, n.x - center.x) * 16.0) * 0.01 * archHeight;
    gothic += sin(atan(n.z - center.z, n.x - center.x) * 24.0) * 0.005 * archHeight;
    
    return archHeight + gothic;
}

// Ancient impact craters like cathedral foundations! 
float ancientCrater(vec3 n, vec3 center, float radius, float depth) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Very old, weathered crater profile
    if (t < 0.8) {
        float floor = -depth * (1.0 - t / 0.8);
        
        // Ancient concentric rings
        float rings = sin(t * 25.0) * 0.005 * (1.0 - t / 0.8);
        
        return floor + rings;
    } else {
        // Heavily eroded rim
        float rimFactor = (t - 0.8) / 0.2;
        return depth * 0.1 * (1.0 - rimFactor * rimFactor);
    }
}

// Mystic energy patterns that pulse slowly! ✨
float mysticPatterns(vec3 p, float time) {
    // Slow, mysterious pulsing
    float pulse = sin(time * 0.5) * 0.5 + 0.5;
    
    // Ancient geometric patterns
    float pattern1 = sin(p.x * 6.0 + time * 0.1) * cos(p.z * 5.0 + time * 0.08);
    float pattern2 = sin(p.y * 4.0 + time * 0.06) * cos(p.x * 7.0 + time * 0.05);
    
    // Mysterious spirals
    float spiral = sin(length(p.xz) * 8.0 + atan(p.z, p.x) * 3.0 + time * 0.2);
    
    return (pattern1 + pattern2 + spiral) * 0.003 * pulse;
}

// Ancient weathered terrain
float ancientWeathering(vec3 p) {
    // Very old, heavily weathered surface
    float weathering = 0.0;
    
    // Large scale erosion
    weathering += noise3d(p * 0.8) * 0.02;
    weathering += noise3d(p * 1.5) * 0.01;
    
    // Medium scale pitting
    weathering += noise3d(p * 3.0) * 0.005;
    
    // Fine scale texture
    weathering += noise3d(p * 8.0) * 0.002;
    
    return weathering;
}

float callistoCathedralTerrain(vec3 n, float scale, float offset, out float ancientness, out float craterDepth, out float mysticAura) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    ancientness = 1.0; // Callisto is very ancient
    craterDepth = 0.0;
    mysticAura = 0.0;
    
    // Ancient weathered base
    terrain += ancientWeathering(p);
    
    // Major ancient impact basins - like cathedral foundations
    vec3 valhalla = normalize(vec3(0.6, 0.4, 0.7));
    float valhallaBasin = ancientCrater(n, valhalla, 0.4, 0.08);
    terrain += valhallaBasin;
    if (valhallaBasin < 0.0) {
        craterDepth += (-valhallaBasin) * 12.0;
        mysticAura += 0.8; // Ancient basins are mystical
    }
    
    vec3 asgard = normalize(vec3(-0.5, -0.6, 0.6));
    float asgardBasin = ancientCrater(n, asgard, 0.35, 0.06);
    terrain += asgardBasin;
    if (asgardBasin < 0.0) {
        craterDepth += (-asgardBasin) * 10.0;
        mysticAura += 0.6;
    }
    
    // Smaller ancient craters
    vec3 crater1 = normalize(vec3(0.3, 0.8, -0.5));
    float oldCrater1 = ancientCrater(n, crater1, 0.2, 0.04);
    terrain += oldCrater1;
    if (oldCrater1 < 0.0) {
        craterDepth += (-oldCrater1) * 8.0;
    }
    
    vec3 crater2 = normalize(vec3(-0.7, 0.2, 0.7));
    float oldCrater2 = ancientCrater(n, crater2, 0.18, 0.035);
    terrain += oldCrater2;
    if (oldCrater2 < 0.0) {
        craterDepth += (-oldCrater2) * 7.0;
    }
    
    // Gothic spires rising from the ancient surface! 🏰
    vec3 spire1 = normalize(vec3(0.8, 0.3, 0.5));
    float gothicSpire1 = gothicSpire(n, spire1, 0.15, 0.06);
    terrain += gothicSpire1;
    if (gothicSpire1 > 0.01) {
        ancientness += gothicSpire1 * 8.0;
        mysticAura += gothicSpire1 * 10.0;
    }
    
    vec3 spire2 = normalize(vec3(-0.4, 0.7, -0.6));
    float gothicSpire2 = gothicSpire(n, spire2, 0.12, 0.05);
    terrain += gothicSpire2;
    if (gothicSpire2 > 0.01) {
        ancientness += gothicSpire2 * 6.0;
        mysticAura += gothicSpire2 * 8.0;
    }
    
    vec3 spire3 = normalize(vec3(0.1, -0.9, 0.4));
    float gothicSpire3 = gothicSpire(n, spire3, 0.1, 0.04);
    terrain += gothicSpire3;
    if (gothicSpire3 > 0.01) {
        ancientness += gothicSpire3 * 5.0;
        mysticAura += gothicSpire3 * 6.0;
    }
    
    // Mystic energy patterns
    float mysticTerrain = mysticPatterns(p, uTime);
    terrain += mysticTerrain;
    mysticAura += abs(mysticTerrain) * 100.0;
    
    // Ancient ridges and valleys
    float ancientRidges = sin(p.x * 2.0 + uTime * 0.02) * cos(p.z * 1.8 + uTime * 0.015) * 0.01;
    terrain += ancientRidges;
    
    // Very fine ancient texture
    terrain += noise3d(p * 15.0) * 0.001;
    terrain += noise3d(p * 25.0) * 0.0005;
    
    // Clamp values
    ancientness = clamp(ancientness, 0.5, 2.0); // Always somewhat ancient
    craterDepth = clamp(craterDepth, 0.0, 1.0);
    mysticAura = clamp(mysticAura, 0.0, 1.0);
    terrain = clamp(terrain, -0.06, 0.08);
    
    return terrain;
}

vec3 calculateDisplacedNormal(vec3 n, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(tangent1) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float ancientness, craterDepth, mysticAura;
    float h = callistoCathedralTerrain(n, uNoiseScale, uNoiseOffset, ancientness, craterDepth, mysticAura);
    float h1 = callistoCathedralTerrain(n1, uNoiseScale, uNoiseOffset, ancientness, craterDepth, mysticAura);
    float h2 = callistoCathedralTerrain(n2, uNoiseScale, uNoiseOffset, ancientness, craterDepth, mysticAura);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float ancientness0, ancientness1, craterDepth0, craterDepth1, mysticAura0, mysticAura1;
    float r0 = 1.0 + callistoCathedralTerrain(normalize(e0), uNoiseScale, uNoiseOffset, ancientness0, craterDepth0, mysticAura0);
    float r1 = 1.0 + callistoCathedralTerrain(normalize(e1), uNoiseScale, uNoiseOffset, ancientness1, craterDepth1, mysticAura1);
    
    vec3 p0 = normalize(e0) * r0;
    vec3 p1 = normalize(e1) * r1;
    vec3 edge = p1 - p0;
    
    float edgeDotEdge = dot(edge, edge);
    float edgeDotRay = dot(edge, dir);
    float edgeDotToStart = dot(edge, p0);
    float rayDotToStart = dot(dir, p0);
    float denom = edgeDotEdge - edgeDotRay * edgeDotRay;
    
    float s = 0.5;
    if(abs(denom) > 1e-10) {
        s = (edgeDotRay * rayDotToStart - edgeDotToStart) / denom;
        s = clamp(s, 0.0, 1.0);
    }
    
    vec3 edgePoint = p0 + s * edge;
    return length(edgePoint);
}

vec3 morphTargetNormal(vec3 dir, vec3 e0, vec3 e1, float epsilon) {
    vec3 n0 = calculateDisplacedNormal(normalize(e0), epsilon);
    vec3 n1 = calculateDisplacedNormal(normalize(e1), epsilon);
    
    float ancientness0, ancientness1, craterDepth0, craterDepth1, mysticAura0, mysticAura1;
    float r0 = 1.0 + callistoCathedralTerrain(normalize(e0), uNoiseScale, uNoiseOffset, ancientness0, craterDepth0, mysticAura0);
    float r1 = 1.0 + callistoCathedralTerrain(normalize(e1), uNoiseScale, uNoiseOffset, ancientness1, craterDepth1, mysticAura1);
    
    vec3 p0 = normalize(e0) * r0;
    vec3 p1 = normalize(e1) * r1;
    vec3 edge = p1 - p0;
    
    float edgeDotEdge = dot(edge, edge);
    float edgeDotRay = dot(edge, dir);
    float edgeDotToStart = dot(edge, p0);
    float rayDotToStart = dot(dir, p0);
    float denom = edgeDotEdge - edgeDotRay * edgeDotRay;
    
    float s = 0.5;
    if(abs(denom) > 1e-10) {
        s = (edgeDotRay * rayDotToStart - edgeDotToStart) / denom;
        s = clamp(s, 0.0, 1.0);
    }
    
    return normalize(mix(n0, n1, s));
}

void main() {
    vec3 n = normalize(aPosition);
    vLocalPos = n;
    
    float ancientness, craterDepth, mysticAura;
    float displacement = callistoCathedralTerrain(n, uNoiseScale, uNoiseOffset, ancientness, craterDepth, mysticAura);
    float r0 = uPlanetRadius * (1.0 + displacement);
    vec3 baseNormal = calculateDisplacedNormal(n, 0.01);
    
    float finalRadius = r0;
    vec3 finalNormal = baseNormal;
    
    if(aMorphable > 0.5) {
        float morphR = morphTargetRadius(n, aEdge0, aEdge1) * uPlanetRadius;
        float morphFactor = aMorphable * aMorphFactor;
        morphFactor = morphFactor * morphFactor * (3.0 - 2.0 * morphFactor);
        finalRadius = mix(r0, morphR, morphFactor);
        
        vec3 morphN = morphTargetNormal(n, aEdge0, aEdge1, 0.01);
        finalNormal = normalize(mix(baseNormal, morphN, morphFactor));
    }
    
    vPos = n * finalRadius;
    vWorldPos = (uModel * vec4(vPos, 1.0)).xyz;
    vWorldNormal = normalize(uNormalMatrix * finalNormal);
    vElevation = displacement;
    vAncientness = ancientness;
    vCraterDepth = craterDepth;
    vMysticAura = mysticAura;
    
    if(uShowLod == 1) {
        vColour = getLodColor(aLod);
    } else {
        vColour = uPlanetColor;
    }
    
    vec4 clipPos = uProj * uView * uModel * vec4(vPos, 1.0);
    gl_Position = clipPos;
    
    vLogDepth = 1.0 + clipPos.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= clipPos.w;
}
`;

export const callistoFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vAncientness;
in float vCraterDepth;
in float vMysticAura;

out vec4 fragColor;

uniform vec3 uCameraPos;
uniform float uTime;
uniform float uPlanetRadius;
uniform float uLogDepthBufFC;
uniform vec3 uSunPosition;
uniform float uNoiseScale;
uniform float uNoiseOffset;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

vec3 getCallistoCathedralColors(vec3 localPos, float elevation, float ancientness, float craterDepth, float mysticAura) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Callisto's GOTHIC CATHEDRAL PALETTE! 🏰🌙✨
    vec3 ancientStone = vec3(0.35, 0.32, 0.28);       // Old weathered stone
    vec3 darkGranite = vec3(0.25, 0.22, 0.20);        // Dark gothic stone
    vec3 mysticPurple = vec3(0.4, 0.25, 0.45);        // Mystical purple glow
    vec3 shadowBlack = vec3(0.12, 0.10, 0.08);        // Deep cathedral shadows
    vec3 moonsilver = vec3(0.6, 0.58, 0.55);          // Moonlit silver
    vec3 gothicGold = vec3(0.7, 0.6, 0.3);            // Gothic gold accents
    vec3 voidBlack = vec3(0.08, 0.06, 0.05);          // Abyssal depths
    vec3 etherealBlue = vec3(0.2, 0.3, 0.5);          // Ethereal blue mist
    vec3 ancientBronze = vec3(0.5, 0.4, 0.25);        // Ancient bronze
    
    // Base color depends on ancientness
    vec3 baseColor;
    if (vAncientness > 1.5) {
        baseColor = ancientStone; // Very ancient areas
    } else if (vAncientness > 1.0) {
        baseColor = darkGranite; // Moderately ancient
    } else {
        baseColor = shadowBlack; // Newer (but still old) areas
    }
    
    // CRATER DEPTH = CATHEDRAL DEPTHS! 🏰
    if (vCraterDepth > 0.2) {
        float depthFactor = min(vCraterDepth, 1.0);
        
        // Deep craters are like cathedral crypts
        vec3 cryptColor;
        if (depthFactor > 0.8) {
            cryptColor = voidBlack; // Deepest crypts
        } else if (depthFactor > 0.5) {
            cryptColor = shadowBlack; // Dark depths
        } else {
            cryptColor = darkGranite; // Shallow depressions
        }
        
        baseColor = mix(baseColor, cryptColor, depthFactor * 0.8);
        
        // Ancient concentric patterns in crater floors
        float ringPattern = sin(length(p.xz) * 20.0 + uTime * 0.1) * 0.5 + 0.5;
        if (ringPattern > 0.7 && depthFactor > 0.4) {
            float ringFactor = (ringPattern - 0.7) * 3.33;
            baseColor = mix(baseColor, ancientBronze, ringFactor * depthFactor * 0.3);
        }
    }
    
    // MYSTIC AURA = MAGICAL CATHEDRAL GLOW! ✨🔮
    if (vMysticAura > 0.3) {
        float auraPulse = sin(uTime * 1.5 + p.x * 3.0) * cos(uTime * 1.2 + p.z * 2.5) * 0.5 + 0.5;
        
        vec3 mysticColor;
        if (auraPulse > 0.8) {
            mysticColor = mysticPurple; // Bright mystical glow
        } else if (auraPulse > 0.6) {
            mysticColor = etherealBlue; // Blue ethereal mist
        } else if (auraPulse > 0.4) {
            mysticColor = gothicGold; // Golden mystical light
        } else {
            mysticColor = moonsilver; // Silver moonlight
        }
        
        baseColor = mix(baseColor, mysticColor, vMysticAura * auraPulse * 0.6);
        
        // Mystical energy veins
        float veinPattern = abs(sin(p.x * 12.0 + uTime * 0.5)) * abs(cos(p.z * 10.0 + uTime * 0.4));
        if (veinPattern > 0.85 && vMysticAura > 0.5) {
            float veinFactor = (veinPattern - 0.85) * 6.67;
            baseColor = mix(baseColor, mysticPurple, veinFactor * vMysticAura * 0.4);
        }
    }
    
    // ELEVATION EFFECTS - Gothic architecture!
    if (elevation > 0.04) {
        // High spires catch moonlight
        float spireFactor = (elevation - 0.04) * 12.5;
        baseColor = mix(baseColor, moonsilver, spireFactor * 0.7);
        
        // Gothic spire details
        float spireDetail = sin(p.y * 30.0) * cos(p.x * 25.0) * 0.5 + 0.5;
        if (spireDetail > 0.8) {
            float detailFactor = (spireDetail - 0.8) * 5.0;
            baseColor = mix(baseColor, gothicGold, detailFactor * spireFactor * 0.3);
        }
    } else if (elevation < -0.02) {
        // Deep foundations are darker
        float foundationFactor = (-elevation - 0.02) * 25.0;
        baseColor = mix(baseColor, voidBlack, foundationFactor * 0.8);
    }
    
    // ANCIENT WEATHERING PATTERNS
    float weatheringPattern = noise3d(p * 4.0 + vec3(uTime * 0.02)) * 0.5 + 0.5;
    if (weatheringPattern > 0.6) {
        float weatherFactor = (weatheringPattern - 0.6) * 2.5;
        vec3 weatheredColor = mix(darkGranite, ancientStone, weatherFactor);
        baseColor = mix(baseColor, weatheredColor, weatherFactor * vAncientness * 0.3);
    }
    
    // GOTHIC ARCH PATTERNS 🏰
    float archPattern = abs(sin(atan(p.z, p.x) * 8.0 + uTime * 0.1)) * abs(cos(length(p.xz) * 6.0));
    if (archPattern > 0.75) {
        float archFactor = (archPattern - 0.75) * 4.0;
        baseColor = mix(baseColor, ancientBronze, archFactor * 0.4);
    }
    
    // CATHEDRAL WINDOWS - stained glass effect! 🌈
    float windowPattern = sin(p.x * 8.0 + uTime * 0.3) * sin(p.z * 6.0 + uTime * 0.25);
    if (abs(windowPattern) > 0.8 && vMysticAura > 0.4) {
        float windowFactor = (abs(windowPattern) - 0.8) * 5.0;
        
        // Stained glass colors
        float glassPhase = atan(p.z, p.x) + uTime * 0.5;
        vec3 glassColor;
        float phase = mod(glassPhase, 6.28);
        
        if (phase < 2.09) {
            glassColor = vec3(0.6, 0.2, 0.8); // Purple glass
        } else if (phase < 4.19) {
            glassColor = vec3(0.2, 0.4, 0.8); // Blue glass
        } else {
            glassColor = vec3(0.8, 0.6, 0.2); // Amber glass
        }
        
        baseColor = mix(baseColor, glassColor, windowFactor * vMysticAura * 0.3);
    }
    
    // MOONBEAM EFFECTS 🌙
    float moonbeam = sin(p.y * 2.0 + uTime * 0.2) * cos(p.x * 1.5 + uTime * 0.15) * 0.5 + 0.5;
    if (moonbeam > 0.7) {
        float beamFactor = (moonbeam - 0.7) * 3.33;
        baseColor = mix(baseColor, moonsilver, beamFactor * 0.25);
    }
    
    // GARGOYLE SHADOWS 👹
    float gargoylePattern = noise3d(p * 6.0 + vec3(uTime * 0.05)) * 0.5 + 0.5;
    if (gargoylePattern < 0.3 && vAncientness > 1.2) {
        float shadowFactor = (0.3 - gargoylePattern) * 3.33;
        baseColor = mix(baseColor, shadowBlack, shadowFactor * 0.6);
    }
    
    // ANCIENT RUNES AND INSCRIPTIONS ✨
    float runePattern = abs(sin(p.x * 20.0)) * abs(sin(p.z * 18.0)) * abs(sin(p.y * 15.0));
    if (runePattern > 0.9 && vMysticAura > 0.6) {
        float runeFactor = (runePattern - 0.9) * 10.0;
        baseColor = mix(baseColor, gothicGold, runeFactor * vMysticAura * 0.4);
    }
    
    // COSMIC DUST ACCUMULATION 🌌
    float dustPattern = noise3d(p * 8.0 + vec3(uTime * 0.01)) * 0.5 + 0.5;
    if (dustPattern > 0.8) {
        float dustFactor = (dustPattern - 0.8) * 5.0;
        vec3 dustColor = mix(shadowBlack, darkGranite, dustFactor);
        baseColor = mix(baseColor, dustColor, dustFactor * 0.2);
    }
    
    // FINE CATHEDRAL TEXTURE - like carved stone! 🏰
    float stoneTexture = noise3d(p * 30.0) * 0.05;
    baseColor += vec3(stoneTexture * 0.1, stoneTexture * 0.08, stoneTexture * 0.06);
    
    // ETHEREAL MIST EFFECTS 👻
    float mistPattern = sin(p.x * 1.0 + uTime * 0.3) * cos(p.z * 0.8 + uTime * 0.25) * 0.5 + 0.5;
    if (mistPattern > 0.8 && vMysticAura > 0.3) {
        float mistFactor = (mistPattern - 0.8) * 5.0;
        baseColor += vec3(0.05, 0.08, 0.12) * mistFactor * vMysticAura;
    }
    
    return clamp(baseColor, vec3(0.05), vec3(0.8)); // Keep it gothic and dark
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(0.4, 0.4, 0.4)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that ancient gothic cathedral surface! 🏰🌙
    vec3 baseColor = getCallistoCathedralColors(vLocalPos, vElevation, vAncientness, vCraterDepth, vMysticAura);
    
    // Gothic cathedral lighting! 🕯️
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Gothic lighting model - dramatic shadows and highlights
    float ambient = 0.15 + vMysticAura * 0.1; // Low ambient, mystical areas glow
    float diffuse = 0.6 * NdotL * attenuation;
    
    // Ancient stone has subtle specular
    float specular = 0.0;
    if (vAncientness > 1.0) {
        vec3 R = reflect(-L, N);
        float RdotV = max(0.0, dot(R, V));
        specular = pow(RdotV, 64.0) * 0.15 * attenuation * (vAncientness - 1.0);
    }
    
    // Mystical glow from within! ✨
    float innerGlow = 0.0;
    if (vMysticAura > 0.5) {
        float glowPulse = sin(uTime * 2.0) * 0.3 + 0.7;
        innerGlow = (vMysticAura - 0.5) * 0.1 * glowPulse;
    }
    
    // Jupiter's distant light (very subtle)
    float jupiterGlow = 0.05 * attenuation;
    vec3 jupiterTint = vec3(1.05, 0.98, 0.95);
    
    vec3 finalColor = baseColor * (ambient + diffuse) * jupiterTint + vec3(specular) + vec3(innerGlow);
    finalColor += baseColor * jupiterGlow;
    
    // Mystical aura emission
    if (vMysticAura > 0.6) {
        float emission = (vMysticAura - 0.6) * 0.08;
        finalColor += vec3(emission * 0.8, emission * 0.5, emission * 1.2);
    }
    
    // Gothic cathedral shadows
    float shadowDepth = 1.0 - NdotL;
    if (shadowDepth > 0.7) {
        float shadowFactor = (shadowDepth - 0.7) * 3.33;
        finalColor *= (1.0 - shadowFactor * 0.4);
    }
    
    // Gothic-appropriate gamma (dark and moody)
    finalColor = pow(finalColor, vec3(1.1));
    
    // Ancient, mystical color tint! 🏰✨
    finalColor *= vec3(0.95, 0.97, 1.05);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createCallistoUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1i(uniforms.uShowLod, showLod ? 1 : 0);
        gl.uniform1f(uniforms.uTime, time);
        gl.uniform3fv(uniforms.uPlanetColor, new Float32Array(body.color));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform1i(uniforms.uHasWaves, body.waveType || 0);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 22.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
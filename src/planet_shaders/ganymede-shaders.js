export const ganymedeVertexShaderSource = `#version 300 es
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
out float vIceShimmer;
out float vRockGrooves;
out float vDiscoFactor;

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

// Disco ball facets that shimmer! ✨🕺
float discoFacets(vec3 p, float time) {
    // Hexagonal disco ball pattern
    float hex1 = sin(p.x * 12.0 + time * 2.0) * cos(p.z * 10.0 + time * 1.8);
    float hex2 = sin(p.y * 8.0 + time * 1.5) * cos(p.x * 14.0 + time * 2.2);
    
    // Rotating mirror facets
    float rotation = time * 3.0;
    float facet1 = sin(p.x * 15.0 + rotation) * sin(p.z * 13.0 + rotation * 0.8);
    float facet2 = cos(p.y * 11.0 + rotation * 0.6) * cos(p.x * 9.0 + rotation * 1.2);
    
    float disco = (hex1 + hex2 + facet1 + facet2) * 0.008;
    
    // Pulsing disco beat! 🎵
    float beat = sin(time * 4.0) * 0.003;
    
    return disco + beat;
}

// Groovy crater system with funky patterns! 🌙
float groovyCrater(vec3 n, vec3 center, float radius, float depth) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Groovy spiral pattern in crater
    float spiral = sin(atan(n.z - center.z, n.x - center.x) * 8.0 + uTime * 2.0);
    
    if (t < 0.6) {
        // Crater floor with disco pattern
        float floor = -depth * (1.0 - t / 0.6);
        floor += spiral * 0.005 * (1.0 - t / 0.6);
        return floor;
    } else {
        // Groovy rim with undulations
        float rimFactor = (t - 0.6) / 0.4;
        float rim = depth * 0.4 * (1.0 - rimFactor);
        rim += sin(atan(n.z - center.z, n.x - center.x) * 12.0) * 0.01 * (1.0 - rimFactor);
        return rim;
    }
}

// Shimmering ice patches like mirror balls! ✨
float shimmerIcePatches(vec3 n, vec3 p, float time) {
    float ice = 0.0;
    
    // Large shimmering regions
    float shimmer1 = noise3d(p * 1.5 + vec3(time * 0.3));
    if (shimmer1 > 0.6) {
        float shimmerHeight = (shimmer1 - 0.6) * 0.02;
        ice += shimmerHeight;
        
        // Add disco sparkles
        float sparkle = sin(p.x * 20.0 + time * 5.0) * cos(p.z * 18.0 + time * 4.5);
        ice += sparkle * 0.003 * shimmerHeight * 5.0;
    }
    
    // Medium ice patches
    float shimmer2 = noise3d(p * 2.5 + vec3(time * 0.2));
    if (shimmer2 > 0.7) {
        ice += (shimmer2 - 0.7) * 0.015;
    }
    
    return ice;
}

// Groovy rock terrain with rhythm! 🎸
float groovyRockTerrain(vec3 p, float time) {
    // Rock ridges that pulse to the beat
    float beat = sin(time * 3.0) * 0.5 + 0.5;
    
    float ridges = 0.0;
    ridges += sin(p.x * 4.0 + time * 1.0) * cos(p.z * 3.5 + time * 0.8) * 0.02 * beat;
    ridges += sin(p.y * 5.0 + time * 1.2) * cos(p.x * 4.5 + time * 0.9) * 0.015 * beat;
    
    // Wavy rock formations
    float waves = sin(p.x * 2.0 + time * 0.5) * sin(p.z * 1.8 + time * 0.4) * 0.01;
    
    return ridges + waves;
}

float ganymedeDiscoTerrain(vec3 n, float scale, float offset, out float iceShimmer, out float rockGrooves, out float discoFactor) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    iceShimmer = 0.0;
    rockGrooves = 0.0;
    discoFactor = 0.0;
    
    // Disco ball facet effects
    terrain += discoFacets(p, uTime);
    discoFactor = abs(sin(p.x * 10.0 + uTime * 2.0)) * abs(cos(p.z * 8.0 + uTime * 1.8));
    
    // Major groovy craters - like dance floors! 🕺
    vec3 crater1 = normalize(vec3(0.7, 0.4, 0.6));
    float groovyCrater1 = groovyCrater(n, crater1, 0.25, 0.08);
    terrain += groovyCrater1;
    if (groovyCrater1 < 0.0) {
        discoFactor += 0.8; // Crater floors are extra disco!
    }
    
    vec3 crater2 = normalize(vec3(-0.5, -0.6, 0.6));
    float groovyCrater2 = groovyCrater(n, crater2, 0.2, 0.06);
    terrain += groovyCrater2;
    if (groovyCrater2 < 0.0) {
        discoFactor += 0.6;
    }
    
    vec3 crater3 = normalize(vec3(0.3, 0.8, -0.5));
    float groovyCrater3 = groovyCrater(n, crater3, 0.18, 0.05);
    terrain += groovyCrater3;
    if (groovyCrater3 < 0.0) {
        discoFactor += 0.5;
    }
    
    // Shimmering ice regions
    float icePatches = shimmerIcePatches(n, p, uTime);
    terrain += icePatches;
    iceShimmer = icePatches * 20.0;
    
    // Groovy rock terrain
    float rockTerrain = groovyRockTerrain(p, uTime);
    terrain += rockTerrain;
    rockGrooves = abs(rockTerrain) * 15.0;
    
    // Magnetic field effects - wavy patterns! 🌊
    float magnetic = sin(p.x * 1.5 + uTime * 0.3) * cos(p.y * 1.2 + uTime * 0.25) * 0.005;
    terrain += magnetic;
    
    // Tidal bulging from Jupiter
    float tidalBulge = sin(p.x * 0.8 + uTime * 0.1) * sin(p.z * 0.6 + uTime * 0.08) * 0.008;
    terrain += tidalBulge;
    
    // Groovy surface texture - like vinyl records! 🎵
    float vinylGrooves = sin(length(p.xz) * 25.0 + uTime * 1.0) * 0.002;
    terrain += vinylGrooves;
    rockGrooves += abs(vinylGrooves) * 10.0;
    
    // Fine disco sparkle texture
    terrain += noise3d(p * 12.0 + vec3(uTime * 0.1)) * 0.003;
    terrain += noise3d(p * 18.0 + vec3(uTime * 0.05)) * 0.0015;
    
    // Clamp values
    iceShimmer = clamp(iceShimmer, 0.0, 1.0);
    rockGrooves = clamp(rockGrooves, 0.0, 1.0);
    discoFactor = clamp(discoFactor, 0.0, 1.0);
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
    
    float iceShimmer, rockGrooves, discoFactor;
    float h = ganymedeDiscoTerrain(n, uNoiseScale, uNoiseOffset, iceShimmer, rockGrooves, discoFactor);
    float h1 = ganymedeDiscoTerrain(n1, uNoiseScale, uNoiseOffset, iceShimmer, rockGrooves, discoFactor);
    float h2 = ganymedeDiscoTerrain(n2, uNoiseScale, uNoiseOffset, iceShimmer, rockGrooves, discoFactor);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float iceShimmer0, iceShimmer1, rockGrooves0, rockGrooves1, discoFactor0, discoFactor1;
    float r0 = 1.0 + ganymedeDiscoTerrain(normalize(e0), uNoiseScale, uNoiseOffset, iceShimmer0, rockGrooves0, discoFactor0);
    float r1 = 1.0 + ganymedeDiscoTerrain(normalize(e1), uNoiseScale, uNoiseOffset, iceShimmer1, rockGrooves1, discoFactor1);
    
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
    
    float iceShimmer0, iceShimmer1, rockGrooves0, rockGrooves1, discoFactor0, discoFactor1;
    float r0 = 1.0 + ganymedeDiscoTerrain(normalize(e0), uNoiseScale, uNoiseOffset, iceShimmer0, rockGrooves0, discoFactor0);
    float r1 = 1.0 + ganymedeDiscoTerrain(normalize(e1), uNoiseScale, uNoiseOffset, iceShimmer1, rockGrooves1, discoFactor1);
    
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
    
    float iceShimmer, rockGrooves, discoFactor;
    float displacement = ganymedeDiscoTerrain(n, uNoiseScale, uNoiseOffset, iceShimmer, rockGrooves, discoFactor);
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
    vIceShimmer = iceShimmer;
    vRockGrooves = rockGrooves;
    vDiscoFactor = discoFactor;
    
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

export const ganymedeFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vIceShimmer;
in float vRockGrooves;
in float vDiscoFactor;

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

vec3 getGanymedeDiscoColors(vec3 localPos, float elevation, float iceShimmer, float rockGrooves, float discoFactor) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Ganymede's DISCO PALETTE! 🕺✨💫
    vec3 mirrorSilver = vec3(0.9, 0.95, 1.0);        // Shiny mirror facets
    vec3 discoGold = vec3(1.0, 0.9, 0.3);            // Golden disco highlights
    vec3 funkPurple = vec3(0.7, 0.4, 0.9);           // Funky purple grooves
    vec3 groovyBlue = vec3(0.3, 0.6, 0.9);           // Groovy blue ice
    vec3 rockBrown = vec3(0.5, 0.4, 0.3);            // Brown rocky areas
    vec3 shimmerWhite = vec3(0.95, 0.98, 1.0);       // Shimmering white ice
    vec3 discoRed = vec3(0.9, 0.3, 0.4);             // Hot disco red
    vec3 neonGreen = vec3(0.4, 0.9, 0.5);            // Neon green accents
    vec3 cosmicBlack = vec3(0.15, 0.12, 0.18);       // Deep space black
    
    // Base color depends on terrain type
    vec3 baseColor = rockBrown; // Start with rocky base
    
    // ICE SHIMMER = MIRROR BALL EFFECTS! ✨
    if (vIceShimmer > 0.2) {
        float shimmerPulse = sin(uTime * 6.0 + p.x * 15.0) * cos(uTime * 5.5 + p.z * 12.0) * 0.5 + 0.5;
        
        vec3 shimmerColor;
        if (shimmerPulse > 0.8) {
            shimmerColor = mirrorSilver; // Bright mirror flash!
        } else if (shimmerPulse > 0.6) {
            shimmerColor = discoGold; // Golden sparkle!
        } else if (shimmerPulse > 0.4) {
            shimmerColor = groovyBlue; // Blue ice shimmer
        } else {
            shimmerColor = shimmerWhite; // White ice
        }
        
        baseColor = mix(baseColor, shimmerColor, vIceShimmer * 0.8);
        
        // Extra disco sparkles! ✨
        float extraSparkle = abs(sin(p.x * 25.0 + uTime * 8.0)) * abs(cos(p.z * 20.0 + uTime * 7.0));
        if (extraSparkle > 0.9) {
            float sparkleFactor = (extraSparkle - 0.9) * 10.0;
            baseColor = mix(baseColor, mirrorSilver, sparkleFactor * vIceShimmer * 0.6);
        }
    }
    
    // ROCK GROOVES = VINYL RECORD PATTERNS! 🎵
    if (vRockGrooves > 0.2) {
        float groovePattern = sin(length(p.xz) * 30.0 + uTime * 2.0) * 0.5 + 0.5;
        
        vec3 grooveColor;
        if (groovePattern > 0.7) {
            grooveColor = funkPurple; // Purple funk grooves!
        } else if (groovePattern > 0.4) {
            grooveColor = rockBrown; // Standard rock
        } else {
            grooveColor = cosmicBlack; // Deep grooves
        }
        
        baseColor = mix(baseColor, grooveColor, vRockGrooves * 0.6);
        
        // Vinyl shine effect
        float vinylShine = abs(sin(p.x * 40.0)) * abs(cos(p.z * 35.0));
        if (vinylShine > 0.85) {
            float shineFactor = (vinylShine - 0.85) * 6.67;
            baseColor = mix(baseColor, discoGold, shineFactor * vRockGrooves * 0.4);
        }
    }
    
    // DISCO FACTOR = DANCE FLOOR MADNESS! 🕺💃
    if (vDiscoFactor > 0.3) {
        float discoTime = uTime * 4.0 + p.x * 10.0 + p.z * 8.0;
        float discoBeat = sin(discoTime) * cos(discoTime * 1.3) * 0.5 + 0.5;
        
        // Rotating disco colors!
        vec3 discoColor;
        float colorPhase = mod(discoTime * 0.1, 6.28);
        
        if (colorPhase < 1.05) {
            discoColor = discoRed; // Red phase
        } else if (colorPhase < 2.09) {
            discoColor = discoGold; // Gold phase
        } else if (colorPhase < 3.14) {
            discoColor = neonGreen; // Green phase
        } else if (colorPhase < 4.19) {
            discoColor = groovyBlue; // Blue phase
        } else if (colorPhase < 5.24) {
            discoColor = funkPurple; // Purple phase
        } else {
            discoColor = mirrorSilver; // Silver phase
        }
        
        baseColor = mix(baseColor, discoColor, vDiscoFactor * discoBeat * 0.7);
        
        // Strobe light effect! 💡
        float strobe = step(0.8, sin(uTime * 12.0));
        if (strobe > 0.5) {
            baseColor += vec3(0.3, 0.3, 0.3) * vDiscoFactor;
        }
    }
    
    // ELEVATION EFFECTS
    if (elevation > 0.04) {
        // High areas - disco ball peaks!
        float peakFactor = (elevation - 0.04) * 12.5;
        baseColor = mix(baseColor, mirrorSilver, peakFactor * 0.8);
    } else if (elevation < -0.02) {
        // Low areas - groovy valleys
        float valleyFactor = (-elevation - 0.02) * 25.0;
        baseColor = mix(baseColor, cosmicBlack, valleyFactor * 0.6);
    }
    
    // MAGNETIC FIELD AURORA EFFECTS! 🌈
    float auroraPattern = sin(p.y * 3.0 + uTime * 1.5) * cos(p.x * 2.5 + uTime * 1.2);
    if (abs(auroraPattern) > 0.7) {
        float auroraFactor = (abs(auroraPattern) - 0.7) * 3.33;
        vec3 auroraColor = mix(neonGreen, funkPurple, sin(uTime * 2.0) * 0.5 + 0.5);
        baseColor = mix(baseColor, auroraColor, auroraFactor * 0.3);
    }
    
    // DISCO BALL FACET REFLECTIONS! 🪩
    float facetPattern = abs(sin(p.x * 20.0 + uTime * 3.0)) * abs(cos(p.z * 18.0 + uTime * 2.8));
    if (facetPattern > 0.8) {
        float facetFactor = (facetPattern - 0.8) * 5.0;
        
        // Rainbow reflection based on angle
        float rainbowPhase = atan(p.z, p.x) + uTime * 2.0;
        vec3 rainbowColor;
        float phase = mod(rainbowPhase, 6.28);
        
        if (phase < 1.05) {
            rainbowColor = vec3(1.0, 0.3, 0.3); // Red
        } else if (phase < 2.09) {
            rainbowColor = vec3(1.0, 0.8, 0.3); // Orange
        } else if (phase < 3.14) {
            rainbowColor = vec3(1.0, 1.0, 0.3); // Yellow
        } else if (phase < 4.19) {
            rainbowColor = vec3(0.3, 1.0, 0.3); // Green
        } else if (phase < 5.24) {
            rainbowColor = vec3(0.3, 0.6, 1.0); // Blue
        } else {
            rainbowColor = vec3(0.8, 0.3, 1.0); // Purple
        }
        
        baseColor = mix(baseColor, rainbowColor, facetFactor * 0.5);
    }
    
    // TIDAL HEATING GLOW
    float tidalGlow = sin(p.x * 1.0 + uTime * 0.2) * cos(p.z * 0.8 + uTime * 0.15) * 0.5 + 0.5;
    if (tidalGlow > 0.8) {
        float glowFactor = (tidalGlow - 0.8) * 5.0;
        baseColor += vec3(0.1, 0.05, 0.15) * glowFactor;
    }
    
    // FINE DISCO TEXTURE - like glitter! ✨
    float glitter = noise3d(p * 40.0 + vec3(uTime * 0.5)) * 0.1;
    baseColor += vec3(glitter * 0.2, glitter * 0.15, glitter * 0.25);
    
    // PSYCHEDELIC SWIRLS! 🌀
    float swirlPattern = sin(length(p) * 8.0 + uTime * 3.0) * cos(atan(p.z, p.x) * 6.0 + uTime * 2.5);
    if (abs(swirlPattern) > 0.75) {
        float swirlFactor = (abs(swirlPattern) - 0.75) * 4.0;
        vec3 swirlColor = mix(funkPurple, neonGreen, sin(uTime * 4.0) * 0.5 + 0.5);
        baseColor = mix(baseColor, swirlColor, swirlFactor * 0.25);
    }
    
    return clamp(baseColor, vec3(0.05), vec3(1.5)); // Allow overbright for disco effects!
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(0.7, 0.6, 0.5)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that groovy disco ball surface! 🕺✨
    vec3 baseColor = getGanymedeDiscoColors(vLocalPos, vElevation, vIceShimmer, vRockGrooves, vDiscoFactor);
    
    // Disco ball lighting! 🪩💡
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Disco lighting model - lots of sparkle!
    float ambient = 0.25 + vDiscoFactor * 0.15; // Extra ambient for disco areas
    float diffuse = 0.7 * NdotL * attenuation;
    
    // Multi-colored specular highlights! 🌈
    vec3 R = reflect(-L, N);
    float RdotV = max(0.0, dot(R, V));
    
    // Different specular for different surface types
    float specularPower = 16.0;
    float specularIntensity = 0.4;
    
    if (vIceShimmer > 0.5) {
        specularPower = 64.0; // Very shiny ice
        specularIntensity = 0.8;
    } else if (vDiscoFactor > 0.5) {
        specularPower = 32.0; // Disco ball facets
        specularIntensity = 0.6;
    }
    
    float specular = pow(RdotV, specularPower) * specularIntensity * attenuation;
    
    // Disco ball rainbow specular! 🌈
    vec3 specularColor = vec3(1.0);
    if (vDiscoFactor > 0.3) {
        float rainbowPhase = atan(N.z, N.x) + uTime * 3.0;
        float r = sin(rainbowPhase) * 0.5 + 0.5;
        float g = sin(rainbowPhase + 2.09) * 0.5 + 0.5;
        float b = sin(rainbowPhase + 4.19) * 0.5 + 0.5;
        specularColor = vec3(r, g, b);
    }
    
    // Fresnel effect for ice
    float fresnel = 0.0;
    if (vIceShimmer > 0.2) {
        fresnel = pow(1.0 - NdotV, 3.0) * 0.4 * vIceShimmer;
    }
    
    // Jupiter's warm reflected light
    float jupiterGlow = 0.1 * attenuation;
    vec3 jupiterTint = vec3(1.1, 0.95, 0.9);
    
    vec3 finalColor = baseColor * (ambient + diffuse) * jupiterTint + specularColor * specular + vec3(fresnel);
    finalColor += baseColor * jupiterGlow;
    
    // Disco strobe effects! 💡
    if (vDiscoFactor > 0.6) {
        float strobeTime = uTime * 8.0;
        float strobe = step(0.7, sin(strobeTime)) * step(0.7, cos(strobeTime * 1.3));
        finalColor += vec3(strobe * 0.3) * vDiscoFactor;
    }
    
    // Magnetic field particle glow
    float magneticGlow = sin(uTime * 2.0 + vLocalPos.y * 5.0) * 0.05;
    finalColor += vec3(magneticGlow * 0.2, magneticGlow * 0.4, magneticGlow * 0.6);
    
    // Disco-appropriate gamma (bright and punchy!)
    finalColor = pow(finalColor, vec3(0.8));
    
    // Groovy color enhancement! 🕺
    finalColor *= vec3(1.05, 1.0, 1.08);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createGanymedeUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 18.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
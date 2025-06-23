export const deimosVertexShaderSource = `#version 300 es
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
out vec2 vTexCoord;
out float vRockiness;
out float vBoulderFactor;

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

// Ridged noise for rocky edges
float ridgedNoise(vec3 p) {
    return 1.0 - abs(noise3d(p) * 2.0 - 1.0);
}

// Voronoi-like noise for rock boundaries
float voronoiNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    
    float minDist = 1.0;
    for(int x = -1; x <= 1; x++) {
        for(int y = -1; y <= 1; y++) {
            for(int z = -1; z <= 1; z++) {
                vec3 neighbor = vec3(float(x), float(y), float(z));
                vec3 point = hash(i + neighbor) * vec3(0.8, 0.8, 0.8) + neighbor;
                float dist = length(point - f);
                minDist = min(minDist, dist);
            }
        }
    }
    return minDist;
}

// Create individual rock shapes using 3D noise
float getRockShape(vec3 n, vec3 offset, float size, float sharpness) {
    vec3 rockPos = n + offset;
    float dist = length(rockPos);
    
    if (dist > size) return 0.0;
    
    // Rock profile with noise-based irregularity
    float rockProfile = 1.0 - (dist / size);
    rockProfile = pow(rockProfile, sharpness);
    
    // Add rocky surface detail
    vec3 noisePos = rockPos * 8.0;
    float rockDetail = ridgedNoise(noisePos) * 0.3 + 0.7;
    rockDetail *= noise3d(noisePos * 2.0) * 0.5 + 0.5;
    
    return rockProfile * rockDetail;
}

// Pile of rocks terrain using 3D noise to place and shape rocks
float rockPileTerrain(vec3 n, float scale, float offset, out float rockiness, out float boulderFactor) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    rockiness = 0.0;
    boulderFactor = 0.0;
    
    // Base irregular shape - not perfectly round like a rubble pile
    float baseShape = 0.0;
    baseShape += noise3d(p * 0.8 + vec3(100.0)) * 0.15;
    baseShape += noise3d(p * 1.6 + vec3(200.0)) * 0.08;
    baseShape += ridgedNoise(p * 2.4 + vec3(300.0)) * 0.05;
    
    terrain += baseShape;
    
    // LARGE BOULDERS - individual rocks sticking out
    // Boulder 1 - big one
    vec3 boulder1Offset = normalize(vec3(0.6, 0.4, 0.7)) * 0.3;
    float boulder1 = getRockShape(n, boulder1Offset, 0.25, 2.0) * 0.18;
    if (boulder1 > 0.01) {
        terrain += boulder1;
        boulderFactor += boulder1 * 5.0;
        rockiness += boulder1 * 3.0;
    }
    
    // Boulder 2 - medium
    vec3 boulder2Offset = normalize(vec3(-0.7, 0.2, -0.5)) * 0.25;
    float boulder2 = getRockShape(n, boulder2Offset, 0.2, 2.5) * 0.14;
    if (boulder2 > 0.01) {
        terrain += boulder2;
        boulderFactor += boulder2 * 4.0;
        rockiness += boulder2 * 2.5;
    }
    
    // Boulder 3 - smaller
    vec3 boulder3Offset = normalize(vec3(0.2, -0.8, 0.3)) * 0.2;
    float boulder3 = getRockShape(n, boulder3Offset, 0.15, 3.0) * 0.1;
    if (boulder3 > 0.01) {
        terrain += boulder3;
        boulderFactor += boulder3 * 3.0;
        rockiness += boulder3 * 2.0;
    }
    
    // Boulder 4 - angular one
    vec3 boulder4Offset = normalize(vec3(-0.3, -0.6, 0.8)) * 0.22;
    float boulder4 = getRockShape(n, boulder4Offset, 0.18, 4.0) * 0.12;
    if (boulder4 > 0.01) {
        terrain += boulder4;
        boulderFactor += boulder4 * 3.5;
        rockiness += boulder4 * 2.2;
    }
    
    // Boulder 5 - tiny one
    vec3 boulder5Offset = normalize(vec3(0.8, -0.2, -0.6)) * 0.15;
    float boulder5 = getRockShape(n, boulder5Offset, 0.12, 3.5) * 0.08;
    if (boulder5 > 0.01) {
        terrain += boulder5;
        boulderFactor += boulder5 * 2.5;
        rockiness += boulder5 * 1.8;
    }
    
    // MEDIUM ROCKS - scattered around
    for(int i = 0; i < 8; i++) {
        float seed = float(i) * 23.7 + 50.0;
        vec3 rockOffset = normalize(vec3(
            hash(vec3(seed + 1.1)) * 2.0 - 1.0,
            hash(vec3(seed + 2.2)) * 2.0 - 1.0,
            hash(vec3(seed + 3.3)) * 2.0 - 1.0
        )) * (0.1 + hash(vec3(seed + 4.4)) * 0.2);
        
        float rockSize = 0.08 + hash(vec3(seed + 5.5)) * 0.06;
        float rockSharpness = 2.0 + hash(vec3(seed + 6.6)) * 2.0;
        float rockHeight = 0.04 + hash(vec3(seed + 7.7)) * 0.04;
        
        float rock = getRockShape(n, rockOffset, rockSize, rockSharpness) * rockHeight;
        if (rock > 0.005) {
            terrain += rock;
            rockiness += rock * 2.0;
            boulderFactor += rock * 1.5;
        }
    }
    
    // ROCK FRAGMENTS AND RUBBLE - using Voronoi-like patterns
    float voronoi = voronoiNoise(p * 6.0 + vec3(400.0));
    float rubble = (1.0 - voronoi) * 0.02;
    rubble *= noise3d(p * 8.0 + vec3(500.0)) * 0.5 + 0.5;
    terrain += rubble;
    rockiness += rubble * 10.0;
    
    // ANGULAR ROCK FACES - using ridged noise
    float angularFaces = ridgedNoise(p * 4.0 + vec3(600.0));
    angularFaces = pow(max(0.0, angularFaces - 0.6), 2.0) * 0.015;
    terrain += angularFaces;
    rockiness += angularFaces * 8.0;
    
    // ROCK CREVICES AND GAPS
    float crevices = noise3d(p * 5.0 + vec3(700.0));
    if (crevices < 0.3) {
        float creviceDepth = (0.3 - crevices) * 0.02;
        terrain -= creviceDepth;
    }
    
    // FINE ROCKY DETAIL
    float fineDetail = 0.0;
    fineDetail += ridgedNoise(p * 12.0) * 0.008;
    fineDetail += noise3d(p * 16.0) * 0.004;
    fineDetail += noise3d(p * 24.0) * 0.002;
    terrain += fineDetail;
    rockiness += fineDetail * 15.0;
    
    // Clamp values
    rockiness = clamp(rockiness, 0.0, 1.0);
    boulderFactor = clamp(boulderFactor, 0.0, 1.0);
    
    // Conservative terrain limits for a rubble pile
    terrain = clamp(terrain, -0.08, 0.25);
    
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
    
    float rockiness, boulderFactor;
    float h = rockPileTerrain(n, uNoiseScale, uNoiseOffset, rockiness, boulderFactor);
    float h1 = rockPileTerrain(n1, uNoiseScale, uNoiseOffset, rockiness, boulderFactor);
    float h2 = rockPileTerrain(n2, uNoiseScale, uNoiseOffset, rockiness, boulderFactor);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float rockiness0, rockiness1, boulderFactor0, boulderFactor1;
    float r0 = 1.0 + rockPileTerrain(normalize(e0), uNoiseScale, uNoiseOffset, rockiness0, boulderFactor0);
    float r1 = 1.0 + rockPileTerrain(normalize(e1), uNoiseScale, uNoiseOffset, rockiness1, boulderFactor1);
    
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
    
    float rockiness0, rockiness1, boulderFactor0, boulderFactor1;
    float r0 = 1.0 + rockPileTerrain(normalize(e0), uNoiseScale, uNoiseOffset, rockiness0, boulderFactor0);
    float r1 = 1.0 + rockPileTerrain(normalize(e1), uNoiseScale, uNoiseOffset, rockiness1, boulderFactor1);
    
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
    
    float rockiness, boulderFactor;
    float displacement = rockPileTerrain(n, uNoiseScale, uNoiseOffset, rockiness, boulderFactor);
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
    vRockiness = rockiness;
    vBoulderFactor = boulderFactor;
    
    vTexCoord = vec2(
        atan(n.z, n.x) / (2.0 * 3.14159) + 0.5,
        asin(clamp(n.y, -1.0, 1.0)) / 3.14159 + 0.5
    );
    
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

export const deimosFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in vec2 vTexCoord;
in float vRockiness;
in float vBoulderFactor;

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

float smoothTransition(float value, float threshold, float smoothness) {
    return smoothstep(threshold - smoothness, threshold + smoothness, value);
}

vec3 getRockPileSurfaceColor(vec3 localPos, float elevation, float rockiness, float boulderFactor) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // ROCK PILE COLOR PALETTE! 🪨
    vec3 darkRock = vec3(0.25, 0.22, 0.2);        // Dark basaltic rock
    vec3 mediumRock = vec3(0.4, 0.35, 0.3);       // Medium gray rock
    vec3 lightRock = vec3(0.55, 0.5, 0.45);       // Lighter weathered rock
    vec3 dustyRock = vec3(0.6, 0.55, 0.5);        // Dust-covered rock
    vec3 freshRock = vec3(0.3, 0.28, 0.25);       // Freshly exposed rock
    vec3 ironRock = vec3(0.45, 0.3, 0.25);        // Iron-rich rock
    vec3 shadowRock = vec3(0.2, 0.18, 0.16);      // Deep shadow areas
    vec3 regolith = vec3(0.5, 0.45, 0.4);         // Fine rock dust
    
    // Start with base rock color
    vec3 baseColor = mediumRock;
    
    // Rock type variation based on 3D noise
    float rockTypeNoise = noise3d(p * 2.0) * 0.5 + 0.5;
    if (rockTypeNoise < 0.3) {
        baseColor = darkRock;
    } else if (rockTypeNoise > 0.7) {
        baseColor = lightRock;
    }
    
    // BOULDER COLORING - larger rocks have different weathering
    if (vBoulderFactor > 0.1) {
        float boulderColorFactor = smoothTransition(vBoulderFactor, 0.3, 0.2);
        
        // Boulders can be fresher (less weathered) or more iron-rich
        float boulderType = noise3d(p * 1.5 + vec3(100.0));
        vec3 boulderColor;
        if (boulderType > 0.6) {
            boulderColor = freshRock; // Fresh, less weathered
        } else if (boulderType < 0.3) {
            boulderColor = ironRock; // Iron-rich composition
        } else {
            boulderColor = lightRock; // Standard weathered
        }
        
        baseColor = mix(baseColor, boulderColor, boulderColorFactor);
    }
    
    // ROCKINESS FACTOR - more angular areas have different colors
    if (vRockiness > 0.2) {
        float rockinessColorFactor = smoothTransition(vRockiness, 0.4, 0.2);
        
        // Rocky areas show more variation and fresh surfaces
        float rockyVariation = noise3d(p * 3.0 + vec3(200.0)) * 0.5 + 0.5;
        vec3 rockyColor = mix(freshRock, mediumRock, rockyVariation);
        
        baseColor = mix(baseColor, rockyColor, rockinessColorFactor * 0.7);
    }
    
    // ELEVATION-BASED COLORING
    if (elevation > 0.08) {
        // High areas - more exposed, fresher rock
        float highFactor = smoothTransition(elevation, 0.12, 0.04);
        baseColor = mix(baseColor, freshRock, highFactor * 0.6);
    } else if (elevation < -0.03) {
        // Low areas - more dust accumulation and shadowing
        float lowFactor = smoothTransition(elevation, -0.05, 0.02);
        vec3 lowColor = mix(regolith, shadowRock, lowFactor);
        baseColor = mix(baseColor, lowColor, lowFactor * 0.8);
    }
    
    // DUST AND REGOLITH ACCUMULATION
    float dustAccumulation = noise3d(p * 1.8 + vec3(300.0)) * 0.5 + 0.5;
    if (dustAccumulation > 0.6) {
        float dustFactor = smoothTransition(dustAccumulation, 0.7, 0.1);
        baseColor = mix(baseColor, dustyRock, dustFactor * 0.4);
    }
    
    // ROCK FACE ORIENTATION - different faces weather differently
    float faceOrientation = abs(dot(normalize(vLocalPos), vec3(0.0, 1.0, 0.0)));
    if (faceOrientation > 0.7) {
        // Top-facing surfaces accumulate more dust
        float topFactor = smoothTransition(faceOrientation, 0.8, 0.1);
        baseColor = mix(baseColor, regolith, topFactor * 0.3);
    } else if (faceOrientation < 0.3) {
        // Steep faces show fresher rock
        float steepFactor = smoothTransition(faceOrientation, 0.2, 0.1);
        baseColor = mix(baseColor, freshRock, (1.0 - steepFactor) * 0.4);
    }
    
    // MINERAL VEINS AND VARIATIONS
    float mineralPattern = noise3d(p * 4.0 + vec3(400.0));
    if (mineralPattern > 0.75) {
        float mineralFactor = smoothTransition(mineralPattern, 0.8, 0.05);
        vec3 mineralColor = vec3(0.35, 0.32, 0.28); // Slightly different mineral
        baseColor = mix(baseColor, mineralColor, mineralFactor * 0.3);
    }
    
    // IMPACT FRACTURES - darker lines where rocks have cracked
    float fracturePattern = abs(sin(p.x * 12.0 + p.y * 8.0)) * abs(sin(p.z * 10.0));
    if (fracturePattern > 0.8) {
        float fractureFactor = smoothTransition(fracturePattern, 0.85, 0.03);
        baseColor = mix(baseColor, shadowRock, fractureFactor * 0.4);
    }
    
    // SPACE WEATHERING - subtle darkening from cosmic radiation
    float spaceWeathering = noise3d(p * 6.0 + vec3(500.0)) * 0.5 + 0.5;
    if (spaceWeathering < 0.4) {
        float weatheringFactor = smoothTransition(spaceWeathering, 0.3, 0.1);
        baseColor = mix(baseColor, darkRock, (1.0 - weatheringFactor) * 0.2);
    }
    
    // FINE SURFACE TEXTURE VARIATION
    float surfaceTexture = noise3d(p * 8.0) * 0.08;
    baseColor += vec3(surfaceTexture * 0.15, surfaceTexture * 0.12, surfaceTexture * 0.1);
    
    // SHADOW AREAS - where rocks overhang
    if (elevation > 0.05 && vRockiness > 0.3) {
        float shadowNoise = noise3d(p * 5.0 + vec3(600.0));
        if (shadowNoise < 0.3) {
            float shadowFactor = smoothTransition(shadowNoise, 0.2, 0.1);
            baseColor = mix(baseColor, shadowRock, (1.0 - shadowFactor) * 0.5);
        }
    }
    
    // Ensure colors stay in realistic rock range
    baseColor = clamp(baseColor, vec3(0.15), vec3(0.7));
    
    return baseColor;
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors
    bool isLodMode = length(vColour - vec3(0.5, 0.4, 0.3)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that rocky rubble pile surface color! 🪨
    vec3 baseColor = getRockPileSurfaceColor(vLocalPos, vElevation, vRockiness, vBoulderFactor);
    
    // Lighting calculations
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Rock lighting - rocks are matte but can have some subtle reflection
    float ambient = 0.25;  // Rocks need decent ambient in space
    float diffuse = 0.75 * NdotL * attenuation;
    
    // Enhanced shadowing for rocky surfaces
    float rockShadowing = 1.0;
    if (vRockiness > 0.3) {
        // Rocky areas have more self-shadowing
        rockShadowing = 0.7 + 0.3 * NdotL;
    }
    
    diffuse *= rockShadowing;
    
    // Very subtle specular for mineral surfaces
    float specular = 0.0;
    if (vBoulderFactor > 0.5) {
        vec3 R = reflect(-L, N);
        float RdotV = max(0.0, dot(R, V));
        specular = pow(RdotV, 32.0) * 0.1 * attenuation; // Very subtle
    }
    
    vec3 finalColor = baseColor * (ambient + diffuse) + vec3(specular);
    
    // Rock-appropriate gamma correction
    finalColor = pow(finalColor, vec3(0.9));
    
    // Slight desaturation for space rocks
    finalColor *= vec3(0.98, 0.99, 1.0);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createDeimosUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 50.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
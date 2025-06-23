export const charonVertexShaderSource = `#version 300 es
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
out float vRedCap;
out float vCanyonDepth;
out float vAncientness;
out float vTidalStress;

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

// Mysterious red polar cap! 🔴
float redPolarCap(vec3 n, float time) {
    float latitude = n.y;
    
    // Northern red cap
    if (latitude > 0.6) {
        float capIntensity = smoothstep(0.6, 0.9, latitude);
        
        // Mysterious organic deposits
        float organicPattern = noise3d(n * 8.0 + vec3(time * 0.01)) * 0.5 + 0.5;
        capIntensity *= organicPattern;
        
        // Seasonal variations
        float seasonal = sin(time * 0.02) * 0.2 + 0.8;
        capIntensity *= seasonal;
        
        return capIntensity;
    }
    
    return 0.0;
}

// Ancient impact canyons! 🏔️ - FIXED FUNCTION
float ancientCanyon(vec3 n, vec3 center, float canyonLength, float width, float depth) {
    // Calculate distance to canyon line
    vec3 canyonDir = normalize(cross(center, vec3(0, 1, 0)));
    vec3 toPoint = n - center;
    float alongCanyon = dot(toPoint, canyonDir);
    alongCanyon = clamp(alongCanyon, -canyonLength * 0.5, canyonLength * 0.5);
    
    vec3 closestPoint = center + canyonDir * alongCanyon;
    float distToCanyon = length(n - closestPoint);
    
    if (distToCanyon > width) return 0.0;
    
    float canyonProfile = 1.0 - (distToCanyon / width);
    canyonProfile = canyonProfile * canyonProfile;
    
    return -canyonProfile * depth;
}

// Tidal stress fractures from Pluto! 🪐
float tidalFractures(vec3 n, float time) {
    // Pluto-facing hemisphere experiences more stress
    vec3 plutoDirection = normalize(vec3(1, 0, 0)); // Tidally locked
    float plutoFacing = dot(n, plutoDirection) * 0.5 + 0.5;
    
    // Stress fracture patterns
    float fracture1 = abs(sin(n.x * 8.0 + time * 0.005)) - 0.9;
    float fracture2 = abs(sin(n.z * 6.0 + n.y * 4.0 + time * 0.003)) - 0.92;
    
    float fractures = 0.0;
    if (fracture1 > 0.0) {
        fractures -= fracture1 * 0.008 * plutoFacing;
    }
    if (fracture2 > 0.0) {
        fractures -= fracture2 * 0.006 * plutoFacing;
    }
    
    return fractures;
}

// Ancient cryovolcanic plains! ❄️🌋
float cryovolcanicPlains(vec3 n, vec3 center, float radius) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Smooth volcanic plain
    float plainHeight = (1.0 - t * t) * 0.01;
    
    // Flow patterns
    float flows = sin(atan(n.z - center.z, n.x - center.x) * 12.0) * 0.002 * plainHeight;
    
    return plainHeight + flows;
}

float charonTerrain(vec3 n, float scale, float offset, out float redCap, out float canyonDepth, out float ancientness, out float tidalStress) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    redCap = 0.0;
    canyonDepth = 0.0;
    ancientness = 1.0; // Charon is very ancient
    tidalStress = 0.0;
    
    // Base ancient terrain
    terrain += noise3d(p * 0.8) * 0.015;
    terrain += noise3d(p * 1.6) * 0.008;
    terrain += noise3d(p * 3.2) * 0.004;
    
    // RED POLAR CAP - Mysterious organic material! 🔴
    redCap = redPolarCap(n, uTime);
    if (redCap > 0.1) {
        // Red cap adds slight elevation
        terrain += redCap * 0.005;
    }
    
    // SERENITY CHASMA - Major canyon system! 🏔️
    vec3 chasmaCenter = normalize(vec3(0.7, 0.1, 0.7));
    float serenityCanyon = ancientCanyon(n, chasmaCenter, 0.8, 0.3, 0.025);
    terrain += serenityCanyon;
    if (serenityCanyon < 0.0) {
        canyonDepth += (-serenityCanyon) * 20.0;
        ancientness += (-serenityCanyon) * 10.0;
    }
    
    // MANDJET CHASMA - Another major canyon
    vec3 mandjetCenter = normalize(vec3(-0.5, -0.2, 0.8));
    float mandjetCanyon = ancientCanyon(n, mandjetCenter, 0.6, 0.25, 0.02);
    terrain += mandjetCanyon;
    if (mandjetCanyon < 0.0) {
        canyonDepth += (-mandjetCanyon) * 15.0;
        ancientness += (-mandjetCanyon) * 8.0;
    }
    
    // VULCAN PLANITIA - Ancient cryovolcanic plain! ❄️🌋
    vec3 vulcanCenter = normalize(vec3(0.2, -0.8, 0.5));
    float vulcanPlain = cryovolcanicPlains(n, vulcanCenter, 0.4);
    terrain += vulcanPlain;
    if (vulcanPlain > 0.005) {
        ancientness += vulcanPlain * 20.0;
    }
    
    // OZ TERRA - Bright terrain region
    vec3 ozCenter = normalize(vec3(-0.6, 0.6, -0.5));
    float ozTerra = cryovolcanicPlains(n, ozCenter, 0.3);
    terrain += ozTerra;
    if (ozTerra > 0.005) {
        ancientness += ozTerra * 15.0;
    }
    
    // TIDAL STRESS FRACTURES - From Pluto's gravity! 🪐
    float tidalFracturing = tidalFractures(n, uTime);
    terrain += tidalFracturing;
    if (tidalFracturing < 0.0) {
        tidalStress += (-tidalFracturing) * 100.0;
    }
    
    // Ancient impact craters
    for(int i = 0; i < 6; i++) {
        float seed = float(i) * 19.3;
        vec3 craterCenter = normalize(vec3(
            hash(vec3(seed + 1.1)) * 2.0 - 1.0,
            hash(vec3(seed + 2.2)) * 2.0 - 1.0,
            hash(vec3(seed + 3.3)) * 2.0 - 1.0
        ));
        
        float craterSize = 0.15 + hash(vec3(seed + 4.4)) * 0.1;
        float craterDist = length(n - craterCenter);
        
        if (craterDist < craterSize) {
            float craterProfile = 1.0 - (craterDist / craterSize);
            float craterDepth = -0.015 * craterProfile * craterProfile;
            
            // Very old, eroded crater rim
            float rimWidth = craterSize * 0.15;
            if (craterDist > craterSize - rimWidth) {
                float rimHeight = 0.003 * smoothstep(craterSize, craterSize - rimWidth, craterDist);
                craterDepth += rimHeight;
            }
            
            terrain += craterDepth;
            if (craterDepth < 0.0) {
                canyonDepth += (-craterDepth) * 5.0;
            }
            ancientness += abs(craterDepth) * 30.0;
        }
    }
    
    // Ancient ridges and valleys
    float ridgePattern = sin(p.x * 1.5 + uTime * 0.001) * cos(p.z * 1.2 + uTime * 0.0008);
    terrain += ridgePattern * 0.003;
    
    // Very fine ancient texture
    terrain += noise3d(p * 12.0) * 0.002;
    terrain += noise3d(p * 20.0) * 0.001;
    
    // Clamp values
    redCap = clamp(redCap, 0.0, 1.0);
    canyonDepth = clamp(canyonDepth, 0.0, 1.0);
    ancientness = clamp(ancientness, 1.0, 3.0);
    tidalStress = clamp(tidalStress, 0.0, 1.0);
    terrain = clamp(terrain, -0.03, 0.02);
    
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
    
    float redCap, canyonDepth, ancientness, tidalStress;
    float h = charonTerrain(n, uNoiseScale, uNoiseOffset, redCap, canyonDepth, ancientness, tidalStress);
    float h1 = charonTerrain(n1, uNoiseScale, uNoiseOffset, redCap, canyonDepth, ancientness, tidalStress);
    float h2 = charonTerrain(n2, uNoiseScale, uNoiseOffset, redCap, canyonDepth, ancientness, tidalStress);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float redCap0, redCap1, canyonDepth0, canyonDepth1, ancientness0, ancientness1, tidalStress0, tidalStress1;
    float r0 = 1.0 + charonTerrain(normalize(e0), uNoiseScale, uNoiseOffset, redCap0, canyonDepth0, ancientness0, tidalStress0);
    float r1 = 1.0 + charonTerrain(normalize(e1), uNoiseScale, uNoiseOffset, redCap1, canyonDepth1, ancientness1, tidalStress1);
    
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
    
    float redCap0, redCap1, canyonDepth0, canyonDepth1, ancientness0, ancientness1, tidalStress0, tidalStress1;
    float r0 = 1.0 + charonTerrain(normalize(e0), uNoiseScale, uNoiseOffset, redCap0, canyonDepth0, ancientness0, tidalStress0);
    float r1 = 1.0 + charonTerrain(normalize(e1), uNoiseScale, uNoiseOffset, redCap1, canyonDepth1, ancientness1, tidalStress1);
    
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
    
    float redCap, canyonDepth, ancientness, tidalStress;
    float displacement = charonTerrain(n, uNoiseScale, uNoiseOffset, redCap, canyonDepth, ancientness, tidalStress);
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
    vRedCap = redCap;
    vCanyonDepth = canyonDepth;
    vAncientness = ancientness;
    vTidalStress = tidalStress;
    
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

// Fragment shader remains the same
export const charonFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vRedCap;
in float vCanyonDepth;
in float vAncientness;
in float vTidalStress;

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

vec3 getCharonSurfaceColors(vec3 localPos, float elevation, float redCap, float canyonDepth, float ancientness, float tidalStress) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Charon's MYSTERIOUS PALETTE! 🔴🌙
    vec3 ancientGray = vec3(0.4, 0.38, 0.36);         // Ancient neutral terrain
    vec3 darkGray = vec3(0.25, 0.23, 0.21);           // Dark ancient areas
    vec3 brightTerrain = vec3(0.6, 0.58, 0.55);       // Bright cryovolcanic plains
    vec3 redOrganics = vec3(0.7, 0.3, 0.2);           // Mysterious red cap material
    vec3 deepCanyon = vec3(0.2, 0.18, 0.16);          // Deep canyon floors
    vec3 canyonWalls = vec3(0.35, 0.32, 0.28);        // Canyon wall material
    vec3 waterIce = vec3(0.8, 0.82, 0.85);            // Exposed water ice
    vec3 fractureFill = vec3(0.3, 0.28, 0.25);        // Tidal fracture material
    vec3 ancientIce = vec3(0.65, 0.63, 0.6);          // Old cryovolcanic ice
    
    // Base ancient terrain color
    vec3 baseColor = ancientGray;
    
    // Ancientness affects base coloration
    if (vAncientness > 2.0) {
        float ancientFactor = (vAncientness - 2.0) / 1.0;
        baseColor = mix(baseColor, darkGray, ancientFactor * 0.6);
    } else if (vAncientness > 1.5) {
        float brightFactor = (vAncientness - 1.5) / 0.5;
        baseColor = mix(baseColor, brightTerrain, brightFactor * 0.4);
    }
    
    // MYSTERIOUS RED POLAR CAP! 🔴
    if (vRedCap > 0.1) {
        float redIntensity = min(vRedCap, 1.0);
        
        // Organic tholins creating the red color
        vec3 redColor = redOrganics;
        
        // Seasonal variations in the red cap
        float seasonalVariation = sin(uTime * 0.02 + p.x * 2.0) * 0.1 + 0.9;
        redColor *= seasonalVariation;
        
        // Patchy distribution of red material
        float patchiness = noise3d(p * 8.0 + vec3(uTime * 0.005)) * 0.5 + 0.5;
        if (patchiness > 0.4) {
            float patchFactor = (patchiness - 0.4) * 1.67;
            baseColor = mix(baseColor, redColor, redIntensity * patchFactor * 0.8);
        }
        
        // Red cap edge effects
        if (redIntensity > 0.1 && redIntensity < 0.7) {
            float edgeFactor = sin(redIntensity * 10.0) * 0.2 + 0.8;
            baseColor = mix(baseColor, mix(redColor, ancientGray, 0.5), edgeFactor * redIntensity * 0.4);
        }
    }
    
    // CANYON SYSTEMS - Ancient scars! 🏔️
    if (vCanyonDepth > 0.1) {
        float canyonIntensity = min(vCanyonDepth, 1.0);
        
        // Canyon floor and wall coloration
        vec3 canyonColor;
        if (canyonIntensity > 0.7) {
            canyonColor = deepCanyon; // Deep canyon floors
        } else if (canyonIntensity > 0.3) {
            canyonColor = canyonWalls; // Canyon walls
        } else {
            canyonColor = mix(baseColor, canyonWalls, 0.5); // Canyon edges
        }
        
        baseColor = mix(baseColor, canyonColor, canyonIntensity * 0.8);
        
        // Exposed water ice in canyon walls
        float iceExposure = noise3d(p * 6.0 + vec3(100.0));
        if (iceExposure > 0.8 && canyonIntensity > 0.4) {
            float iceFactor = (iceExposure - 0.8) * 5.0;
            baseColor = mix(baseColor, waterIce, iceFactor * canyonIntensity * 0.3);
        }
        
        // Canyon layering - geological history
        float layering = sin(elevation * 100.0 + p.y * 20.0) * 0.5 + 0.5;
        if (layering > 0.7 && canyonIntensity > 0.2) {
            float layerFactor = (layering - 0.7) * 3.33;
            vec3 layerColor = mix(canyonWalls, ancientIce, layerFactor);
            baseColor = mix(baseColor, layerColor, layerFactor * canyonIntensity * 0.2);
        }
    }
    
    // TIDAL STRESS FRACTURES - Pluto's influence! 🪐
    if (vTidalStress > 0.2) {
        float stressIntensity = min(vTidalStress, 1.0);
        
        // Fracture fill material
        vec3 stressColor = fractureFill;
        
        // Stress fracture patterns
        float fracPattern = abs(sin(p.x * 15.0 + uTime * 0.001)) * abs(cos(p.z * 12.0 + uTime * 0.0008));
        if (fracPattern > 0.8) {
            float fracFactor = (fracPattern - 0.8) * 5.0;
            baseColor = mix(baseColor, stressColor, fracFactor * stressIntensity * 0.5);
        }
        
        // Pluto-facing hemisphere shows more stress effects
        vec3 plutoDirection = normalize(vec3(1, 0, 0));
        float plutoFacing = dot(normalize(localPos), plutoDirection) * 0.5 + 0.5;
        if (plutoFacing > 0.6) {
            float facingFactor = (plutoFacing - 0.6) * 2.5;
            baseColor = mix(baseColor, mix(stressColor, darkGray, 0.5), facingFactor * stressIntensity * 0.3);
        }
    }
    
    // ELEVATION EFFECTS
    if (elevation > 0.01) {
        // High areas - cryovolcanic plains and ridges
        float highFactor = (elevation - 0.01) * 50.0;
        baseColor = mix(baseColor, brightTerrain, highFactor * 0.6);
        
        // Ancient cryovolcanic ice exposure
        if (elevation > 0.015) {
            float cryoFactor = (elevation - 0.015) * 100.0;
            baseColor = mix(baseColor, ancientIce, cryoFactor * 0.4);
        }
    } else if (elevation < -0.01) {
        // Low areas - impact crater floors and depressions
        float lowFactor = (-elevation - 0.01) * 50.0;
        baseColor = mix(baseColor, darkGray, lowFactor * 0.8);
    }
    
    // Fine ancient surface texture
    float surfaceTexture = noise3d(p * 20.0) * 0.02;
    baseColor += vec3(surfaceTexture * 0.1, surfaceTexture * 0.08, surfaceTexture * 0.06);
    
    return clamp(baseColor, vec3(0.1), vec3(0.9));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(0.6, 0.6, 0.6)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that ancient, mysterious surface! 🔴🌙
    vec3 baseColor = getCharonSurfaceColors(vLocalPos, vElevation, vRedCap, vCanyonDepth, vAncientness, vTidalStress);
    
    // Distant lighting from the Sun
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Very minimal atmosphere effects
    float atmosphere = pow(1.0 - NdotV, 6.0);
    vec3 atmosphereColor = vec3(0.3, 0.25, 0.2) * atmosphere * 0.03;
    
    // Ancient world lighting - mostly ambient due to distance
    float ambient = 0.45; // High ambient due to extreme distance from sun
    float diffuse = 0.55 * NdotL * attenuation;
    
    // Subtle rim lighting
    float rim = pow(1.0 - NdotV, 4.0) * 0.08;
    
    // Pluto's reflected light (tidally locked)
    vec3 plutoDirection = normalize(vec3(1, 0, 0));
    float plutoFacing = max(0.0, dot(normalize(vLocalPos), plutoDirection));
    float plutoGlow = plutoFacing * 0.08;
    vec3 plutoTint = vec3(0.9, 0.8, 0.7);
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + vec3(rim);
    finalColor += baseColor * plutoGlow * plutoTint;
    
    // Red cap emission (mysterious organic glow)
    if (vRedCap > 0.5) {
        float redEmission = (vRedCap - 0.5) * 0.05;
        finalColor += vec3(redEmission * 1.5, redEmission * 0.5, redEmission * 0.3);
    }
    
    // Ancient world gamma
    finalColor = pow(finalColor, vec3(0.95));
    
    // Mysterious, ancient tint! 🔴🌙
    finalColor *= vec3(1.02, 0.98, 0.96);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createCharonUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 45.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
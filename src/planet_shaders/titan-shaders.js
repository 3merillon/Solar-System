export const titanVertexShaderSource = `#version 300 es
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
out float vMethaneLakes;
out float vOrganicDeposits;
out float vAtmosphereThickness;
out float vDuneFields;

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

// Methane lake systems! 🌊
float methaneLakeSystem(vec3 n, vec3 center, float radius, float depth) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Smooth lake depression
    float lakeDepth = -depth * (1.0 - t * t);
    
    // Lake shore variations
    float shoreNoise = noise3d(n * 15.0 + vec3(uTime * 0.1)) * 0.003;
    
    return lakeDepth + shoreNoise;
}

// Organic sand dunes! 🏜️
float organicDunes(vec3 p, float time) {
    // Flowing dune patterns
    float dune1 = sin(p.x * 8.0 + time * 0.05) * cos(p.z * 6.0 + time * 0.03);
    float dune2 = sin(p.x * 12.0 + p.z * 4.0 + time * 0.04) * 0.7;
    float dune3 = sin(p.z * 10.0 + time * 0.02) * 0.5;
    
    return (dune1 + dune2 + dune3) * 0.008;
}

// Cryovolcanic features! 🌋❄️
float cryovolcano(vec3 n, vec3 center, float radius, float height) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    
    // Volcanic dome profile
    float dome = height * (1.0 - t * t * t);
    
    // Cryovolcanic flows
    float flows = sin(atan(n.z - center.z, n.x - center.x) * 8.0 + uTime * 0.1) * 0.005 * dome;
    
    return dome + flows;
}

// Atmospheric haze effects! 🌫️
float atmosphericHaze(vec3 n, float time) {
    // Thick atmosphere creates surface pressure variations
    float haze = sin(n.x * 2.0 + time * 0.02) * cos(n.y * 1.5 + time * 0.015);
    haze += sin(n.z * 3.0 + time * 0.018) * 0.7;
    
    return haze * 0.002;
}

float titanTerrain(vec3 n, float scale, float offset, out float methaneLakes, out float organicDeposits, out float atmosphereThickness, out float duneFields) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    methaneLakes = 0.0;
    organicDeposits = 0.0;
    atmosphereThickness = 1.0; // Titan has a thick atmosphere
    duneFields = 0.0;
    
    // Base terrain with organic sediments
    terrain += noise3d(p * 0.8) * 0.02;
    terrain += noise3d(p * 1.6) * 0.01;
    
    // KRAKEN MARE - Largest methane sea! 🌊
    vec3 krakenMare = normalize(vec3(0.7, 0.3, 0.6));
    float krakenLake = methaneLakeSystem(n, krakenMare, 0.4, 0.015);
    terrain += krakenLake;
    if (krakenLake < 0.0) {
        methaneLakes += (-krakenLake) * 30.0;
    }
    
    // LIGEIA MARE - Another major methane sea
    vec3 ligeiaMare = normalize(vec3(-0.5, 0.6, 0.6));
    float ligeiaLake = methaneLakeSystem(n, ligeiaMare, 0.3, 0.012);
    terrain += ligeiaLake;
    if (ligeiaLake < 0.0) {
        methaneLakes += (-ligeiaLake) * 25.0;
    }
    
    // PUNGA MARE - Smaller methane lake
    vec3 pungaMare = normalize(vec3(0.2, -0.8, 0.5));
    float pungaLake = methaneLakeSystem(n, pungaMare, 0.2, 0.008);
    terrain += pungaLake;
    if (pungaLake < 0.0) {
        methaneLakes += (-pungaLake) * 20.0;
    }
    
    // SHANGRI-LA - Vast dune fields! 🏜️
    vec3 shangriLa = normalize(vec3(0.1, -0.3, 0.9));
    float distToShangri = length(n - shangriLa);
    if (distToShangri < 0.35) {
        float duneIntensity = smoothstep(0.35, 0.1, distToShangri);
        float duneHeight = organicDunes(p, uTime) * duneIntensity;
        terrain += duneHeight;
        duneFields += duneIntensity;
        organicDeposits += duneIntensity * 0.8;
    }
    
    // XANADU - Bright continent with highlands! 🏔️
    vec3 xanadu = normalize(vec3(-0.6, 0.2, -0.7));
    float distToXanadu = length(n - xanadu);
    if (distToXanadu < 0.4) {
        float xanaduHeight = smoothstep(0.4, 0.15, distToXanadu) * 0.03;
        terrain += xanaduHeight;
        organicDeposits += xanaduHeight * 15.0;
    }
    
    // Cryovolcanic features
    vec3 cryovolcano1 = normalize(vec3(0.8, -0.4, 0.4));
    float volcano1 = cryovolcano(n, cryovolcano1, 0.15, 0.02);
    terrain += volcano1;
    if (volcano1 > 0.005) {
        organicDeposits += volcano1 * 20.0;
    }
    
    vec3 cryovolcano2 = normalize(vec3(-0.3, 0.7, -0.6));
    float volcano2 = cryovolcano(n, cryovolcano2, 0.12, 0.015);
    terrain += volcano2;
    if (volcano2 > 0.005) {
        organicDeposits += volcano2 * 15.0;
    }
    
    // Atmospheric effects on terrain
    float atmoEffect = atmosphericHaze(n, uTime);
    terrain += atmoEffect;
    
    // Equatorial dune belt
    float latitude = abs(n.y);
    if (latitude < 0.4) {
        float equatorialDunes = organicDunes(p * 1.5, uTime) * (0.4 - latitude) * 2.5;
        terrain += equatorialDunes;
        duneFields += equatorialDunes * 50.0;
        organicDeposits += equatorialDunes * 30.0;
    }
    
    // River channels from methane rain! 🌧️
    float riverChannels = 0.0;
    for(int i = 0; i < 6; i++) {
        float seed = float(i) * 15.7;
        vec3 riverStart = normalize(vec3(
            hash(vec3(seed + 1.1)) * 2.0 - 1.0,
            hash(vec3(seed + 2.2)) * 0.5 - 1.0,
            hash(vec3(seed + 3.3)) * 2.0 - 1.0
        ));
        
        float riverDist = length(n - riverStart);
        if (riverDist < 0.8) {
            float riverDepth = abs(sin(riverDist * 10.0 + seed)) * 0.003;
            if (riverDepth > 0.002) {
                riverChannels -= riverDepth;
                methaneLakes += riverDepth * 10.0;
            }
        }
    }
    terrain += riverChannels;
    
    // Tidal effects from Saturn! 🪐
    float tidalBulge = sin(n.x * 1.0 + uTime * 0.08) * cos(n.z * 0.8 + uTime * 0.06) * 0.001;
    terrain += tidalBulge;
    
    // Organic sediment layers
    float sedimentLayers = sin(p.y * 20.0 + uTime * 0.01) * 0.002;
    terrain += sedimentLayers;
    organicDeposits += abs(sedimentLayers) * 100.0;
    
    // Fine surface texture - organic particles!
    terrain += noise3d(p * 12.0) * 0.003;
    terrain += noise3d(p * 20.0) * 0.001;
    
    // Clamp values
    methaneLakes = clamp(methaneLakes, 0.0, 1.0);
    organicDeposits = clamp(organicDeposits, 0.0, 1.0);
    duneFields = clamp(duneFields, 0.0, 1.0);
    atmosphereThickness = clamp(atmosphereThickness + abs(atmoEffect) * 50.0, 0.8, 1.5);
    terrain = clamp(terrain, -0.02, 0.04);
    
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
    
    float methaneLakes, organicDeposits, atmosphereThickness, duneFields;
    float h = titanTerrain(n, uNoiseScale, uNoiseOffset, methaneLakes, organicDeposits, atmosphereThickness, duneFields);
    float h1 = titanTerrain(n1, uNoiseScale, uNoiseOffset, methaneLakes, organicDeposits, atmosphereThickness, duneFields);
    float h2 = titanTerrain(n2, uNoiseScale, uNoiseOffset, methaneLakes, organicDeposits, atmosphereThickness, duneFields);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float methaneLakes0, methaneLakes1, organicDeposits0, organicDeposits1;
    float atmosphereThickness0, atmosphereThickness1, duneFields0, duneFields1;
    float r0 = 1.0 + titanTerrain(normalize(e0), uNoiseScale, uNoiseOffset, methaneLakes0, organicDeposits0, atmosphereThickness0, duneFields0);
    float r1 = 1.0 + titanTerrain(normalize(e1), uNoiseScale, uNoiseOffset, methaneLakes1, organicDeposits1, atmosphereThickness1, duneFields1);
    
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
    
    float methaneLakes0, methaneLakes1, organicDeposits0, organicDeposits1;
    float atmosphereThickness0, atmosphereThickness1, duneFields0, duneFields1;
    float r0 = 1.0 + titanTerrain(normalize(e0), uNoiseScale, uNoiseOffset, methaneLakes0, organicDeposits0, atmosphereThickness0, duneFields0);
    float r1 = 1.0 + titanTerrain(normalize(e1), uNoiseScale, uNoiseOffset, methaneLakes1, organicDeposits1, atmosphereThickness1, duneFields1);
    
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
    
    float methaneLakes, organicDeposits, atmosphereThickness, duneFields;
    float displacement = titanTerrain(n, uNoiseScale, uNoiseOffset, methaneLakes, organicDeposits, atmosphereThickness, duneFields);
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
    vMethaneLakes = methaneLakes;
    vOrganicDeposits = organicDeposits;
    vAtmosphereThickness = atmosphereThickness;
    vDuneFields = duneFields;
    
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

export const titanFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vMethaneLakes;
in float vOrganicDeposits;
in float vAtmosphereThickness;
in float vDuneFields;

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

vec3 getTitanSurfaceColors(vec3 localPos, float elevation, float methaneLakes, float organicDeposits, float atmosphereThickness, float duneFields) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Titan's ORGANIC CHEMISTRY PALETTE! 🧪🌊
    vec3 methaneLake = vec3(0.1, 0.15, 0.25);        // Dark methane lakes
    vec3 organicSediment = vec3(0.4, 0.35, 0.25);    // Orange-brown organics
    vec3 waterIce = vec3(0.7, 0.75, 0.8);            // Water ice bedrock
    vec3 tholin = vec3(0.6, 0.4, 0.2);               // Reddish organic compounds
    vec3 duneSand = vec3(0.5, 0.45, 0.3);            // Organic dune material
    vec3 brightTerrain = vec3(0.8, 0.7, 0.5);        // Xanadu bright terrain
    vec3 darkTerrain = vec3(0.25, 0.2, 0.15);        // Dark equatorial regions
    vec3 cryovolcanic = vec3(0.6, 0.6, 0.7);         // Fresh cryovolcanic ice
    vec3 atmosphericHaze = vec3(0.9, 0.7, 0.4);      // Atmospheric scattering
    
    // Base terrain color
    vec3 baseColor = organicSediment;
    
    // METHANE LAKES - Dark and mysterious! 🌊
    if (vMethaneLakes > 0.2) {
        float lakeIntensity = min(vMethaneLakes, 1.0);
        
        // Lake surface with subtle waves
        float wavePattern = sin(p.x * 20.0 + uTime * 0.5) * cos(p.z * 15.0 + uTime * 0.4) * 0.5 + 0.5;
        vec3 lakeColor = methaneLake;
        
        // Add subtle methane surface tension effects
        if (wavePattern > 0.7) {
            float waveFactor = (wavePattern - 0.7) * 3.33;
            lakeColor = mix(lakeColor, vec3(0.15, 0.2, 0.3), waveFactor * 0.3);
        }
        
        baseColor = mix(baseColor, lakeColor, lakeIntensity * 0.9);
        
        // Lake shore effects
        if (lakeIntensity > 0.1 && lakeIntensity < 0.8) {
            float shoreFactor = abs(sin(lakeIntensity * 10.0)) * 0.3;
            baseColor = mix(baseColor, duneSand, shoreFactor);
        }
    }
    
    // ORGANIC DEPOSITS - The building blocks of life! 🧬
    if (vOrganicDeposits > 0.3) {
        float organicIntensity = min(vOrganicDeposits, 1.0);
        
        // Different organic compounds
        float organicType = noise3d(p * 3.0 + vec3(100.0));
        vec3 organicColor;
        
        if (organicType > 0.7) {
            organicColor = tholin; // Reddish tholins
        } else if (organicType > 0.4) {
            organicColor = vec3(0.45, 0.4, 0.3); // Brownish organics
        } else {
            organicColor = vec3(0.35, 0.3, 0.2); // Dark organics
        }
        
        baseColor = mix(baseColor, organicColor, organicIntensity * 0.8);
        
        // Organic chemistry patterns
        float chemPattern = abs(sin(p.x * 12.0 + uTime * 0.1)) * abs(cos(p.z * 10.0 + uTime * 0.08));
        if (chemPattern > 0.8 && organicIntensity > 0.5) {
            float chemFactor = (chemPattern - 0.8) * 5.0;
            baseColor = mix(baseColor, vec3(0.7, 0.5, 0.3), chemFactor * organicIntensity * 0.3);
        }
    }
    
    // DUNE FIELDS - Organic sand seas! 🏜️
    if (vDuneFields > 0.2) {
        float duneIntensity = min(vDuneFields, 1.0);
        
        // Dune coloration
        vec3 duneColor = duneSand;
        
        // Dune crest highlights
        float dunePattern = sin(p.x * 8.0 + uTime * 0.02) * cos(p.z * 6.0 + uTime * 0.015);
        if (abs(dunePattern) > 0.7) {
            float crestFactor = (abs(dunePattern) - 0.7) * 3.33;
            duneColor = mix(duneColor, brightTerrain, crestFactor * 0.4);
        }
        
        baseColor = mix(baseColor, duneColor, duneIntensity * 0.7);
    }
    
    // ELEVATION EFFECTS
    if (elevation > 0.02) {
        // High terrain - Xanadu-like bright terrain
        float brightFactor = (elevation - 0.02) * 25.0;
        baseColor = mix(baseColor, brightTerrain, brightFactor * 0.6);
        
        // Water ice bedrock exposure
        if (elevation > 0.03) {
            float iceFactor = (elevation - 0.03) * 50.0;
            baseColor = mix(baseColor, waterIce, iceFactor * 0.4);
        }
    } else if (elevation < -0.01) {
        // Low terrain - darker, more organic-rich
        float darkFactor = (-elevation - 0.01) * 50.0;
        baseColor = mix(baseColor, darkTerrain, darkFactor * 0.8);
    }
    
    // CRYOVOLCANIC FEATURES
    float cryovolcanicPattern = noise3d(p * 4.0 + vec3(200.0));
    if (cryovolcanicPattern > 0.8 && vOrganicDeposits > 0.4) {
        float volcFactor = (cryovolcanicPattern - 0.8) * 5.0;
        baseColor = mix(baseColor, cryovolcanic, volcFactor * vOrganicDeposits * 0.3);
    }
    
    // ATMOSPHERIC HAZE EFFECTS - Titan's thick atmosphere! 🌫️
    float hazePattern = sin(p.y * 1.0 + uTime * 0.01) * cos(p.x * 0.8 + uTime * 0.008) * 0.5 + 0.5;
    if (hazePattern > 0.6 && vAtmosphereThickness > 1.0) {
        float hazeFactor = (hazePattern - 0.6) * 2.5;
        float thicknessFactor = (vAtmosphereThickness - 1.0) / 0.5;
        baseColor = mix(baseColor, atmosphericHaze, hazeFactor * thicknessFactor * 0.15);
    }
    
    // SEASONAL METHANE RAIN EFFECTS 🌧️
    float rainPattern = noise3d(p * 6.0 + vec3(uTime * 0.05));
    if (rainPattern > 0.85) {
        float rainFactor = (rainPattern - 0.85) * 6.67;
        vec3 wetSurface = mix(baseColor, methaneLake, 0.3);
        baseColor = mix(baseColor, wetSurface, rainFactor * 0.2);
    }
    
    // HYDROCARBON CHEMISTRY - Complex organic molecules! ⚗️
    float hydroPattern = abs(sin(p.x * 15.0)) * abs(sin(p.z * 12.0)) * abs(sin(p.y * 10.0));
    if (hydroPattern > 0.9 && vOrganicDeposits > 0.6) {
        float hydroFactor = (hydroPattern - 0.9) * 10.0;
        vec3 hydroColor = vec3(0.8, 0.6, 0.4); // Complex hydrocarbons
        baseColor = mix(baseColor, hydroColor, hydroFactor * vOrganicDeposits * 0.2);
    }
    
    // TITAN'S ORANGE GLOW - Atmospheric tint! 🍊
    float orangeGlow = sin(uTime * 0.3 + p.y * 2.0) * 0.05 + 0.95;
    baseColor *= vec3(orangeGlow * 1.1, orangeGlow, orangeGlow * 0.9);
    
    // SUBSURFACE OCEAN HINTS - Very subtle! 🌊
    if (vMethaneLakes > 0.5) {
        float oceanHint = sin(uTime * 0.1 + p.x * 1.0) * cos(uTime * 0.08 + p.z * 0.8) * 0.02;
        baseColor += vec3(oceanHint * 0.1, oceanHint * 0.2, oceanHint * 0.3);
    }
    
    // Fine surface texture - organic particles!
    float surfaceTexture = noise3d(p * 25.0) * 0.03;
    baseColor += vec3(surfaceTexture * 0.2, surfaceTexture * 0.15, surfaceTexture * 0.1);
    
    return clamp(baseColor, vec3(0.05), vec3(0.95));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(0.8, 0.6, 0.4)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that alien organic chemistry surface! 🧪
    vec3 baseColor = getTitanSurfaceColors(vLocalPos, vElevation, vMethaneLakes, vOrganicDeposits, vAtmosphereThickness, vDuneFields);
    
    // Titan's atmospheric lighting! 🌫️
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Thick atmosphere effects - very diffuse lighting
    float ambient = 0.4 + vAtmosphereThickness * 0.1; // High ambient from thick atmosphere
    float diffuse = 0.5 * NdotL * attenuation / vAtmosphereThickness; // Atmosphere scatters light
    
    // Atmospheric scattering - orange haze!
    float atmosphere = pow(1.0 - NdotV, 1.5);
    vec3 atmosphereColor = vec3(1.0, 0.7, 0.4) * atmosphere * vAtmosphereThickness * 0.3;
    
    // Methane lake reflections
    float specular = 0.0;
    if (vMethaneLakes > 0.5) {
        vec3 R = reflect(-L, N);
        float RdotV = max(0.0, dot(R, V));
        specular = pow(RdotV, 8.0) * 0.4 * attenuation * vMethaneLakes;
    }
    
    // Saturn's warm reflected light
    float saturnGlow = 0.15 * attenuation;
    vec3 saturnTint = vec3(1.1, 0.9, 0.8);
    
    vec3 finalColor = baseColor * (ambient + diffuse) * saturnTint + atmosphereColor + vec3(specular);
    finalColor += baseColor * saturnGlow;
    
    // Organic chemistry glow! ⚗️
    if (vOrganicDeposits > 0.7) {
        float organicGlow = (vOrganicDeposits - 0.7) * 0.1;
        finalColor += vec3(organicGlow * 1.2, organicGlow * 0.8, organicGlow * 0.4);
    }
    
    // Atmospheric haze gamma
    finalColor = pow(finalColor, vec3(0.85));
    
    // Titan's signature orange atmospheric tint! 🍊
    finalColor *= vec3(1.05, 0.95, 0.85);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createTitanUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 16.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
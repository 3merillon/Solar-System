export const marsVertexShaderSource = `#version 300 es
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
out float vVolcanicActivity;
out float vCraterDensity;

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

// Simple 2-octave FBM
float fbm2(vec3 p) {
    return noise3d(p) * 0.6 + noise3d(p * 2.0) * 0.3;
}

// Ridged noise for volcanic features
float ridgedNoise(vec3 p) {
    return 1.0 - abs(noise3d(p) * 2.0 - 1.0);
}

// Enhanced Mars terrain with major geological features
float marsTerrain(vec3 n, float scale, float offset, out float volcanicActivity, out float craterDensity) {
    vec3 p = n * scale + vec3(offset);
    float latitude = n.y;
    float longitude = atan(n.z, n.x);
    
    // Base terrain with multiple scales
    float terrain = 0.0;
    terrain += fbm2(p * 0.5) * 0.12;
    terrain += noise3d(p * 1.0) * 0.06;
    terrain += noise3d(p * 2.0) * 0.03;
    
    // OLYMPUS MONS - Massive shield volcano
    vec3 olympusCenter = normalize(vec3(0.3, 0.15, 0.8));
    float distToOlympus = length(n - olympusCenter);
    float olympusMons = 0.0;
    if (distToOlympus < 0.25) {
        // Shield volcano profile - gentle slopes, massive size
        float olympusProfile = 1.0 - (distToOlympus / 0.25);
        olympusProfile = olympusProfile * olympusProfile;
        olympusMons = olympusProfile * 0.35; // Huge mountain
        
        // Add volcanic texture
        float volcanicNoise = ridgedNoise(p * 3.0 + vec3(100.0)) * 0.05;
        olympusMons += volcanicNoise * olympusProfile;
    }
    
    // THARSIS VOLCANIC REGION - Multiple large volcanoes
    vec3 tharsisCenter = normalize(vec3(0.5, 0.2, 0.7));
    float distToTharsis = length(n - tharsisCenter);
    float tharsisVolcanoes = 0.0;
    if (distToTharsis < 0.35) {
        // Multiple volcanic peaks in the region
        float tharsisBase = exp(-distToTharsis * 8.0) * 0.2;
        
        // Individual volcanic peaks
        float peak1 = exp(-length(n - normalize(vec3(0.45, 0.25, 0.75))) * 25.0) * 0.15;
        float peak2 = exp(-length(n - normalize(vec3(0.55, 0.15, 0.65))) * 30.0) * 0.12;
        float peak3 = exp(-length(n - normalize(vec3(0.5, 0.3, 0.6))) * 35.0) * 0.1;
        
        tharsisVolcanoes = tharsisBase + peak1 + peak2 + peak3;
        
        // Add volcanic texture
        float volcanicDetail = ridgedNoise(p * 4.0 + vec3(200.0)) * 0.03;
        tharsisVolcanoes += volcanicDetail * smoothstep(0.35, 0.1, distToTharsis);
    }
    
    // VALLES MARINERIS - Massive canyon system
    vec3 vallesStart = normalize(vec3(0.8, 0.05, 0.2));
    vec3 vallesEnd = normalize(vec3(0.6, -0.1, 0.4));
    
    // Calculate distance to canyon line
    vec3 vallesDir = normalize(vallesEnd - vallesStart);
    vec3 toPoint = n - vallesStart;
    float projLength = dot(toPoint, vallesDir);
    projLength = clamp(projLength, 0.0, length(vallesEnd - vallesStart));
    vec3 closestPoint = vallesStart + vallesDir * projLength;
    float distToValles = length(n - closestPoint);
    
    float vallesMarineris = 0.0;
    if (distToValles < 0.15) {
        // Canyon profile - deep and wide
        float canyonProfile = 1.0 - (distToValles / 0.15);
        canyonProfile = canyonProfile * canyonProfile;
        vallesMarineris = -canyonProfile * 0.18; // Deep canyon
        
        // Add canyon wall details
        float wallDetail = noise3d(p * 6.0 + vec3(300.0)) * 0.02;
        vallesMarineris += wallDetail * canyonProfile;
    }
    
    // ENHANCED IMPACT CRATERS with varying sizes and ages
    craterDensity = 0.0;
    float craters = 0.0;
    
    // Large ancient craters
    for(int i = 0; i < 8; i++) {
        float seed = float(i) * 31.7;
        vec3 craterPos = normalize(vec3(
            hash(vec3(seed + 1.1)) * 2.0 - 1.0,
            hash(vec3(seed + 2.2)) * 2.0 - 1.0,
            hash(vec3(seed + 3.3)) * 2.0 - 1.0
        ));
        
        float craterSize = 0.06 + hash(vec3(seed + 4.4)) * 0.08;
        float distToCrater = length(n - craterPos);
        
        if (distToCrater < craterSize) {
            float craterProfile = 1.0 - (distToCrater / craterSize);
            float craterDepth = -0.025 * craterProfile * craterProfile;
            
            // Crater rim
            float rimWidth = craterSize * 0.2;
            if (distToCrater > craterSize - rimWidth) {
                float rimHeight = 0.008 * smoothstep(craterSize, craterSize - rimWidth, distToCrater);
                craterDepth += rimHeight;
            }
            
            craters += craterDepth;
            craterDensity += craterProfile;
        }
    }
    
    // Medium craters
    for(int i = 0; i < 12; i++) {
        float seed = float(i) * 17.3 + 100.0;
        vec3 craterPos = normalize(vec3(
            hash(vec3(seed + 1.1)) * 2.0 - 1.0,
            hash(vec3(seed + 2.2)) * 2.0 - 1.0,
            hash(vec3(seed + 3.3)) * 2.0 - 1.0
        ));
        
        float craterSize = 0.03 + hash(vec3(seed + 4.4)) * 0.04;
        float distToCrater = length(n - craterPos);
        
        if (distToCrater < craterSize) {
            float craterProfile = 1.0 - (distToCrater / craterSize);
            float craterDepth = -0.015 * craterProfile * craterProfile;
            craters += craterDepth;
            craterDensity += craterProfile * 0.5;
        }
    }
    
    // POLAR ICE CAPS with seasonal variation
    float absoluteLatitude = abs(latitude);
    float iceCaps = 0.0;
    if (absoluteLatitude > 0.8) {
        float iceStrength = smoothstep(0.8, 0.95, absoluteLatitude);
        float iceNoise = noise3d(p * 2.5 + vec3(800.0)) * 0.5 + 0.5;
        iceCaps = iceStrength * iceNoise * 0.015;
    }
    
    // DUST DUNES in low-lying areas
    float dustDunes = 0.0;
    if (terrain < 0.02) {
        float duneNoise = sin(p.x * 25.0) * sin(p.z * 20.0) * 0.003;
        duneNoise += sin(p.x * 40.0 + p.z * 30.0) * 0.002;
        dustDunes = duneNoise * smoothstep(0.02, -0.02, terrain);
    }
    
    // Calculate volcanic activity for coloring
    volcanicActivity = 0.0;
    if (distToOlympus < 0.3) {
        volcanicActivity += smoothstep(0.3, 0.1, distToOlympus);
    }
    if (distToTharsis < 0.4) {
        volcanicActivity += smoothstep(0.4, 0.15, distToTharsis) * 0.7;
    }
    volcanicActivity = clamp(volcanicActivity, 0.0, 1.0);
    
    // Combine all features
    float totalTerrain = terrain + olympusMons + tharsisVolcanoes + vallesMarineris + craters + iceCaps + dustDunes;
    
    // Add fine surface detail
    totalTerrain += noise3d(p * 8.0) * 0.008;
    
    return clamp(totalTerrain, -0.2, 0.4);
}

vec3 calculateDisplacedNormal(vec3 n, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(tangent1) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float volcanicActivity, craterDensity;
    float h = marsTerrain(n, uNoiseScale, uNoiseOffset, volcanicActivity, craterDensity);
    float h1 = marsTerrain(n1, uNoiseScale, uNoiseOffset, volcanicActivity, craterDensity);
    float h2 = marsTerrain(n2, uNoiseScale, uNoiseOffset, volcanicActivity, craterDensity);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float volcanicActivity0, volcanicActivity1, craterDensity0, craterDensity1;
    float r0 = 1.0 + marsTerrain(normalize(e0), uNoiseScale, uNoiseOffset, volcanicActivity0, craterDensity0);
    float r1 = 1.0 + marsTerrain(normalize(e1), uNoiseScale, uNoiseOffset, volcanicActivity1, craterDensity1);
    
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
    
    float volcanicActivity0, volcanicActivity1, craterDensity0, craterDensity1;
    float r0 = 1.0 + marsTerrain(normalize(e0), uNoiseScale, uNoiseOffset, volcanicActivity0, craterDensity0);
    float r1 = 1.0 + marsTerrain(normalize(e1), uNoiseScale, uNoiseOffset, volcanicActivity1, craterDensity1);
    
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
    
    float volcanicActivity, craterDensity;
    float displacement = marsTerrain(n, uNoiseScale, uNoiseOffset, volcanicActivity, craterDensity);
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
    vVolcanicActivity = volcanicActivity;
    vCraterDensity = craterDensity;
    
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

export const marsFragmentShaderSource = `#version 300 es
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
in float vVolcanicActivity;
in float vCraterDensity;

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

vec3 getMarsSurfaceColor(vec3 localPos, float elevation, float volcanicActivity, float craterDensity) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    float latitude = localPos.y;
    float absoluteLatitude = abs(latitude);
    
    // Enhanced Mars color palette
    vec3 darkRust = vec3(0.35, 0.18, 0.1);        // Dark iron oxide
    vec3 rust = vec3(0.7, 0.35, 0.2);             // Classic Mars rust
    vec3 lightRust = vec3(0.85, 0.55, 0.35);      // Lighter oxidized areas
    vec3 dusty = vec3(0.8, 0.65, 0.45);           // Dust-covered areas
    vec3 volcanic = vec3(0.25, 0.12, 0.08);       // Dark volcanic rock
    vec3 basalt = vec3(0.4, 0.25, 0.15);          // Volcanic basalt
    vec3 ice = vec3(0.9, 0.95, 1.0);              // Polar ice
    vec3 canyon = vec3(0.5, 0.25, 0.15);          // Canyon walls
    vec3 crater = vec3(0.6, 0.4, 0.25);           // Crater material
    vec3 highland = vec3(0.75, 0.5, 0.3);         // Highland terrain
    
    // Base color variation with noise
    float colorVariation = noise3d(p * 3.0) * 0.5 + 0.5;
    vec3 baseColor = mix(darkRust, rust, colorVariation);
    
    // ELEVATION-BASED COLORING with smooth transitions
    if (elevation > 0.15) {
        // Very high elevations - Olympus Mons and high peaks
        float highFactor = smoothTransition(elevation, 0.2, 0.05);
        vec3 highColor = mix(volcanic, basalt, colorVariation);
        baseColor = mix(baseColor, highColor, highFactor);
        
        // Add some volcanic texture variation
        float volcanicNoise = noise3d(p * 6.0 + vec3(100.0)) * 0.3 + 0.7;
        baseColor *= volcanicNoise;
        
    } else if (elevation > 0.05) {
        // Medium elevations - highlands and crater rims
        float mediumFactor = smoothTransition(elevation, 0.1, 0.05);
        vec3 mediumColor = mix(rust, highland, colorVariation);
        baseColor = mix(baseColor, mediumColor, mediumFactor);
        
    } else if (elevation < -0.05) {
        // Low elevations - canyon floors and deep craters
        float lowFactor = smoothTransition(elevation, -0.1, 0.05);
        vec3 lowColor = mix(canyon, darkRust, colorVariation);
        baseColor = mix(baseColor, lowColor, lowFactor);
    }
    
    // VOLCANIC ACTIVITY COLORING
    if (volcanicActivity > 0.1) {
        float volcanicFactor = smoothTransition(volcanicActivity, 0.3, 0.2);
        vec3 volcanicColor = mix(basalt, volcanic, volcanicActivity);
        
        // Add some lava flow patterns
        float flowPattern = sin(p.x * 15.0 + p.z * 12.0) * 0.5 + 0.5;
        volcanicColor = mix(volcanicColor, vec3(0.3, 0.15, 0.1), flowPattern * 0.3);
        
        baseColor = mix(baseColor, volcanicColor, volcanicFactor);
    }
    
    // CRATER COLORING
    if (craterDensity > 0.1) {
        float craterFactor = smoothTransition(craterDensity, 0.3, 0.2);
        vec3 craterColor = mix(crater, lightRust, craterDensity);
        baseColor = mix(baseColor, craterColor, craterFactor * 0.7);
    }
    
    // POLAR ICE CAPS with smooth transitions
    if (absoluteLatitude > 0.8) {
        float iceStrength = smoothTransition(absoluteLatitude, 0.85, 0.1);
        float iceNoise = noise3d(p * 2.5 + vec3(800.0)) * 0.5 + 0.5;
        float iceFactor = iceStrength * iceNoise;
        baseColor = mix(baseColor, ice, iceFactor);
    }
    
    // DUST COVERAGE - varies by region and elevation
    float dustCoverage = noise3d(p * 2.0 + vec3(500.0)) * 0.5 + 0.5;
    
    // More dust in low areas and certain latitudes
    if (elevation < 0.02) {
        dustCoverage *= 1.5;
    }
    
    // Seasonal dust storm effects (very subtle)
    float dustStormNoise = noise3d(p * 1.5 + vec3(uTime * 0.02)) * 0.5 + 0.5;
    if (dustStormNoise > 0.7) {
        dustCoverage *= 1.3;
    }
    
    dustCoverage = clamp(dustCoverage, 0.0, 1.0);
    float dustFactor = smoothTransition(dustCoverage, 0.6, 0.2);
    baseColor = mix(baseColor, dusty, dustFactor * 0.4);
    
    // IRON OXIDE STREAKS AND PATTERNS
    float ironStreaks = abs(sin(p.x * 8.0 + p.z * 6.0)) * abs(sin(p.y * 10.0));
    ironStreaks = smoothTransition(ironStreaks, 0.6, 0.2);
    vec3 ironColor = vec3(0.6, 0.28, 0.15);
    baseColor = mix(baseColor, ironColor, ironStreaks * 0.25);
    
    // LAYERED ROCK FORMATIONS (geological stratification)
    float rockLayers = sin(elevation * 100.0 + p.x * 20.0) * 0.5 + 0.5;
    rockLayers = smoothTransition(rockLayers, 0.7, 0.15);
    vec3 layerColor = vec3(0.65, 0.45, 0.28);
    baseColor = mix(baseColor, layerColor, rockLayers * 0.15);
    
    // MINERAL DEPOSITS (subtle color variations)
    float mineralDeposits = noise3d(p * 4.0 + vec3(1000.0)) * 0.5 + 0.5;
    if (mineralDeposits > 0.8) {
        float mineralFactor = smoothTransition(mineralDeposits, 0.85, 0.05);
        vec3 mineralColor = vec3(0.8, 0.6, 0.4); // Lighter mineral veins
        baseColor = mix(baseColor, mineralColor, mineralFactor * 0.2);
    }
    
    // Add fine surface texture variation
    float surfaceTexture = noise3d(p * 8.0) * 0.08;
    baseColor += vec3(surfaceTexture * 0.3, surfaceTexture * 0.2, surfaceTexture * 0.15);
    
    // Ensure colors stay in valid range
    baseColor = clamp(baseColor, vec3(0.0), vec3(1.0));
    
    return baseColor;
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors
    bool isLodMode = length(vColour - vec3(1.0, 0.4, 0.2)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get enhanced Mars surface color
    vec3 baseColor = getMarsSurfaceColor(vLocalPos, vElevation, vVolcanicActivity, vCraterDensity);
    
    // Lighting calculations
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Thin atmosphere effect (much weaker than Earth)
    float atmosphere = pow(1.0 - NdotV, 4.0);
    vec3 atmosphereColor = vec3(0.8, 0.6, 0.4) * atmosphere * 0.08;
    
    // Dust storm atmospheric effects
    vec3 p = vLocalPos * uNoiseScale + vec3(uNoiseOffset);
    float dustStorm = noise3d(p * 1.5 + vec3(uTime * 0.03));
    float dustHaze = smoothstep(0.6, 0.85, dustStorm) * 0.15;
    vec3 dustColor = vec3(0.7, 0.5, 0.3);
    
    // Enhanced lighting model for Mars
    float ambient = 0.28; // Higher ambient due to dust in atmosphere
    float diffuse = 0.72 * NdotL * attenuation;
    
    // Subsurface scattering for dusty surfaces
    float subsurface = max(0.0, dot(-N, L)) * 0.2;
    diffuse += subsurface * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor;
    finalColor = mix(finalColor, dustColor, dustHaze);
    
    // Mars-specific gamma correction and color grading
    finalColor = pow(finalColor, vec3(0.85)) * vec3(1.05, 1.0, 0.95);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createMarsUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1i(uniforms.uShowLod, showLod ? 1 : 0);
        gl.uniform1f(uniforms.uTime, time); // Always pass time for dust storms
        gl.uniform3fv(uniforms.uPlanetColor, new Float32Array(body.color));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform1i(uniforms.uHasWaves, body.waveType || 0);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 12.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
export const logDepthVertexShaderSource = `#version 300 es
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

// Simple 3D hash for noise
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Basic 3D noise
float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Enhanced Earth with 3D continents
float earthTerrain(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Large continents using 3D noise
    float continents = noise3d(p * 0.8) * 0.08;
    
    // Mountains
    float mountains = abs(noise3d(p * 2.0)) * 0.04;
    
    // Ocean waves
    float waves = sin(t * 2.0 + p.x * 20.0) * sin(t * 1.5 + p.z * 15.0) * 0.003;
    
    return continents + mountains + waves;
}

// Mars with craters and canyons
float marsTerrain(vec3 n, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Basic terrain
    float terrain = noise3d(p * 1.5) * 0.06;
    
    // Simple crater approximation
    float craters = 0.0;
    vec3 cp = p * 3.0;
    float cd = length(fract(cp) - 0.5);
    if(cd < 0.3) {
        craters = -0.02 * (0.3 - cd);
    }
    
    return terrain + craters;
}

// Moon with heavy cratering
float moonTerrain(vec3 n, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Multiple crater sizes
    float craters = 0.0;
    for(int i = 0; i < 3; i++) {
        vec3 cp = p * (2.0 + float(i));
        float cd = length(fract(cp) - 0.5);
        if(cd < 0.4) {
            craters += -0.015 * (0.4 - cd);
        }
    }
    
    // Fine detail
    float detail = noise3d(p * 8.0) * 0.005;
    
    return craters + detail;
}

float mercuryTerrain(vec3 n, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Heavy cratering like the Moon but more extreme
    float craters = 0.0;
    for(int i = 0; i < 4; i++) {
        vec3 cp = p * (1.5 + float(i) * 0.8);
        float cd = length(fract(cp) - 0.5);
        if(cd < 0.35) {
            craters += -0.02 * (0.35 - cd);
        }
    }
    
    // Caloris Basin-like large impact
    vec3 basinPos = p * 0.6;
    float basinDist = length(fract(basinPos) - 0.5);
    if(basinDist < 0.4) {
        craters += -0.06 * (0.4 - basinDist);
    }
    
    // Lobate scarps (cliffs from planetary shrinking)
    float scarps = abs(sin(p.x * 8.0 + p.z * 6.0)) * 0.015;
    
    // Fine regolith detail
    float detail = noise3d(p * 12.0) * 0.008;
    
    return craters + scarps + detail;
}

// Keep original ocean waves
float oceanWaves(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float amp1 = 0.06, freq1 = 7.0, speed1 = 3.1416;
    float amp2 = 0.025, freq2 = 16.0, speed2 = 2.0;
    float w = 0.0;
    w += amp1 * sin(freq1 * p.x + speed1 * t);
    w += amp1 * sin(freq1 * p.y + speed1 * t * 0.75);
    w += amp2 * sin(freq2 * p.z + speed2 * t);
    return w * 0.1;
}

// Keep original solar flares
float solarFlares(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float amp1 = 0.15, freq1 = 4.0, speed1 = 2.0;
    float amp2 = 0.08, freq2 = 8.0, speed2 = 3.5;
    float amp3 = 0.04, freq3 = 16.0, speed3 = 5.0;
    float w = 0.0;
    w += amp1 * sin(freq1 * p.x + speed1 * t) * cos(freq1 * p.z + speed1 * t * 0.7);
    w += amp2 * sin(freq2 * p.y + speed2 * t) * sin(freq2 * p.x + speed2 * t * 1.3);
    w += amp3 * sin(freq3 * p.z + speed3 * t);
    return w * 0.2;
}

// Keep original gas giant bands
float gasGiantBands(vec3 n, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float bands = sin(p.y * 8.0 + sin(p.x * 3.0) * 0.5) * 0.02;
    bands += sin(p.y * 16.0 + cos(p.z * 2.0) * 0.3) * 0.01;
    return bands;
}

float getDisplacement(vec3 n, float t) {
    if(uHasWaves == 1) {
        return earthTerrain(n, t, uNoiseScale, uNoiseOffset);
    } else if(uHasWaves == 2) {
        return solarFlares(n, t, uNoiseScale, uNoiseOffset);
    } else if(uHasWaves == 3) {
        return marsTerrain(n, uNoiseScale, uNoiseOffset);
    } else if(uHasWaves == 4) {
        return gasGiantBands(n, uNoiseScale, uNoiseOffset);
    } else if(uHasWaves == 5) {
        return moonTerrain(n, uNoiseScale, uNoiseOffset);
    } else if(uHasWaves == 6) {
        return mercuryTerrain(n, uNoiseScale, uNoiseOffset);
    }
    return 0.0;
}

vec3 calculateDisplacedNormal(vec3 n, float t, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(cross(n, vec3(0.0, 1.0, 0.0))) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float h = getDisplacement(n, t);
    float h1 = getDisplacement(n1, t);
    float h2 = getDisplacement(n2, t);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + getDisplacement(normalize(e0), t);
    float r1 = 1.0 + getDisplacement(normalize(e1), t);
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

vec3 morphTargetNormal(vec3 dir, vec3 e0, vec3 e1, float t, float epsilon) {
    vec3 n0 = calculateDisplacedNormal(normalize(e0), t, epsilon);
    vec3 n1 = calculateDisplacedNormal(normalize(e1), t, epsilon);
    
    float r0 = 1.0 + getDisplacement(normalize(e0), t);
    float r1 = 1.0 + getDisplacement(normalize(e1), t);
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
    
    float r0 = uPlanetRadius * (1.0 + getDisplacement(n, uTime));
    vec3 baseNormal = calculateDisplacedNormal(n, uTime, 0.01);
    
    float finalRadius = r0;
    vec3 finalNormal = baseNormal;
    
    if(aMorphable > 0.5) {
        float morphR = morphTargetRadius(n, aEdge0, aEdge1, uTime) * uPlanetRadius;
        finalRadius = mix(r0, morphR, aMorphable * aMorphFactor);
        
        vec3 morphN = morphTargetNormal(n, aEdge0, aEdge1, uTime, 0.01);
        finalNormal = normalize(mix(baseNormal, morphN, aMorphable * aMorphFactor));
    }
    
    vPos = n * finalRadius;
    vWorldPos = (uModel * vec4(vPos, 1.0)).xyz;
    vWorldNormal = normalize(uNormalMatrix * finalNormal);
    
    if(uShowLod == 1) {
        vColour = getLodColor(aLod);
    } else {
        vColour = uPlanetColor;
    }
    
    vec4 clipPos = uProj * uView * uModel * vec4(vPos, 1.0);
    gl_Position = clipPos;
    
    // Logarithmic depth calculation
    vLogDepth = 1.0 + clipPos.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= clipPos.w;
}
`;

export const logDepthFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;
in vec3 vColour, vPos, vWorldPos, vWorldNormal;
in float vLogDepth;
out vec4 fragColor;

uniform vec3 uCameraPos;
uniform mediump int uHasWaves;
uniform vec3 uSunPosition;
uniform float uLogDepthBufFC;

void main() {
    // Set logarithmic depth
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    vec3 L = normalize(lightDir);
    
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // FIXED: Adjusted attenuation for 10x scale - reduced falloff by 100x
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001); // Was 0.0001, now 0.000001
    
    float NdotL = max(0.0, dot(N, L));
    
    float ambient = 0.15;
    float diffuse = 0.85 * NdotL * attenuation;
    
    float rim = 1.0 - max(0.0, dot(N, V));
    rim = pow(rim, 3.0) * 0.15 * attenuation;
    
    // Special handling for sun (no attenuation needed)
    if(uHasWaves == 2) {
        ambient = 0.8;
        diffuse = 0.4;
        rim *= 2.0;
        attenuation = 1.0;
    }
    
    float lighting = ambient + diffuse + rim;
    
    vec3 finalColor = vColour * lighting;
    
    finalColor = pow(finalColor, vec3(0.9));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

// Updated line shaders with logarithmic depth
export const logDepthLineVertexShaderSource = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPosition;
layout(location=1) in float aAlpha;

uniform mat4 uModel, uView, uProj;
uniform vec3 uColor;
uniform float uLogDepthBufFC;

out vec3 vColor;
out float vAlpha;
out float vLogDepth;

void main() {
    vColor = uColor;
    vAlpha = aAlpha;
    
    vec4 clipPos = uProj * uView * uModel * vec4(aPosition, 1.0);
    gl_Position = clipPos;
    
    // Logarithmic depth calculation
    vLogDepth = 1.0 + clipPos.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= clipPos.w;
}
`;

export const logDepthLineFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;
in vec3 vColor;
in float vAlpha;
in float vLogDepth;
out vec4 fragColor;

uniform float uLogDepthBufFC;

void main() {
    // Set logarithmic depth
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    fragColor = vec4(vColor, vAlpha);
}
`;
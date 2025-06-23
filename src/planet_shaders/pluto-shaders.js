export const plutoVertexShaderSource = `#version 300 es
precision highp float;
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

// Pluto surface features (rocky dwarf planet)
float plutoSurface(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Large impact craters
    float craters = 0.0;
    for (int i = 0; i < 4; i++) {
        vec3 craterCenter = normalize(vec3(
            sin(float(i) * 2.4 + 100.0),
            cos(float(i) * 1.8 + 200.0),
            sin(float(i) * 3.1 + 300.0)
        ));
        
        float craterDist = distance(n, craterCenter);
        float craterSize = 0.3 + float(i) * 0.1;
        
        if (craterDist < craterSize) {
            float craterDepth = (craterSize - craterDist) / craterSize;
            craters += -craterDepth * craterDepth * 0.08;
        }
    }
    
    // Sputnik Planitia (heart-shaped nitrogen plain)
    vec3 heartCenter = normalize(vec3(0.5, 0.3, 0.8));
    float heartDist = distance(n, heartCenter);
    float heartPlain = 0.0;
    if (heartDist < 0.4) {
        float heartShape = smoothstep(0.4, 0.1, heartDist);
        heartPlain = -heartShape * 0.03; // Smooth plain
    }
    
    // Mountain ranges and ridges
    float mountains = 0.0;
    mountains += abs(noise3d(p * 1.5 + vec3(400.0))) - 0.5;
    mountains = max(0.0, mountains) * 0.12;
    
    // Chasma Borealis (large canyon system)
    float canyons = 0.0;
    float canyonNoise = abs(noise3d(p * 0.8 + vec3(500.0))) - 0.6;
    if (canyonNoise > 0.0) {
        canyons = -canyonNoise * 0.06;
    }
    
    // General surface roughness
    float roughness = 0.0;
    roughness += noise3d(p * 3.0 + vec3(600.0)) * 0.02;
    roughness += noise3d(p * 6.0 + vec3(700.0)) * 0.01;
    roughness += noise3d(p * 12.0 + vec3(800.0)) * 0.005;
    
    // Nitrogen ice deposits (seasonal)
    float latitude = abs(n.y);
    float iceDeposits = 0.0;
    if (latitude > 0.7) {
        float iceNoise = noise3d(p * 4.0 + vec3(900.0)) * 0.5 + 0.5;
        iceDeposits = smoothstep(0.7, 0.9, latitude) * iceNoise * 0.01;
    }
    
    float totalDisplacement = craters + heartPlain + mountains + canyons + roughness + iceDeposits;
    
    // Prevent excessive negative displacement
    totalDisplacement = max(totalDisplacement, -0.1);
    
    return totalDisplacement;
}

vec3 calculateDisplacedNormal(vec3 n, float t, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(cross(n, vec3(0.0, 1.0, 0.0))) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float h = plutoSurface(n, t, uNoiseScale, uNoiseOffset);
    float h1 = plutoSurface(n1, t, uNoiseScale, uNoiseOffset);
    float h2 = plutoSurface(n2, t, uNoiseScale, uNoiseOffset);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + plutoSurface(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + plutoSurface(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float r0 = 1.0 + plutoSurface(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + plutoSurface(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float displacement = plutoSurface(n, uTime, uNoiseScale, uNoiseOffset);
    float r0 = uPlanetRadius * (1.0 + displacement);
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
    vElevation = displacement;
    
    vTexCoord = vec2(
        atan(n.z, n.x) / (2.0 * 3.14159) + 0.5,
        asin(n.y) / 3.14159 + 0.5
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

export const plutoFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision highp float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in vec2 vTexCoord;

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

vec3 getPlutoSurfaceColor(vec3 localPos, float elevation, vec2 texCoord) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Pluto's varied surface colors
    vec3 darkTerrain = vec3(0.3, 0.25, 0.2);     // Dark reddish-brown
    vec3 lightTerrain = vec3(0.7, 0.6, 0.5);     // Lighter tan
    vec3 heartPlain = vec3(0.9, 0.85, 0.8);      // Sputnik Planitia (bright nitrogen)
    vec3 redDeposits = vec3(0.6, 0.3, 0.2);      // Tholins (organic compounds)
    vec3 iceDeposits = vec3(0.95, 0.9, 0.85);    // Nitrogen/methane ice
    vec3 craterMaterial = vec3(0.2, 0.18, 0.15);  // Impact crater material
    
    // Base terrain color variation
    float terrainNoise = noise3d(p * 2.0) * 0.5 + 0.5;
    vec3 baseColor = mix(darkTerrain, lightTerrain, terrainNoise);
    
    // Sputnik Planitia (heart-shaped plain)
    vec3 heartCenter = normalize(vec3(0.5, 0.3, 0.8));
    float heartDist = distance(localPos, heartCenter);
    if (heartDist < 0.4) {
        float heartIntensity = smoothstep(0.4, 0.1, heartDist);
        baseColor = mix(baseColor, heartPlain, heartIntensity);
    }
    
    // Impact craters
    for (int i = 0; i < 4; i++) {
        vec3 craterCenter = normalize(vec3(
            sin(float(i) * 2.4 + 100.0),
            cos(float(i) * 1.8 + 200.0),
            sin(float(i) * 3.1 + 300.0)
        ));
        
        float craterDist = distance(localPos, craterCenter);
        float craterSize = 0.3 + float(i) * 0.1;
        
        if (craterDist < craterSize) {
            float craterIntensity = smoothstep(craterSize, craterSize * 0.3, craterDist);
            baseColor = mix(baseColor, craterMaterial, craterIntensity * 0.7);
        }
    }
    
    // Tholins (reddish organic deposits)
    float tholinPattern = noise3d(p * 1.5 + vec3(400.0)) * 0.5 + 0.5;
    if (tholinPattern > 0.6) {
        float tholinIntensity = smoothstep(0.6, 0.8, tholinPattern);
        baseColor = mix(baseColor, redDeposits, tholinIntensity * 0.4);
    }
    
    // Polar ice deposits
    float latitude = abs(localPos.y);
    if (latitude > 0.7) {
        float iceNoise = noise3d(p * 4.0 + vec3(900.0)) * 0.5 + 0.5;
        float iceIntensity = smoothstep(0.7, 0.9, latitude) * iceNoise;
        baseColor = mix(baseColor, iceDeposits, iceIntensity * 0.6);
    }
    
    // Surface texture variation
    float surfaceDetail = noise3d(p * 8.0) * 0.1;
    baseColor += vec3(surfaceDetail);
    
    // Elevation-based color variation
    if (elevation > 0.05) {
        // High elevations are more reddish
        baseColor = mix(baseColor, redDeposits, (elevation - 0.05) * 2.0);
    } else if (elevation < -0.03) {
        // Low elevations (craters, plains) are darker
        baseColor = mix(baseColor, craterMaterial, (-elevation - 0.03) * 3.0);
    }
    
    return clamp(baseColor, vec3(0.1), vec3(0.95));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    bool isLodMode = length(vColour - vec3(0.8, 0.7, 0.6)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    vec3 baseColor = getPlutoSurfaceColor(vLocalPos, vElevation, vTexCoord);
    
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Very thin atmosphere effect (almost none)
    float atmosphere = pow(1.0 - NdotV, 4.0);
    vec3 atmosphereColor = vec3(0.4, 0.35, 0.3) * atmosphere * 0.05;
    
    // Minimal rim lighting
    float rim = 1.0 - NdotV;
    vec3 rimGlow = baseColor * pow(rim, 8.0) * 0.1;
    
    // Lighting (very distant from sun, so mostly ambient)
    float ambient = 0.4; // Higher ambient due to distance from sun
    float diffuse = 0.6 * NdotL * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + rimGlow;
    
    // Gamma correction
    finalColor = pow(finalColor, vec3(0.85));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createPlutoUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1i(uniforms.uShowLod, showLod ? 1 : 0);
        gl.uniform1f(uniforms.uTime, animateWaves ? time : 0);
        gl.uniform3fv(uniforms.uPlanetColor, new Float32Array(body.color));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform1i(uniforms.uHasWaves, body.waveType || 0);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 40.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
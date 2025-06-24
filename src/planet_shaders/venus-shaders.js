export const venusVertexShaderSource = `#version 300 es
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

// Venus terrain with volcanic features and highland regions
float venusTerrain(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Base terrain
    float terrain = 0.0;
    terrain += noise3d(p * 0.6) * 0.12;
    terrain += noise3d(p * 1.2) * 0.06;
    terrain += noise3d(p * 2.4) * 0.03;
    
    // Ishtar Terra (northern highland)
    vec3 ishtarCenter = vec3(0.2, 0.8, 0.3);
    ishtarCenter = normalize(ishtarCenter);
    float distToIshtar = length(n - ishtarCenter);
    float ishtarTerra = exp(-distToIshtar * 12.0) * 0.2;
    
    // Aphrodite Terra (equatorial highland)
    vec3 aphroditeCenter = vec3(0.7, 0.1, 0.6);
    aphroditeCenter = normalize(aphroditeCenter);
    float distToAphrodite = length(n - aphroditeCenter);
    float aphroditeTerra = exp(-distToAphrodite * 10.0) * 0.18;
    
    // Volcanic features
    float volcanoes = 0.0;
    for(int i = 0; i < 6; i++) {
        vec3 volcanoPos = normalize(vec3(
            sin(float(i) * 2.1) * 0.9,
            cos(float(i) * 1.3) * 0.7,
            sin(float(i) * 2.8) * 0.8
        ));
        float volcanoDist = length(n - volcanoPos);
        float volcanoHeight = exp(-volcanoDist * 20.0) * (0.08 + float(i) * 0.02);
        volcanoes += volcanoHeight;
    }
    
    // Rift valleys and coronae (circular volcanic features)
    float rifts = 0.0;
    for(int i = 0; i < 4; i++) {
        vec3 riftPos = normalize(vec3(
            cos(float(i) * 1.8) * 0.8,
            sin(float(i) * 2.3) * 0.6,
            cos(float(i) * 3.2) * 0.7
        ));
        float riftDist = length(n - riftPos);
        float rift = -exp(-riftDist * 15.0) * 0.05;
        rifts += rift;
    }
    
    // Atmospheric pressure effects (very subtle)
    float pressureVariation = noise3d(p * 8.0 + vec3(t * 0.1)) * 0.002;
    
    return terrain + ishtarTerra + aphroditeTerra + volcanoes + rifts + pressureVariation;
}

vec3 calculateDisplacedNormal(vec3 n, float t, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(cross(n, vec3(0.0, 1.0, 0.0))) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float h = venusTerrain(n, t, uNoiseScale, uNoiseOffset);
    float h1 = venusTerrain(n1, t, uNoiseScale, uNoiseOffset);
    float h2 = venusTerrain(n2, t, uNoiseScale, uNoiseOffset);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + venusTerrain(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + venusTerrain(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float r0 = 1.0 + venusTerrain(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + venusTerrain(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float displacement = venusTerrain(n, uTime, uNoiseScale, uNoiseOffset);
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

export const venusFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;

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

vec3 getVenusColor(vec3 localPos, float elevation) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Venus color palette - yellows and oranges
    vec3 darkVolcanic = vec3(0.4, 0.3, 0.1);
    vec3 volcanic = vec3(0.7, 0.5, 0.2);
    vec3 highland = vec3(1.0, 0.8, 0.4);
    vec3 plains = vec3(0.9, 0.7, 0.3);
    vec3 hotspot = vec3(1.0, 0.6, 0.2);
    
    // Base color variation
    float colorVariation = noise3d(p * 4.0);
    vec3 baseColor = mix(volcanic, plains, colorVariation);
    
    // Highland regions (Ishtar Terra, Aphrodite Terra)
    if (elevation > 0.12) {
        baseColor = mix(baseColor, highland, smoothstep(0.12, 0.2, elevation));
    }
    
    // Volcanic hotspots
    float volcanism = noise3d(p * 6.0);
    float hotspotIntensity = smoothstep(0.7, 0.9, volcanism);
    baseColor = mix(baseColor, hotspot, hotspotIntensity * 0.6);
    
    // Rift valleys and low areas
    if (elevation < -0.02) {
        baseColor = mix(baseColor, darkVolcanic, smoothstep(-0.02, -0.08, elevation));
    }
    
    // Surface weathering from sulfuric acid
    float weathering = noise3d(p * 8.0) * 0.5 + 0.5;
    vec3 weatheredColor = vec3(0.8, 0.6, 0.25);
    baseColor = mix(baseColor, weatheredColor, weathering * 0.3);
    
    // Atmospheric heating effects
    float atmosphericGlow = smoothstep(0.0, 0.1, elevation) * 0.2;
    baseColor += vec3(atmosphericGlow * 0.3, atmosphericGlow * 0.2, 0.0);
    
    return baseColor;
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors if they're active
    bool isLodMode = length(vColour - vec3(1.0, 0.8, 0.3)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get Venus surface color
    vec3 baseColor = getVenusColor(vLocalPos, vElevation);
    
    // Lighting calculations
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Thick atmosphere effect - very strong atmospheric scattering
    float atmosphere = pow(1.0 - NdotV, 2.0);
    vec3 atmosphereColor = vec3(1.0, 0.8, 0.4) * atmosphere * 0.4;
    
    // Greenhouse effect - everything is hot and glowing
    vec3 greenhouseGlow = vec3(0.3, 0.2, 0.1) * 0.3;
    
    // Sulfuric acid cloud effects
    vec3 p = vLocalPos * uNoiseScale + vec3(uNoiseOffset);
    float cloudDensity = noise3d(p * 3.0 + vec3(uTime * 0.02));
    float cloudShadow = 1.0 - smoothstep(0.4, 0.8, cloudDensity) * 0.4;
    
    // Venus has very diffuse lighting due to thick atmosphere
    float ambient = 0.2; // High ambient due to atmospheric scattering
    float diffuse = 0.8 * NdotL * cloudShadow;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + greenhouseGlow;
    
    // Add volcanic glow for high elevation areas
    if (vElevation > 0.1) {
        float volcGlow = smoothstep(0.1, 0.2, vElevation) * 0.2;
        finalColor += vec3(volcGlow * 0.5, volcGlow * 0.3, volcGlow * 0.1);
    }
    
    // Gamma correction
    finalColor = pow(finalColor, vec3(0.85));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createVenusUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        // Standard uniforms
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1i(uniforms.uShowLod, showLod ? 1 : 0);
        gl.uniform1f(uniforms.uTime, time); // Always pass time for atmospheric effects
        gl.uniform3fv(uniforms.uPlanetColor, new Float32Array(body.color));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform1i(uniforms.uHasWaves, body.waveType || 0);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 8.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
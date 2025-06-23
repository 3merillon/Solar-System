export const saturnVertexShaderSource = `#version 300 es
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

// Saturn atmospheric bands (more subtle than Jupiter)
float saturnAtmosphere(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float latitude = n.y;
    float longitude = atan(n.z, n.x);
    
    // Subtle banding pattern
    float bands = 0.0;
    bands += sin(latitude * 6.0 + sin(latitude * 12.0) * 0.2) * 0.008;
    bands += sin(latitude * 10.0 + cos(latitude * 20.0) * 0.15) * 0.005;
    bands += sin(latitude * 16.0 + sin(latitude * 32.0) * 0.1) * 0.003;
    
    // Longitudinal flow patterns
    float flow = sin(longitude * 4.0 + t * 0.08) * 0.003;
    flow += sin(longitude * 8.0 + t * 0.12) * 0.002;
    bands += flow * (1.0 - abs(latitude) * 0.6);
    
    // Hexagonal storm at north pole
    if (latitude > 0.85) {
        float hexAngle = longitude * 3.0; // 6-sided pattern
        float hexPattern = cos(hexAngle) * 0.004;
        bands += hexPattern * smoothstep(0.85, 0.95, latitude);
    }
    
    // Atmospheric turbulence
    float turbulence = noise3d(p * 3.0 + vec3(t * 0.05, 0.0, 0.0)) * 0.002;
    turbulence += noise3d(p * 6.0 + vec3(t * 0.03, 0.0, 0.0)) * 0.001;
    
    float totalDisplacement = bands + turbulence;
    totalDisplacement = max(totalDisplacement, -0.003);
    
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
    
    float h = saturnAtmosphere(n, t, uNoiseScale, uNoiseOffset);
    float h1 = saturnAtmosphere(n1, t, uNoiseScale, uNoiseOffset);
    float h2 = saturnAtmosphere(n2, t, uNoiseScale, uNoiseOffset);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + saturnAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + saturnAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float r0 = 1.0 + saturnAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + saturnAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float displacement = saturnAtmosphere(n, uTime, uNoiseScale, uNoiseOffset);
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

export const saturnFragmentShaderSource = `#version 300 es
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

vec3 getSaturnSurfaceColor(vec3 localPos, float elevation, vec2 texCoord) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    float latitude = localPos.y;
    float longitude = atan(localPos.z, localPos.x);
    
    // Saturn's golden color palette
    vec3 lightBand = vec3(0.98, 0.92, 0.75);    // Pale gold
    vec3 darkBand = vec3(0.85, 0.75, 0.55);     // Darker gold
    vec3 hexStorm = vec3(0.9, 0.8, 0.6);        // Hexagonal storm color
    
    // Subtle band pattern
    float bandPattern = sin(latitude * 6.0) * 0.5 + 0.5;
    bandPattern += sin(latitude * 12.0) * 0.2;
    bandPattern += sin(latitude * 20.0) * 0.1;
    
    vec3 baseColor = mix(darkBand, lightBand, smoothstep(0.4, 0.6, bandPattern));
    
    // Hexagonal storm at north pole
    if (latitude > 0.85) {
        float hexAngle = longitude * 3.0;
        float hexPattern = cos(hexAngle) * 0.5 + 0.5;
        float hexIntensity = smoothstep(0.85, 0.95, latitude);
        baseColor = mix(baseColor, hexStorm, hexPattern * hexIntensity * 0.3);
    }
    
    // Atmospheric turbulence
    float turbulence = noise3d(p * 4.0 + vec3(uTime * 0.05, 0.0, 0.0)) * 0.08;
    turbulence += noise3d(p * 8.0 + vec3(uTime * 0.03, 0.0, 0.0)) * 0.04;
    
    baseColor += vec3(turbulence * 0.15, turbulence * 0.12, turbulence * 0.08);
    
    return clamp(baseColor, vec3(0.2), vec3(1.0));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    bool isLodMode = length(vColour - vec3(1.0, 0.9, 0.6)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    vec3 baseColor = getSaturnSurfaceColor(vLocalPos, vElevation, vTexCoord);
    
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    float atmosphere = pow(1.0 - NdotV, 1.8);
    vec3 atmosphereColor = vec3(0.95, 0.85, 0.65) * atmosphere * 0.15;
    
    float limb = 1.0 - NdotV;
    vec3 limbGlow = vec3(0.9, 0.8, 0.6) * pow(limb, 3.0) * 0.25;
    
    float ambient = 0.25;
    float diffuse = 0.75 * NdotL * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + limbGlow;
    finalColor = pow(finalColor, vec3(0.9));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createSaturnUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 5.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
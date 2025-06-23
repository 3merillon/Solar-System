export const neptuneVertexShaderSource = `#version 300 es
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

// Neptune atmosphere with dynamic storms
float neptuneAtmosphere(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float latitude = n.y;
    float longitude = atan(n.z, n.x);
    
    // Dynamic atmospheric bands
    float bands = 0.0;
    bands += sin(latitude * 5.0 + sin(latitude * 10.0) * 0.2) * 0.006;
    bands += sin(latitude * 8.0 + cos(latitude * 16.0) * 0.15) * 0.004;
    bands += sin(latitude * 12.0 + sin(latitude * 24.0) * 0.1) * 0.003;
    
    // Great Dark Spot (similar to Jupiter's red spot but darker)
    float spotLat = latitude - 0.1; // Southern hemisphere
    float spotLon = mod(longitude + t * 0.015 + 3.14159, 6.28318) - 3.14159;
    float spotDistance = sqrt((spotLon * 0.8) * (spotLon * 0.8) + (spotLat * 1.5) * (spotLat * 1.5));
    
    float darkSpot = 0.0;
    if (spotDistance < 0.4) {
        darkSpot = smoothstep(0.4, 0.1, spotDistance) * 0.008;
    }
    
    // High-speed winds and storm systems
    float winds = sin(longitude * 6.0 + t * 0.2) * 0.003;
    winds += sin(longitude * 12.0 + t * 0.15) * 0.002;
    winds *= (1.0 - abs(latitude) * 0.4); // Stronger at equator
    
    // Methane storms
    float storms = noise3d(p * 3.0 + vec3(t * 0.08, 0.0, 0.0)) * 0.003;
    storms += noise3d(p * 6.0 + vec3(t * 0.06, 0.0, 0.0)) * 0.002;
    
    float totalDisplacement = bands + darkSpot + winds + storms;
    totalDisplacement = max(totalDisplacement, -0.002);
    
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
    
    float h = neptuneAtmosphere(n, t, uNoiseScale, uNoiseOffset);
    float h1 = neptuneAtmosphere(n1, t, uNoiseScale, uNoiseOffset);
    float h2 = neptuneAtmosphere(n2, t, uNoiseScale, uNoiseOffset);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + neptuneAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + neptuneAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float r0 = 1.0 + neptuneAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + neptuneAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float displacement = neptuneAtmosphere(n, uTime, uNoiseScale, uNoiseOffset);
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

export const neptuneFragmentShaderSource = `#version 300 es
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

float getGreatDarkSpotIntensity(vec3 localPos) {
    float latitude = localPos.y;
    float longitude = atan(localPos.z, localPos.x);
    
    float spotLat = latitude - 0.1;
    float spotLon = mod(longitude + uTime * 0.015 + 3.14159, 6.28318) - 3.14159;
    float spotDistance = sqrt((spotLon * 0.8) * (spotLon * 0.8) + (spotLat * 1.5) * (spotLat * 1.5));
    
    if (spotDistance > 0.4) return 0.0;
    
    float spotIntensity = smoothstep(0.4, 0.05, spotDistance);
    float innerVariation = noise3d(localPos * 10.0 + vec3(uTime * 0.1)) * 0.3 + 0.7;
    
    return clamp(spotIntensity * innerVariation, 0.0, 1.0);
}

vec3 getNeptuneSurfaceColor(vec3 localPos, float elevation, vec2 texCoord) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    float latitude = localPos.y;
    float longitude = atan(localPos.z, localPos.x);
    
    // Neptune's deep blue methane atmosphere
    vec3 baseColor = vec3(0.15, 0.3, 0.8);       // Deep blue
    vec3 lightBand = vec3(0.2, 0.4, 0.9);        // Lighter blue bands
    vec3 darkBand = vec3(0.1, 0.25, 0.7);        // Darker blue bands
    vec3 darkSpotColor = vec3(0.05, 0.15, 0.5);  // Great Dark Spot
    vec3 stormColor = vec3(0.25, 0.45, 0.85);    // Storm systems
    
    // Atmospheric banding
    float bandPattern = sin(latitude * 5.0) * 0.5 + 0.5;
    bandPattern += sin(latitude * 10.0) * 0.2;
    bandPattern += sin(latitude * 16.0) * 0.1;
    
    vec3 surfaceColor = mix(darkBand, lightBand, smoothstep(0.3, 0.7, bandPattern));
    
    // Great Dark Spot
    float darkSpotIntensity = getGreatDarkSpotIntensity(localPos);
    if (darkSpotIntensity > 0.0) {
        surfaceColor = mix(surfaceColor, darkSpotColor, darkSpotIntensity * 0.8);
        
        // Add swirling pattern
        float swirl = sin(length(vec2(longitude, latitude * 2.0)) * 15.0 + uTime * 0.6) * 0.1 + 0.9;
        surfaceColor *= mix(1.0, swirl, darkSpotIntensity * 0.4);
    }
    
    // High-speed wind patterns
    float windPattern = sin(longitude * 8.0 + uTime * 0.2 + latitude * 4.0) * 0.08;
    surfaceColor += vec3(windPattern * 0.1, windPattern * 0.15, windPattern * 0.2);
    
    // Methane storms and atmospheric turbulence
    float storms = noise3d(p * 4.0 + vec3(uTime * 0.08, 0.0, 0.0)) * 0.1;
    storms += noise3d(p * 8.0 + vec3(uTime * 0.06, 0.0, 0.0)) * 0.05;
    
    surfaceColor = mix(surfaceColor, stormColor, storms * 0.3);
    
    return clamp(surfaceColor, vec3(0.05), vec3(0.95));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    bool isLodMode = length(vColour - vec3(0.2, 0.4, 1.0)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    vec3 baseColor = getNeptuneSurfaceColor(vLocalPos, vElevation, vTexCoord);
    
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Strong atmospheric scattering
    float atmosphere = pow(1.0 - NdotV, 1.1);
    vec3 atmosphereColor = vec3(0.2, 0.5, 1.0) * atmosphere * 0.3;
    
    float limb = 1.0 - NdotV;
    vec3 limbGlow = vec3(0.1, 0.4, 0.9) * pow(limb, 2.0) * 0.5;
    
    float ambient = 0.25;
    float diffuse = 0.75 * NdotL * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + limbGlow;
    finalColor = pow(finalColor, vec3(0.9));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createNeptuneUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 7.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
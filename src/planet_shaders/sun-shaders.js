export const sunVertexShaderSource = `#version 300 es
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

// Custom sun uniforms
uniform float uIntensity;
uniform float uFlareScale;

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

// Simple hash function
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Simple 3D noise
float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Enhanced solar surface with faster animation and more detail
float solarSurfaceDisplacement(vec3 n, float t) {
    vec3 p = n * uNoiseScale + vec3(uNoiseOffset);
    
    // 3x faster time for all animations
    float fastTime = t * 7.0;
    
    // Large flowing patterns (convection cells)
    float flow1 = noise3d(p * 0.8 + vec3(fastTime * 0.05, fastTime * 0.03, fastTime * 0.04));
    
    // Medium flowing patterns (lava streams)
    float flow2 = noise3d(p * 1.5 + vec3(fastTime * 0.08, fastTime * 0.06, fastTime * 0.07));
    
    // Small bubbling patterns (granulation)
    float flow3 = noise3d(p * 3.0 + vec3(fastTime * 0.15, fastTime * 0.12, fastTime * 0.18));
    
    // Combine flows with different intensities
    float surface = flow1 * 0.08 + flow2 * 0.05 + flow3 * 0.02;
    
    // Add dramatic flares
    float flareNoise = noise3d(p * 2.0 + vec3(fastTime * 0.1));
    float flares = smoothstep(0.7, 1.0, flareNoise) * 0.15 * uFlareScale;
    
    return (surface + flares) * uIntensity;
}

vec3 calculateDisplacedNormal(vec3 n, float t, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(cross(n, vec3(0.0, 1.0, 0.0))) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float h = solarSurfaceDisplacement(n, t);
    float h1 = solarSurfaceDisplacement(n1, t);
    float h2 = solarSurfaceDisplacement(n2, t);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + solarSurfaceDisplacement(normalize(e0), t);
    float r1 = 1.0 + solarSurfaceDisplacement(normalize(e1), t);
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
    
    float r0 = 1.0 + solarSurfaceDisplacement(normalize(e0), t);
    float r1 = 1.0 + solarSurfaceDisplacement(normalize(e1), t);
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
    
    float displacement = solarSurfaceDisplacement(n, uTime);
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
    
    // Logarithmic depth calculation
    vLogDepth = 1.0 + clipPos.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= clipPos.w;
}
`;

export const sunFragmentShaderSource = `#version 300 es
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
uniform float uIntensity;
uniform float uFlareScale;

// Simple hash function
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Simple 3D noise
float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Enhanced solar color with more orange features
vec3 solarColor(float elevation, float activity, float smallFeatures) {
    // Base solar colors - more orange spectrum
    vec3 darkColor = vec3(0.6, 0.1, 0.0);      // Dark red (sunspots)
    vec3 coolColor = vec3(1.0, 0.4, 0.1);      // Orange-red
    vec3 normalColor = vec3(1.0, 0.7, 0.2);    // Bright orange
    vec3 hotColor = vec3(1.0, 0.9, 0.4);       // Yellow-orange
    vec3 flareColor = vec3(1.0, 1.0, 0.8);     // Hot white-yellow
    
    // Mix based on elevation (height = hotter)
    float tempFactor = clamp(elevation * 4.0 + 0.5, 0.0, 1.0);
    
    vec3 baseColor;
    if (tempFactor < 0.25) {
        baseColor = mix(darkColor, coolColor, tempFactor * 4.0);
    } else if (tempFactor < 0.5) {
        baseColor = mix(coolColor, normalColor, (tempFactor - 0.25) * 4.0);
    } else if (tempFactor < 0.75) {
        baseColor = mix(normalColor, hotColor, (tempFactor - 0.5) * 4.0);
    } else {
        baseColor = mix(hotColor, flareColor, (tempFactor - 0.75) * 4.0);
    }
    
    // Add small-scale orange features
    vec3 orangeFeatures = vec3(1.0, 0.5, 0.1) * smallFeatures * 0.4;
    baseColor += orangeFeatures;
    
    // Add activity variation with more orange tint
    baseColor += activity * vec3(0.4, 0.3, 0.1);
    
    return baseColor;
}

void main() {
    // Set logarithmic depth
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors if they're active
    bool isLodMode = length(vColour - vec3(1.0, 0.8, 0.2)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // 3x faster time for all animations
    float fastTime = uTime * 3.0;
    
    // Calculate surface activity with faster animation
    vec3 activityPos = vLocalPos * 4.0 + vec3(fastTime * 0.1);
    float activity = noise3d(activityPos) * 0.5 + 0.5;
    
    // Add small-scale orangish features (fast moving granulation)
    vec3 smallFeaturesPos1 = vLocalPos * 8.0 + vec3(fastTime * 0.25, fastTime * 0.2, fastTime * 0.3);
    vec3 smallFeaturesPos2 = vLocalPos * 12.0 + vec3(fastTime * 0.35, fastTime * 0.3, fastTime * 0.4);
    
    float smallFeatures1 = noise3d(smallFeaturesPos1);
    float smallFeatures2 = noise3d(smallFeaturesPos2);
    
    // Combine small features with sharp transitions for more detail
    float smallFeatures = smoothstep(0.4, 0.7, smallFeatures1) * 0.6 + 
                         smoothstep(0.5, 0.8, smallFeatures2) * 0.4;
    
    // Get enhanced solar color
    vec3 baseColor = solarColor(vElevation, activity, smallFeatures);
    
    // Add flowing magma effect with faster animation
    vec3 flowPos = vLocalPos * 6.0 + vec3(fastTime * 0.08, fastTime * 0.05, fastTime * 0.12);
    float flow = noise3d(flowPos);
    
    // Create magma flow patterns with more orange
    float magmaFlow = smoothstep(0.3, 0.8, flow);
    vec3 magmaColor = mix(vec3(0.9, 0.3, 0.1), vec3(1.0, 0.8, 0.3), magmaFlow);
    
    // Blend magma with base color
    baseColor = mix(baseColor, magmaColor, 0.3);
    
    // Add fast-moving lava streams
    vec3 lavaStreamPos = vLocalPos * 10.0 + vec3(fastTime * 0.4, fastTime * 0.3, fastTime * 0.5);
    float lavaStream = noise3d(lavaStreamPos);
    float lavaIntensity = smoothstep(0.6, 0.9, lavaStream) * 0.5;
    baseColor += lavaIntensity * vec3(1.0, 0.6, 0.2);
    
    // Add flares on elevated areas with more orange
    float flareIntensity = smoothstep(0.05, 0.2, vElevation) * activity;
    baseColor += flareIntensity * vec3(0.8, 0.5, 0.2) * uFlareScale;
    
    // Add small bright orange spots (solar granules)
    vec3 granulePos = vLocalPos * 15.0 + vec3(fastTime * 0.6);
    float granules = noise3d(granulePos);
    float granuleIntensity = smoothstep(0.75, 0.95, granules) * 0.3;
    baseColor += granuleIntensity * vec3(1.0, 0.7, 0.3);
    
    // Corona effect (edge glow) with orange tint
    float fresnel = 1.0 - abs(dot(V, N));
    float corona = pow(fresnel, 2.0) * 0.4;
    baseColor += corona * vec3(1.0, 0.6, 0.3);
    
    // Add some flickering effect
    vec3 flickerPos = vLocalPos * 20.0 + vec3(fastTime * 0.8);
    float flicker = noise3d(flickerPos) * 0.1 + 0.95;
    baseColor *= flicker;
    
    // Apply intensity
    baseColor *= uIntensity * 1.6;
    
    // Ensure minimum brightness with orange tint
    baseColor = max(baseColor, vec3(0.5, 0.25, 0.1));
    
    // Enhanced gamma correction for more vibrant colors
    baseColor = pow(baseColor, vec3(0.85));
    
    fragColor = vec4(baseColor, 1.0);
}
`;

// Keep the same uniform setup
export function createSunUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        // Standard uniforms
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 3.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
        
        // Simple custom sun uniforms
        if (uniforms.uIntensity) {
            gl.uniform1f(uniforms.uIntensity, 1.0);
        }
        if (uniforms.uFlareScale) {
            gl.uniform1f(uniforms.uFlareScale, 1.2); // Slightly increased for more dramatic flares
        }
    };
}
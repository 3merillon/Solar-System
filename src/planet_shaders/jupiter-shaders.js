export const jupiterVertexShaderSource = `#version 300 es
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

// Smooth Great Red Spot function
float greatRedSpotContribution(vec3 n, float t) {
    float latitude = n.y;
    float longitude = atan(n.z, n.x);
    
    // FIXED: Better positioning and wrapping
    float spotLat = latitude + 0.15; // Slightly south of equator
    float spotLon = mod(longitude + t * 0.01 + 3.14159, 6.28318) - 3.14159; // Proper wrapping
    
    // IMPROVED: Elliptical shape more like the real Great Red Spot
    float latScale = 1.8;  // Taller than wide
    float lonScale = 1.0;
    
    float spotDistance = sqrt(
        (spotLon * lonScale) * (spotLon * lonScale) + 
        (spotLat * latScale) * (spotLat * latScale)
    );
    
    float spotSize = 0.35; // Reduced size for better integration
    
    if (spotDistance > spotSize) return 0.0;
    
    // SMOOTH: Multiple falloff layers for seamless integration
    float spotIntensity = smoothstep(spotSize, spotSize * 0.3, spotDistance);
    spotIntensity *= smoothstep(spotSize * 0.1, spotSize * 0.5, spotDistance); // Inner smoothing
    
    // SUBTLE: Much smaller displacement
    float displacement = spotIntensity * 0.005; // Reduced from 0.02
    
    // Add gentle swirling motion without sharp edges
    float swirl = sin(spotDistance * 8.0 + t * 0.3) * spotIntensity * 0.002;
    
    return displacement + swirl;
}

// Jupiter atmospheric bands and storm systems
float jupiterAtmosphere(vec3 n, float t, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    
    // Latitude-based banding (Jupiter's main feature)
    float latitude = n.y; // -1 to 1
    
    // Main atmospheric bands
    float bands = 0.0;
    
    // Large-scale band structure
    bands += sin(latitude * 8.0 + sin(latitude * 16.0) * 0.3) * 0.015;
    bands += sin(latitude * 12.0 + cos(latitude * 24.0) * 0.2) * 0.01;
    bands += sin(latitude * 20.0 + sin(latitude * 40.0) * 0.15) * 0.008;
    
    // Longitudinal variations in bands (atmospheric flow)
    float longitude = atan(n.z, n.x);
    float bandFlow = sin(longitude * 3.0 + t * 0.1) * 0.005;
    bandFlow += sin(longitude * 7.0 + t * 0.15) * 0.003;
    bands += bandFlow * (1.0 - abs(latitude) * 0.5); // Stronger at equator
    
    // IMPROVED: Great Red Spot with smooth integration
    float greatRedSpot = greatRedSpotContribution(n, t);
    
    // Smaller storm systems
    float storms = 0.0;
    for (int i = 0; i < 3; i++) {
        float stormLat = latitude + float(i) * 0.7 - 1.0;
        float stormLon = longitude + float(i) * 2.0 + t * (0.05 + float(i) * 0.02);
        float stormDist = length(vec2(stormLon * 0.8, stormLat * 1.5));
        
        if (stormDist < 0.4) {
            float stormIntensity = smoothstep(0.4, 0.1, stormDist);
            storms += stormIntensity * 0.004; // Reduced intensity
        }
    }
    
    // Atmospheric turbulence
    float turbulence = 0.0;
    turbulence += noise3d(p * 2.0 + vec3(t * 0.1, 0.0, 0.0)) * 0.004;
    turbulence += noise3d(p * 4.0 + vec3(t * 0.05, 0.0, 0.0)) * 0.002;
    turbulence += noise3d(p * 8.0 + vec3(t * 0.03, 0.0, 0.0)) * 0.001;
    
    // Combine all atmospheric features
    float totalDisplacement = bands + greatRedSpot + storms + turbulence;
    
    // Jupiter is a gas giant - keep displacement small and positive
    totalDisplacement = max(totalDisplacement, -0.005);
    
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
    
    float h = jupiterAtmosphere(n, t, uNoiseScale, uNoiseOffset);
    float h1 = jupiterAtmosphere(n1, t, uNoiseScale, uNoiseOffset);
    float h2 = jupiterAtmosphere(n2, t, uNoiseScale, uNoiseOffset);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float r0 = 1.0 + jupiterAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + jupiterAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float r0 = 1.0 + jupiterAtmosphere(normalize(e0), t, uNoiseScale, uNoiseOffset);
    float r1 = 1.0 + jupiterAtmosphere(normalize(e1), t, uNoiseScale, uNoiseOffset);
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
    
    float displacement = jupiterAtmosphere(n, uTime, uNoiseScale, uNoiseOffset);
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
    
    // Generate texture coordinates
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

export const jupiterFragmentShaderSource = `#version 300 es
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

// IMPROVED: Smooth Great Red Spot color function
float getGreatRedSpotIntensity(vec3 localPos) {
    float latitude = localPos.y;
    float longitude = atan(localPos.z, localPos.x);
    
    // Same positioning as vertex shader
    float spotLat = latitude + 0.15;
    float spotLon = mod(longitude + uTime * 0.01 + 3.14159, 6.28318) - 3.14159;
    
    float latScale = 1.8;
    float lonScale = 1.0;
    
    float spotDistance = sqrt(
        (spotLon * lonScale) * (spotLon * lonScale) + 
        (spotLat * latScale) * (spotLat * latScale)
    );
    
    float spotSize = 0.35;
    
    if (spotDistance > spotSize) return 0.0;
    
    // SMOOTH: Multiple falloff layers for color blending
    float spotIntensity = smoothstep(spotSize, spotSize * 0.2, spotDistance);
    spotIntensity *= smoothstep(spotSize * 0.05, spotSize * 0.4, spotDistance);
    
    // Add subtle variation within the spot
    float innerVariation = noise3d(localPos * 8.0 + vec3(uTime * 0.1)) * 0.3 + 0.7;
    spotIntensity *= innerVariation;
    
    return clamp(spotIntensity, 0.0, 1.0);
}

// Jupiter atmospheric coloring
vec3 getJupiterSurfaceColor(vec3 localPos, float elevation, vec2 texCoord) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    float latitude = localPos.y;
    float longitude = atan(localPos.z, localPos.x);
    
    // Jupiter's characteristic color bands
    vec3 lightBand = vec3(0.95, 0.85, 0.65);    // Cream/beige zones
    vec3 darkBand = vec3(0.7, 0.5, 0.3);        // Brown belts
    vec3 redBand = vec3(0.8, 0.4, 0.2);         // Reddish areas
    vec3 greatRedSpotColor = vec3(0.85, 0.25, 0.15); // Great Red Spot (darker red)
    vec3 stormColor = vec3(0.6, 0.6, 0.8);      // Bluish storms
    
    // Create alternating bands based on latitude
    float bandPattern = sin(latitude * 8.0) * 0.5 + 0.5;
    bandPattern += sin(latitude * 16.0) * 0.2;
    bandPattern += sin(latitude * 24.0) * 0.1;
    
    // Base color from band pattern
    vec3 baseColor = mix(darkBand, lightBand, smoothstep(0.3, 0.7, bandPattern));
    
    // Add reddish tint to certain latitudes
    float redZone = smoothstep(0.2, 0.4, abs(latitude)) * smoothstep(0.8, 0.6, abs(latitude));
    baseColor = mix(baseColor, redBand, redZone * 0.3);
    
    // IMPROVED: Great Red Spot with smooth blending
    float spotIntensity = getGreatRedSpotIntensity(localPos);
    if (spotIntensity > 0.0) {
        // Smooth color transition
        vec3 spotColor = mix(greatRedSpotColor, vec3(0.9, 0.4, 0.2), spotIntensity * 0.5);
        baseColor = mix(baseColor, spotColor, spotIntensity);
        
        // Add subtle swirling pattern
        float swirl = sin(length(vec2(longitude, latitude * 2.0)) * 12.0 + uTime * 0.4) * 0.1 + 0.9;
        baseColor *= mix(1.0, swirl, spotIntensity * 0.5);
    }
    
    // Smaller storm systems with smoother integration
    for (int i = 0; i < 3; i++) {
        float stormLat = latitude + float(i) * 0.7 - 1.0;
        float stormLon = longitude + float(i) * 2.0 + uTime * (0.05 + float(i) * 0.02);
        float stormDist = length(vec2(stormLon * 0.8, stormLat * 1.5));
        
        if (stormDist < 0.4) {
            float stormIntensity = smoothstep(0.4, 0.05, stormDist) * 0.4; // Reduced intensity
            baseColor = mix(baseColor, stormColor, stormIntensity);
        }
    }
    
    // Atmospheric turbulence and cloud details
    float turbulence = noise3d(p * 3.0 + vec3(uTime * 0.1, 0.0, 0.0)) * 0.12;
    turbulence += noise3d(p * 6.0 + vec3(uTime * 0.05, 0.0, 0.0)) * 0.06;
    turbulence += noise3d(p * 12.0 + vec3(uTime * 0.03, 0.0, 0.0)) * 0.03;
    
    baseColor += vec3(turbulence * 0.2, turbulence * 0.15, turbulence * 0.1);
    
    // Band flow variations
    float flowPattern = sin(longitude * 5.0 + uTime * 0.1 + latitude * 3.0) * 0.04;
    baseColor += vec3(flowPattern);
    
    // Ensure colors stay in valid range
    baseColor = clamp(baseColor, vec3(0.1), vec3(1.0));
    
    return baseColor;
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors if they're active
    bool isLodMode = length(vColour - vec3(0.9, 0.7, 0.4)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get Jupiter surface color
    vec3 baseColor = getJupiterSurfaceColor(vLocalPos, vElevation, vTexCoord);
    
    // Lighting calculations with adjusted attenuation for 10x scale
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Gas giant atmospheric scattering (more pronounced than rocky planets)
    float atmosphere = pow(1.0 - NdotV, 1.5);
    vec3 atmosphereColor = vec3(0.9, 0.7, 0.4) * atmosphere * 0.2;
    
    // Atmospheric glow on the limb
    float limb = 1.0 - NdotV;
    vec3 limbGlow = vec3(0.8, 0.6, 0.3) * pow(limb, 4.0) * 0.3;
    
    // Final lighting
    float ambient = 0.3; // Higher ambient for gas giant
    float diffuse = 0.7 * NdotL * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + limbGlow;
    
    // Gamma correction
    finalColor = pow(finalColor, vec3(0.9));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createJupiterUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 4.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
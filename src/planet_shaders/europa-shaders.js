export const europaVertexShaderSource = `#version 300 es
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
out float vIceThickness;
out float vCrackDensity;
out float vOceanActivity;

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

// Flowing ice patterns like figure skating trails! ⛸️
float iceFlowPattern(vec3 p, float time) {
    // Graceful flowing curves
    float flow1 = sin(p.x * 3.0 + time * 0.8) * cos(p.z * 2.5 + time * 0.6);
    float flow2 = sin(p.y * 2.0 + time * 0.5) * cos(p.x * 3.5 + time * 0.7);
    
    // Figure-8 patterns
    float figure8 = sin(p.x * 4.0 + time * 0.3) * sin(p.z * 4.0 + time * 0.4);
    
    return (flow1 + flow2 + figure8) * 0.008;
}

// Ice cracks that shift and heal! ❄️
float iceCrackSystem(vec3 n, vec3 p, float time) {
    float cracks = 0.0;
    
    // Major lineae (large cracks)
    float linea1 = abs(sin(p.x * 2.0 + time * 0.1)) - 0.95;
    if (linea1 > 0.0) {
        cracks -= linea1 * 0.02;
    }
    
    float linea2 = abs(sin(p.z * 1.8 + p.x * 0.5 + time * 0.08)) - 0.92;
    if (linea2 > 0.0) {
        cracks -= linea2 * 0.015;
    }
    
    // Cycloid patterns (curved cracks from tidal forces)
    float cycloid = abs(sin(p.x * 3.0 + sin(p.z * 2.0) + time * 0.05)) - 0.9;
    if (cycloid > 0.0) {
        cracks -= cycloid * 0.012;
    }
    
    return cracks;
}

// Chaos terrain - broken ice blocks! 🧊
float chaosBlocks(vec3 n, vec3 center, float radius) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    float blockHeight = (1.0 - t) * 0.03;
    
    // Tilted ice blocks
    float tilt = sin(center.x * 20.0) * cos(center.z * 15.0) * 0.01;
    
    return blockHeight + tilt;
}

float europaIceTerrain(vec3 n, float scale, float offset, out float iceThickness, out float crackDensity, out float oceanActivity) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    iceThickness = 1.0; // Start with thick ice
    crackDensity = 0.0;
    oceanActivity = 0.0;
    
    // Smooth ice base with flowing patterns
    terrain += iceFlowPattern(p, uTime);
    
    // Ice crack systems
    float cracks = iceCrackSystem(n, p, uTime);
    terrain += cracks;
    if (cracks < 0.0) {
        crackDensity += (-cracks) * 50.0;
        iceThickness -= (-cracks) * 20.0; // Thinner ice at cracks
    }
    
    // Chaos terrain regions
    vec3 chaos1 = normalize(vec3(0.6, 0.4, 0.7));
    float chaosRegion1 = chaosBlocks(n, chaos1, 0.3);
    terrain += chaosRegion1;
    if (chaosRegion1 > 0.01) {
        crackDensity += chaosRegion1 * 15.0;
        iceThickness -= chaosRegion1 * 8.0;
    }
    
    vec3 chaos2 = normalize(vec3(-0.5, -0.6, 0.6));
    float chaosRegion2 = chaosBlocks(n, chaos2, 0.25);
    terrain += chaosRegion2;
    if (chaosRegion2 > 0.01) {
        crackDensity += chaosRegion2 * 12.0;
        iceThickness -= chaosRegion2 * 6.0;
    }
    
    // Subsurface ocean effects - subtle bulging
    float oceanPulse = sin(uTime * 0.3 + p.x * 1.5) * cos(uTime * 0.25 + p.z * 1.2);
    float oceanBulge = oceanPulse * 0.003;
    terrain += oceanBulge;
    oceanActivity = abs(oceanPulse);
    
    // Tidal flexing creates gentle waves in the ice
    float tidalFlex = sin(p.x * 1.0 + uTime * 0.1) * sin(p.z * 0.8 + uTime * 0.08);
    terrain += tidalFlex * 0.002;
    
    // Ice ridges from compression
    float ridgePattern = noise3d(p * 2.0);
    if (ridgePattern > 0.7) {
        float ridge = (ridgePattern - 0.7) * 0.1;
        terrain += ridge;
        iceThickness += ridge * 5.0;
    }
    
    // Very fine ice texture - like zamboni marks! 
    terrain += noise3d(p * 15.0) * 0.001;
    terrain += noise3d(p * 25.0) * 0.0005;
    
    // Clamp values
    iceThickness = clamp(iceThickness, 0.1, 2.0);
    crackDensity = clamp(crackDensity, 0.0, 1.0);
    oceanActivity = clamp(oceanActivity, 0.0, 1.0);
    terrain = clamp(terrain, -0.025, 0.04);
    
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
    
    float iceThickness, crackDensity, oceanActivity;
    float h = europaIceTerrain(n, uNoiseScale, uNoiseOffset, iceThickness, crackDensity, oceanActivity);
    float h1 = europaIceTerrain(n1, uNoiseScale, uNoiseOffset, iceThickness, crackDensity, oceanActivity);
    float h2 = europaIceTerrain(n2, uNoiseScale, uNoiseOffset, iceThickness, crackDensity, oceanActivity);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float iceThickness0, iceThickness1, crackDensity0, crackDensity1, oceanActivity0, oceanActivity1;
    float r0 = 1.0 + europaIceTerrain(normalize(e0), uNoiseScale, uNoiseOffset, iceThickness0, crackDensity0, oceanActivity0);
    float r1 = 1.0 + europaIceTerrain(normalize(e1), uNoiseScale, uNoiseOffset, iceThickness1, crackDensity1, oceanActivity1);
    
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
    
    float iceThickness0, iceThickness1, crackDensity0, crackDensity1, oceanActivity0, oceanActivity1;
    float r0 = 1.0 + europaIceTerrain(normalize(e0), uNoiseScale, uNoiseOffset, iceThickness0, crackDensity0, oceanActivity0);
    float r1 = 1.0 + europaIceTerrain(normalize(e1), uNoiseScale, uNoiseOffset, iceThickness1, crackDensity1, oceanActivity1);
    
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
    
    float iceThickness, crackDensity, oceanActivity;
    float displacement = europaIceTerrain(n, uNoiseScale, uNoiseOffset, iceThickness, crackDensity, oceanActivity);
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
    vIceThickness = iceThickness;
    vCrackDensity = crackDensity;
    vOceanActivity = oceanActivity;
    
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

export const europaFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vIceThickness;
in float vCrackDensity;
in float vOceanActivity;

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

vec3 getEuropaIceColors(vec3 localPos, float elevation, float iceThickness, float crackDensity, float oceanActivity) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Europa's ICE RINK PALETTE! ⛸️❄️
    vec3 pureIce = vec3(0.95, 0.98, 1.0);          // Pure white ice
    vec3 thickIce = vec3(0.85, 0.92, 0.98);        // Thick blue-white ice
    vec3 thinIce = vec3(0.7, 0.85, 0.95);          // Thinner, bluer ice
    vec3 crackBlue = vec3(0.4, 0.7, 0.9);          // Deep crack blue
    vec3 darkWater = vec3(0.1, 0.3, 0.6);          // Dark ocean glimpse
    vec3 dirtyIce = vec3(0.8, 0.85, 0.88);         // Slightly dirty ice
    vec3 freshIce = vec3(0.98, 0.99, 1.0);         // Freshly zambonied!
    vec3 shadowIce = vec3(0.6, 0.75, 0.85);        // Shadowed ice
    
    // Base ice color depends on thickness
    vec3 baseColor;
    if (vIceThickness > 1.5) {
        baseColor = pureIce; // Thick, opaque ice
    } else if (vIceThickness > 1.0) {
        baseColor = thickIce; // Normal ice
    } else {
        baseColor = thinIce; // Thin ice shows ocean beneath
    }
    
    // CRACK EFFECTS - like skate marks! ⛸️
    if (vCrackDensity > 0.2) {
        float crackIntensity = min(vCrackDensity, 1.0);
        
        // Deep cracks show darker colors
        vec3 crackColor;
        if (crackIntensity > 0.8) {
            crackColor = darkWater; // Deep cracks show ocean!
        } else if (crackIntensity > 0.5) {
            crackColor = crackBlue; // Medium cracks
        } else {
            crackColor = shadowIce; // Shallow cracks
        }
        
        baseColor = mix(baseColor, crackColor, crackIntensity * 0.7);
        
        // Add crack edge highlights
        float crackEdge = abs(sin(p.x * 20.0 + uTime * 0.1)) * abs(cos(p.z * 18.0 + uTime * 0.08));
        if (crackEdge > 0.85 && crackIntensity > 0.3) {
            float edgeFactor = (crackEdge - 0.85) * 6.67;
            baseColor = mix(baseColor, freshIce, edgeFactor * crackIntensity * 0.3);
        }
    }
    
    // OCEAN ACTIVITY - subtle color shifts from below! 🌊
    if (vOceanActivity > 0.3) {
        float oceanPulse = sin(uTime * 2.0 + p.x * 5.0) * cos(uTime * 1.8 + p.z * 4.0) * 0.5 + 0.5;
        
        if (oceanPulse > 0.6) {
            float pulseFactor = (oceanPulse - 0.6) * 2.5;
            vec3 oceanTint = mix(thinIce, crackBlue, pulseFactor);
            baseColor = mix(baseColor, oceanTint, vOceanActivity * pulseFactor * 0.2);
        }
    }
    
    // ELEVATION EFFECTS
    if (elevation > 0.02) {
        // High areas - pressure ridges with fresh ice
        float ridgeFactor = (elevation - 0.02) * 25.0;
        baseColor = mix(baseColor, freshIce, ridgeFactor * 0.6);
    } else if (elevation < -0.01) {
        // Low areas - older, slightly dirty ice
        float lowFactor = (-elevation - 0.01) * 40.0;
        baseColor = mix(baseColor, dirtyIce, lowFactor * 0.5);
    }
    
    // ICE FLOW PATTERNS - like figure skating trails! ⛸️
    float flowPattern = sin(p.x * 8.0 + uTime * 0.3) * cos(p.z * 6.0 + uTime * 0.25);
    if (abs(flowPattern) > 0.7) {
        float flowFactor = (abs(flowPattern) - 0.7) * 3.33;
        vec3 flowColor = mix(baseColor, freshIce, flowFactor * 0.3);
        baseColor = mix(baseColor, flowColor, flowFactor * 0.4);
    }
    
    // ZAMBONI MARKS! 🏒 (fine parallel lines)
    float zamboniPattern = abs(sin(p.x * 50.0 + p.z * 2.0));
    if (zamboniPattern > 0.9) {
        float zamboniFactor = (zamboniPattern - 0.9) * 10.0;
        baseColor = mix(baseColor, freshIce, zamboniFactor * 0.15);
    }
    
    // FROST PATTERNS ❄️
    float frostNoise = noise3d(p * 12.0 + vec3(uTime * 0.05));
    if (frostNoise > 0.8) {
        float frostFactor = (frostNoise - 0.8) * 5.0;
        vec3 frostColor = mix(pureIce, freshIce, frostFactor);
        baseColor = mix(baseColor, frostColor, frostFactor * 0.25);
    }
    
    // SUBSURFACE SCATTERING - ice is translucent! ✨
    float scatterNoise = noise3d(p * 8.0 + vec3(uTime * 0.02)) * 0.5 + 0.5;
    if (scatterNoise > 0.6 && vIceThickness < 1.2) {
        float scatterFactor = (scatterNoise - 0.6) * 2.5;
        float thinnessFactor = (1.2 - vIceThickness) / 1.1;
        baseColor += vec3(0.05, 0.08, 0.12) * scatterFactor * thinnessFactor;
    }
    
    // TIDAL STRESS PATTERNS
    float tidalPattern = abs(sin(p.x * 3.0 + uTime * 0.1)) * abs(cos(p.z * 2.5 + uTime * 0.08));
    if (tidalPattern > 0.75) {
        float tidalFactor = (tidalPattern - 0.75) * 4.0;
        baseColor = mix(baseColor, shadowIce, tidalFactor * 0.2);
    }
    
    // FINE ICE TEXTURE - like microscopic crystals! ❄️
    float iceTexture = noise3d(p * 30.0) * 0.03;
    baseColor += vec3(iceTexture, iceTexture * 0.8, iceTexture * 0.9);
    
    // AURORA REFLECTION (very subtle) 🌌
    float auroraReflection = sin(uTime * 0.5 + p.y * 2.0) * 0.02;
    baseColor += vec3(auroraReflection * 0.1, auroraReflection * 0.3, auroraReflection * 0.2);
    
    return clamp(baseColor, vec3(0.1), vec3(1.1)); // Allow slight overbright for ice shine
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(0.9, 0.9, 1)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that pristine ice rink surface! ⛸️
    vec3 baseColor = getEuropaIceColors(vLocalPos, vElevation, vIceThickness, vCrackDensity, vOceanActivity);
    
    // Ice rink lighting! ✨
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Ice lighting model - very reflective!
    float ambient = 0.3; // High ambient from Jupiter and ice reflection
    float diffuse = 0.7 * NdotL * attenuation;
    
    // Ice is highly specular! ✨
    vec3 R = reflect(-L, N);
    float RdotV = max(0.0, dot(R, V));
    float specular = pow(RdotV, 32.0) * 0.6 * attenuation;
    
    // Fresnel effect - ice is more reflective at grazing angles
    float fresnel = pow(1.0 - NdotV, 2.0) * 0.3;
    
    // Thicker ice is more reflective
    float iceReflectivity = vIceThickness * 0.2;
    specular += fresnel + iceReflectivity;
    
    // Jupiter's warm reflected light
    float jupiterGlow = 0.12 * attenuation;
    vec3 jupiterTint = vec3(1.1, 0.95, 0.9);
    
    vec3 finalColor = baseColor * (ambient + diffuse) * jupiterTint + vec3(specular);
    finalColor += baseColor * jupiterGlow;
    
    // Subsurface ocean glow (very subtle)
    if (vOceanActivity > 0.4 && vIceThickness < 1.0) {
        float oceanGlow = vOceanActivity * (1.0 - vIceThickness) * 0.05;
        finalColor += vec3(oceanGlow * 0.3, oceanGlow * 0.6, oceanGlow * 1.0);
    }
    
    // Ice crystal sparkles! ✨
    float sparkleNoise = noise3d(vLocalPos * 100.0 + vec3(uTime * 0.1));
    if (sparkleNoise > 0.95) {
        float sparkleFactor = (sparkleNoise - 0.95) * 20.0;
        finalColor += vec3(sparkleFactor * 0.3);
    }
    
    // Ice-appropriate gamma (cool and bright)
    finalColor = pow(finalColor, vec3(0.9));
    
    // Cool ice tint! ❄️
    finalColor *= vec3(0.98, 0.99, 1.02);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createEuropaUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 15.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
export const phobosVertexShaderSource = `#version 300 es
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
out float vPotatoEyes;
out float vPotatoBumps;

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

// Create the overall POTATO SHAPE - elongated and lumpy
float getPotatoBaseShape(vec3 n) {
    // Make it elongated like a real potato (longer on one axis)
    vec3 potatoN = n;
    
    // Stretch it to be more oval/elongated (potatoes aren't round!)
    potatoN.x *= 1.4;  // Make it longer
    potatoN.y *= 0.8;  // Squish it a bit
    potatoN.z *= 1.1;  // Slightly wider
    
    // Renormalize after stretching
    potatoN = normalize(potatoN);
    
    // Create the basic potato lumpiness with LARGE scale features
    float potatoShape = 0.0;
    
    // Big potato bulges and indentations
    potatoShape += noise3d(potatoN * 1.2 + vec3(100.0)) * 0.25;  // Main potato lumps
    potatoShape += noise3d(potatoN * 0.8 + vec3(200.0)) * 0.15;  // Secondary bulges
    potatoShape += noise3d(potatoN * 2.0 + vec3(300.0)) * 0.08;  // Medium features
    
    // Make one end more pointed (like many potatoes)
    float endTaper = smoothstep(-0.8, 0.8, n.x) * 0.1;
    potatoShape -= endTaper;
    
    // Add some asymmetry (potatoes are never symmetric!)
    potatoShape += sin(n.x * 3.0) * cos(n.y * 2.5) * sin(n.z * 2.8) * 0.06;
    
    return potatoShape;
}

// Potato terrain - now with proper potato base shape!
float potatoTerrain(vec3 n, float scale, float offset, out float potatoEyes, out float potatoBumps) {
    vec3 p = n * scale + vec3(offset);
    
    // START WITH THE OVERALL POTATO SHAPE
    float terrain = getPotatoBaseShape(n);
    
    // POTATO EYES - fewer and more realistic
    potatoEyes = 0.0;
    
    // Eye 1 - main eye
    vec3 eye1Pos = normalize(vec3(0.7, 0.2, 0.4));
    float distToEye1 = length(n - eye1Pos);
    if (distToEye1 < 0.2) {
        float eyeDepth = (1.0 - distToEye1 / 0.2);
        eyeDepth = eyeDepth * eyeDepth;
        terrain -= eyeDepth * 0.08; // Deeper indent
        potatoEyes += eyeDepth;
    }
    
    // Eye 2 - smaller eye
    vec3 eye2Pos = normalize(vec3(-0.5, 0.6, 0.2));
    float distToEye2 = length(n - eye2Pos);
    if (distToEye2 < 0.15) {
        float eyeDepth = (1.0 - distToEye2 / 0.15);
        eyeDepth = eyeDepth * eyeDepth;
        terrain -= eyeDepth * 0.06;
        potatoEyes += eyeDepth * 0.7;
    }
    
    // Eye 3 - tiny eye
    vec3 eye3Pos = normalize(vec3(0.1, -0.7, 0.5));
    float distToEye3 = length(n - eye3Pos);
    if (distToEye3 < 0.12) {
        float eyeDepth = (1.0 - distToEye3 / 0.12);
        eyeDepth = eyeDepth * eyeDepth;
        terrain -= eyeDepth * 0.04;
        potatoEyes += eyeDepth * 0.5;
    }
    
    // LARGE POTATO BUMPS - part of the overall shape
    potatoBumps = 0.0;
    
    // Big characteristic potato bump
    vec3 bump1Pos = normalize(vec3(-0.6, 0.1, -0.6));
    float distToBump1 = length(n - bump1Pos);
    if (distToBump1 < 0.3) {
        float bumpHeight = (1.0 - distToBump1 / 0.3);
        bumpHeight = bumpHeight * bumpHeight;
        terrain += bumpHeight * 0.15; // Big bump
        potatoBumps += bumpHeight;
    }
    
    // Another characteristic bulge
    vec3 bump2Pos = normalize(vec3(0.4, -0.5, 0.5));
    float distToBump2 = length(n - bump2Pos);
    if (distToBump2 < 0.25) {
        float bumpHeight = (1.0 - distToBump2 / 0.25);
        bumpHeight = bumpHeight * bumpHeight;
        terrain += bumpHeight * 0.12;
        potatoBumps += bumpHeight * 0.8;
    }
    
    // MUCH REDUCED surface texture - just subtle skin texture
    float skinTexture = 0.0;
    skinTexture += noise3d(p * 6.0) * 0.008;   // Gentle skin bumps
    skinTexture += noise3d(p * 12.0) * 0.004;  // Fine skin texture
    
    // Very subtle potato skin wrinkles
    float wrinkles = sin(p.x * 8.0 + p.y * 6.0) * sin(p.z * 7.0 + p.x * 5.0) * 0.003;
    
    // Combine all features - mostly the base shape with subtle details
    float totalTerrain = terrain + skinTexture + wrinkles;
    
    // More conservative clamping to maintain potato shape
    totalTerrain = clamp(totalTerrain, -0.15, 0.3);
    
    return totalTerrain;
}

vec3 calculateDisplacedNormal(vec3 n, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(tangent1) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float potatoEyes, potatoBumps;
    float h = potatoTerrain(n, uNoiseScale, uNoiseOffset, potatoEyes, potatoBumps);
    float h1 = potatoTerrain(n1, uNoiseScale, uNoiseOffset, potatoEyes, potatoBumps);
    float h2 = potatoTerrain(n2, uNoiseScale, uNoiseOffset, potatoEyes, potatoBumps);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float potatoEyes0, potatoEyes1, potatoBumps0, potatoBumps1;
    float r0 = 1.0 + potatoTerrain(normalize(e0), uNoiseScale, uNoiseOffset, potatoEyes0, potatoBumps0);
    float r1 = 1.0 + potatoTerrain(normalize(e1), uNoiseScale, uNoiseOffset, potatoEyes1, potatoBumps1);
    
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
    
    float potatoEyes0, potatoEyes1, potatoBumps0, potatoBumps1;
    float r0 = 1.0 + potatoTerrain(normalize(e0), uNoiseScale, uNoiseOffset, potatoEyes0, potatoBumps0);
    float r1 = 1.0 + potatoTerrain(normalize(e1), uNoiseScale, uNoiseOffset, potatoEyes1, potatoBumps1);
    
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
    
    float potatoEyes, potatoBumps;
    float displacement = potatoTerrain(n, uNoiseScale, uNoiseOffset, potatoEyes, potatoBumps);
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
    vPotatoEyes = potatoEyes;
    vPotatoBumps = potatoBumps;
    
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

export const phobosFragmentShaderSource = `#version 300 es
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
in float vPotatoEyes;
in float vPotatoBumps;

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

vec3 getPotatoSurfaceColor(vec3 localPos, float elevation, float potatoEyes, float potatoBumps) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // POTATO COLOR PALETTE! 🥔
    vec3 potatoSkin = vec3(0.76, 0.65, 0.45);        // Classic potato brown
    vec3 potatoFlesh = vec3(0.95, 0.92, 0.85);       // Inside potato color
    vec3 potatoDirt = vec3(0.45, 0.35, 0.25);        // Dirty spots
    vec3 potatoEyeColor = vec3(0.25, 0.15, 0.1);     // Dark potato eyes
    vec3 potatoSprout = vec3(0.4, 0.6, 0.3);         // Green sprouts from eyes!
    vec3 potatoBump = vec3(0.8, 0.7, 0.5);           // Lighter bumpy areas
    vec3 potatoWrinkle = vec3(0.6, 0.5, 0.35);       // Wrinkled skin
    
    // Start with base potato skin color
    vec3 baseColor = potatoSkin;
    
    // Much more subtle skin variation
    float skinVariation = noise3d(p * 2.0) * 0.5 + 0.5;
    baseColor = mix(potatoSkin, vec3(0.7, 0.6, 0.4), skinVariation * 0.2);
    
    // POTATO EYES - dark spots with potential sprouts!
    if (vPotatoEyes > 0.1) {
        float eyeFactor = smoothTransition(vPotatoEyes, 0.3, 0.2);
        vec3 eyeColor = potatoEyeColor;
        
        // Some eyes have green sprouts! 🌱
        float sproutChance = noise3d(p * 1.5 + vec3(500.0));
        if (sproutChance > 0.75 && vPotatoEyes > 0.6) {
            float sproutFactor = smoothTransition(sproutChance, 0.8, 0.05);
            eyeColor = mix(eyeColor, potatoSprout, sproutFactor);
        }
        
        baseColor = mix(baseColor, eyeColor, eyeFactor);
    }
    
    // POTATO BUMPS - lighter, more exposed areas
    if (vPotatoBumps > 0.1) {
        float bumpFactor = smoothTransition(vPotatoBumps, 0.3, 0.2);
        baseColor = mix(baseColor, potatoBump, bumpFactor * 0.4);
    }
    
    // Much more subtle dirt spots
    float dirtPattern = noise3d(p * 1.5 + vec3(200.0)) * 0.5 + 0.5;
    if (dirtPattern > 0.7) {
        float dirtFactor = smoothTransition(dirtPattern, 0.75, 0.05);
        baseColor = mix(baseColor, potatoDirt, dirtFactor * 0.3);
    }
    
    // Very subtle skin texture
    float skinTexture = noise3d(p * 4.0) * 0.05;
    baseColor += vec3(skinTexture * 0.1, skinTexture * 0.08, skinTexture * 0.06);
    
    // Subtle elevation-based coloring
    if (elevation > 0.1) {
        // High areas - slightly lighter
        float highFactor = smoothTransition(elevation, 0.15, 0.05);
        baseColor = mix(baseColor, potatoBump, highFactor * 0.3);
    } else if (elevation < -0.05) {
        // Deep areas - slightly darker
        float deepFactor = smoothTransition(elevation, -0.08, 0.03);
        baseColor = mix(baseColor, potatoDirt, deepFactor * 0.4);
    }
    
    // Very subtle blemishes
    float blemishPattern = noise3d(p * 3.0 + vec3(300.0));
    if (blemishPattern > 0.8) {
        float blemishFactor = smoothTransition(blemishPattern, 0.85, 0.03);
        vec3 blemishColor = vec3(0.5, 0.4, 0.3);
        baseColor = mix(baseColor, blemishColor, blemishFactor * 0.2);
    }
    
    // Ensure we stay in potato color range
    baseColor = clamp(baseColor, vec3(0.3), vec3(0.9));
    
    return baseColor;
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors
    bool isLodMode = length(vColour - vec3(0.6, 0.5, 0.4)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that delicious potato surface color! 🥔
    vec3 baseColor = getPotatoSurfaceColor(vLocalPos, vElevation, vPotatoEyes, vPotatoBumps);
    
    // Lighting calculations
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Potato lighting - potatoes are matte, not shiny!
    float ambient = 0.3;  // Potatoes need good ambient lighting
    float diffuse = 0.7 * NdotL * attenuation;
    
    // Subsurface scattering - potatoes are slightly translucent
    float subsurface = max(0.0, dot(-N, L)) * 0.1;
    diffuse += subsurface * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse);
    
    // Potato-appropriate gamma correction
    finalColor = pow(finalColor, vec3(0.9));
    
    // Add a tiny bit of "potato warmth" to the color
    finalColor *= vec3(1.02, 1.0, 0.98);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createPhobosUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 40.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
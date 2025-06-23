export const earthVertexShaderSource = `#version 300 es
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
out float vWaterMask;
out float vCoastalDistance;

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

// Ridged noise for mountain ridges
float ridgedNoise(vec3 p) {
    return 1.0 - abs(noise3d(p) * 2.0 - 1.0);
}

// Enhanced Earth terrain with improved mountains and coastal transitions
float earthTerrain(vec3 n, float t, float scale, float offset, out float waterMask, out float coastalDistance) {
    vec3 p = n * scale + vec3(offset);
    
    // Continental structure - simplified but effective
    float continents = fbm2(p * 0.4 + vec3(100.0)) * 0.5;
    continents += noise3d(p * 0.8 + vec3(200.0)) * 0.25;
    continents -= 0.28; // Adjust for ~30% land
    
    // Smooth coastal distance calculation for beach transitions
    coastalDistance = smoothstep(-0.08, 0.08, continents);
    
    // Water mask for rendering separation
    waterMask = smoothstep(0.02, -0.02, continents);
    
    // WATER: Only small surface perturbations
    if (continents < 0.02) {
        float waterSurface = noise3d(p * 8.0 + vec3(t * 0.5)) * 0.002;
        
        // Simple ocean waves
        if (t > 0.0) {
            waterSurface += sin(p.x * 15.0 + t * 1.2) * sin(p.z * 12.0 + t * 0.8) * 0.001;
        }
        
        return clamp(waterSurface, -0.003, 0.003);
    }
    
    // LAND: Full terrain displacement
    float terrain = continents;
    
    // Enhanced mountains with multiple scales and ridges
    if (continents > -0.05) {
        // Primary mountain ranges with ridged noise
        float mountainBase = ridgedNoise(p * 1.8 + vec3(50.0));
        float mountains1 = max(0.0, mountainBase - 0.35);
        mountains1 = mountains1 * mountains1 * 0.18;
        
        // Secondary mountain details
        float mountains2 = max(0.0, noise3d(p * 3.2 + vec3(150.0)) - 0.45);
        mountains2 = mountains2 * mountains2 * 0.1;
        
        // Mountain ridges and peaks
        float ridges = ridgedNoise(p * 2.8 + vec3(250.0));
        float peaks = max(0.0, ridges - 0.6) * 0.12;
        
        // Combine mountain features
        float totalMountains = mountains1 + mountains2 + peaks;
        
        // Mountain mask - stronger on land, weaker near coasts
        float mountainMask = smoothstep(-0.05, 0.15, continents);
        totalMountains *= mountainMask;
        
        // Add some mountain variation based on noise
        float mountainVariation = noise3d(p * 1.5 + vec3(350.0)) * 0.3 + 0.7;
        totalMountains *= mountainVariation;
        
        terrain += totalMountains;
    }
    
    // Polar ice caps
    float latitude = abs(n.y);
    if (latitude > 0.75) {
        float iceStrength = smoothstep(0.75, 0.95, latitude);
        float iceNoise = noise3d(p * 2.5 + vec3(800.0)) * 0.5 + 0.5;
        terrain += iceStrength * iceNoise * 0.02;
    }
    
    // Fine detail
    terrain += noise3d(p * 12.0) * 0.005;
    
    return clamp(terrain, -0.08, 0.3);
}

vec3 calculateDisplacedNormal(vec3 n, float t, float epsilon) {
    vec3 tangent1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
    if(length(tangent1) < 0.1) {
        tangent1 = normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(n, tangent1));
    
    vec3 n1 = normalize(n + epsilon * tangent1);
    vec3 n2 = normalize(n + epsilon * tangent2);
    
    float waterMask, coastalDistance;
    float h = earthTerrain(n, t, uNoiseScale, uNoiseOffset, waterMask, coastalDistance);
    float h1 = earthTerrain(n1, t, uNoiseScale, uNoiseOffset, waterMask, coastalDistance);
    float h2 = earthTerrain(n2, t, uNoiseScale, uNoiseOffset, waterMask, coastalDistance);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float t) {
    float waterMask0, waterMask1, coastalDistance0, coastalDistance1;
    float r0 = 1.0 + earthTerrain(normalize(e0), t, uNoiseScale, uNoiseOffset, waterMask0, coastalDistance0);
    float r1 = 1.0 + earthTerrain(normalize(e1), t, uNoiseScale, uNoiseOffset, waterMask1, coastalDistance1);
    
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
    
    float waterMask0, waterMask1, coastalDistance0, coastalDistance1;
    float r0 = 1.0 + earthTerrain(normalize(e0), t, uNoiseScale, uNoiseOffset, waterMask0, coastalDistance0);
    float r1 = 1.0 + earthTerrain(normalize(e1), t, uNoiseScale, uNoiseOffset, waterMask1, coastalDistance1);
    
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
    
    float waterMask, coastalDistance;
    float displacement = earthTerrain(n, uTime, uNoiseScale, uNoiseOffset, waterMask, coastalDistance);
    float r0 = uPlanetRadius * (1.0 + displacement);
    vec3 baseNormal = calculateDisplacedNormal(n, uTime, 0.01);
    
    float finalRadius = r0;
    vec3 finalNormal = baseNormal;
    
    if(aMorphable > 0.5) {
        float morphR = morphTargetRadius(n, aEdge0, aEdge1, uTime) * uPlanetRadius;
        float morphFactor = aMorphable * aMorphFactor;
        morphFactor = morphFactor * morphFactor * (3.0 - 2.0 * morphFactor);
        finalRadius = mix(r0, morphR, morphFactor);
        
        vec3 morphN = morphTargetNormal(n, aEdge0, aEdge1, uTime, 0.01);
        finalNormal = normalize(mix(baseNormal, morphN, morphFactor));
    }
    
    vPos = n * finalRadius;
    vWorldPos = (uModel * vec4(vPos, 1.0)).xyz;
    vWorldNormal = normalize(uNormalMatrix * finalNormal);
    vElevation = displacement;
    vWaterMask = waterMask;
    vCoastalDistance = coastalDistance;
    
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

export const earthFragmentShaderSource = `#version 300 es
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
in float vWaterMask;
in float vCoastalDistance;

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

// Simple smooth transition
float smoothTransition(float value, float threshold, float smoothness) {
    return smoothstep(threshold - smoothness, threshold + smoothness, value);
}

vec3 getEarthSurfaceColor(vec3 localPos, float elevation, float waterMask, float coastalDistance) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    float latitude = localPos.y;
    float absoluteLatitude = abs(latitude);
    
    // Enhanced color palette with better mountain colors
    vec3 deepOcean = vec3(0.01, 0.03, 0.1);
    vec3 shallowOcean = vec3(0.03, 0.15, 0.35);
    vec3 coastalWater = vec3(0.1, 0.3, 0.5);
    vec3 tropicalWater = vec3(0.15, 0.45, 0.7);
    
    vec3 beach = vec3(0.9, 0.85, 0.7);
    vec3 desert = vec3(0.85, 0.7, 0.5);
    vec3 savanna = vec3(0.7, 0.6, 0.35);
    vec3 grassland = vec3(0.3, 0.7, 0.2);
    vec3 temperateForest = vec3(0.15, 0.5, 0.15);
    vec3 tropicalForest = vec3(0.1, 0.4, 0.1);
    vec3 borealForest = vec3(0.2, 0.4, 0.2);
    vec3 tundra = vec3(0.4, 0.5, 0.3);
    
    // Enhanced mountain color palette
    vec3 lowMountain = vec3(0.35, 0.45, 0.25);     // Forest-covered foothills
    vec3 midMountain = vec3(0.45, 0.4, 0.35);      // Rocky slopes
    vec3 highMountain = vec3(0.55, 0.5, 0.45);     // Bare rock
    vec3 peakMountain = vec3(0.65, 0.6, 0.55);     // High peaks
    vec3 snow = vec3(0.95, 0.97, 1.0);
    
    // WATER RENDERING
    if (waterMask > 0.5) {
        float depth = max(0.0, -elevation);
        float tropicalFactor = 1.0 - absoluteLatitude;
        
        vec3 waterColor;
        if (depth < 0.02) {
            waterColor = coastalWater;
            if (tropicalFactor > 0.6) {
                waterColor = mix(waterColor, tropicalWater, (tropicalFactor - 0.6) * 2.5);
            }
        } else if (depth < 0.05) {
            waterColor = mix(shallowOcean, coastalWater, smoothTransition(depth, 0.035, 0.015));
        } else {
            waterColor = mix(deepOcean, shallowOcean, smoothTransition(depth, 0.08, 0.03));
        }
        
        // Simple water effects
        float sparkle = noise3d(p * 20.0 + vec3(uTime * 1.5)) * 0.1;
        if (sparkle > 0.05) {
            waterColor += vec3(0.1, 0.15, 0.2) * (sparkle - 0.05) * 2.0;
        }
        
        return clamp(waterColor, vec3(0.0), vec3(1.0));
    }
    
    // LAND RENDERING
    float temperatureZone = 1.0 - absoluteLatitude;
    temperatureZone += noise3d(p * 0.8) * 0.15; // Add some variation
    temperatureZone = clamp(temperatureZone, 0.0, 1.0);
    
    float moistureZone = noise3d(p * 1.2 + vec3(600.0)) * 0.5 + 0.5;
    moistureZone = clamp(moistureZone, 0.0, 1.0);
    
    // Ice caps
    float iceCapFactor = 0.0;
    if (absoluteLatitude > 0.75) {
        iceCapFactor = smoothTransition(absoluteLatitude, 0.8, 0.1);
        iceCapFactor *= noise3d(p * 2.5) * 0.5 + 0.5;
    }
    
    vec3 surfaceColor;
    
    if (iceCapFactor > 0.3) {
        surfaceColor = mix(tundra, snow, iceCapFactor);
    } else {
        // Enhanced mountain rendering with smooth color transitions
        float mountainHeight = max(0.0, elevation);
        
        if (mountainHeight > 0.05) {
            // Mountain color based on elevation with noise variation
            float mountainNoise = noise3d(p * 4.0 + vec3(400.0)) * 0.5 + 0.5;
            float colorNoise = noise3d(p * 8.0 + vec3(500.0)) * 0.3 + 0.7;
            
            // Smooth elevation-based mountain colors
            vec3 mountainColor;
            if (mountainHeight < 0.08) {
                // Forest-covered foothills
                float forestMix = smoothTransition(mountainHeight, 0.065, 0.015);
                mountainColor = mix(temperateForest, lowMountain, forestMix);
            } else if (mountainHeight < 0.12) {
                // Transition to rocky slopes
                float rockMix = smoothTransition(mountainHeight, 0.1, 0.02);
                mountainColor = mix(lowMountain, midMountain, rockMix);
            } else if (mountainHeight < 0.16) {
                // Rocky slopes to bare rock
                float bareMix = smoothTransition(mountainHeight, 0.14, 0.02);
                mountainColor = mix(midMountain, highMountain, bareMix);
            } else if (mountainHeight < 0.2) {
                // High peaks
                float peakMix = smoothTransition(mountainHeight, 0.18, 0.02);
                mountainColor = mix(highMountain, peakMountain, peakMix);
            } else {
                // Snow line with temperature consideration
                float snowFactor = smoothTransition(mountainHeight, 0.22 - temperatureZone * 0.05, 0.03);
                mountainColor = mix(peakMountain, snow, snowFactor);
            }
            
            // Add color variation with noise
            mountainColor *= colorNoise;
            
            // Add some rock striations
            float striations = sin(mountainHeight * 50.0 + mountainNoise * 10.0) * 0.05 + 1.0;
            mountainColor *= striations;
            
            surfaceColor = mountainColor;
        } else {
            // Regular biomes for lower elevations
            if (temperatureZone < 0.3) {
                // Cold - tundra to boreal forest
                surfaceColor = mix(tundra, borealForest, smoothTransition(moistureZone, 0.4, 0.2));
            } else if (temperatureZone < 0.6) {
                // Temperate
                if (moistureZone > 0.6) {
                    surfaceColor = temperateForest;
                } else if (moistureZone > 0.3) {
                    surfaceColor = mix(grassland, temperateForest, smoothTransition(moistureZone, 0.45, 0.15));
                } else {
                    surfaceColor = mix(desert, savanna, smoothTransition(moistureZone, 0.2, 0.1));
                }
            } else {
                // Warm
                if (moistureZone > 0.5) {
                    surfaceColor = mix(temperateForest, tropicalForest, smoothTransition(temperatureZone, 0.7, 0.1));
                } else if (moistureZone > 0.25) {
                    surfaceColor = savanna;
                } else {
                    surfaceColor = desert;
                }
            }
        }
        
        // IMPROVED BEACH TRANSITIONS - much smoother and more natural
        if (temperatureZone > 0.4) {
            // Use coastal distance for smooth beach transitions
            float beachZone = 1.0 - vCoastalDistance;
            
            // Add noise to beach boundaries for natural variation
            float beachNoise = noise3d(p * 6.0 + vec3(700.0)) * 0.3 + 0.7;
            beachZone *= beachNoise;
            
            // Smooth beach transition based on elevation and coastal distance
            float beachFactor = 0.0;
            if (elevation < 0.04) {
                beachFactor = smoothTransition(elevation, 0.02, 0.02) * smoothTransition(beachZone, 0.3, 0.2);
                beachFactor = clamp(beachFactor, 0.0, 0.8);
            }
            
            if (beachFactor > 0.0) {
                surfaceColor = mix(surfaceColor, beach, beachFactor);
            }
        }
    }
    
    // Add some terrain variation
    float terrainVar = noise3d(p * 8.0) * 0.05;
    surfaceColor += vec3(terrainVar * 0.3, terrainVar * 0.2, terrainVar * 0.1);
    
    return clamp(surfaceColor, vec3(0.0), vec3(1.0));
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Don't override LOD colors
    bool isLodMode = length(vColour - vec3(0.2, 0.7, 1.0)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    vec3 baseColor = getEarthSurfaceColor(vLocalPos, vElevation, vWaterMask, vCoastalDistance);
    
    // Lighting
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Atmospheric scattering
    float atmosphere = pow(1.0 - NdotV, 1.8);
    vec3 atmosphereColor = vec3(0.5, 0.7, 1.0) * atmosphere * 0.2;
    
    // Water specular
    float specular = 0.0;
    if (vWaterMask > 0.5) {
        vec3 R = reflect(-L, N);
        float RdotV = max(0.0, dot(R, V));
        specular = pow(RdotV, 16.0) * 0.8 * attenuation;
        
        // Fresnel
        float fresnel = pow(1.0 - NdotV, 3.0);
        specular *= (0.3 + 0.7 * fresnel);
    }
    
    // Cloud shadows
    vec3 p = vLocalPos * uNoiseScale + vec3(uNoiseOffset);
    float cloudShadow = 1.0 - smoothstep(0.6, 0.8, noise3d(p * 1.5 + vec3(uTime * 0.02))) * 0.15;
    
    // Final lighting
    float ambient = 0.2;
    float diffuse = 0.8 * NdotL * cloudShadow * attenuation;
    
    vec3 finalColor = baseColor * (ambient + diffuse) + atmosphereColor + vec3(specular);
    
    // Simple gamma correction
    finalColor = pow(finalColor, vec3(0.9));
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createEarthUniformSetup() {
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
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 8.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
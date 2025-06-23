export const ioVertexShaderSource = `#version 300 es
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
out float vVolcanicHeat;
out float vSulfurRichness;
out float vLavaActivity;

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

// Pulsing volcanic caldera - like a pizza oven! 🔥
float volcanicCaldera(vec3 n, vec3 center, float radius, float intensity) {
    float d = length(n - center);
    if (d > radius) return 0.0;
    
    float t = d / radius;
    float pulse = sin(uTime * 3.0 + center.x * 10.0) * 0.5 + 0.5;
    
    if (t < 0.6) {
        // Hot caldera center
        return -intensity * (1.0 - t / 0.6) * (0.8 + pulse * 0.4);
    } else {
        // Volcanic rim
        float rimFactor = (t - 0.6) / 0.4;
        return intensity * 0.4 * (1.0 - rimFactor) * (0.9 + pulse * 0.2);
    }
}

// Sulfur plains that shift and bubble! 
float sulfurPlains(vec3 p, float time) {
    float plains = 0.0;
    
    // Bubbling sulfur pools
    float bubble1 = sin(time * 2.0 + p.x * 8.0) * cos(time * 1.5 + p.z * 6.0);
    float bubble2 = sin(time * 2.5 + p.y * 7.0) * cos(time * 1.8 + p.x * 5.0);
    
    plains += (bubble1 + bubble2) * 0.015;
    
    // Flowing sulfur rivers
    float flow = sin(p.x * 4.0 + time * 1.5) * sin(p.z * 3.0 + time * 1.2);
    plains += flow * 0.01;
    
    return plains;
}

float ioVolcanicTerrain(vec3 n, float scale, float offset, out float volcanicHeat, out float sulfurRichness, out float lavaActivity) {
    vec3 p = n * scale + vec3(offset);
    
    float terrain = 0.0;
    volcanicHeat = 0.0;
    sulfurRichness = 0.0;
    lavaActivity = 0.0;
    
    // Major volcanic hotspots - like pepperoni on pizza! 🍕
    vec3 loki = normalize(vec3(0.7, 0.3, 0.6));
    float lokiCaldera = volcanicCaldera(n, loki, 0.2, 0.12);
    terrain += lokiCaldera;
    if (lokiCaldera < 0.0) {
        volcanicHeat += 1.0;
        lavaActivity += 0.8;
    }
    
    vec3 pele = normalize(vec3(-0.5, -0.6, 0.6));
    float peleCaldera = volcanicCaldera(n, pele, 0.15, 0.08);
    terrain += peleCaldera;
    if (peleCaldera < 0.0) {
        volcanicHeat += 0.8;
        sulfurRichness += 1.0;
    }
    
    vec3 prometheus = normalize(vec3(0.2, 0.8, -0.5));
    float prometheusCaldera = volcanicCaldera(n, prometheus, 0.12, 0.06);
    terrain += prometheusCaldera;
    if (prometheusCaldera < 0.0) {
        volcanicHeat += 0.6;
        lavaActivity += 0.6;
    }
    
    // Sulfur plains with dynamic bubbling
    float plainsNoise = noise3d(p * 2.0) * 0.5 + 0.5;
    if (plainsNoise > 0.4) {
        float sulfurTerrain = sulfurPlains(p, uTime);
        terrain += sulfurTerrain;
        sulfurRichness += (plainsNoise - 0.4) * 2.0;
    }
    
    // Lava flows that pulse with heat
    float lavaFlow1 = max(0.0, 0.1 - length(n - normalize(vec3(0.8, 0.2, 0.5)) * 0.4));
    lavaFlow1 *= (sin(uTime * 2.0 + n.x * 15.0) * 0.3 + 0.7);
    terrain += lavaFlow1 * 0.3;
    lavaActivity += lavaFlow1 * 5.0;
    
    float lavaFlow2 = max(0.0, 0.08 - length(n - normalize(vec3(-0.6, 0.1, 0.8)) * 0.3));
    lavaFlow2 *= (sin(uTime * 1.8 + n.z * 12.0) * 0.3 + 0.7);
    terrain += lavaFlow2 * 0.25;
    lavaActivity += lavaFlow2 * 4.0;
    
    // Tidal heating cracks that glow
    float tidalStress = abs(sin(p.x * 6.0 + uTime * 0.5)) * abs(sin(p.z * 5.0 + uTime * 0.3));
    if (tidalStress > 0.7) {
        terrain -= (tidalStress - 0.7) * 0.02;
        volcanicHeat += (tidalStress - 0.7) * 2.0;
    }
    
    // Fine volcanic texture
    terrain += noise3d(p * 8.0) * 0.008;
    terrain += noise3d(p * 12.0) * 0.004;
    
    // Clamp values
    volcanicHeat = clamp(volcanicHeat, 0.0, 1.0);
    sulfurRichness = clamp(sulfurRichness, 0.0, 1.0);
    lavaActivity = clamp(lavaActivity, 0.0, 1.0);
    terrain = clamp(terrain, -0.1, 0.12);
    
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
    
    float volcanicHeat, sulfurRichness, lavaActivity;
    float h = ioVolcanicTerrain(n, uNoiseScale, uNoiseOffset, volcanicHeat, sulfurRichness, lavaActivity);
    float h1 = ioVolcanicTerrain(n1, uNoiseScale, uNoiseOffset, volcanicHeat, sulfurRichness, lavaActivity);
    float h2 = ioVolcanicTerrain(n2, uNoiseScale, uNoiseOffset, volcanicHeat, sulfurRichness, lavaActivity);
    
    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);
    
    vec3 v1 = p1 - p0;
    vec3 v2 = p2 - p0;
    
    return normalize(cross(v1, v2));
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1) {
    float volcanicHeat0, volcanicHeat1, sulfurRichness0, sulfurRichness1, lavaActivity0, lavaActivity1;
    float r0 = 1.0 + ioVolcanicTerrain(normalize(e0), uNoiseScale, uNoiseOffset, volcanicHeat0, sulfurRichness0, lavaActivity0);
    float r1 = 1.0 + ioVolcanicTerrain(normalize(e1), uNoiseScale, uNoiseOffset, volcanicHeat1, sulfurRichness1, lavaActivity1);
    
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
    
    float volcanicHeat0, volcanicHeat1, sulfurRichness0, sulfurRichness1, lavaActivity0, lavaActivity1;
    float r0 = 1.0 + ioVolcanicTerrain(normalize(e0), uNoiseScale, uNoiseOffset, volcanicHeat0, sulfurRichness0, lavaActivity0);
    float r1 = 1.0 + ioVolcanicTerrain(normalize(e1), uNoiseScale, uNoiseOffset, volcanicHeat1, sulfurRichness1, lavaActivity1);
    
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
    
    float volcanicHeat, sulfurRichness, lavaActivity;
    float displacement = ioVolcanicTerrain(n, uNoiseScale, uNoiseOffset, volcanicHeat, sulfurRichness, lavaActivity);
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
    vVolcanicHeat = volcanicHeat;
    vSulfurRichness = sulfurRichness;
    vLavaActivity = lavaActivity;
    
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

export const ioFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vColour;
in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;
in float vVolcanicHeat;
in float vSulfurRichness;
in float vLavaActivity;

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

vec3 getIoPizzaColors(vec3 localPos, float elevation, float volcanicHeat, float sulfurRichness, float lavaActivity) {
    vec3 p = localPos * uNoiseScale + vec3(uNoiseOffset);
    
    // Io's PIZZA PALETTE! 🍕✨
    vec3 cheeseYellow = vec3(1.0, 0.9, 0.3);       // Bright sulfur cheese!
    vec3 pepperoniRed = vec3(0.9, 0.2, 0.1);       // Hot lava pepperoni!
    vec3 crustBrown = vec3(0.6, 0.4, 0.2);         // Volcanic crust
    vec3 sauceOrange = vec3(0.95, 0.5, 0.1);       // Orange sulfur sauce
    vec3 burntBlack = vec3(0.1, 0.05, 0.02);       // Burnt volcanic areas
    vec3 mozzarellaWhite = vec3(0.95, 0.95, 0.85);  // White sulfur deposits
    vec3 basilGreen = vec3(0.3, 0.7, 0.2);         // Rare green sulfur
    vec3 garlicGold = vec3(0.8, 0.7, 0.3);         // Golden sulfur
    
    // Base is the cheese layer!
    vec3 baseColor = cheeseYellow;
    
    // VOLCANIC HEAT = PEPPERONI! 🌶️
    if (vVolcanicHeat > 0.3) {
        float heatPulse = sin(uTime * 4.0 + p.x * 10.0) * 0.3 + 0.7;
        vec3 hotColor = mix(pepperoniRed, sauceOrange, heatPulse);
        baseColor = mix(baseColor, hotColor, vVolcanicHeat * 0.8);
        
        // Extra spicy hot spots!
        if (vVolcanicHeat > 0.7) {
            float extraHot = (vVolcanicHeat - 0.7) * 3.33;
            baseColor = mix(baseColor, burntBlack, extraHot * 0.6);
        }
    }
    
    // SULFUR RICHNESS = CHEESE VARIETIES! 🧀
    if (vSulfurRichness > 0.2) {
        float cheeseType = noise3d(p * 3.0 + vec3(uTime * 0.1));
        vec3 cheeseColor;
        
        if (cheeseType > 0.8) {
            cheeseColor = mozzarellaWhite; // Fresh mozzarella!
        } else if (cheeseType > 0.6) {
            cheeseColor = garlicGold; // Garlic cheese!
        } else if (cheeseType > 0.4) {
            cheeseColor = cheeseYellow; // Classic cheddar!
        } else if (cheeseType > 0.1) {
            cheeseColor = sauceOrange; // Aged cheese!
        } else {
            cheeseColor = basilGreen; // Pesto cheese! (rare)
        }
        
        baseColor = mix(baseColor, cheeseColor, vSulfurRichness * 0.7);
    }
    
    // LAVA ACTIVITY = BUBBLING CHEESE! 🫧
    if (vLavaActivity > 0.2) {
        float bubbleTime = uTime * 3.0 + p.x * 8.0 + p.z * 6.0;
        float bubble = sin(bubbleTime) * cos(bubbleTime * 1.3) * 0.5 + 0.5;
        
        if (bubble > 0.7) {
            float bubbleFactor = (bubble - 0.7) * 3.33;
            vec3 bubbleColor = mix(sauceOrange, pepperoniRed, bubbleFactor);
            baseColor = mix(baseColor, bubbleColor, vLavaActivity * bubbleFactor * 0.5);
        }
    }
    
    // ELEVATION = CRUST THICKNESS! 🥖
    if (elevation > 0.05) {
        float crustFactor = (elevation - 0.05) * 10.0;
        baseColor = mix(baseColor, crustBrown, crustFactor * 0.6);
    } else if (elevation < -0.03) {
        // Deep dish areas!
        float deepFactor = (-elevation - 0.03) * 15.0;
        baseColor = mix(baseColor, burntBlack, deepFactor * 0.8);
    }
    
    // SEASONING SPRINKLES! ✨
    float seasoning = noise3d(p * 12.0 + vec3(uTime * 0.2));
    if (seasoning > 0.85) {
        float sprinkleFactor = (seasoning - 0.85) * 6.67;
        vec3 sprinkleColor = mix(garlicGold, mozzarellaWhite, sprinkleFactor);
        baseColor = mix(baseColor, sprinkleColor, sprinkleFactor * 0.3);
    }
    
    // MELTED CHEESE STRINGS! 🧀
    float stringPattern = abs(sin(p.x * 15.0 + uTime)) * abs(cos(p.z * 12.0 + uTime * 0.8));
    if (stringPattern > 0.8 && vSulfurRichness > 0.4) {
        float stringFactor = (stringPattern - 0.8) * 5.0;
        baseColor = mix(baseColor, mozzarellaWhite, stringFactor * vSulfurRichness * 0.4);
    }
    
    // PIZZA OVEN GLOW! 🔥
    float ovenGlow = noise3d(p * 4.0 + vec3(uTime * 0.5)) * 0.5 + 0.5;
    if (ovenGlow > 0.6 && vVolcanicHeat > 0.5) {
        float glowFactor = (ovenGlow - 0.6) * 2.5;
        baseColor += vec3(0.2, 0.1, 0.02) * glowFactor * vVolcanicHeat;
    }
    
    // FINE TEXTURE - like flour dusting!
    float texture = noise3d(p * 20.0) * 0.05;
    baseColor += vec3(texture, texture * 0.8, texture * 0.6);
    
    return clamp(baseColor, vec3(0.05), vec3(1.2)); // Allow slight overbright for glow
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    
    // Check for LOD mode
    bool isLodMode = length(vColour - vec3(1, 1, 0.6)) > 0.1;
    
    if (isLodMode) {
        fragColor = vec4(vColour, 1.0);
        return;
    }
    
    // Get that delicious pizza surface! 🍕
    vec3 baseColor = getIoPizzaColors(vLocalPos, vElevation, vVolcanicHeat, vSulfurRichness, vLavaActivity);
    
    // Pizza oven lighting! 🔥
    vec3 lightDir = uSunPosition - vWorldPos;
    float lightDistance = length(lightDir);
    float attenuation = 1.0 / max(1.0, lightDistance * lightDistance * 0.000001);
    
    float NdotL = max(0.0, dot(N, L));
    float NdotV = max(0.0, dot(N, V));
    
    // Pizza lighting model
    float ambient = 0.25; // Jupiter's warm glow
    float diffuse = 0.75 * NdotL * attenuation;
    
    // Volcanic glow adds to ambient
    if (vVolcanicHeat > 0.4) {
        ambient += vVolcanicHeat * 0.2;
    }
    
    // Cheese has subtle specular highlights! ✨
    float specular = 0.0;
    if (vSulfurRichness > 0.3) {
        vec3 R = reflect(-L, N);
        float RdotV = max(0.0, dot(R, V));
        specular = pow(RdotV, 8.0) * 0.2 * attenuation * vSulfurRichness;
    }
    
    // Jupiter's warm reflected light
    float jupiterGlow = 0.08 * attenuation;
    vec3 jupiterTint = vec3(1.15, 0.95, 0.8);
    
    vec3 finalColor = baseColor * (ambient + diffuse) * jupiterTint + vec3(specular);
    finalColor += baseColor * jupiterGlow;
    
    // Volcanic emission - like a hot pizza! 🔥
    if (vVolcanicHeat > 0.6) {
        float emission = (vVolcanicHeat - 0.6) * 0.25;
        finalColor += vec3(emission * 3.0, emission * 1.0, emission * 0.2);
    }
    
    // Lava activity adds pulsing glow
    if (vLavaActivity > 0.5) {
        float pulse = sin(uTime * 5.0) * 0.1 + 0.9;
        float lavaGlow = (vLavaActivity - 0.5) * 0.2 * pulse;
        finalColor += vec3(lavaGlow * 2.0, lavaGlow * 0.6, lavaGlow * 0.1);
    }
    
    // Pizza-appropriate gamma (slightly warm)
    finalColor = pow(finalColor, vec3(0.85));
    
    // Delicious warm tint! 🍕
    finalColor *= vec3(1.05, 1.0, 0.95);
    
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createIoUniformSetup() {
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
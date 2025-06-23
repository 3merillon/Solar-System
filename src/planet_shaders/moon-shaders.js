export const moonVertexShaderSource = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPosition;
layout(location=1) in float aMorphable;
layout(location=2) in float aLod;
layout(location=3) in float aMorphFactor;
layout(location=4) in vec3 aEdge0;
layout(location=5) in vec3 aEdge1;

uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMatrix;
uniform float uPlanetRadius;
uniform float uNoiseScale;
uniform float uNoiseOffset;
uniform float uLogDepthBufFC;

out vec3 vPos;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out float vLogDepth;
out vec3 vLocalPos;
out float vElevation;

// --- Noise ---
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

// --- Crater/Mare profile ---
float basinProfile(vec3 n, vec3 center, float radius, float rimH, float depth, out float centerMask) {
    float d = length(n - center);
    float normD = d / radius;
    centerMask = 0.0;
    if (normD > 1.0) return 0.0;
    if (normD < 0.5) {
        centerMask = 1.0;
        return -depth;
    }
    if (normD < 0.8) {
        float t = (normD - 0.5) / 0.3;
        centerMask = 1.0 - t;
        return mix(-depth, rimH, t*t);
    }
    if (normD < 0.95) {
        float t = (normD - 0.8) / 0.15;
        return rimH * (1.0 - t*t);
    }
    float t = (normD - 0.95) / 0.05;
    return rimH * (1.0 - t) * 0.1;
}

float moonDisplacement(vec3 n, float scale, float offset, out float smoothBasin) {
    vec3 p = n * scale + vec3(offset);
    float disp = 0.0, mask, maxMask = 0.0;

    // Maria as giant shallow craters
    vec3 tranquility = normalize(vec3(0.6, 0.2, 0.7));
    vec3 imbrium = normalize(vec3(-0.4, 0.5, 0.6));
    disp += basinProfile(n, tranquility, 0.28, 0.004, 0.008, mask); maxMask = max(maxMask, mask);
    disp += basinProfile(n, imbrium, 0.32, 0.005, 0.010, mask); maxMask = max(maxMask, mask);

    // Major craters
    vec3 craters[4];
    float radii[4], rimH[4], depths[4];
    craters[0] = normalize(vec3(0.2, -0.8, 0.4)); radii[0] = 0.08; rimH[0] = 0.012; depths[0] = 0.035;
    craters[1] = normalize(vec3(-0.3, 0.4, 0.7)); radii[1] = 0.06; rimH[1] = 0.010; depths[1] = 0.025;
    craters[2] = normalize(vec3(0.7, 0.3, -0.2)); radii[2] = 0.04; rimH[2] = 0.008; depths[2] = 0.018;
    craters[3] = normalize(vec3(-0.1, 0.8, 0.3)); radii[3] = 0.09; rimH[3] = 0.007; depths[3] = 0.018;
    for (int i = 0; i < 4; ++i) {
        float cb;
        disp += basinProfile(n, craters[i], radii[i], rimH[i], depths[i], cb);
        maxMask = max(maxMask, cb);
    }

    // Small-scale noise (suppressed in basin/crater centers)
    float noiseFactor = 1.0 - maxMask * 0.95;
    float regolith = noise3d(p * 2.5) * 0.003 * noiseFactor;
    regolith += noise3d(p * 8.0) * 0.001 * noiseFactor;

    // Highlands (small bumps, suppressed in basins/craters)
    float highland = noise3d(p * 0.7) * 0.002 * (1.0 - maxMask);

    smoothBasin = maxMask;
    return clamp(disp + regolith + highland, -0.03, 0.03);
}

vec3 calculateDisplacedNormal(vec3 n, float scale, float offset, float epsilon) {
    float s0, s1, s2;
    vec3 t1 = normalize(cross(n, vec3(0,1,0)));
    if (length(t1) < 0.1) t1 = normalize(cross(n, vec3(1,0,0)));
    vec3 t2 = normalize(cross(n, t1));
    vec3 n1 = normalize(n + epsilon * t1);
    vec3 n2 = normalize(n + epsilon * t2);
    float h = moonDisplacement(n, scale, offset, s0);
    float h1 = moonDisplacement(n1, scale, offset, s1);
    float h2 = moonDisplacement(n2, scale, offset, s2);

    vec3 p0 = n * (1.0 + h);
    vec3 p1 = n1 * (1.0 + h1);
    vec3 p2 = n2 * (1.0 + h2);

    vec3 normal = normalize(cross(p1 - p0, p2 - p0));

    // Blend normal to sphere normal in basin/crater centers for smooth shading
    float blend = max(max(s0, s1), s2);
    if (blend > 0.0) {
        normal = normalize(mix(normal, n, blend * 0.8));
    }
    return normal;
}

float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float scale, float offset) {
    float dummy;
    float r0 = 1.0 + moonDisplacement(normalize(e0), scale, offset, dummy);
    float r1 = 1.0 + moonDisplacement(normalize(e1), scale, offset, dummy);
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

vec3 morphTargetNormal(vec3 dir, vec3 e0, vec3 e1, float scale, float offset, float epsilon) {
    vec3 n0 = calculateDisplacedNormal(normalize(e0), scale, offset, epsilon);
    vec3 n1 = calculateDisplacedNormal(normalize(e1), scale, offset, epsilon);
    float dummy;
    float r0 = 1.0 + moonDisplacement(normalize(e0), scale, offset, dummy);
    float r1 = 1.0 + moonDisplacement(normalize(e1), scale, offset, dummy);
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
    float smoothBasin;
    float displacement = moonDisplacement(n, uNoiseScale, uNoiseOffset, smoothBasin);
    float r0 = uPlanetRadius * (1.0 + displacement);
    vec3 baseNormal = calculateDisplacedNormal(n, uNoiseScale, uNoiseOffset, 0.01);

    float finalRadius = r0;
    vec3 finalNormal = baseNormal;

    if(aMorphable > 0.5) {
        float morphR = morphTargetRadius(n, aEdge0, aEdge1, uNoiseScale, uNoiseOffset) * uPlanetRadius;
        finalRadius = mix(r0, morphR, aMorphable * aMorphFactor);
        vec3 morphN = morphTargetNormal(n, aEdge0, aEdge1, uNoiseScale, uNoiseOffset, 0.01);
        finalNormal = normalize(mix(baseNormal, morphN, aMorphable * aMorphFactor));
    }

    vPos = n * finalRadius;
    vWorldPos = (uModel * vec4(vPos, 1.0)).xyz;
    vWorldNormal = normalize(uNormalMatrix * finalNormal);
    vElevation = displacement;

    gl_Position = uProj * uView * uModel * vec4(vPos, 1.0);
    vLogDepth = 1.0 + gl_Position.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= gl_Position.w;
}
`;

export const moonFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;

in vec3 vPos;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vLogDepth;
in vec3 vLocalPos;
in float vElevation;

out vec4 fragColor;

uniform vec3 uCameraPos;
uniform vec3 uSunPosition;
uniform float uLogDepthBufFC;

vec3 getMoonColor(vec3 localPos) {
    // Maria coloring is a subtle blue-gray tint, not dark
    vec3 mariaColor = vec3(0.41, 0.43, 0.47);
    vec3 highlandColor = vec3(0.54, 0.53, 0.51);
    vec3 tranquility = normalize(vec3(0.6, 0.2, 0.7));
    vec3 imbrium = normalize(vec3(-0.4, 0.5, 0.6));
    float dtranq = length(localPos - tranquility) / 0.28;
    float dimbrium = length(localPos - imbrium) / 0.32;
    float mariaBlend = max(smoothstep(0.0, 1.0, 1.0 - dtranq), smoothstep(0.0, 1.0, 1.0 - dimbrium));
    return mix(highlandColor, mariaColor, clamp(mariaBlend, 0.0, 1.0) * 0.7);
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);

    vec3 baseColor = getMoonColor(vLocalPos);

    float NdotL = max(0.0, dot(N, L));
    float ambient = 0.07;
    float diffuse = 0.93 * NdotL;
    float rim = pow(1.0 - max(0.0, dot(N, V)), 4.0) * 0.04;

    float lighting = ambient + diffuse + rim;
    vec3 finalColor = baseColor * lighting;

    finalColor = pow(finalColor, vec3(1.05));
    fragColor = vec4(finalColor, 1.0);
}
`;

export function createMoonUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 8.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC); // <--- ADD THIS
    };
}
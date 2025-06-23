export const mercuryVertexShaderSource = `#version 300 es
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
uniform float uTime;
uniform float uLogDepthBufFC;

out vec3 vWorldPos, vWorldNormal, vLocalPos;
out float vElevation, vLogDepth;

// --- Pure hash/noise ---
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,54.53)))*43758.5453); }
float noise3d(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float n = dot(i,vec3(1,57,113));
    return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
               mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
}

// --- Crater field: 16 deterministic random craters, plus a big basin ---
float craterField(vec3 n) {
    float sum = 0.0;
    for(int i=0;i<16;i++) {
        float a = float(i) * 31.7;
        float b = float(i) * 17.3;
        float c = float(i) * 13.1;
        vec3 center = normalize(vec3(
            hash(a+1.1), hash(b+2.2), hash(c+3.3)
        ) * 2.0 - 1.0);
        float r = 0.04 + hash(a+b) * 0.08;
        float d = length(n-center);
        if(d<r) {
            float t = 1.0-(d/r);
            sum += -0.016 * t * t * (1.0-t);
        }
    }
    // Caloris basin (large, shallow)
    vec3 basinCenter = normalize(vec3(0.93,0.13,0.21));
    float basinD = length(n-basinCenter);
    if(basinD<0.36) {
        float t = 1.0-(basinD/0.36);
        sum += -0.04 * t * t * (1.0-t);
    }
    return sum;
}

// --- Scarps (cliffs) ---
float scarps(vec3 n) {
    float s = sin(n.x*10.0 + n.y*7.0) * 0.009 + sin(n.z*12.0) * 0.005;
    s += sin(n.x*28.0 + n.y*15.0) * 0.003;
    return s;
}

// --- Regolith and noise ---
float regolith(vec3 n, float scale, float offset) {
    vec3 p = n * scale + vec3(offset);
    float fine = noise3d(p*8.0) * 0.006;
    float micro = noise3d(p*32.0) * 0.002;
    return fine + micro;
}

// --- Mercury terrain total ---
float mercuryTerrain(vec3 n, float scale, float offset) {
    return craterField(n) + scarps(n) + regolith(n, scale, offset);
}

// --- Displaced normal (matches default shader logic) ---
vec3 displacedNormal(vec3 n, float scale, float offset, float eps) {
    vec3 t1 = normalize(cross(n,vec3(0,1,0)));
    if(length(t1)<0.1) t1 = normalize(cross(n,vec3(1,0,0)));
    vec3 t2 = normalize(cross(n,t1));
    vec3 n1 = normalize(n+eps*t1);
    vec3 n2 = normalize(n+eps*t2);
    float h = mercuryTerrain(n,scale,offset);
    float h1 = mercuryTerrain(n1,scale,offset);
    float h2 = mercuryTerrain(n2,scale,offset);
    vec3 p0 = n*(1.0+h), p1 = n1*(1.0+h1), p2 = n2*(1.0+h2);
    return normalize(cross(p1-p0,p2-p0));
}

// --- Morph target radius (matches default) ---
float morphTargetRadius(vec3 dir, vec3 e0, vec3 e1, float scale, float offset) {
    float r0 = 1.0 + mercuryTerrain(normalize(e0), scale, offset);
    float r1 = 1.0 + mercuryTerrain(normalize(e1), scale, offset);
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

// --- Morph target normal (matches default) ---
vec3 morphTargetNormal(vec3 dir, vec3 e0, vec3 e1, float scale, float offset, float eps) {
    vec3 n0 = displacedNormal(normalize(e0), scale, offset, eps);
    vec3 n1 = displacedNormal(normalize(e1), scale, offset, eps);
    float r0 = 1.0 + mercuryTerrain(normalize(e0), scale, offset);
    float r1 = 1.0 + mercuryTerrain(normalize(e1), scale, offset);
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
    float displacement = mercuryTerrain(n, uNoiseScale, uNoiseOffset);
    float r0 = uPlanetRadius * (1.0 + displacement);
    vec3 baseNormal = displacedNormal(n, uNoiseScale, uNoiseOffset, 0.01);

    float finalRadius = r0;
    vec3 finalNormal = baseNormal;

    if(aMorphable > 0.5) {
        float morphR = morphTargetRadius(n, aEdge0, aEdge1, uNoiseScale, uNoiseOffset) * uPlanetRadius;
        finalRadius = mix(r0, morphR, aMorphable * aMorphFactor);
        vec3 morphN = morphTargetNormal(n, aEdge0, aEdge1, uNoiseScale, uNoiseOffset, 0.01);
        finalNormal = normalize(mix(baseNormal, morphN, aMorphable * aMorphFactor));
    }

    vec3 pos = n * finalRadius;
    vWorldPos = (uModel * vec4(pos, 1.0)).xyz;
    vWorldNormal = normalize(uNormalMatrix * finalNormal);
    vElevation = displacement;

    vec4 clipPos = uProj * uView * uModel * vec4(pos, 1.0);
    gl_Position = clipPos;
    vLogDepth = 1.0 + clipPos.w;
    gl_Position.z = log2(max(1e-6, vLogDepth)) * uLogDepthBufFC - 1.0;
    gl_Position.z *= clipPos.w;
}
`;

export const mercuryFragmentShaderSource = `#version 300 es
#extension GL_EXT_frag_depth : enable
precision mediump float;
in vec3 vWorldPos, vWorldNormal, vLocalPos;
in float vElevation, vLogDepth;
out vec4 fragColor;
uniform vec3 uCameraPos, uSunPosition;
uniform float uLogDepthBufFC;

// --- Realistic Mercury color palette ---
vec3 getMercuryColor(vec3 n, float elevation) {
    // Iron-rich gray
    vec3 base = mix(vec3(0.48,0.44,0.41), vec3(0.58,0.54,0.48), smoothstep(0.01,0.04,elevation));
    // Brighten highlands, darken basins
    if(elevation>0.015) base = mix(base, vec3(0.65,0.60,0.50), 0.3);
    if(elevation<-0.02) base = mix(base, vec3(0.32,0.27,0.24), 0.5);
    // Subtle ochre for scarps
    float scarp = sin(n.x*10.0 + n.y*7.0) * 0.5 + 0.5;
    base = mix(base, vec3(0.56,0.50,0.39), scarp * 0.09);
    // Add subtle color noise
    float tint = fract(sin(dot(n,vec3(12.9898,78.233,54.53)))*43758.5453);
    base += (tint-0.5)*0.07;
    return clamp(base,0.0,1.0);
}

void main() {
    gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPosition - vWorldPos);
    vec3 V = normalize(uCameraPos - vWorldPos);
    float NdotL = max(0.0, dot(N, L));
    float ambient = 0.16, diffuse = 0.84*NdotL;
    float rim = pow(1.0 - max(0.0, dot(N,V)), 2.0) * 0.09;
    float lighting = ambient + diffuse + rim;
    vec3 baseColor = getMercuryColor(vLocalPos, vElevation);
    fragColor = vec4(baseColor * lighting, 1.0);
}
`;

export function createMercuryUniformSetup() {
    return (gl, uniforms, body, cameraPos, viewMatrix, projMatrix, time, showLod, animateWaves, sunPosition, logDepthBufFC) => {
        gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(body.worldMatrix));
        gl.uniformMatrix4fv(uniforms.uView, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(uniforms.uProj, false, new Float32Array(projMatrix));
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, new Float32Array(body.normalMatrix));
        gl.uniform1f(uniforms.uPlanetRadius, body.radius);
        gl.uniform1f(uniforms.uNoiseScale, body.noiseScale || 25.0);
        gl.uniform1f(uniforms.uNoiseOffset, body.noiseOffset || 0.0);
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cameraPos));
        gl.uniform3fv(uniforms.uSunPosition, new Float32Array(sunPosition));
        gl.uniform1f(uniforms.uTime, time);
        gl.uniform1f(uniforms.uLogDepthBufFC, logDepthBufFC);
    };
}
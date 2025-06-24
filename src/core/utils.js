export function nrm(v) {
    const l = Math.hypot(...v);
    return l ? v.map(x => x / l) : [0, 0, 1];
}

export function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function cr(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

export function dt(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lookAt(eye, target, up) {
    const z = nrm(sub(eye, target));
    const x = nrm(cr(up, z));
    const y = cr(z, x);
    return [
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -dt(x, eye), -dt(y, eye), -dt(z, eye), 1
    ];
}

export function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
    ];
}

export function mat4Identity() {
    return [1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1];
}

export function mat3Identity() {
    return [1, 0, 0,
            0, 1, 0,
            0, 0, 1];
}

export function mat3FromMat4(m4) {
    return [
        m4[0], m4[1], m4[2],
        m4[4], m4[5], m4[6],
        m4[8], m4[9], m4[10]
    ];
}

export function mat3Inverse(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[3], a11 = m[4], a12 = m[5];
    const a20 = m[6], a21 = m[7], a22 = m[8];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;

    const det = a00 * b01 + a01 * b11 + a02 * b21;

    if (!det) return mat3Identity();

    const invDet = 1.0 / det;

    return [
        b01 * invDet,
        (-a22 * a01 + a02 * a21) * invDet,
        (a12 * a01 - a02 * a11) * invDet,
        b11 * invDet,
        (a22 * a00 - a02 * a20) * invDet,
        (-a12 * a00 + a02 * a10) * invDet,
        b21 * invDet,
        (-a21 * a00 + a01 * a20) * invDet,
        (a11 * a00 - a01 * a10) * invDet
    ];
}

export function mat3Transpose(m) {
    return [
        m[0], m[3], m[6],
        m[1], m[4], m[7],
        m[2], m[5], m[8]
    ];
}

export function mat4Translate(x, y, z) {
    return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        x, y, z, 1
    ];
}

export function mat4RotateX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
        1, 0, 0, 0,
        0, c, s, 0,
        0, -s, c, 0,
        0, 0, 0, 1
    ];
}

export function mat4RotateY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1
    ];
}

export function mat4RotateZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
        c, s, 0, 0,
        -s, c, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ];
}

export function mat4Multiply(a, b) {
    const result = new Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            result[i * 4 + j] =
                a[i * 4 + 0] * b[0 * 4 + j] +
                a[i * 4 + 1] * b[1 * 4 + j] +
                a[i * 4 + 2] * b[2 * 4 + j] +
                a[i * 4 + 3] * b[3 * 4 + j];
        }
    }
    return result;
}
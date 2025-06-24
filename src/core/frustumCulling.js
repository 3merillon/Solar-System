export class FrustumCuller {
    constructor() {
        this.frustumPlanes = new Array(6);
        for (let i = 0; i < 6; i++) {
            this.frustumPlanes[i] = [0, 0, 0, 0];
        }
    }

    extractFrustumPlanes(viewProjMatrix) {
        const m = viewProjMatrix;
        
        // Left plane
        this.frustumPlanes[0][0] = m[3] + m[0];
        this.frustumPlanes[0][1] = m[7] + m[4];
        this.frustumPlanes[0][2] = m[11] + m[8];
        this.frustumPlanes[0][3] = m[15] + m[12];
        
        // Right plane
        this.frustumPlanes[1][0] = m[3] - m[0];
        this.frustumPlanes[1][1] = m[7] - m[4];
        this.frustumPlanes[1][2] = m[11] - m[8];
        this.frustumPlanes[1][3] = m[15] - m[12];
        
        // Bottom plane
        this.frustumPlanes[2][0] = m[3] + m[1];
        this.frustumPlanes[2][1] = m[7] + m[5];
        this.frustumPlanes[2][2] = m[11] + m[9];
        this.frustumPlanes[2][3] = m[15] + m[13];
        
        // Top plane
        this.frustumPlanes[3][0] = m[3] - m[1];
        this.frustumPlanes[3][1] = m[7] - m[5];
        this.frustumPlanes[3][2] = m[11] - m[9];
        this.frustumPlanes[3][3] = m[15] - m[13];
        
        // Near plane
        this.frustumPlanes[4][0] = m[3] + m[2];
        this.frustumPlanes[4][1] = m[7] + m[6];
        this.frustumPlanes[4][2] = m[11] + m[10];
        this.frustumPlanes[4][3] = m[15] + m[14];
        
        // Far plane
        this.frustumPlanes[5][0] = m[3] - m[2];
        this.frustumPlanes[5][1] = m[7] - m[6];
        this.frustumPlanes[5][2] = m[11] - m[10];
        this.frustumPlanes[5][3] = m[15] - m[14];
        
        // Normalize planes
        for (let i = 0; i < 6; i++) {
            const length = Math.sqrt(
                this.frustumPlanes[i][0] * this.frustumPlanes[i][0] +
                this.frustumPlanes[i][1] * this.frustumPlanes[i][1] +
                this.frustumPlanes[i][2] * this.frustumPlanes[i][2]
            );
            if (length > 0) {
                this.frustumPlanes[i][0] /= length;
                this.frustumPlanes[i][1] /= length;
                this.frustumPlanes[i][2] /= length;
                this.frustumPlanes[i][3] /= length;
            }
        }
    }

    isSphereInFrustum(center, radius) {
        for (let i = 0; i < 6; i++) {
            const plane = this.frustumPlanes[i];
            const distance = plane[0] * center[0] + plane[1] * center[1] + plane[2] * center[2] + plane[3];
            
            if (distance < -radius) {
                return false;
            }
        }
        return true;
    }

    // CAMERA-CENTERED: Updated to work with camera-relative coordinates
    getPlanetWorldCenter(body, camera) {
        // Return camera-relative position
        return camera.worldToCameraRelative(body.position);
    }

    // CAMERA-CENTERED: Updated planet visibility test
    isPlanetVisible(body, viewProjMatrix, camera) {
        this.extractFrustumPlanes(viewProjMatrix);
        
        const cameraRelativeCenter = this.getPlanetWorldCenter(body, camera);
        const radius = body.radius;
        
        const maxDisplacement = body.maxDisplacement || 0.08;
        const cullRadius = radius * (1.0 + maxDisplacement + 0.3);
        
        return this.isSphereInFrustum(cameraRelativeCenter, cullRadius);
    }
}

export function mat4MultiplyViewProj(view, proj) {
    const result = new Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            result[i * 4 + j] =
                view[i * 4 + 0] * proj[0 * 4 + j] +
                view[i * 4 + 1] * proj[1 * 4 + j] +
                view[i * 4 + 2] * proj[2 * 4 + j] +
                view[i * 4 + 3] * proj[3 * 4 + j];
        }
    }
    return result;
}
import { nrm, cr, dt, sub, add, lookAt } from './utils.js';

export class EnhancedCamera {
    constructor() {
        // Start near Earth with Sun in backdrop
        this.worldPosition = [0, 0, 0];
        this.forward = [0, 0, -1];
        this.up = [0, 1, 0];
        this.velocity = [0, 0, 0];
        
        // Camera settings
        this.speed = 0.067;
        this.fastSpeed = 0.33;
        this.slowSpeed = 0.017;
        this.speedMultiplier = 1.0;
        this.mouseSensitivity = 0.001;
        this.sensitivityMultiplier = 1.0;
        this.rollSpeed = 0.01;
        this.friction = 0.85;
        
        // Orbital camera properties
        this.mode = 'free'; // START IN FREE MODE
        this.target = null;
        this.orbitDistance = 100;
        this.orbitAngleH = 0;
        this.orbitAngleV = 0;
        this.orbitSpeed = 0.5;
        this.orbitMinDistance = 20;
        this.orbitMaxDistance = 1000;
        
        // Input state
        this.keys = {};
        this.mouseCapture = false;
        this.lastTouchDistance = 0;
        this.lastTouchCenter = { x: 0, y: 0 };
        this.touchStartTime = 0;
        
        this.solarSystem = null;
        this.initialSetupComplete = false;
        
        this.setupControls();
    }
    
    // Initialize camera near Earth with optimal view in FREE MODE
    initializeNearEarth() {
        if (!this.solarSystem || this.initialSetupComplete) return;
        
        const earth = this.solarSystem.getBody('earth');
        const sun = this.solarSystem.getBody('sun');
        
        if (!earth || !sun) return;
        
        // Get Earth and Sun positions
        const earthPos = earth.position;
        const sunPos = sun.position;
        
        // Calculate Sun-to-Earth vector (opposite direction for proper orientation)
        const sunToEarth = [
            earthPos[0] - sunPos[0],
            earthPos[1] - sunPos[1], 
            earthPos[2] - sunPos[2]
        ];
        const sunEarthDistance = Math.sqrt(
            sunToEarth[0] * sunToEarth[0] + 
            sunToEarth[1] * sunToEarth[1] + 
            sunToEarth[2] * sunToEarth[2]
        );
        
        // Normalize Sun-to-Earth vector
        const sunToEarthNorm = [
            sunToEarth[0] / sunEarthDistance,
            sunToEarth[1] / sunEarthDistance,
            sunToEarth[2] / sunEarthDistance
        ];
        
        // Position camera
        const cameraDistance = earth.radius * 10.0;
        
        const offsetAngle = Math.PI * -0.07;
        const cosOffset = Math.cos(offsetAngle);
        const sinOffset = Math.sin(offsetAngle);
        
        const perpendicular = [
            -sunToEarthNorm[2], // Perpendicular in XZ plane
            0,
            sunToEarthNorm[0]
        ];
        const perpLength = Math.sqrt(perpendicular[0] * perpendicular[0] + perpendicular[2] * perpendicular[2]);
        if (perpLength > 0) {
            perpendicular[0] /= perpLength;
            perpendicular[2] /= perpLength;
        }
        
        // Offset camera
        const cameraOffset = [
            (sunToEarthNorm[0] * cosOffset + perpendicular[0] * sinOffset) * cameraDistance,
            sunToEarthNorm[1] * cameraDistance + earth.radius * 0.3, // Reduced vertical offset
            (sunToEarthNorm[2] * cosOffset + perpendicular[2] * sinOffset) * cameraDistance
        ];
        
        // Set camera position
        this.worldPosition = [
            earthPos[0] + cameraOffset[0],
            earthPos[1] + cameraOffset[1],
            earthPos[2] + cameraOffset[2]
        ];
        
        this.mode = 'free';
        this.target = null; // No target in free mode
        
        // Calculate direction that looks from camera towards Sun, with Earth in foreground
        const cameraToSun = [
            sunPos[0] - this.worldPosition[0],
            sunPos[1] - this.worldPosition[1],
            sunPos[2] - this.worldPosition[2]
        ];
        
        this.forward = nrm(cameraToSun);
        
        // Set up vector pointing generally upward
        this.up = [0, 1, 0];
        
        // Ensure right vector is perpendicular
        const right = nrm(cr(this.forward, this.up));
        this.up = nrm(cr(right, this.forward));
        
        // Clear any velocity
        this.velocity = [0, 0, 0];
        
        this.initialSetupComplete = true;
        
        // Calculate distances for logging
        const distanceToEarth = Math.sqrt(
            cameraOffset[0] * cameraOffset[0] + 
            cameraOffset[1] * cameraOffset[1] + 
            cameraOffset[2] * cameraOffset[2]
        );
        
        const distanceToSun = Math.sqrt(
            cameraToSun[0] * cameraToSun[0] + 
            cameraToSun[1] * cameraToSun[1] + 
            cameraToSun[2] * cameraToSun[2]
        );
        
        //console.log('Camera initialized in FREE MODE with Earth in foreground and Sun in view');
        //console.log(`Earth position: [${earthPos[0].toFixed(1)}, ${earthPos[1].toFixed(1)}, ${earthPos[2].toFixed(1)}]`);
        //console.log(`Sun position: [${sunPos[0].toFixed(1)}, ${sunPos[1].toFixed(1)}, ${sunPos[2].toFixed(1)}]`);
        //console.log(`Camera position: [${this.worldPosition[0].toFixed(1)}, ${this.worldPosition[1].toFixed(1)}, ${this.worldPosition[2].toFixed(1)}]`);
        //console.log(`Distance to Earth: ${distanceToEarth.toFixed(1)} units (${(distanceToEarth/earth.radius).toFixed(1)}x Earth radius)`);
        //console.log(`Distance to Sun: ${distanceToSun.toFixed(1)} units`);
        //console.log(`Camera looking towards Sun with Earth in foreground`);
    }
    
    // Get camera position for external use (world coordinates)
    get position() {
        return [...this.worldPosition];
    }
    
    // Set camera position (world coordinates)
    set position(pos) {
        this.worldPosition = [...pos];
    }
    
    // Transform world position to camera-relative coordinates
    worldToCameraRelative(worldPos) {
        return [
            worldPos[0] - this.worldPosition[0],
            worldPos[1] - this.worldPosition[1],
            worldPos[2] - this.worldPosition[2]
        ];
    }
    
    // Transform camera-relative position to world coordinates
    cameraRelativeToWorld(cameraRelativePos) {
        return [
            cameraRelativePos[0] + this.worldPosition[0],
            cameraRelativePos[1] + this.worldPosition[1],
            cameraRelativePos[2] + this.worldPosition[2]
        ];
    }
    
    setSolarSystem(solarSystem) {
        this.solarSystem = solarSystem;
        // Initialize near Earth once solar system is available
        setTimeout(() => this.initializeNearEarth(), 100);
    }
    
    setupControls() {
        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            this.keys[e.code.toLowerCase()] = true;
            
            switch(e.code.toLowerCase()) {
                case 'keyr': this.reset(); break;
                case 'digit0': this.setFreeMode(); break;
                case 'digit1': this.focusBody('sun'); break;
                case 'digit2': this.focusBody('earth'); break;
                case 'digit3': this.focusBody('moon'); break;
                case 'digit4': this.focusBody('mars'); break;
                case 'digit5': this.focusBody('jupiter'); break;
                case 'digit6': this.focusBody('europa'); break;
                case 'digit7': this.focusBody('saturn'); break;
                case 'digit8': this.focusBody('titan'); break;
                case 'digit9': this.focusBody('neptune'); break;
                case 'keyp': this.focusBody('pluto'); break;
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code.toLowerCase()] = false;
        });
        
        // Mouse controls without pointer lock
        let isMouseDown = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
        const canvas = document.getElementById('gl');
        
        let clickStartTime = 0;
        let clickStartPos = { x: 0, y: 0 };

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                isMouseDown = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
                
                clickStartTime = Date.now();
                clickStartPos = { x: e.clientX, y: e.clientY };
            }
        });
        
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                isMouseDown = false;
                canvas.style.cursor = 'grab';
                
                const clickDuration = Date.now() - clickStartTime;
                const clickDistance = Math.hypot(
                    e.clientX - clickStartPos.x,
                    e.clientY - clickStartPos.y
                );
                
                if (clickDuration < 300 && clickDistance < 10) {
                    if (this.mode === 'orbital' && window.solarSystemApp) {
                        window.solarSystemApp.showDescriptionOnInteraction();
                    }
                }
            }
        });
        
        window.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                const deltaX = e.clientX - lastMouseX;
                const deltaY = e.clientY - lastMouseY;
                
                const sensitivity = this.mouseSensitivity * this.sensitivityMultiplier;
                
                if (this.mode === 'free') {
                    this.rotate(-deltaY * sensitivity, -deltaX * sensitivity, 0);
                } else if (this.mode === 'orbital') {
                    this.orbitAngleH += deltaX * sensitivity * 2;
                    this.orbitAngleV = Math.max(-Math.PI/2 + 0.05, 
                                            Math.min(Math.PI/2 - 0.05, 
                                                    this.orbitAngleV - deltaY * sensitivity * 2));
                }
                
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            }
        });
        
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        window.addEventListener('mouseleave', () => {
            isMouseDown = false;
            canvas.style.cursor = 'grab';
        });
        
        // Wheel zoom for orbital mode
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (this.mode === 'orbital') {
                const zoomSpeed = 0.15;
                const currentDistanceRatio = this.orbitDistance / (this.target ? this.target.radius : 1);
                const adaptiveZoomSpeed = zoomSpeed * Math.max(0.1, Math.min(2.0, currentDistanceRatio * 0.1));
                const zoomFactor = 1 + (e.deltaY > 0 ? adaptiveZoomSpeed : -adaptiveZoomSpeed);
                this.orbitDistance = Math.max(this.orbitMinDistance, 
                                            Math.min(this.orbitMaxDistance, 
                                                    this.orbitDistance * zoomFactor));
            }
        });
        
        this.setupTouchControls();
    }
    
    setupTouchControls() {
        let activeGesture = null;
        let initialTouches = {};
        let lastSingleTouch = null;
        let lastPinchData = null;
        
        const canvas = document.getElementById('gl');
        
        const preventCanvasDefaults = (e) => {
            if (e.target === canvas) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        
        canvas.addEventListener('touchstart', preventCanvasDefaults, { passive: false });
        canvas.addEventListener('touchmove', preventCanvasDefaults, { passive: false });
        canvas.addEventListener('touchend', preventCanvasDefaults, { passive: false });
        
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('selectstart', (e) => e.preventDefault());
        
        let touchStartTime = 0;
        let touchStartPos = { x: 0, y: 0 };
        
        canvas.addEventListener('touchstart', (e) => {
            if (e.target !== canvas) return;
            
            e.preventDefault();
            
            const touches = Array.from(e.touches);
            
            if (touches.length === 1) {
                activeGesture = 'rotate';
                lastSingleTouch = {
                    x: touches[0].clientX,
                    y: touches[0].clientY,
                    time: Date.now()
                };
                initialTouches = { single: lastSingleTouch };
                
                touchStartTime = Date.now();
                touchStartPos = { x: touches[0].clientX, y: touches[0].clientY };
                
            } else if (touches.length === 2) {
                activeGesture = 'pinch';
                
                const touch1 = touches[0];
                const touch2 = touches[1];
                
                const distance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                lastPinchData = {
                    distance: distance,
                    centerX: centerX,
                    centerY: centerY
                };
                
                initialTouches = {
                    pinch: lastPinchData,
                    touch1: { x: touch1.clientX, y: touch1.clientY },
                    touch2: { x: touch2.clientX, y: touch2.clientY }
                };
            }
        }, { passive: false });
        
        canvas.addEventListener('touchmove', (e) => {
            if (!activeGesture) return;
            
            e.preventDefault();
            
            const touches = Array.from(e.touches);
            
            if (activeGesture === 'rotate' && touches.length === 1 && lastSingleTouch) {
                const currentTouch = touches[0];
                const deltaX = currentTouch.clientX - lastSingleTouch.x;
                const deltaY = currentTouch.clientY - lastSingleTouch.y;
                
                const mobileSensitivity = this.mouseSensitivity * this.sensitivityMultiplier * 3;
                
                if (this.mode === 'free') {
                    this.rotate(-deltaY * mobileSensitivity, -deltaX * mobileSensitivity, 0);
                } else if (this.mode === 'orbital') {
                    this.orbitAngleH += deltaX * mobileSensitivity * 2;
                    
                    const maxVerticalAngle = Math.PI / 2 - 0.05;
                    this.orbitAngleV = Math.max(-maxVerticalAngle, 
                                            Math.min(maxVerticalAngle, 
                                                    this.orbitAngleV - deltaY * mobileSensitivity * 2));
                }
                
                lastSingleTouch = {
                    x: currentTouch.clientX,
                    y: currentTouch.clientY,
                    time: Date.now()
                };
                
            } else if (activeGesture === 'pinch' && touches.length === 2 && lastPinchData) {
                const touch1 = touches[0];
                const touch2 = touches[1];
                
                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                
                const currentCenterX = (touch1.clientX + touch2.clientX) / 2;
                const currentCenterY = (touch1.clientY + touch2.clientY) / 2;
                
                const distanceChange = currentDistance - lastPinchData.distance;
                
                if (Math.abs(distanceChange) > 2) {
                    if (this.mode === 'orbital' && this.target) {
                        const baseZoomSensitivity = 0.05;
                        const speedAdjustedSensitivity = baseZoomSensitivity * this.speedMultiplier;
                        
                        const zoomFactor = 1.0 - (distanceChange * speedAdjustedSensitivity);
                        
                        const newDistance = this.orbitDistance * zoomFactor;
                        this.orbitDistance = Math.max(this.orbitMinDistance, 
                                                    Math.min(this.orbitMaxDistance, newDistance));
                        
                    } else if (this.mode === 'free') {
                        const baseMoveSensitivity = 0.3;
                        const speedAdjustedSensitivity = baseMoveSensitivity * this.speedMultiplier;
                        
                        const moveDistance = distanceChange * speedAdjustedSensitivity;
                        
                        this.worldPosition[0] += this.forward[0] * moveDistance;
                        this.worldPosition[1] += this.forward[1] * moveDistance;
                        this.worldPosition[2] += this.forward[2] * moveDistance;
                    }
                    
                    lastPinchData.distance = currentDistance;
                }
                
                if (this.mode === 'free') {
                    const initialAngle = Math.atan2(
                        initialTouches.touch2.y - initialTouches.touch1.y,
                        initialTouches.touch2.x - initialTouches.touch1.x
                    );
                    
                    const currentAngle = Math.atan2(
                        touch2.clientY - touch1.clientY,
                        touch2.clientX - touch1.clientX
                    );
                    
                    let rollDelta = currentAngle - initialAngle;
                    
                    while (rollDelta > Math.PI) rollDelta -= 2 * Math.PI;
                    while (rollDelta < -Math.PI) rollDelta += 2 * Math.PI;
                    
                    if (Math.abs(rollDelta) > 0.05) {
                        const rollSensitivity = 0.3;
                        this.rotate(0, 0, rollDelta * rollSensitivity);
                        
                        initialTouches.touch1 = { x: touch1.clientX, y: touch1.clientY };
                        initialTouches.touch2 = { x: touch2.clientX, y: touch2.clientY };
                    }
                }
                
                const panDeltaX = currentCenterX - lastPinchData.centerX;
                const panDeltaY = currentCenterY - lastPinchData.centerY;
                const panDistance = Math.hypot(panDeltaX, panDeltaY);
                
                if (panDistance > 15) {
                    const panSensitivity = this.mouseSensitivity * this.sensitivityMultiplier * 2;
                    
                    if (this.mode === 'free') {
                        this.rotate(-panDeltaY * panSensitivity, -panDeltaX * panSensitivity, 0);
                    } else if (this.mode === 'orbital') {
                        this.orbitAngleH += panDeltaX * panSensitivity * 2;
                        
                        const maxVerticalAngle = Math.PI / 2 - 0.05;
                        this.orbitAngleV = Math.max(-maxVerticalAngle, 
                                                Math.min(maxVerticalAngle, 
                                                        this.orbitAngleV - panDeltaY * panSensitivity * 2));
                    }
                    
                    lastPinchData.centerX = currentCenterX;
                    lastPinchData.centerY = currentCenterY;
                }
            }
        }, { passive: false });
        
        canvas.addEventListener('touchend', (e) => {
            if (!activeGesture) return;
            
            e.preventDefault();
            
            const touches = Array.from(e.touches);
            
            if (touches.length === 0) {
                if (activeGesture === 'rotate' && lastSingleTouch) {
                    const tapDuration = Date.now() - touchStartTime;
                    const tapDistance = Math.hypot(
                        e.changedTouches[0].clientX - touchStartPos.x,
                        e.changedTouches[0].clientY - touchStartPos.y
                    );
                    
                    if (tapDuration < 300 && tapDistance < 20) {
                        if (this.mode === 'orbital' && window.solarSystemApp) {
                            window.solarSystemApp.showDescriptionOnInteraction();
                        }
                    }
                }
                
                activeGesture = null;
                lastSingleTouch = null;
                lastPinchData = null;
                initialTouches = {};
                
            } else if (touches.length === 1 && activeGesture === 'pinch') {
                activeGesture = 'rotate';
                lastSingleTouch = {
                    x: touches[0].clientX,
                    y: touches[0].clientY,
                    time: Date.now()
                };
                lastPinchData = null;
            }
        }, { passive: false });
        
        canvas.addEventListener('touchcancel', (e) => {
            if (!activeGesture) return;
            e.preventDefault();
            activeGesture = null;
            lastSingleTouch = null;
            lastPinchData = null;
            initialTouches = {};
        }, { passive: false });
    }
    
    setFreeMode() {
        this.mode = 'free';
        this.target = null;
    }
    
    focusBody(bodyId) {
        if (!this.solarSystem) {
            //console.warn('Solar system not set on camera');
            return;
        }
        
        const body = this.solarSystem.getBody(bodyId);
        if (body) {
            this.mode = 'orbital';
            this.target = body;
            
            this.orbitDistance = body.radius * 3.0;
            
            this.orbitAngleH = 0;
            this.orbitAngleV = 0;
            this.velocity = [0, 0, 0];
        }
    }
    
    rotate(pitch, yaw, roll) {
        const right = this.getRightVector();
        
        if (pitch !== 0) {
            this.forward = this.rotateVectorAroundAxis(this.forward, right, pitch);
            this.up = this.rotateVectorAroundAxis(this.up, right, pitch);
        }
        
        if (yaw !== 0) {
            this.forward = this.rotateVectorAroundAxis(this.forward, this.up, yaw);
        }
        
        if (roll !== 0) {
            this.up = this.rotateVectorAroundAxis(this.up, this.forward, roll);
        }
        
        this.forward = nrm(this.forward);
        this.up = nrm(this.up);
        
        const right2 = nrm(cr(this.forward, this.up));
        this.up = nrm(cr(right2, this.forward));
    }
    
    rotateVectorAroundAxis(vector, axis, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dot = dt(vector, axis);
        const cross = cr(axis, vector);
        
        return [
            vector[0] * cos + cross[0] * sin + axis[0] * dot * (1 - cos),
            vector[1] * cos + cross[1] * sin + axis[1] * dot * (1 - cos),
            vector[2] * cos + cross[2] * sin + axis[2] * dot * (1 - cos)
        ];
    }
    
    update(deltaTime) {
        if (this.mode === 'free') {
            this.updateFreeCamera(deltaTime);
        } else if (this.mode === 'orbital') {
            this.updateOrbitalCamera(deltaTime);
        }
    }
    
    updateFreeCamera(deltaTime) {
        let moveSpeed = this.speed * this.speedMultiplier;
        if (this.keys['shiftleft'] || this.keys['shiftright']) moveSpeed = this.fastSpeed * this.speedMultiplier;
        if (this.keys['controlleft'] || this.keys['controlright']) moveSpeed = this.slowSpeed * this.speedMultiplier;
        
        const right = this.getRightVector();
        let inputVel = [0, 0, 0];
        
        if (this.keys['keyw']) {
            inputVel[0] += this.forward[0] * moveSpeed;
            inputVel[1] += this.forward[1] * moveSpeed;
            inputVel[2] += this.forward[2] * moveSpeed;
        }
        if (this.keys['keys']) {
            inputVel[0] -= this.forward[0] * moveSpeed;
            inputVel[1] -= this.forward[1] * moveSpeed;
            inputVel[2] -= this.forward[2] * moveSpeed;
        }
        if (this.keys['keya']) {
            inputVel[0] -= right[0] * moveSpeed;
            inputVel[1] -= right[1] * moveSpeed;
            inputVel[2] -= right[2] * moveSpeed;
        }
        if (this.keys['keyd']) {
            inputVel[0] += right[0] * moveSpeed;
            inputVel[1] += right[1] * moveSpeed;
            inputVel[2] += right[2] * moveSpeed;
        }
        if (this.keys['space']) {
            inputVel[0] += this.up[0] * moveSpeed;
            inputVel[1] += this.up[1] * moveSpeed;
            inputVel[2] += this.up[2] * moveSpeed;
        }
        if (this.keys['keyc']) {
            inputVel[0] -= this.up[0] * moveSpeed;
            inputVel[1] -= this.up[1] * moveSpeed;
            inputVel[2] -= this.up[2] * moveSpeed;
        }
        
        if (this.keys['keyq']) {
            this.rotate(0, 0, -this.rollSpeed);
        }
        if (this.keys['keye']) {
            this.rotate(0, 0, this.rollSpeed);
        }
        
        this.velocity[0] = this.velocity[0] * this.friction + inputVel[0];
        this.velocity[1] = this.velocity[1] * this.friction + inputVel[1];
        this.velocity[2] = this.velocity[2] * this.friction + inputVel[2];
        
        this.worldPosition[0] += this.velocity[0];
        this.worldPosition[1] += this.velocity[1];
        this.worldPosition[2] += this.velocity[2];
    }
    
    updateOrbitalCamera(deltaTime) {
        if (!this.target) {
            this.setFreeMode();
            return;
        }

        // Use the planet's center as the local origin to minimize floating point error
        const targetPos = this.target.orbitCenter || this.target.position;

        // Extract axes from worldMatrix (rotation only, no translation)
        const planetMatrix = this.target.worldMatrix;
        const planetRight = nrm([planetMatrix[0], planetMatrix[1], planetMatrix[2]]);
        const planetUp = nrm([planetMatrix[4], planetMatrix[5], planetMatrix[6]]);
        const planetForward = nrm([planetMatrix[8], planetMatrix[9], planetMatrix[10]]);

        const maxVerticalAngle = Math.PI / 2 - 0.05;
        this.orbitAngleV = Math.max(-maxVerticalAngle, Math.min(maxVerticalAngle, this.orbitAngleV));

        const cosV = Math.cos(this.orbitAngleV);
        const sinV = Math.sin(this.orbitAngleV);
        const cosH = Math.cos(this.orbitAngleH);
        const sinH = Math.sin(this.orbitAngleH);

        // Calculate offset in planet-local frame
        const offsetLocal = [
            this.orbitDistance * cosV * cosH,
            this.orbitDistance * sinV,
            this.orbitDistance * cosV * sinH
        ];

        // Transform to world frame using only rotation part of planet matrix
        const offsetWorld = [
            planetRight[0]*offsetLocal[0] + planetUp[0]*offsetLocal[1] + planetForward[0]*offsetLocal[2],
            planetRight[1]*offsetLocal[0] + planetUp[1]*offsetLocal[1] + planetForward[1]*offsetLocal[2],
            planetRight[2]*offsetLocal[0] + planetUp[2]*offsetLocal[1] + planetForward[2]*offsetLocal[2]
        ];

        // Set camera position relative to planet center
        this.worldPosition = [
            targetPos[0] + offsetWorld[0],
            targetPos[1] + offsetWorld[1],
            targetPos[2] + offsetWorld[2]
        ];

        // Look at planet center
        this.forward = nrm(sub(targetPos, this.worldPosition));

        // Use planet's current up vector as camera up
        this.up = nrm(planetUp);

        // Ensure right vector is perpendicular
        const right = nrm(cr(this.forward, this.up));
        this.up = nrm(cr(right, this.forward));

        // Proper zoom limits
        const surfaceBuffer = this.target.radius * 0.2;
        const minDist = this.target.radius + surfaceBuffer;
        const maxDist = this.target.radius * 50;

        this.orbitMinDistance = minDist;
        this.orbitMaxDistance = maxDist;

        if (this.orbitDistance < minDist) this.orbitDistance = minDist;
        if (this.orbitDistance > maxDist) this.orbitDistance = maxDist;
    }
    
    crossProduct(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }
    
    getRightVector() {
        return nrm(cr(this.forward, this.up));
    }
    
    // CAMERA-CENTERED RENDERING: Return identity view matrix (camera always at origin)
    getViewMatrix() {
        // Create view matrix with camera at origin looking in forward direction
        const target = [
            this.forward[0],
            this.forward[1], 
            this.forward[2]
        ];
        return lookAt([0, 0, 0], target, this.up);
    }
    
    reset() {
        // Reset to the nice Earth view instead of arbitrary position
        this.initialSetupComplete = false;
        this.initializeNearEarth();
    }
    
    getCurrentTarget() {
        return this.target;
    }
    
    getDistanceToTarget() {
        if (!this.target) return null;
        const pos = this.target.orbitCenter || this.target.position;
        return Math.hypot(
            this.worldPosition[0] - this.target.position[0],
            this.worldPosition[1] - this.target.position[1],
            this.worldPosition[2] - this.target.position[2]
        );
    }
}
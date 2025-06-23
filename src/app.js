import { EnhancedCamera } from './camera.js';
import { SolarSystem } from './solarSystem.js';
import { ScreenSpaceGPULODRenderer, LineRenderer } from './renderer.js';
import { FrustumCuller, mat4MultiplyViewProj } from './frustumCulling.js';
import { SkyboxRenderer } from './skybox.js';
import { AudioManager } from './audio-manager.js';
import { ASTRONOMICAL_DATA, formatNumber, formatDistance, formatTemperature, formatTimePeriod } from './astronomical-data.js';

export class RetroSolarSystemApp {
    constructor(gl) {
        this.gl = gl;
        this.camera = new EnhancedCamera();
        this.solarSystem = new SolarSystem();
        
        this.camera.setSolarSystem(this.solarSystem);
        
        this.renderer = new ScreenSpaceGPULODRenderer(gl);
        this.lineRenderer = new LineRenderer(gl);
        this.skyboxRenderer = new SkyboxRenderer(gl);
        this.frustumCuller = new FrustumCuller();
        
        // CAMERA-CENTERED: Set camera reference on renderers
        this.renderer.setCamera(this.camera);
        this.lineRenderer.setCamera(this.camera);
        
        // Initialize audio manager
        this.audioManager = new AudioManager();
        this.audioInitialized = false;

        this.showLod = false;
        this.animateWaves = true;
        this.animateOrbits = true;
        this.showAxisOrbit = true;
        this.showSkybox = true;
        this.maxLod = 8;
        this.lastTime = 0;
        this.waveTime = 0;

        // Default to 1 day per second (86400 seconds per second)
        this.timeMultiplier = 1;

        this.performanceStats = {
            frameTime: 0,
            fps: 0,
            frameCount: 0,
            lastFpsUpdate: 0,
            totalPatches: 0,
            totalVertices: 0,
            culledPlanets: 0,
            visiblePlanets: 0
        };

        // Description system properties
        this.lastShownTarget = null;

        this.setupUI();
        this.updateTimeDisplay();
        this.updateSpeedDisplay();
        
        document.getElementById('pixelSizeSlider').value = 6;
        document.getElementById('pixelSizeValue').textContent = '1px';
        
        document.getElementById('orbitSpeedSlider').value = 66.2;
        
        this.updateSolarSystemSpeed();
    }

    async initializeAudio() {
        if (!this.audioInitialized) {
            try {
                // Generate a seed based on current time for variety
                const seed = Math.floor(Date.now() / 1000) % 10000;
                await this.audioManager.initialize(seed);
                this.audioInitialized = true;
                
                // Update UI to reflect audio state
                this.updateAudioUI();
            } catch (error) {
                console.warn('Audio initialization failed:', error);
            }
        }
    }

    updateAudioUI() {
        const playButton = document.getElementById('audioPlayButton');
        const volumeSlider = document.getElementById('audioVolumeSlider');
        const tempoSlider = document.getElementById('audioTempoSlider');
        const seedButton = document.getElementById('audioSeedButton');
        
        if (this.audioManager.isPlaying()) {
            playButton.textContent = '⏸️ Pause Music';
            playButton.classList.add('active');
        } else {
            playButton.textContent = '▶️ Play Music';
            playButton.classList.remove('active');
        }
        
        volumeSlider.value = this.audioManager.getVolume() * 100;
        document.getElementById('audioVolumeValue').textContent = Math.round(this.audioManager.getVolume() * 100) + '%';
    }

    setupUI() {
        // Initialize panels as docked by default
        const controlPanel = document.getElementById('controlPanel');
        const infoPanel = document.getElementById('infoPanel');
        
        // Start side panels as collapsed (docked), but music panel open
        controlPanel.classList.add('collapsed');
        infoPanel.classList.add('collapsed');
        // musicPanel starts open - no collapsed class added
        
        // Set initial tab icons
        document.querySelector('.main-pull-tab .tab-icon').textContent = '▶';
        document.querySelector('.info-pull-tab .tab-icon').textContent = '◀';
        document.querySelector('.music-pull-tab .tab-icon').textContent = '▲'; // Up arrow since it starts open

        // Main panel toggle
        document.getElementById('panelToggle').addEventListener('click', () => {
            const panel = document.getElementById('controlPanel');
            const toggle = document.getElementById('panelToggle');
            const icon = toggle.querySelector('.tab-icon');
            panel.classList.toggle('collapsed');
            icon.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
        });

        // Info panel toggle
        document.getElementById('infoPanelToggle').addEventListener('click', () => {
            const panel = document.getElementById('infoPanel');
            const toggle = document.getElementById('infoPanelToggle');
            const icon = toggle.querySelector('.tab-icon');
            panel.classList.toggle('collapsed');
            icon.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
        });

        // Music panel toggle
        document.getElementById('musicPanelToggle').addEventListener('click', () => {
            const panel = document.getElementById('musicPanel');
            const toggle = document.getElementById('musicPanelToggle');
            const icon = toggle.querySelector('.tab-icon');
            panel.classList.toggle('collapsed');
            icon.textContent = panel.classList.contains('collapsed') ? '▼' : '▲';
        });

        // Audio Controls
        document.getElementById('audioPlayButton').addEventListener('click', async () => {
            await this.initializeAudio();
            if (this.audioManager.isPlaying()) {
                this.audioManager.stopMusic();
            } else {
                await this.audioManager.startMusic();
            }
            this.updateAudioUI();
        });

        document.getElementById('audioVolumeSlider').addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value) / 100;
            this.audioManager.setVolume(volume);
            document.getElementById('audioVolumeValue').textContent = Math.round(volume * 100) + '%';
        });

        document.getElementById('audioSeedButton').addEventListener('click', async () => {
            const newSeed = Math.floor(Math.random() * 10000);
            this.audioManager.setSeed(newSeed);
        });

        // Enhanced Status HUD Camera Controls
        const speedSlider = document.getElementById('speedSlider');
        const speedValue = document.getElementById('speedValue');
        speedSlider.addEventListener('input', () => {
            this.camera.speedMultiplier = parseFloat(speedSlider.value);
            speedValue.textContent = speedSlider.value + 'x';
        });

        // Free Flight Button in Status HUD
        document.getElementById('freeFlightBtn').addEventListener('click', () => {
            this.camera.setFreeMode();
            this.updateCameraUI();
        });

        const sensitivitySlider = document.getElementById('sensitivitySlider');
        const sensitivityValue = document.getElementById('sensitivityValue');
        sensitivitySlider.addEventListener('input', () => {
            this.camera.sensitivityMultiplier = parseFloat(sensitivitySlider.value);
            sensitivityValue.textContent = sensitivitySlider.value + 'x';
        });

        // Time speed slider with proper handling
        const timeSlider = document.getElementById('orbitSpeedSlider');
        timeSlider.addEventListener('input', () => {
            const sliderValue = parseFloat(timeSlider.value);
            
            if (sliderValue === 0) {
                this.timeMultiplier = 0;
            } else {
                // Exponential scale from 0.1x to 1000000x
                this.timeMultiplier = Math.pow(10, (sliderValue - 1) * 7.5 / 99);
            }
            
            this.updateSpeedDisplay();
            this.updateSolarSystemSpeed();
        });

        // Time control buttons with proper functionality
        document.getElementById('resetTimeBtn').addEventListener('click', () => {
            this.resetToCurrentDate();
        });

        document.getElementById('setDateBtn').addEventListener('click', () => {
            this.showDateModal();
        });

        // Modal event handlers
        document.getElementById('closeModal').addEventListener('click', () => {
            this.hideDateModal();
        });

        document.getElementById('cancelDate').addEventListener('click', () => {
            this.hideDateModal();
        });

        document.getElementById('applyDate').addEventListener('click', () => {
            this.applySelectedDate();
        });

        document.getElementById('dateModal').addEventListener('click', (e) => {
            if (e.target.id === 'dateModal') {
                this.hideDateModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDateModal();
            }
        });

        const lodSlider = document.getElementById('lodSlider');
        const lodValue = document.getElementById('lodValue');
        lodSlider.addEventListener('input', () => {
            this.maxLod = parseInt(lodSlider.value);
            lodValue.textContent = lodSlider.value;
        });

        const pixelSizeSlider = document.getElementById('pixelSizeSlider');
        const pixelSizeValue = document.getElementById('pixelSizeValue');
        pixelSizeSlider.setAttribute('max', '8');
        pixelSizeSlider.addEventListener('input', () => {
            this.renderer.currentTargetIndex = parseInt(pixelSizeSlider.value);
            pixelSizeValue.textContent = this.renderer.getCurrentTargetPixelSize() + 'px';
        });

        document.getElementById('lodToggle').addEventListener('click', (e) => {
            this.showLod = !this.showLod;
            e.target.textContent = `LOD Colors: ${this.showLod ? 'ON' : 'OFF'}`;
            e.target.classList.toggle('active', this.showLod);
        });

        document.getElementById('waveToggle').addEventListener('click', (e) => {
            this.animateWaves = !this.animateWaves;
            e.target.textContent = `Wave Animation: ${this.animateWaves ? 'ON' : 'OFF'}`;
            e.target.classList.toggle('active', this.animateWaves);
        });

        document.getElementById('axisOrbitToggle').addEventListener('click', (e) => {
            this.showAxisOrbit = !this.showAxisOrbit;
            e.target.textContent = `Axis/Orbits: ${this.showAxisOrbit ? 'ON' : 'OFF'}`;
            e.target.classList.toggle('active', this.showAxisOrbit);
        });

        // Skybox toggle
        document.getElementById('skyboxToggle').addEventListener('click', (e) => {
            this.showSkybox = !this.showSkybox;
            e.target.textContent = `Skybox: ${this.showSkybox ? 'ON' : 'OFF'}`;
            e.target.classList.toggle('active', this.showSkybox);
        });

        document.getElementById('resetCamera').addEventListener('click', () => {
            this.camera.reset();
            this.updateCameraUI();
        });

        document.getElementById('freeCameraBtn').addEventListener('click', () => {
            this.camera.setFreeMode();
            this.updateCameraUI();
        });

        // Updated celestial body selection
        document.querySelectorAll('.celestial-item').forEach(item => {
            item.addEventListener('click', () => {
                const planetId = item.dataset.planet;
                this.camera.focusBody(planetId);
                this.updateCameraUI();

                document.querySelectorAll('.celestial-item').forEach(b => b.classList.remove('active'));
                item.classList.add('active');
                setTimeout(() => item.classList.remove('active'), 200);
            });
        });

        this.updateCameraUI();
    }

    updateSolarSystemSpeed() {
        this.solarSystem.setTimeMultiplier(this.timeMultiplier);
    }

    updateSpeedDisplay() {
        const speedIndicator = document.getElementById('speedIndicator');
        const speedDescription = document.getElementById('speedDescription');
        const timeSpeedValue = document.getElementById('timeSpeedValue');

        // Clear previous classes
        speedIndicator.className = 'speed-value';
        
        if (this.timeMultiplier === 0) {
            speedIndicator.textContent = 'PAUSED';
            speedIndicator.classList.add('paused');
            speedDescription.textContent = 'Time is frozen';
            timeSpeedValue.textContent = 'PAUSED';
        } else if (this.timeMultiplier < 60) {
            speedIndicator.textContent = `${this.timeMultiplier.toFixed(1)}X SPEED`;
            speedIndicator.classList.add('realtime');
            speedDescription.textContent = `${this.timeMultiplier.toFixed(1)} seconds per second`;
            timeSpeedValue.textContent = `${this.timeMultiplier.toFixed(1)}x`;
        } else if (this.timeMultiplier < 3600) {
            const minutes = this.timeMultiplier / 60;
            speedIndicator.textContent = `${minutes.toFixed(1)} MIN/SEC`;
            speedIndicator.classList.add('realtime');
            speedDescription.textContent = `${minutes.toFixed(1)} minutes per second`;
            timeSpeedValue.textContent = `${minutes.toFixed(1)} min/sec`;
        } else if (this.timeMultiplier < 86400) {
            const hours = this.timeMultiplier / 3600;
            speedIndicator.textContent = `${hours.toFixed(1)} HRS/SEC`;
            speedIndicator.classList.add('fast');
            speedDescription.textContent = `${hours.toFixed(1)} hours per second`;
            timeSpeedValue.textContent = `${hours.toFixed(1)} hrs/sec`;
        } else if (this.timeMultiplier < 31557600) {
            const days = this.timeMultiplier / 86400;
            speedIndicator.textContent = `${days.toFixed(1)} DAYS/SEC`;
            speedIndicator.classList.add('fast');
            speedDescription.textContent = `${days.toFixed(1)} days per second`;
            timeSpeedValue.textContent = `${days.toFixed(1)} days/sec`;
        } else {
            const years = this.timeMultiplier / 31557600;
            speedIndicator.textContent = `${years.toFixed(1)} YEARS/SEC`;
            speedIndicator.classList.add('fast');
            speedDescription.textContent = `${years.toFixed(1)} years per second`;
            timeSpeedValue.textContent = `${years.toFixed(1)} yrs/sec`;
        }
    }

    // Reset to current date functionality
    resetToCurrentDate() {
        this.solarSystem.resetToCurrentDate();
        this.updateTimeDisplay();
        
        // Reset time multiplier to paused
        this.timeMultiplier = 1;
        document.getElementById('orbitSpeedSlider').value = 1;
        this.updateSpeedDisplay();
        this.updateSolarSystemSpeed();
    }

    // Show date modal with current simulation date
    showDateModal() {
        const modal = document.getElementById('dateModal');
        const dateInput = document.getElementById('dateInput');
        
        // Get current simulation date from solar system
        const currentDate = this.solarSystem.getCurrentSimulationDate();
        
        // Format for datetime-local input (YYYY-MM-DDTHH:MM)
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const hours = String(currentDate.getHours()).padStart(2, '0');
        const minutes = String(currentDate.getMinutes()).padStart(2, '0');
        
        const isoString = `${year}-${month}-${day}T${hours}:${minutes}`;
        dateInput.value = isoString;
        
        modal.style.display = 'block';
        
        // Focus the input for better UX
        setTimeout(() => dateInput.focus(), 100);
    }

    hideDateModal() {
        const modal = document.getElementById('dateModal');
        modal.style.display = 'none';
    }

    // Apply selected date with proper method call
    applySelectedDate() {
        const dateInput = document.getElementById('dateInput');
        const selectedDate = new Date(dateInput.value);
        
        // Validate the date
        if (isNaN(selectedDate.getTime())) {
            alert('Please select a valid date and time.');
            return;
        }
        
        // Check if date is reasonable (not too far in past/future)
        const now = new Date();
        const minDate = new Date('1900-01-01');
        const maxDate = new Date(now.getFullYear() + 100, 11, 31);
        
        if (selectedDate < minDate || selectedDate > maxDate) {
            alert(`Please select a date between ${minDate.getFullYear()} and ${maxDate.getFullYear()}.`);
            return;
        }
        
        // Use setSimulationDate instead of resetToDate
        this.solarSystem.setSimulationDate(selectedDate);
        this.updateTimeDisplay();
        this.hideDateModal();
    }

    // Update time display using solar system's current date
    updateTimeDisplay() {
        const currentDate = this.solarSystem.getCurrentSimulationDate();
        
        const dateOptions = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            timeZone: 'UTC'
        };
        document.getElementById('currentDate').textContent = currentDate.toLocaleDateString('en-US', dateOptions);
        
        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZone: 'UTC'
        };
        document.getElementById('currentTime').textContent = currentDate.toLocaleTimeString('en-US', timeOptions);
    }

    // Show description panel
    showBodyDescription(astroData) {
        let descPanel = document.getElementById('bodyDescriptionPanel');
        if (!descPanel) {
            descPanel = document.createElement('div');
            descPanel.id = 'bodyDescriptionPanel';
            descPanel.className = 'body-description-panel scientific-panel';
            document.body.appendChild(descPanel);
        }
        
        const description = astroData.description;
        
        descPanel.innerHTML = `
            <div class="description-content-wrapper">
                <div class="description-header">
                    <h2 class="description-title">${description.title}</h2>
                    <h3 class="description-subtitle">${description.subtitle}</h3>
                    <button class="description-close" id="descriptionCloseBtn">&times;</button>
                </div>
                <div class="description-content">
                    <div class="description-facts">
                        ${description.facts.map(fact => `<div class="description-fact">${fact}</div>`).join('')}
                    </div>
                    <div class="description-fun-fact">
                        <div class="fun-fact-label">🎉 Fun Fact:</div>
                        <div class="fun-fact-text">${description.funFact}</div>
                    </div>
                    <div class="description-controls">
                        <button class="scientific-button description-close-btn" id="closeDescBtn">✕ Close</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add event listeners
        const closeBtn = descPanel.querySelector('#descriptionCloseBtn');
        const closeDescBtn = descPanel.querySelector('#closeDescBtn');
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideBodyDescription();
        });
        
        closeDescBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideBodyDescription();
        });
        
        // Prevent clicks inside the panel from closing it
        descPanel.querySelector('.description-content-wrapper').addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        descPanel.style.display = 'block';
    }

    // Hide description panel
    hideBodyDescription() {
        const descPanel = document.getElementById('bodyDescriptionPanel');
        if (descPanel) {
            descPanel.style.display = 'none';
        }
    }

    // Show description on click/tap
    showDescriptionOnInteraction() {
        const currentTarget = this.camera.getCurrentTarget();
        if (currentTarget && ASTRONOMICAL_DATA[currentTarget.id]) {
            const descPanel = document.getElementById('bodyDescriptionPanel');
            
            // If description is already visible, close it
            if (descPanel && descPanel.style.display === 'block') {
                this.hideBodyDescription();
            } else {
                // Otherwise, show it
                const astroData = ASTRONOMICAL_DATA[currentTarget.id];
                this.showBodyDescription(astroData);
            }
        }
    }

    // Update detailed info panel
    updateDetailedInfo(astroData) {
        let detailPanel = document.getElementById('detailedInfoPanel');
        if (!detailPanel) {
            detailPanel = document.createElement('div');
            detailPanel.id = 'detailedInfoPanel';
            detailPanel.className = 'detailed-info-panel';
            document.getElementById('infoPanel').querySelector('.panel-content').appendChild(detailPanel);
        }
        
        detailPanel.innerHTML = `
            <div class="control-section">
                <div class="section-title">📊 Physical Properties</div>
                <div class="control-row">
                    <span class="control-label">Real Radius:</span>
                    <span class="control-value">${formatDistance(astroData.realRadius)}</span>
                </div>
                <div class="control-row">
                    <span class="control-label">Mass:</span>
                    <span class="control-value">${formatNumber(astroData.realMass, 'kg')}</span>
                </div>
                <div class="control-row">
                    <span class="control-label">Density:</span>
                    <span class="control-value">${formatNumber(astroData.realDensity, 'kg/m³')}</span>
                </div>
                <div class="control-row">
                    <span class="control-label">Gravity:</span>
                    <span class="control-value">${astroData.realGravity.toFixed(2)} m/s²</span>
                </div>
                <div class="control-row">
                    <span class="control-label">Escape Velocity:</span>
                    <span class="control-value">${astroData.realEscapeVelocity.toFixed(2)} km/s</span>
                </div>
                ${astroData.realTemperature ? `
                <div class="control-row">
                    <span class="control-label">Temperature:</span>
                    <span class="control-value">${formatTemperature(astroData.realTemperature)}</span>
                </div>
                ` : ''}
                ${astroData.realDistanceFromSun ? `
                <div class="control-row">
                    <span class="control-label">Distance from Sun:</span>
                    <span class="control-value">${formatDistance(astroData.realDistanceFromSun)}</span>
                </div>
                ` : ''}
                ${astroData.realDistanceFromEarth ? `
                <div class="control-row">
                    <span class="control-label">Distance from Earth:</span>
                    <span class="control-value">${formatDistance(astroData.realDistanceFromEarth)}</span>
                </div>
                ` : ''}
                ${astroData.realAtmosphere ? `
                <div class="control-row">
                    <span class="control-label">Atmosphere:</span>
                    <span class="control-value atmosphere-text">${astroData.realAtmosphere}</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    hideDetailedInfo() {
        const detailPanel = document.getElementById('detailedInfoPanel');
        if (detailPanel) {
            detailPanel.remove();
        }
    }

    updateCameraUI() {
        const currentTarget = this.camera.getCurrentTarget();
        const distance = this.camera.getDistanceToTarget();

        document.getElementById('cameraMode').textContent =
            this.camera.mode === 'free' ? 'Free Flight' : 'Orbital';

        const hudTitle = document.getElementById('hudTitle');
        const freeFlightBtn = document.getElementById('freeFlightBtn');

        if (this.camera.mode === 'free') {
            hudTitle.textContent = 'FREE FLIGHT MODE';
            freeFlightBtn.style.display = 'none';
            this.hideBodyDescription();
        } else if (currentTarget) {
            hudTitle.textContent = `ORBITAL MODE: ${currentTarget.name.toUpperCase()}`;
            freeFlightBtn.style.display = 'flex';
        }

        if (currentTarget) {
            const astroData = ASTRONOMICAL_DATA[currentTarget.id];
            
            document.getElementById('currentTarget').textContent = currentTarget.name;
            
            if (astroData) {
                // Display real-world data
                document.getElementById('targetDistance').textContent = 
                    distance ? `${(distance * astroData.realRadius / currentTarget.radius).toFixed(0)} km` : '-';
                
                document.getElementById('targetRadius').textContent = 
                    formatDistance(astroData.realRadius);
                
                let bodyType = 'Unknown';
                if (currentTarget.id === 'sun') {
                    bodyType = 'Star';
                } else if (currentTarget.parent) {
                    if (currentTarget.parent.id === 'sun') {
                        bodyType = 'Planet';
                    } else {
                        bodyType = 'Moon';
                    }
                } else {
                    bodyType = 'Dwarf Planet';
                }
                document.getElementById('targetType').textContent = bodyType;
                
                document.getElementById('targetOrbitalPeriod').textContent = 
                    astroData.realOrbitalPeriod ? formatTimePeriod(astroData.realOrbitalPeriod) : 'N/A';
                
                document.getElementById('targetRotationPeriod').textContent = 
                    astroData.realRotationPeriod ? formatTimePeriod(Math.abs(astroData.realRotationPeriod)) : 'N/A';
                
                this.updateDetailedInfo(astroData);
                
                // Show description when switching targets
                if (this.lastShownTarget !== currentTarget.id) {
                    this.showBodyDescription(astroData);
                    this.lastShownTarget = currentTarget.id;
                }
            } else {
                // Fallback to simulation data
                document.getElementById('targetDistance').textContent = distance ? distance.toFixed(2) + ' units' : '-';
                document.getElementById('targetRadius').textContent = currentTarget.radius.toFixed(2) + ' units';
                
                const bodyType = currentTarget.parent ? 'Moon' : (currentTarget.id === 'sun' ? 'Star' : 'Planet');
                document.getElementById('targetType').textContent = bodyType;
                
                const orbitalPeriod = currentTarget.getOrbitalPeriodDays();
                document.getElementById('targetOrbitalPeriod').textContent = 
                    orbitalPeriod > 0 ? `${orbitalPeriod.toFixed(1)} sim days` : 'N/A';
                
                const rotationPeriod = currentTarget.getRotationPeriodDays();
                document.getElementById('targetRotationPeriod').textContent = 
                    rotationPeriod > 0 ? `${rotationPeriod.toFixed(1)} sim days` : 'N/A';
                    
                this.hideBodyDescription();
            }
        } else {
            document.getElementById('currentTarget').textContent = 'None';
            document.getElementById('targetDistance').textContent = '-';
            document.getElementById('targetRadius').textContent = '-';
            document.getElementById('targetType').textContent = '-';
            document.getElementById('targetOrbitalPeriod').textContent = '-';
            document.getElementById('targetRotationPeriod').textContent = '-';
            this.hideDetailedInfo();
            this.hideBodyDescription();
            this.lastShownTarget = null;
            freeFlightBtn.style.display = 'none';
        }
    }

    update(currentTime) {
        const frameStart = performance.now();
        const deltaTime = (currentTime - this.lastTime) * 0.001;
        this.lastTime = currentTime;
        this.waveTime = currentTime * 0.001;

        // Solar system now handles its own time updates
        this.solarSystem.update(deltaTime);
        this.camera.update(deltaTime);

        this.performanceStats.frameCount++;
        if (currentTime - this.performanceStats.lastFpsUpdate > 1000) {
            this.performanceStats.fps = this.performanceStats.frameCount;
            this.performanceStats.frameCount = 0;
            this.performanceStats.lastFpsUpdate = currentTime;

            document.getElementById('fpsCounter').textContent = this.performanceStats.fps;
            this.updateTimeDisplay();
        }

        const frameEnd = performance.now();
        this.performanceStats.frameTime = frameEnd - frameStart;
        document.getElementById('frameTime').textContent = this.performanceStats.frameTime.toFixed(1) + 'ms';

        if (Math.floor(currentTime / 100) % 5 === 0) {
            this.updateCameraUI();
        }
    }

    render() {
        const gl = this.gl;
        gl.clearColor(0.02, 0.02, 0.08, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const near = 0.01;
        const far = 20000.0;
        const viewMatrix = this.camera.getViewMatrix();
        const projMatrix = this.renderer.perspective(
            Math.PI / 3,
            gl.canvas.width / gl.canvas.height,
            near,
            far
        );
        const logDepthBufFC = 2.0 / (Math.log(far + 1.0) / Math.LN2);

        this.renderer.logDepthBufFC = logDepthBufFC;
        if (this.lineRenderer) this.lineRenderer.logDepthBufFC = logDepthBufFC;
        this.renderer.ringSystem.setLogDepthBufFC(logDepthBufFC);

        // Render skybox first
        if (this.showSkybox) {
            this.skyboxRenderer.render(viewMatrix, projMatrix);
        }

        const viewProjMatrix = mat4MultiplyViewProj(viewMatrix, projMatrix);
        const sunWorldPosition = this.solarSystem.getSunPosition();
        const sunCameraRelativePosition = this.camera.worldToCameraRelative(sunWorldPosition);

        let totalPatches = 0;
        let totalVertices = 0;
        let visiblePlanets = 0;
        let culledPlanets = 0;
        let totalFrustumCulled = 0;
        let totalBackfaceCulled = 0;

        // COLLECT RING DATA while rendering planets
        const ringDataArray = [];

        for (const body of this.solarSystem.getAllBodies()) {
            if (this.frustumCuller.isPlanetVisible(body, viewProjMatrix, this.camera)) {
                visiblePlanets++;
                
                const stats = this.renderer.renderBody(
                    body,
                    this.camera.worldPosition,
                    this.camera.forward,
                    viewMatrix,
                    projMatrix,
                    this.animateWaves ? this.waveTime : 0,
                    this.showLod,
                    this.animateWaves,
                    sunCameraRelativePosition,
                    this.maxLod
                );

                totalPatches += stats.patches;
                totalVertices += stats.vertices;
                
                if (stats.cullStats) {
                    totalFrustumCulled += stats.cullStats.frustumCulled;
                    totalBackfaceCulled += stats.cullStats.backfaceCulled;
                }

                // COLLECT RING DATA
                if (stats.ringData) {
                    ringDataArray.push(stats.ringData);
                }
            } else {
                culledPlanets++;
            }
        }

        // Render orbits and axes
        if (this.showAxisOrbit) {
            gl.disable(gl.CULL_FACE);
            gl.lineWidth(2);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            for (const body of this.solarSystem.getAllBodies()) {
                if (this.frustumCuller.isPlanetVisible(body, viewProjMatrix, this.camera)) {
                    this.lineRenderer.renderAxis(body, viewMatrix, projMatrix);
                    this.lineRenderer.renderOrbit(body, viewMatrix, projMatrix, this.solarSystem.time);
                } else {
                    this.lineRenderer.renderOrbit(body, viewMatrix, projMatrix, this.solarSystem.time);
                }
            }

            gl.enable(gl.CULL_FACE);
            gl.depthFunc(gl.LESS);
        }

        // RENDER ALL RINGS AFTER ALL CELESTIAL BODIES
        if (ringDataArray.length > 0) {
            this.renderer.ringSystem.renderAllRings(ringDataArray);
        }

        // Update performance stats
        this.performanceStats.totalPatches = totalPatches;
        this.performanceStats.totalVertices = totalVertices;
        this.performanceStats.visiblePlanets = visiblePlanets;
        this.performanceStats.culledPlanets = culledPlanets;
        this.performanceStats.frustumCulledPatches = totalFrustumCulled;
        this.performanceStats.backfaceCulledPatches = totalBackfaceCulled;

        document.getElementById('patchCount').textContent = totalPatches.toLocaleString();
        document.getElementById('vertexCount').textContent = totalVertices.toLocaleString();
        document.getElementById('visibleCount').textContent = visiblePlanets;
        document.getElementById('culledCount').textContent = culledPlanets;
        document.getElementById('frustumCulledCount').textContent = totalFrustumCulled.toLocaleString();
        document.getElementById('backfaceCulledCount').textContent = totalBackfaceCulled.toLocaleString();
    }

    run() {
        const loop = (currentTime) => {
            if (!this.lastTime) this.lastTime = currentTime;
            this.update(currentTime);
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
}
export class ProceduralMusicGenerator {
    constructor(config) {
        this.config = { ...config };
        this.isPlaying = false;
        this.oscillators = [];
        this.envelopes = [];
        this.sequencePosition = 0;
        this.nextNoteTime = 0;
        this.lookahead = 25.0;
        this.scheduleAheadTime = 0.2; // Increased for smoother scheduling
        this.timerID = 0;
        this.currentKey = 0;
        this.currentScale = [];
        this.harmonicProgression = [];
        this.sectionLength = 32;
        this.currentSection = 0;
        this.modulationTarget = 0;
        this.isModulating = false;
        
        // Core instruments for consistent mixing
        this.coreInstruments = ['lead', 'pad', 'bass', 'arp'];
        this.colorInstruments = ['strings', 'bell', 'choir', 'organ', 'flute', 'oboe', 'horn', 'harp', 'celesta', 'vibraphone'];
        this.currentInstruments = new Map();
        
        // Neverending evolution system
        this.globalEvolution = 0;
        this.evolutionSpeed = 0.001;
        this.cosmicPhase = 0;
        this.stellarDrift = 0;
        this.nebulaIntensity = 0.5;
        this.tensionLevel = 0;
        this.currentMood = 'ethereal';
        this.phrasePosition = 0;
        this.lastChordTension = 0;
        this.suspensionActive = false;
        this.baroqueComplexity = 0.3;
        
        // Arpeggio prominence system
        this.arpeggioIntensity = 0.7;
        this.arpeggioLayers = 2;
        this.arpeggioSpeed = 1.2;
        this.arpeggioEvolution = 0;
        this.arpeggioPattern = 0;
        
        // Audio optimization
        this.masterLimiter = null;
        this.compressorStages = [];
        this.headroom = 0.12;
        
        // Continuous scheduling system
        this.lastScheduledTime = 0;
        this.schedulingBuffer = [];
        this.minScheduleAhead = 0.5;
        
        // Mix levels for consistency
        this.mixLevels = {
            core: 0.8,      // Always present
            arpeggio: 0.9,  // Very prominent
            color: 0.4,     // Supporting elements
            texture: 0.2    // Atmospheric
        };
        
        this.scales = {
            major: [0, 2, 4, 5, 7, 9, 11],
            minor: [0, 2, 3, 5, 7, 8, 10],
            lydian: [0, 2, 4, 6, 7, 9, 11],
            mixolydian: [0, 2, 4, 5, 7, 9, 10],
            dorian: [0, 2, 3, 5, 7, 9, 10],
            phrygian: [0, 1, 3, 5, 7, 8, 10],
            pentatonic: [0, 2, 4, 7, 9],
            wholeTone: [0, 2, 4, 6, 8, 10],
            blues: [0, 3, 5, 6, 7, 10],
            harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
            melodic_minor: [0, 2, 3, 5, 7, 9, 11],
            byzantine: [0, 1, 4, 5, 7, 8, 11],
            hungarian: [0, 2, 3, 6, 7, 8, 11]
        };

        this.chordProgressions = {
            ethereal: [
                [0, 5, 6, 4], [0, 3, 6, 5], [0, 6, 4, 5], [0, 2, 5, 3]
            ],
            melancholic: [
                [6, 4, 0, 5], [6, 2, 3, 0], [0, 6, 3, 4], [2, 6, 4, 0]
            ],
            mysterious: [
                [0, 1, 4, 5], [0, 6, 2, 4], [0, 3, 2, 5], [6, 4, 0, 5]
            ],
            cosmic: [
                [0, 5, 2, 6], [0, 4, 1, 6], [2, 6, 0, 4], [0, 2, 4, 6]
            ],
            dramatic: [
                [0, 3, 6, 2], [6, 0, 4, 1], [0, 1, 5, 6], [4, 0, 6, 3]
            ]
        };

        this.suspensionTypes = [
            { type: '4-3', interval: 4, resolution: 3 },
            { type: '7-6', interval: 7, resolution: 6 },
            { type: '9-8', interval: 9, resolution: 8 },
            { type: '2-1', interval: 2, resolution: 1 },
            { type: '6-5', interval: 6, resolution: 5 }
        ];

        this.thirdModulations = [
            { interval: 4, mode: 'major' }, { interval: -4, mode: 'major' },
            { interval: 3, mode: 'minor' }, { interval: -3, mode: 'minor' },
            { interval: 8, mode: 'major' }, { interval: -8, mode: 'minor' }
        ];

        this.modulations = [0, 5, 7, -5, 2, -2, 3, -3, 4, -4, 1, -1];

        this.setupSeededRandom(config.seed);
        this.initializeMusicalSystem();
        this.initializeAudioContext();
    }

    setupSeededRandom(seed) {
        let s = seed;
        this.rng = () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }

    initializeMusicalSystem() {
        this.currentKey = 0;
        this.currentScale = [...this.scales[this.config.scale]];
        this.currentMood = this.selectInitialMood();
        this.harmonicProgression = [...this.chordProgressions[this.currentMood][Math.floor(this.rng() * this.chordProgressions[this.currentMood].length)]];
        this.sectionLength = 32; // Fixed length for consistency
        this.currentSection = 0;
        this.modulationTarget = 0;
        this.isModulating = false;
        this.globalEvolution = 0;
        this.tensionLevel = 0;
        this.phrasePosition = 0;
        this.baroqueComplexity = 0.3;
        this.arpeggioEvolution = 0;
        this.arpeggioPattern = 0;
        this.initializeInstruments();
    }

    selectInitialMood() {
        const moods = ['ethereal', 'melancholic', 'mysterious', 'cosmic', 'dramatic'];
        return moods[Math.floor(this.rng() * moods.length)];
    }

    initializeInstruments() {
        this.currentInstruments.clear();
        
        // Core instruments - always present with consistent levels
        this.currentInstruments.set('lead', {
            type: 'sawtooth',
            octave: 5,
            detune: 2,
            attack: 0.05,
            decay: 0.15,
            sustain: 0.6,
            release: 0.4,
            filterFreq: 2000,
            resonance: 3,
            lfoRate: 0.4,
            lfoAmount: 0.2,
            gain: 0.25 * this.mixLevels.core,
            category: 'core'
        });

        this.currentInstruments.set('pad', {
            type: 'sine',
            octave: 3,
            detune: 1,
            attack: 1.5,
            decay: 1.0,
            sustain: 0.8,
            release: 2.5,
            filterFreq: 800,
            resonance: 1,
            voices: 3,
            gain: 0.2 * this.mixLevels.core,
            category: 'core'
        });

        this.currentInstruments.set('bass', {
            type: 'sawtooth',
            octave: 2,
            detune: 0.5,
            attack: 0.01,
            decay: 0.08,
            sustain: 0.5,
            release: 0.1,
            filterFreq: 150,
            resonance: 4,
            gain: 0.3 * this.mixLevels.core,
            category: 'core'
        });

        // PROMINENT ARPEGGIATOR - Much more noticeable
        this.currentInstruments.set('arp', {
            type: 'square',
            octave: 6,
            detune: 1.5,
            attack: 0.002,
            decay: 0.04,
            sustain: 0.1,
            release: 0.08,
            pattern: 0,
            speed: 0.0625, // 16th notes
            filterFreq: 1500,
            resonance: 6,
            swing: 0.1,
            gain: 0.35 * this.mixLevels.arpeggio, // Much louder!
            category: 'arpeggio',
            layers: 2
        });

        // Secondary arpeggiator for complexity
        this.currentInstruments.set('arp2', {
            type: 'triangle',
            octave: 7,
            detune: 2,
            attack: 0.001,
            decay: 0.03,
            sustain: 0.05,
            release: 0.06,
            pattern: 3,
            speed: 0.03125, // 32nd notes
            filterFreq: 2500,
            resonance: 4,
            gain: 0.25 * this.mixLevels.arpeggio,
            category: 'arpeggio'
        });

        // Color instruments - supporting elements
        this.currentInstruments.set('strings', {
            type: 'sawtooth',
            octave: 4,
            detune: 2,
            attack: 0.5,
            decay: 0.3,
            sustain: 0.7,
            release: 1.2,
            filterFreq: 1200,
            resonance: 1.5,
            ensemble: true,
            gain: 0.15 * this.mixLevels.color,
            category: 'color'
        });

        this.currentInstruments.set('bell', {
            type: 'sine',
            octave: 6,
            detune: 3,
            attack: 0.001,
            decay: 0.15,
            sustain: 0.2,
            release: 1.5,
            filterFreq: 2500,
            resonance: 1,
            gain: 0.08 * this.mixLevels.color,
            category: 'color'
        });

        this.currentInstruments.set('choir', {
            type: 'sine',
            octave: 4,
            detune: 1,
            attack: 1.0,
            decay: 0.6,
            sustain: 0.8,
            release: 2.0,
            filterFreq: 1000,
            resonance: 0.5,
            voices: 4,
            gain: 0.12 * this.mixLevels.color,
            category: 'color'
        });

        // Texture instruments
        this.currentInstruments.set('cosmic', {
            type: 'sine',
            octave: 8,
            detune: 8,
            attack: 1.0,
            decay: 2.0,
            sustain: 0.3,
            release: 3.0,
            filterFreq: 3000,
            resonance: 1,
            gain: 0.06 * this.mixLevels.texture,
            category: 'texture'
        });

        this.currentInstruments.set('shimmer', {
            type: 'triangle',
            octave: 8,
            detune: 12,
            attack: 0.2,
            decay: 0.4,
            sustain: 0.15,
            release: 1.0,
            filterFreq: 4000,
            resonance: 2,
            gain: 0.04 * this.mixLevels.texture,
            category: 'texture'
        });
    }

    initializeAudioContext() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.config.volume * (1.0 - this.headroom);
        this.setupEffectsChain();
        this.masterGain.connect(this.audioContext.destination);
    }

    setupEffectsChain() {
        // Multi-stage compression for HDR
        this.compressor1 = this.audioContext.createDynamicsCompressor();
        this.compressor1.threshold.value = -24;
        this.compressor1.knee.value = 30;
        this.compressor1.ratio.value = 3;
        this.compressor1.attack.value = 0.001;
        this.compressor1.release.value = 0.1;

        this.compressor2 = this.audioContext.createDynamicsCompressor();
        this.compressor2.threshold.value = -12;
        this.compressor2.knee.value = 20;
        this.compressor2.ratio.value = 4;
        this.compressor2.attack.value = 0.003;
        this.compressor2.release.value = 0.25;

        this.limiter = this.audioContext.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.0001;
        this.limiter.release.value = 0.01;

        // EQ for frequency balance
        this.lowShelf = this.audioContext.createBiquadFilter();
        this.lowShelf.type = 'lowshelf';
        this.lowShelf.frequency.value = 200;
        this.lowShelf.gain.value = -1;

        this.midPeak = this.audioContext.createBiquadFilter();
        this.midPeak.type = 'peaking';
        this.midPeak.frequency.value = 1000;
        this.midPeak.Q.value = 0.7;
        this.midPeak.gain.value = 1;

        this.highShelf = this.audioContext.createBiquadFilter();
        this.highShelf.type = 'highshelf';
        this.highShelf.frequency.value = 8000;
        this.highShelf.gain.value = 0;

        // Main filtering
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 3500;
        this.filter.Q.value = 0.6;

        this.filter2 = this.audioContext.createBiquadFilter();
        this.filter2.type = 'highpass';
        this.filter2.frequency.value = 35;
        this.filter2.Q.value = 0.4;

        // Chorus
        this.chorus = this.audioContext.createDelay(0.08);
        this.chorus.delayTime.value = 0.015;
        this.chorusLFO = this.audioContext.createOscillator();
        this.chorusLFO.type = 'sine';
        this.chorusLFO.frequency.value = 0.3;
        this.chorusGain = this.audioContext.createGain();
        this.chorusGain.gain.value = 0.006;
        this.chorusLFO.connect(this.chorusGain);
        this.chorusGain.connect(this.chorus.delayTime);
        this.chorusLFO.start();

        // Reverb
        this.reverb = this.audioContext.createConvolver();
        this.createOptimizedImpulseResponse();

        // Delay lines
        this.delay1 = this.audioContext.createDelay(1.5);
        this.delay1.delayTime.value = 0.375;
        this.delay1Feedback = this.audioContext.createGain();
        this.delay1Feedback.gain.value = 0.15;
        this.delay1Wet = this.audioContext.createGain();
        this.delay1Wet.gain.value = 0.1;

        this.delay2 = this.audioContext.createDelay(1.0);
        this.delay2.delayTime.value = 0.25;
        this.delay2Feedback = this.audioContext.createGain();
        this.delay2Feedback.gain.value = 0.1;
        this.delay2Wet = this.audioContext.createGain();
        this.delay2Wet.gain.value = 0.08;

        // Connect delays
        this.delay1.connect(this.delay1Feedback);
        this.delay1Feedback.connect(this.delay1);
        this.delay1.connect(this.delay1Wet);

        this.delay2.connect(this.delay2Feedback);
        this.delay2Feedback.connect(this.delay2);
        this.delay2.connect(this.delay2Wet);

        // Main signal chain
        this.lowShelf.connect(this.midPeak);
        this.midPeak.connect(this.highShelf);
        this.highShelf.connect(this.filter);
        this.filter.connect(this.filter2);
        this.filter2.connect(this.chorus);
        this.chorus.connect(this.compressor1);
        this.compressor1.connect(this.compressor2);
        this.compressor2.connect(this.reverb);
        this.reverb.connect(this.limiter);
        this.limiter.connect(this.masterGain);
        
        this.delay1Wet.connect(this.compressor1);
        this.delay2Wet.connect(this.compressor1);

        this.compressorStages = [this.compressor1, this.compressor2, this.limiter];
    }

    createOptimizedImpulseResponse() {
        const length = this.audioContext.sampleRate * 2.5;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 1.5);
                const noise = (Math.random() * 2 - 1) * decay * 0.15;
                channelData[i] = noise * (channel === 0 ? 1 : 0.85);
            }
        }
        this.reverb.buffer = impulse;
    }

    noteToFrequency(note, octave = 4) {
        const clampedNote = Math.max(-36, Math.min(48, note + this.currentKey));
        const clampedOctave = Math.max(0, Math.min(9, octave));
        return 440 * Math.pow(2, (clampedNote + (clampedOctave - 4) * 12) / 12);
    }

    buildChordWithSuspensions(root, addSuspension = false) {
        const chord = [
            this.currentScale[root % this.currentScale.length],
            this.currentScale[(root + 2) % this.currentScale.length],
            this.currentScale[(root + 4) % this.currentScale.length]
        ];

        if (this.rng() > 0.4) {
            chord.push(this.currentScale[(root + 6) % this.currentScale.length]);
        }

        if (addSuspension && this.rng() < this.baroqueComplexity) {
            const suspension = this.suspensionTypes[Math.floor(this.rng() * this.suspensionTypes.length)];
            const suspensionNote = this.currentScale[(root + suspension.interval - 1) % this.currentScale.length];
            const resolutionNote = this.currentScale[(root + suspension.resolution - 1) % this.currentScale.length];
            
            return {
                suspension: [...chord, suspensionNote],
                resolution: [...chord, resolutionNote],
                type: suspension.type
            };
        }

        return { chord, resolution: chord };
    }

    // ENHANCED ARPEGGIO SYSTEM - Much more prominent!
    createProminentArpeggio(notes, evolution = 0, layer = 0) {
        const patterns = [
            [0, 1, 2, 1],                    // Classic
            [0, 2, 1, 2],                    // Skip
            [0, 1, 2, 3, 2, 1],              // Extended
            [0, 2, 4, 2, 1, 3],              // Complex skip
            [0, 1, 3, 2, 4, 1],              // Baroque
            [2, 0, 1, 3, 0, 2],              // Inverted
            [0, 1, 2, 4, 3, 1, 0],           // Heptuple
            [0, 2, 1, 3, 2, 4, 1],           // Syncopated
            [1, 0, 2, 1, 3, 2, 4],           // Off-beat
            [0, 1, 2, 3, 4, 3, 2, 1, 0],     // Palindrome
            [0, 2, 4, 1, 3, 0, 2],           // Triadic
            [2, 4, 1, 3, 0, 2, 4]            // Mediant
        ];

        const evolutionIndex = Math.floor(evolution * patterns.length) % patterns.length;
        let pattern = [...patterns[(evolutionIndex + layer) % patterns.length]];
        
        // Layer-specific modifications
        if (layer === 1) {
            pattern = pattern.map(p => (p + 1) % notes.length); // Offset pattern
        }
        
        // Evolution mutations
        if (evolution > 0.3) {
            if (this.rng() > 0.8) {
                pattern.push(Math.floor(this.rng() * notes.length));
            }
            if (evolution > 0.6 && this.rng() > 0.7) {
                const mid = Math.floor(pattern.length / 2);
                pattern = [...pattern.slice(0, mid).reverse(), ...pattern.slice(mid)];
            }
        }
        
        return pattern;
    }

    playProminentArpeggio(notes, startTime, beatLength, evolution, instrumentName = 'arp') {
        const config = this.currentInstruments.get(instrumentName);
        if (!config) return;

        const pattern = this.createProminentArpeggio(notes, evolution, 0);
        const baseSpeed = config.speed;
        const noteLength = beatLength * baseSpeed;
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.01);

        // Play multiple layers for prominence
        const layers = config.layers || 1;
        for (let layer = 0; layer < layers; layer++) {
            const layerPattern = this.createProminentArpeggio(notes, evolution, layer);
            const layerOffset = layer * noteLength * 0.25;
            
            layerPattern.forEach((patternIndex, step) => {
                if (patternIndex < notes.length) {
                    const note = notes[patternIndex];
                    const swing = config.swing || 0;
                    const swingOffset = (step % 2 === 1) ? swing * noteLength : 0;
                    const timing = safeStartTime + layerOffset + (step * noteLength) + swingOffset;
                    
                    if (timing > currentTime && timing < currentTime + 4) { // Ensure we don't schedule too far ahead
                        this.playInstrument(instrumentName, [note], timing, noteLength * 0.8);
                    }
                }
            });
        }
    }

    // CONTINUOUS EVOLUTION SYSTEM
    updateGlobalEvolution() {
        this.globalEvolution += this.evolutionSpeed;
        this.arpeggioEvolution = (Math.sin(this.globalEvolution * 0.1) + 1) * 0.5;
        this.arpeggioPattern = Math.floor(this.globalEvolution * 0.05) % 12;
        
        // Update arpeggio parameters for continuous evolution
        const arpConfig = this.currentInstruments.get('arp');
        if (arpConfig) {
            arpConfig.pattern = this.arpeggioPattern;
            arpConfig.speed = 0.0625 + (Math.sin(this.globalEvolution * 0.03) * 0.03125);
        }
        
        const arp2Config = this.currentInstruments.get('arp2');
        if (arp2Config) {
            arp2Config.pattern = (this.arpeggioPattern + 3) % 12;
            arp2Config.speed = 0.03125 + (Math.cos(this.globalEvolution * 0.04) * 0.015625);
        }
    }

    checkForModulation() {
        if (this.sequencePosition % this.sectionLength === 0 && this.sequencePosition > 0) {
            this.currentSection++;
            
            if (this.shouldModulate()) {
                this.performModulation();
            }
            
            this.updateMood();
        }
    }

    shouldModulate() {
        return this.rng() < 0.4 && !this.isModulating;
    }

    performModulation() {
        this.isModulating = true;
        
        if (this.rng() > 0.4) {
            const thirdMod = this.thirdModulations[Math.floor(this.rng() * this.thirdModulations.length)];
            this.modulationTarget = thirdMod.interval;
        } else {
            this.modulationTarget = this.modulations[Math.floor(this.rng() * this.modulations.length)];
        }
        
        this.harmonicProgression = [...this.chordProgressions[this.currentMood][Math.floor(this.rng() * this.chordProgressions[this.currentMood].length)]];
    }

    updateMood() {
        const moodProgression = ['ethereal', 'melancholic', 'mysterious', 'cosmic', 'dramatic'];
        const currentMoodIndex = moodProgression.indexOf(this.currentMood);
        
        if (this.rng() > 0.6) {
            const nextMoodIndex = (currentMoodIndex + 1) % moodProgression.length;
            this.currentMood = moodProgression[nextMoodIndex];
            this.harmonicProgression = [...this.chordProgressions[this.currentMood][Math.floor(this.rng() * this.chordProgressions[this.currentMood].length)]];
        }
    }

    createSynth(config) {
        const osc = this.audioContext.createOscillator();
        osc.type = config.type;
        
        const envelope = this.audioContext.createGain();
        envelope.gain.value = 0;

        const instrumentGain = this.audioContext.createGain();
        instrumentGain.gain.value = config.gain || 0.1;

        let filter;
        if (config.filterFreq) {
            filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = Math.max(80, Math.min(18000, config.filterFreq));
            filter.Q.value = Math.max(0.1, Math.min(25, config.resonance || 1));
            osc.connect(filter);
            filter.connect(envelope);
        } else {
            osc.connect(envelope);
        }

        envelope.connect(instrumentGain);

        if (config.lfoRate && config.lfoAmount) {
            const lfo = this.audioContext.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = config.lfoRate;
            const lfoGain = this.audioContext.createGain();
            lfoGain.gain.value = config.lfoAmount * (config.filterFreq || 1000) * 0.5;
            lfo.connect(lfoGain);
            if (filter) {
                lfoGain.connect(filter.frequency);
            }
            lfo.start();
            
            if (!this.lfos) this.lfos = [];
            this.lfos.push(lfo);
        }

        return { osc, envelope, filter, instrumentGain };
    }

    triggerSynth(synth, frequency, startTime, duration, config) {
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.001);
        const safeDuration = Math.max(duration, 0.02);

        const clampedFrequency = Math.max(20, Math.min(18000, frequency * (1 + (this.rng() * 2 - 1) * config.detune * 0.003)));
        synth.osc.frequency.value = clampedFrequency;

        const attack = Math.max(config.attack, 0.001);
        const decay = Math.max(config.decay, 0.001);
        const sustain = Math.max(0.001, Math.min(0.9, config.sustain));
        const release = Math.max(config.release, 0.001);

        const attackEndTime = safeStartTime + attack;
        const decayEndTime = attackEndTime + decay;
        const sustainDuration = Math.max(safeDuration - attack - decay - release, 0.01);
        const releaseStartTime = safeStartTime + attack + decay + sustainDuration;
        const endTime = releaseStartTime + release;

        try {
            synth.envelope.gain.cancelScheduledValues(safeStartTime);
            synth.envelope.gain.setValueAtTime(0.001, safeStartTime);
            synth.envelope.gain.exponentialRampToValueAtTime(0.8, attackEndTime);
            synth.envelope.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.001), decayEndTime);
            synth.envelope.gain.setValueAtTime(sustain, releaseStartTime);
            synth.envelope.gain.exponentialRampToValueAtTime(0.001, endTime);

            synth.osc.start(safeStartTime);
            synth.osc.stop(endTime);
        } catch (error) {
            console.warn('Synth trigger error:', error);
            return;
        }
    }

    playInstrument(instrumentName, notes, startTime, duration) {
        const config = this.currentInstruments.get(instrumentName);
        if (!config) return;

        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.001);
        const safeDuration = Math.max(duration, 0.05);

        notes.forEach((note, index) => {
            const frequency = this.noteToFrequency(note, config.octave);
            if (frequency < 20 || frequency > 18000) return;

            const voices = Math.min(config.voices || 1, 3);
            for (let voice = 0; voice < voices; voice++) {
                const synth = this.createSynth(config);
                synth.instrumentGain.connect(this.lowShelf);
                synth.instrumentGain.connect(this.delay1);
                synth.instrumentGain.connect(this.delay2);

                const voiceDetune = voice * (config.detune || 0) * 0.2;
                const voiceFreq = frequency * (1 + voiceDetune * 0.003);
                const noteStartTime = safeStartTime + (index * 0.005) + (voice * 0.002);
                
                this.triggerSynth(synth, voiceFreq, noteStartTime, safeDuration, config);

                this.oscillators.push(synth.osc);
                this.envelopes.push(synth.envelope);
            }
        });

        // Cleanup with shorter timeout to prevent accumulation
        setTimeout(() => {
            this.cleanupOscillators();
        }, (safeDuration + 1) * 1000);
    }

    cleanupOscillators() {
        this.oscillators = this.oscillators.filter(osc => {
            try {
                return osc.playbackState !== osc.FINISHED_STATE;
            } catch (e) {
                return false;
            }
        });
        
        this.envelopes = this.envelopes.filter(env => {
            try {
                return env.gain.value > 0.001;
            } catch (e) {
                return false;
            }
        });
    }

    // MAIN SCHEDULING - Fixed for continuous play
    scheduleNote() {
        // Update global evolution continuously
        this.updateGlobalEvolution();
        this.checkForModulation();
        
        const beatLength = Math.max(60.0 / this.config.tempo, 0.05);
        const currentTime = this.audioContext.currentTime;
        
        // Ensure continuous scheduling
        if (this.nextNoteTime <= currentTime) {
            this.nextNoteTime = currentTime + beatLength;
        }

        // Handle modulation
        if (this.isModulating && this.sequencePosition % 8 === 0) {
            const newKey = this.currentKey + this.modulationTarget;
            if (newKey >= -12 && newKey <= 12) {
                this.currentKey = newKey;
            }
            this.isModulating = false;
            this.modulationTarget = 0;
        }

        const progressionIndex = Math.floor(this.sequencePosition / 4) % this.harmonicProgression.length;
        const chordRoot = this.harmonicProgression[progressionIndex];
        
        const shouldAddSuspension = this.rng() < this.baroqueComplexity;
        const chordData = this.buildChordWithSuspensions(chordRoot, shouldAddSuspension);
        const chord = chordData.suspension || chordData.chord;

        const currentBeat = this.sequencePosition % 4;
        
        // CONSISTENT ARRANGEMENT - Always play core elements
        if (currentBeat === 0) {
            // Always play core elements
            this.playInstrument('pad', chord, this.nextNoteTime, beatLength * 4);
            this.playInstrument('bass', [chord[0]], this.nextNoteTime, beatLength * 0.8);
            
            // PROMINENT ARPEGGIOS - Always present!
            this.playProminentArpeggio(chord, this.nextNoteTime, beatLength, this.arpeggioEvolution, 'arp');
            if (this.rng() > 0.3) {
                this.playProminentArpeggio(chord, this.nextNoteTime + beatLength * 0.125, beatLength, this.arpeggioEvolution, 'arp2');
            }
            
            // Lead melody
            if (this.rng() > 0.3) {
                const leadNote = chord[0] + 12 + Math.floor(this.rng() * 5);
                this.playInstrument('lead', [leadNote], this.nextNoteTime + 0.05, beatLength * 1.5);
            }
            
        } else if (currentBeat === 1) {
            // Continue arpeggios
            this.playProminentArpeggio(chord, this.nextNoteTime, beatLength, this.arpeggioEvolution, 'arp');
            
            // Bass movement
            if (this.rng() > 0.4) {
                const bassNote = chord[0] + 7;
                this.playInstrument('bass', [bassNote], this.nextNoteTime, beatLength * 0.5);
            }
            
            // Color instruments occasionally
            if (this.rng() > 0.7) {
                this.playInstrument('strings', chord.slice(0, 3), this.nextNoteTime, beatLength * 2);
            }
            
        } else if (currentBeat === 2) {
            // Continue arpeggios - most important!
            this.playProminentArpeggio(chord, this.nextNoteTime, beatLength, this.arpeggioEvolution, 'arp');
            this.playProminentArpeggio(chord, this.nextNoteTime + beatLength * 0.0625, beatLength, this.arpeggioEvolution, 'arp2');
            
            // Lead elements
            this.playInstrument('lead', chord.slice(0, 2), this.nextNoteTime, beatLength * 1.2);
            
            // Bass
            if (this.rng() > 0.5) {
                this.playInstrument('bass', [chord[1]], this.nextNoteTime + beatLength * 0.5, beatLength * 0.4);
            }
            
        } else if (currentBeat === 3) {
            // Continue arpeggios
            this.playProminentArpeggio(chord, this.nextNoteTime, beatLength, this.arpeggioEvolution, 'arp');
            
            // Lead fills
            if (this.rng() > 0.2) {
                const leadNotes = [
                    this.currentScale[Math.floor(this.rng() * this.currentScale.length)] + 12
                ];
                this.playInstrument('lead', leadNotes, this.nextNoteTime, beatLength * 0.6);
            }
            
            // Texture elements
            if (this.rng() > 0.6) {
                this.playInstrument('bell', [chord[2] + 24], this.nextNoteTime + 0.05, beatLength * 1.2);
            }
        }

        // Dynamic filter modulation
        this.cosmicPhase += 0.01;
        const filterFreq = 1500 + 
                          Math.sin(this.cosmicPhase) * 1000 + 
                          Math.sin(this.cosmicPhase * 1.618) * 500 + 
                          this.rng() * 200;
        
        const clampedFilterFreq = Math.max(400, Math.min(5000, filterFreq));
        this.filter.frequency.setTargetAtTime(clampedFilterFreq, this.nextNoteTime, 0.1);

        // Update delay times periodically
        if (this.sequencePosition % 16 === 0) {
            const newDelayTime1 = 0.25 + (this.rng() * 0.125);
            this.delay1.delayTime.setTargetAtTime(newDelayTime1, this.nextNoteTime, 0.5);
        }

        // ENSURE CONTINUOUS SCHEDULING
        this.nextNoteTime += beatLength;
        this.sequencePosition++;
        this.lastScheduledTime = this.nextNoteTime;
    }

    // IMPROVED SCHEDULER - No more pauses!
    scheduler() {
        if (!this.isPlaying) return;
        
        const currentTime = this.audioContext.currentTime;
        
        try {
            // Schedule multiple notes ahead to prevent gaps
            while (this.nextNoteTime < currentTime + this.scheduleAheadTime) {
                this.scheduleNote();
            }
            
            // Ensure we always have notes scheduled
            if (this.nextNoteTime - currentTime < this.minScheduleAhead) {
                this.scheduleNote();
            }
            
        } catch (error) {
            console.warn('Scheduler error:', error);
            // Don't stop on errors, just continue
        }
        
        // Use shorter timeout for more responsive scheduling
        this.timerID = setTimeout(() => this.scheduler(), 15);
    }

    async start() {
        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            if (!this.isPlaying) {
                this.isPlaying = true;
                this.nextNoteTime = this.audioContext.currentTime + 0.1;
                this.lastScheduledTime = this.nextNoteTime;
                this.sequencePosition = 0;
                this.globalEvolution = 0;
                this.scheduler();
            }
        } catch (error) {
            console.warn('Start error:', error);
        }
    }

    stop() {
        this.isPlaying = false;
        
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = 0;
        }

        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        this.oscillators = [];
        this.envelopes = [];

        if (this.lfos) {
            this.lfos.forEach(lfo => {
                try {
                    lfo.stop();
                } catch (e) {}
            });
            this.lfos = [];
        }
    }

    setVolume(volume) {
        this.config.volume = Math.max(0, Math.min(1, volume));
        if (this.masterGain) {
            const adjustedVolume = this.config.volume * (1.0 - this.headroom);
            this.masterGain.gain.setTargetAtTime(adjustedVolume, this.audioContext.currentTime, 0.1);
        }
    }

    setSeed(seed) {
        this.config.seed = seed;
        this.setupSeededRandom(seed);
        this.initializeMusicalSystem();
    }

    setTempo(tempo) {
        this.config.tempo = Math.max(80, Math.min(160, tempo));
    }

    getVolume() {
        return this.config.volume;
    }

    isActive() {
        return this.isPlaying;
    }
}
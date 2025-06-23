export class ProceduralMusicGenerator {
    constructor(config) {
        this.config = { ...config };
        this.isPlaying = false;
        this.oscillators = [];
        this.envelopes = [];
        this.sequencePosition = 0;
        this.nextNoteTime = 0;
        this.lookahead = 25.0;
        this.scheduleAheadTime = 0.1;
        this.timerID = 0;
        this.currentKey = 0;
        this.currentScale = [];
        this.harmonicProgression = [];
        this.sectionLength = 32;
        this.currentSection = 0;
        this.modulationTarget = 0;
        this.isModulating = false;
        this.instrumentTypes = ['lead', 'pad', 'bass', 'arp', 'pluck', 'cosmic', 'shimmer'];
        this.currentInstruments = new Map();
        
        // Enhanced for celestial feel
        this.cosmicPhase = 0;
        this.stellarDrift = 0;
        this.nebulaIntensity = 0.5;
        
        this.scales = {
            major: [0, 2, 4, 5, 7, 9, 11],
            lydian: [0, 2, 4, 6, 7, 9, 11],
            mixolydian: [0, 2, 4, 5, 7, 9, 10],
            dorian: [0, 2, 3, 5, 7, 9, 10],
            pentatonic: [0, 2, 4, 7, 9],
            wholeTone: [0, 2, 4, 6, 8, 10],
            minor: [0, 2, 3, 5, 7, 8, 10],
            phrygian: [0, 1, 3, 5, 7, 8, 10],
            blues: [0, 3, 5, 6, 7, 10]
        };

        // More sophisticated chord progressions for celestial feel
        this.chordProgressions = [
            [0, 5, 6, 4], // vi-V-vi-IV (classic)
            [0, 3, 6, 5], // I-IV-vi-V 
            [0, 6, 4, 5], // I-vi-IV-V
            [0, 2, 5, 3], // I-iii-vi-IV
            [0, 4, 6, 2], // I-V-vi-iii
            [0, 1, 4, 5], // I-ii-V-vi (jazz influenced)
            [0, 6, 2, 4], // I-vi-iii-V
            [0, 3, 2, 5], // I-IV-iii-vi (modal)
            [0, 5, 2, 6], // I-vi-iii-vii (ethereal)
            [0, 4, 1, 6]  // I-V-ii-vi (suspended)
        ];

        this.modulations = [0, 5, 7, -5, 2, -2, 3, -3, 4, -4];

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
        this.harmonicProgression = [...this.chordProgressions[Math.floor(this.rng() * this.chordProgressions.length)]];
        this.sectionLength = 16 + Math.floor(this.rng() * 32);
        this.currentSection = 0;
        this.modulationTarget = 0;
        this.isModulating = false;
        this.initializeInstruments();
    }

    initializeInstruments() {
        this.currentInstruments.clear();
        
        // Lead synth - more ethereal
        this.currentInstruments.set('lead', {
            type: this.rng() > 0.6 ? 'sawtooth' : 'triangle',
            octave: 5 + Math.floor(this.rng() * 2),
            detune: 3 + this.rng() * 8,
            attack: 0.05 + this.rng() * 0.15,
            decay: 0.2 + this.rng() * 0.4,
            sustain: 0.4 + this.rng() * 0.4,
            release: 0.3 + this.rng() * 1.2,
            filterFreq: 1200 + this.rng() * 2800,
            resonance: 1 + this.rng() * 8,
            lfoRate: 0.1 + this.rng() * 0.8,
            lfoAmount: 0.1 + this.rng() * 0.3
        });

        // Cosmic pad - wide, spacious
        this.currentInstruments.set('pad', {
            type: 'sine',
            octave: 3 + Math.floor(this.rng() * 3),
            detune: 1 + this.rng() * 4,
            attack: 1.0 + this.rng() * 2.5,
            decay: 0.8 + this.rng() * 1.5,
            sustain: 0.7 + this.rng() * 0.25,
            release: 2.0 + this.rng() * 4.0,
            filterFreq: 400 + this.rng() * 1200,
            resonance: 0.3 + this.rng() * 1.5,
            chorus: true,
            reverb: 0.8 + this.rng() * 0.2
        });

        // Bass - punchy but not overwhelming
        this.currentInstruments.set('bass', {
            type: this.rng() > 0.5 ? 'triangle' : 'sawtooth',
            octave: 2,
            detune: 0.5 + this.rng() * 2,
            attack: 0.01 + this.rng() * 0.03,
            decay: 0.08 + this.rng() * 0.15,
            sustain: 0.6 + this.rng() * 0.3,
            release: 0.1 + this.rng() * 0.2,
            filterFreq: 150 + this.rng() * 300,
            resonance: 2 + this.rng() * 6,
            sidechainAmount: 0.2 + this.rng() * 0.3
        });

        // Arpeggiated elements
        this.currentInstruments.set('arp', {
            type: this.rng() > 0.4 ? 'square' : 'triangle',
            octave: 6 + Math.floor(this.rng() * 2),
            detune: 2 + this.rng() * 6,
            attack: 0.005 + this.rng() * 0.02,
            decay: 0.03 + this.rng() * 0.1,
            sustain: 0.05 + this.rng() * 0.2,
            release: 0.05 + this.rng() * 0.3,
            pattern: Math.floor(this.rng() * 6),
            speed: 0.0625 + this.rng() * 0.1875, // Faster for techno feel
            filterFreq: 800 + this.rng() * 2000,
            resonance: 3 + this.rng() * 8
        });

        // Plucked elements
        this.currentInstruments.set('pluck', {
            type: 'triangle',
            octave: 4 + Math.floor(this.rng() * 3),
            detune: 1 + this.rng() * 4,
            attack: 0.001 + this.rng() * 0.005,
            decay: 0.03 + this.rng() * 0.15,
            sustain: 0.0,
            release: 0.08 + this.rng() * 0.4,
            filterFreq: 600 + this.rng() * 2400,
            resonance: 2 + this.rng() * 6,
            delay: 0.125 + this.rng() * 0.25
        });

        // Cosmic texture
        this.currentInstruments.set('cosmic', {
            type: 'sine',
            octave: 7 + Math.floor(this.rng() * 2),
            detune: 5 + this.rng() * 15,
            attack: 0.5 + this.rng() * 2.0,
            decay: 1.0 + this.rng() * 3.0,
            sustain: 0.3 + this.rng() * 0.4,
            release: 1.5 + this.rng() * 4.0,
            filterFreq: 2000 + this.rng() * 4000,
            resonance: 0.5 + this.rng() * 2,
            modulation: 0.3 + this.rng() * 0.7
        });

        // Shimmer layer
        this.currentInstruments.set('shimmer', {
            type: 'triangle',
            octave: 8,
            detune: 8 + this.rng() * 20,
            attack: 0.1 + this.rng() * 0.5,
            decay: 0.2 + this.rng() * 0.8,
            sustain: 0.1 + this.rng() * 0.3,
            release: 0.5 + this.rng() * 2.0,
            filterFreq: 3000 + this.rng() * 5000,
            resonance: 1 + this.rng() * 4,
            sparkle: true
        });
    }

    initializeAudioContext() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.config.volume;
        this.setupEffectsChain();
        this.masterGain.connect(this.audioContext.destination);
    }

    setupEffectsChain() {
        // Enhanced effects chain for stellar sound
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        // Multi-stage filtering
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 3000;
        this.filter.Q.value = 0.8;

        this.filter2 = this.audioContext.createBiquadFilter();
        this.filter2.type = 'highpass';
        this.filter2.frequency.value = 60;
        this.filter2.Q.value = 0.5;

        // Enhanced chorus for width
        this.chorus = this.audioContext.createDelay(0.1);
        this.chorus.delayTime.value = 0.015;
        this.chorusLFO = this.audioContext.createOscillator();
        this.chorusLFO.type = 'sine';
        this.chorusLFO.frequency.value = 0.3 + this.rng() * 0.4;
        this.chorusGain = this.audioContext.createGain();
        this.chorusGain.gain.value = 0.008;
        this.chorusLFO.connect(this.chorusGain);
        this.chorusGain.connect(this.chorus.delayTime);
        this.chorusLFO.start();

        // Stellar reverb
        this.reverb = this.audioContext.createConvolver();
        this.createStellarImpulseResponse();

        // Cosmic delay
        this.delay = this.audioContext.createDelay(2.0);
        this.delay.delayTime.value = 0.375 + this.rng() * 0.25; // Dotted eighth note delay
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.15 + this.rng() * 0.2;
        this.delayWet = this.audioContext.createGain();
        this.delayWet.gain.value = 0.2 + this.rng() * 0.15;

        // Additional stellar delay
        this.delay2 = this.audioContext.createDelay(1.5);
        this.delay2.delayTime.value = 0.25; // Quarter note delay
        this.delay2Feedback = this.audioContext.createGain();
        this.delay2Feedback.gain.value = 0.1 + this.rng() * 0.15;
        this.delay2Wet = this.audioContext.createGain();
        this.delay2Wet.gain.value = 0.15 + this.rng() * 0.1;

        // Connect delay chains
        this.delay.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delay);
        this.delay.connect(this.delayWet);

        this.delay2.connect(this.delay2Feedback);
        this.delay2Feedback.connect(this.delay2);
        this.delay2.connect(this.delay2Wet);

        // Main signal chain
        this.filter.connect(this.filter2);
        this.filter2.connect(this.chorus);
        this.chorus.connect(this.compressor);
        this.compressor.connect(this.reverb);
        this.reverb.connect(this.masterGain);
        
        // Delay sends
        this.delayWet.connect(this.masterGain);
        this.delay2Wet.connect(this.masterGain);
    }

    createStellarImpulseResponse() {
        const length = this.audioContext.sampleRate * (3 + this.rng() * 4); // Longer reverb
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 0.8 + this.rng() * 0.4);
                const shimmer = Math.sin(i * 0.0001 * (1 + this.rng())) * 0.1;
                channelData[i] = (this.rng() * 2 - 1) * decay * (0.05 + shimmer);
            }
        }
        this.reverb.buffer = impulse;
    }

    // Improved note frequency calculation with better range control
    noteToFrequency(note, octave = 4) {
        // Clamp note to reasonable range to prevent out-of-range issues
        const clampedNote = Math.max(-24, Math.min(36, note + this.currentKey));
        const clampedOctave = Math.max(0, Math.min(9, octave));
        return 440 * Math.pow(2, (clampedNote + (clampedOctave - 4) * 12) / 12);
    }

    createSynth(config) {
        const osc = this.audioContext.createOscillator();
        osc.type = config.type;
        
        const envelope = this.audioContext.createGain();
        envelope.gain.value = 0;

        let filter;
        if (config.filterFreq) {
            filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = Math.max(80, Math.min(20000, config.filterFreq));
            filter.Q.value = Math.max(0.1, Math.min(30, config.resonance || 1));
            osc.connect(filter);
            filter.connect(envelope);
        } else {
            osc.connect(envelope);
        }

        // Add LFO modulation for cosmic feel
        if (config.lfoRate && config.lfoAmount) {
            const lfo = this.audioContext.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = config.lfoRate;
            const lfoGain = this.audioContext.createGain();
            lfoGain.gain.value = config.lfoAmount * config.filterFreq;
            lfo.connect(lfoGain);
            if (filter) {
                lfoGain.connect(filter.frequency);
            }
            lfo.start();
            
            // Store LFO for cleanup
            if (!this.lfos) this.lfos = [];
            this.lfos.push(lfo);
        }

        return { osc, envelope, filter };
    }

    triggerSynth(synth, frequency, startTime, duration, config) {
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.01);
        const safeDuration = Math.max(duration, 0.05);

        // Clamp frequency to audible range
        const clampedFrequency = Math.max(20, Math.min(20000, frequency * (1 + (this.rng() * 2 - 1) * config.detune * 0.01)));
        synth.osc.frequency.value = clampedFrequency;

        // Improved envelope with better timing
        const attack = Math.max(config.attack, 0.001);
        const decay = Math.max(config.decay, 0.001);
        const sustain = Math.max(0, Math.min(1, config.sustain));
        const release = Math.max(config.release, 0.001);

        const attackEndTime = safeStartTime + attack;
        const decayEndTime = attackEndTime + decay;
        const sustainDuration = Math.max(safeDuration - attack - decay - release, 0.01);
        const releaseStartTime = safeStartTime + attack + decay + sustainDuration;
        const endTime = releaseStartTime + release;

        try {
            synth.envelope.gain.cancelScheduledValues(safeStartTime);
            synth.envelope.gain.setValueAtTime(0, safeStartTime);
            synth.envelope.gain.linearRampToValueAtTime(0.8, attackEndTime);
            synth.envelope.gain.linearRampToValueAtTime(sustain, decayEndTime);
            synth.envelope.gain.setValueAtTime(sustain, releaseStartTime);
            synth.envelope.gain.linearRampToValueAtTime(0, endTime);

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
        const safeStartTime = Math.max(startTime, currentTime + 0.01);
        const safeDuration = Math.max(duration, 0.1);

        notes.forEach((note, index) => {
            // Improved frequency calculation with range checking
            const frequency = this.noteToFrequency(note, config.octave);
            if (frequency < 20 || frequency > 20000) return; // Skip out-of-range notes

            const synth = this.createSynth(config);
            synth.envelope.connect(this.filter);
            synth.envelope.connect(this.delay);
            synth.envelope.connect(this.delay2);

            const noteStartTime = safeStartTime + (index * 0.01);
            this.triggerSynth(synth, frequency, noteStartTime, safeDuration, config);

            this.oscillators.push(synth.osc);
            this.envelopes.push(synth.envelope);

            // Cleanup with timeout
            setTimeout(() => {
                const oscIndex = this.oscillators.indexOf(synth.osc);
                if (oscIndex > -1) {
                    this.oscillators.splice(oscIndex, 1);
                    const envIndex = this.envelopes.indexOf(synth.envelope);
                    if (envIndex > -1) {
                        this.envelopes.splice(envIndex, 1);
                    }
                }
            }, (safeDuration + 2) * 1000);
        });
    }

    playArpeggioPattern(notes, startTime, beatLength) {
        const config = this.currentInstruments.get('arp');
        if (!config || this.rng() > 0.8) return;

        const patterns = [
            [0, 1, 2, 1],
            [0, 2, 1, 2],
            [0, 1, 2, 3],
            [2, 1, 0, 1],
            [0, 2, 1, 3],
            [1, 0, 2, 1], // New patterns for variety
            [0, 1, 3, 2],
            [2, 0, 1, 3]
        ];

        const pattern = patterns[config.pattern % patterns.length];
        const noteLength = Math.max(beatLength * config.speed, 0.05);
        const currentTime = this.audioContext.currentTime;
        const safeStartTime = Math.max(startTime, currentTime + 0.01);

        pattern.forEach((patternIndex, step) => {
            if (patternIndex < notes.length) {
                const note = notes[patternIndex];
                const timing = safeStartTime + (step * noteLength);
                if (timing > currentTime) {
                    this.playInstrument('arp', [note], timing, noteLength * 0.9);
                }
            }
        });
    }

    checkForModulation() {
        if (this.sequencePosition % this.sectionLength === 0 && this.sequencePosition > 0) {
            this.currentSection++;
            
            // More frequent modulations for variety
            if (this.rng() > 0.6 && !this.isModulating) {
                this.isModulating = true;
                this.modulationTarget = this.modulations[Math.floor(this.rng() * this.modulations.length)];
                this.harmonicProgression = [...this.chordProgressions[Math.floor(this.rng() * this.chordProgressions.length)]];
            } else if (this.isModulating) {
                // Safer modulation with range checking
                const newKey = this.currentKey + this.modulationTarget;
                if (newKey >= -12 && newKey <= 12) {
                    this.currentKey = newKey;
                }
                this.isModulating = false;
                this.modulationTarget = 0;
                
                // Refresh instruments occasionally
                if (this.rng() > 0.5) {
                    this.initializeInstruments();
                }
            }
            
            this.sectionLength = 16 + Math.floor(this.rng() * 32);
        }
    }

    scheduleNote() {
        this.checkForModulation();
        
        const beatLength = Math.max(60.0 / this.config.tempo, 0.1);
        const currentTime = this.audioContext.currentTime;
        
        if (this.nextNoteTime <= currentTime + 0.05) {
            this.nextNoteTime = currentTime + 0.1;
        }

        const progressionIndex = Math.floor(this.sequencePosition / 4) % this.harmonicProgression.length;
        const chordRoot = this.harmonicProgression[progressionIndex];
        
        // Build chord with range checking
        const chord = [
            this.currentScale[chordRoot % this.currentScale.length],
            this.currentScale[(chordRoot + 2) % this.currentScale.length],
            this.currentScale[(chordRoot + 4) % this.currentScale.length]
        ];

        if (this.rng() > 0.6) {
            chord.push(this.currentScale[(chordRoot + 6) % this.currentScale.length]);
        }

        const currentBeat = this.sequencePosition % 4;
        
        // Enhanced sequencing for upbeat techno feel
        if (currentBeat === 0) {
            // Downbeat - full chord and bass
            this.playInstrument('pad', chord, this.nextNoteTime, beatLength * 4);
            this.playInstrument('bass', [chord[0]], this.nextNoteTime, beatLength * 0.9);
            
            if (this.rng() > 0.3) {
                this.playInstrument('lead', [chord[0] + 12], this.nextNoteTime + 0.05, beatLength * 2);
            }
            
            // Add cosmic texture occasionally
            if (this.rng() > 0.7) {
                this.playInstrument('cosmic', [chord[1] + 24], this.nextNoteTime + 0.1, beatLength * 3);
            }
        } else if (currentBeat === 1) {
            // Off-beat elements
            if (this.rng() > 0.5) {
                this.playInstrument('bass', [chord[0] + 7], this.nextNoteTime, beatLength * 0.5);
            }
            
            if (this.rng() > 0.4) {
                const melodyNote = this.currentScale[Math.floor(this.rng() * this.currentScale.length)];
                this.playInstrument('pluck', [melodyNote + 12], this.nextNoteTime + 0.02, beatLength * 0.4);
            }
            
            // Shimmer layer
            if (this.rng() > 0.8) {
                this.playInstrument('shimmer', [chord[2] + 24], this.nextNoteTime + 0.03, beatLength * 0.6);
            }
        } else if (currentBeat === 2) {
            // Syncopated elements
            this.playInstrument('lead', chord.slice(0, 2), this.nextNoteTime, beatLength * 1.2);
            this.playArpeggioPattern(chord, this.nextNoteTime + 0.01, beatLength);
            
            if (this.rng() > 0.6) {
                this.playInstrument('bass', [chord[1]], this.nextNoteTime + beatLength * 0.5, beatLength * 0.4);
            }
        } else if (currentBeat === 3) {
            // Lead elements and fills
            if (this.rng() > 0.2) {
                const leadNotes = [
                    this.currentScale[Math.floor(this.rng() * this.currentScale.length)] + 12,
                    this.currentScale[Math.floor(this.rng() * this.currentScale.length)] + 12
                ];
                this.playInstrument('lead', leadNotes, this.nextNoteTime, beatLength * 0.8);
            }
            
            // Cosmic elements
            if (this.rng() > 0.7) {
                this.playInstrument('cosmic', [chord[0] + 19], this.nextNoteTime + 0.05, beatLength * 1.5);
            }
        }

        // Dynamic filter modulation for stellar movement
        this.cosmicPhase += 0.02;
        const filterFreq = 800 + Math.sin(this.cosmicPhase) * 1200 + 
                          Math.sin(this.cosmicPhase * 1.618) * 600 + 
                          this.rng() * 400;
        
        const clampedFilterFreq = Math.max(200, Math.min(8000, filterFreq));
        this.filter.frequency.setTargetAtTime(clampedFilterFreq, this.nextNoteTime, 0.1);

        // Evolving delay times for cosmic drift
        if (this.sequencePosition % 16 === 0) {
            const newDelayTime = 0.125 + this.rng() * 0.25;
            this.delay.delayTime.setTargetAtTime(newDelayTime, this.nextNoteTime, 0.5);
        }

        if (this.sequencePosition % 32 === 0) {
            const newDelayTime2 = 0.1875 + this.rng() * 0.1875;
            this.delay2.delayTime.setTargetAtTime(newDelayTime2, this.nextNoteTime, 0.8);
        }

        this.nextNoteTime += beatLength;
        this.sequencePosition++;
    }

    scheduler() {
        if (!this.isPlaying) return;
        
        try {
            while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
                this.scheduleNote();
            }
        } catch (error) {
            console.warn('Scheduler error:', error);
        }
        
        this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
    }

    async start() {
        try {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            if (!this.isPlaying) {
                this.isPlaying = true;
                this.nextNoteTime = this.audioContext.currentTime + 0.2;
                this.sequencePosition = 0;
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

        // Clean up oscillators
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        this.oscillators = [];
        this.envelopes = [];

        // Clean up LFOs
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
            this.masterGain.gain.setTargetAtTime(this.config.volume, this.audioContext.currentTime, 0.1);
        }
    }

    setSeed(seed) {
        this.config.seed = seed;
        this.setupSeededRandom(seed);
        this.initializeMusicalSystem();
        if (this.audioContext) {
            this.setupEffectsChain();
        }
    }

    setTempo(tempo) {
        this.config.tempo = Math.max(80, Math.min(160, tempo)); // Reasonable tempo range
    }

    getVolume() {
        return this.config.volume;
    }

    isActive() {
        return this.isPlaying;
    }
}
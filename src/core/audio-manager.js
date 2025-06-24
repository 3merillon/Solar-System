import { ProceduralMusicGenerator } from './procedural-music-generator.js';

export class AudioManager {
    constructor() {
        this.musicGenerator = null;
        this.isInitialized = false;
        this.pendingStart = false;
    }

    async initialize(seed) {
        if (this.isInitialized) return;

        const config = {
            seed: seed,
            volume: 0.4,
            tempo: 95 + Math.floor((seed % 1000) / 20), // 95-145 BPM range for upbeat feel
            key: 'C',
            scale: this.getScaleFromSeed(seed)
        };

        this.musicGenerator = new ProceduralMusicGenerator(config);
        this.isInitialized = true;

        if (this.pendingStart) {
            await this.startMusic();
            this.pendingStart = false;
        }
    }

    getScaleFromSeed(seed) {
        // More upbeat, celestial scales
        const scales = ['major', 'lydian', 'mixolydian', 'dorian', 'pentatonic', 'wholeTone'];
        return scales[seed % scales.length];
    }

    async startMusic() {
        if (!this.isInitialized || !this.musicGenerator) {
            this.pendingStart = true;
            return;
        }
        try {
            await this.musicGenerator.start();
        } catch (error) {
            console.warn('Failed to start music:', error);
        }
    }

    stopMusic() {
        if (this.musicGenerator) {
            this.musicGenerator.stop();
        }
    }

    setVolume(volume) {
        if (this.musicGenerator) {
            this.musicGenerator.setVolume(volume);
        }
    }

    getVolume() {
        return this.musicGenerator ? this.musicGenerator.getVolume() : 0.4;
    }

    setSeed(seed) {
        if (this.musicGenerator) {
            const newTempo = 95 + Math.floor((seed % 1000) / 20);
            this.musicGenerator.setTempo(newTempo);
            this.musicGenerator.setSeed(seed);
        }
    }

    setTempo(tempo) {
        if (this.musicGenerator) {
            this.musicGenerator.setTempo(tempo);
        }
    }

    isPlaying() {
        return this.musicGenerator ? this.musicGenerator.isActive() : false;
    }

    cleanup() {
        if (this.musicGenerator) {
            this.musicGenerator.stop();
        }
        this.isInitialized = false;
        this.musicGenerator = null;
    }
}
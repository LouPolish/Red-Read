/**
 * Playback Controller
 * Manages RSVP playback with proper timing, seeking, and iOS visibility recovery
 */

/**
 * @typedef {Object} PlaybackState
 * @property {boolean} isPlaying
 * @property {number} currentIndex
 * @property {number} wpm
 * @property {string} mode - 'reading' | 'skim'
 */

/**
 * @typedef {Object} PlaybackCallbacks
 * @property {function(Token, number): void} onTick - Called for each word
 * @property {function(): void} onComplete - Called when finished
 * @property {function(PlaybackState): void} onStateChange - Called on state changes
 * @property {function(number): void} onProgress - Called with progress percentage
 */

import { getDisplayDuration } from './tokenizer.js';

class PlaybackController {
    constructor(callbacks = {}) {
        this.tokens = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.wpm = 300;
        this.mode = 'reading';

        // Callbacks
        this.onTick = callbacks.onTick || (() => {});
        this.onComplete = callbacks.onComplete || (() => {});
        this.onStateChange = callbacks.onStateChange || (() => {});
        this.onProgress = callbacks.onProgress || (() => {});

        // Timing state
        this.rafId = null;
        this.lastTimestamp = null;
        this.accumulatedTime = 0;
        this.currentTokenDuration = 0;

        // Visibility handling for iOS
        this.wasPlayingBeforeHidden = false;
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);

        // Page lifecycle for more aggressive iOS backgrounding
        if ('onfreeze' in document) {
            document.addEventListener('freeze', () => this.handleFreeze());
            document.addEventListener('resume', () => this.handleResume());
        }
    }

    /**
     * Load tokens for playback
     * @param {Token[]} tokens
     * @param {number} startIndex - Optional starting position
     */
    load(tokens, startIndex = 0) {
        this.stop();
        this.tokens = tokens;
        this.currentIndex = Math.max(0, Math.min(startIndex, tokens.length - 1));
        this.emitTick();
        this.emitStateChange();
    }

    /**
     * Set WPM
     * @param {number} wpm
     */
    setWPM(wpm) {
        this.wpm = Math.max(50, Math.min(2000, wpm));

        // Recalculate current token duration if playing
        if (this.isPlaying && this.tokens[this.currentIndex]) {
            this.currentTokenDuration = getDisplayDuration(this.tokens[this.currentIndex], this.wpm);
        }

        this.emitStateChange();
    }

    /**
     * Adjust WPM by delta
     * @param {number} delta
     */
    adjustWPM(delta) {
        this.setWPM(this.wpm + delta);
    }

    /**
     * Set reading mode
     * @param {'reading' | 'skim'} mode
     */
    setMode(mode) {
        this.mode = mode;
        this.emitStateChange();
    }

    /**
     * Start playback
     */
    play() {
        if (this.tokens.length === 0) return;

        // If at end, restart
        if (this.currentIndex >= this.tokens.length - 1) {
            this.currentIndex = 0;
        }

        this.isPlaying = true;
        this.accumulatedTime = 0;
        this.lastTimestamp = null;

        // Calculate duration for current token
        this.currentTokenDuration = getDisplayDuration(this.tokens[this.currentIndex], this.wpm);

        // Start the animation frame loop
        this.rafId = requestAnimationFrame((ts) => this.tick(ts));

        this.emitStateChange();
    }

    /**
     * Pause playback
     */
    pause() {
        this.isPlaying = false;

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        this.lastTimestamp = null;
        this.emitStateChange();
    }

    /**
     * Stop playback and reset
     */
    stop() {
        this.pause();
        this.currentIndex = 0;
        this.accumulatedTime = 0;
        this.emitStateChange();
    }

    /**
     * Toggle play/pause
     */
    toggle() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Step forward or backward
     * @param {number} delta - Positive for forward, negative for backward
     */
    step(delta) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.pause();
        }

        this.currentIndex = Math.max(0, Math.min(this.currentIndex + delta, this.tokens.length - 1));
        this.accumulatedTime = 0;

        this.emitTick();
        this.emitProgress();
        this.emitStateChange();
    }

    /**
     * Seek to specific index
     * @param {number} index
     */
    seek(index) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.pause();
        }

        this.currentIndex = Math.max(0, Math.min(index, this.tokens.length - 1));
        this.accumulatedTime = 0;

        this.emitTick();
        this.emitProgress();

        if (wasPlaying) {
            this.play();
        } else {
            this.emitStateChange();
        }
    }

    /**
     * Seek to percentage (0-100)
     * @param {number} percent
     */
    seekPercent(percent) {
        const index = Math.floor((percent / 100) * this.tokens.length);
        this.seek(index);
    }

    /**
     * Quick rewind (jump back N words)
     * @param {number} words - Default 10
     */
    rewind(words = 10) {
        this.step(-words);
    }

    /**
     * Main animation frame tick
     * Uses delta timing for accuracy regardless of frame rate
     * @param {number} timestamp
     */
    tick(timestamp) {
        if (!this.isPlaying) return;

        // Calculate delta time
        if (this.lastTimestamp === null) {
            this.lastTimestamp = timestamp;
        }

        const deltaTime = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;

        // Accumulate time
        this.accumulatedTime += deltaTime;

        // Check if we should advance to next word
        if (this.accumulatedTime >= this.currentTokenDuration) {
            this.accumulatedTime -= this.currentTokenDuration;
            this.currentIndex++;

            // Check for completion
            if (this.currentIndex >= this.tokens.length) {
                this.currentIndex = this.tokens.length - 1;
                this.pause();
                this.onComplete();
                return;
            }

            // Update duration for new token
            this.currentTokenDuration = getDisplayDuration(this.tokens[this.currentIndex], this.wpm);

            this.emitTick();
            this.emitProgress();
        }

        // Schedule next frame
        this.rafId = requestAnimationFrame((ts) => this.tick(ts));
    }

    /**
     * Handle page visibility change (iOS backgrounding)
     */
    handleVisibilityChange() {
        if (document.hidden) {
            // Page is hidden - pause and remember state
            this.wasPlayingBeforeHidden = this.isPlaying;
            if (this.isPlaying) {
                this.pause();
            }
        } else {
            // Page is visible again
            // Reset timing to avoid jumps
            this.lastTimestamp = null;
            this.accumulatedTime = 0;

            // Optionally auto-resume (user preference)
            // For now, don't auto-resume - let user tap play
        }
    }

    /**
     * Handle page freeze (aggressive iOS backgrounding)
     */
    handleFreeze() {
        this.wasPlayingBeforeHidden = this.isPlaying;
        this.pause();
    }

    /**
     * Handle page resume
     */
    handleResume() {
        this.lastTimestamp = null;
        this.accumulatedTime = 0;
    }

    /**
     * Emit tick callback
     */
    emitTick() {
        if (this.tokens[this.currentIndex]) {
            this.onTick(this.tokens[this.currentIndex], this.currentIndex);
        }
    }

    /**
     * Emit progress callback
     */
    emitProgress() {
        const percent = this.tokens.length > 0
            ? (this.currentIndex / this.tokens.length) * 100
            : 0;
        this.onProgress(percent);
    }

    /**
     * Emit state change callback
     */
    emitStateChange() {
        this.onStateChange({
            isPlaying: this.isPlaying,
            currentIndex: this.currentIndex,
            wpm: this.wpm,
            mode: this.mode
        });
    }

    /**
     * Get current state
     * @returns {PlaybackState}
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            currentIndex: this.currentIndex,
            wpm: this.wpm,
            mode: this.mode
        };
    }

    /**
     * Get progress info
     * @returns {{current: number, total: number, percent: number}}
     */
    getProgress() {
        return {
            current: this.currentIndex + 1,
            total: this.tokens.length,
            percent: this.tokens.length > 0
                ? (this.currentIndex / this.tokens.length) * 100
                : 0
        };
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        this.pause();
        document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
}

export { PlaybackController };

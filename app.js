/**
 * Speed Reader - Main Application
 * RSVP Reader with gesture-based controls
 */

import { PersistenceLayer, generateDocumentId } from './src/persistence.js';
import { tokenize, getDisplayDuration, estimateReadingTime, formatTime } from './src/engine/tokenizer.js';
import { PlaybackController } from './src/engine/playback.js';
import { parseEpub, isEpubFile } from './src/importers/epub.js';

class SpeedReaderApp {
    constructor() {
        // Core state
        this.persistence = new PersistenceLayer();
        this.playback = null;
        this.currentDocument = null;
        this.tokens = [];

        // Settings
        this.settings = {
            defaultWPM: 300,
            fontSize: 48,
            showGuides: true,
            flowMode: false,
            mode: 'reading'
        };

        // Gesture state
        this.gestureState = {
            isDragging: false,
            startY: 0,
            startWPM: 0,
            lastTap: 0
        };

        // Initialize
        this.initElements();
        this.initPlayback();
        this.initEventListeners();
        this.loadSettings();
        this.loadLibrary();
    }

    // ============ Initialization ============

    initElements() {
        // Views
        this.libraryView = document.getElementById('library-view');
        this.readerView = document.getElementById('reader-view');

        // Library elements
        this.importBtn = document.getElementById('import-btn');
        this.fileInput = document.getElementById('file-input');
        this.recentList = document.getElementById('recent-list');
        this.settingsBtn = document.getElementById('settings-btn');

        // Reader elements
        this.backBtn = document.getElementById('back-btn');
        this.docTitle = document.getElementById('doc-title');
        this.readerSettingsBtn = document.getElementById('reader-settings-btn');
        this.rsvpDisplay = document.getElementById('rsvp-display');
        this.wordBefore = document.getElementById('word-before');
        this.wordPivot = document.getElementById('word-pivot');
        this.wordAfter = document.getElementById('word-after');

        // Tap zones
        this.tapLeft = document.getElementById('tap-left');
        this.tapCenter = document.getElementById('tap-center');
        this.tapRight = document.getElementById('tap-right');

        // Progress
        this.progressSlider = document.getElementById('progress-slider');
        this.progressCurrent = document.getElementById('progress-current');
        this.progressTotal = document.getElementById('progress-total');

        // WPM
        this.wpmValue = document.getElementById('wpm-value');
        this.modeIndicator = document.getElementById('mode-indicator');

        // Playback controls
        this.playBtn = document.getElementById('play-btn');
        this.iconPlay = document.getElementById('icon-play');
        this.iconPause = document.getElementById('icon-pause');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.rewindBtn = document.getElementById('rewind-btn');
        this.wpmDownBtn = document.getElementById('wpm-down-btn');
        this.wpmUpBtn = document.getElementById('wpm-up-btn');

        // Settings panel
        this.settingsPanel = document.getElementById('settings-panel');
        this.closeSettingsBtn = document.getElementById('close-settings');
        this.fontSizeSetting = document.getElementById('font-size-setting');
        this.fontSizeLabel = document.getElementById('font-size-label');
        this.defaultWpmSetting = document.getElementById('default-wpm-setting');
        this.showGuidesSetting = document.getElementById('show-guides-setting');
        this.flowModeSetting = document.getElementById('flow-mode-setting');
        this.clearLibraryBtn = document.getElementById('clear-library-btn');
        this.modeToggleBtns = document.querySelectorAll('.toggle-btn[data-mode]');

        // Loading
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingText = document.getElementById('loading-text');
    }

    initPlayback() {
        this.playback = new PlaybackController({
            onTick: (token, index) => this.renderWord(token),
            onComplete: () => this.onPlaybackComplete(),
            onStateChange: (state) => this.updatePlaybackUI(state),
            onProgress: (percent) => this.updateProgress(percent)
        });
    }

    initEventListeners() {
        // File import
        this.importBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Navigation
        this.backBtn.addEventListener('click', () => this.showLibrary());

        // Settings
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.readerSettingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
        this.settingsPanel.addEventListener('click', (e) => {
            if (e.target === this.settingsPanel) this.closeSettings();
        });

        // Settings controls
        this.fontSizeSetting.addEventListener('input', (e) => this.setFontSize(e.target.value));
        this.defaultWpmSetting.addEventListener('change', (e) => this.setDefaultWPM(e.target.value));
        this.showGuidesSetting.addEventListener('change', (e) => this.setShowGuides(e.target.checked));
        this.flowModeSetting.addEventListener('change', (e) => this.setFlowMode(e.target.checked));
        this.clearLibraryBtn.addEventListener('click', () => this.clearLibrary());

        // Mode toggle
        this.modeToggleBtns.forEach(btn => {
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
        });

        // Playback controls
        this.playBtn.addEventListener('click', () => this.playback.toggle());
        this.prevBtn.addEventListener('click', () => this.playback.step(-1));
        this.nextBtn.addEventListener('click', () => this.playback.step(1));
        this.rewindBtn.addEventListener('click', () => this.playback.rewind(10));
        this.wpmDownBtn.addEventListener('click', () => this.playback.adjustWPM(-50));
        this.wpmUpBtn.addEventListener('click', () => this.playback.adjustWPM(50));

        // Progress slider
        this.progressSlider.addEventListener('input', (e) => {
            this.playback.seekPercent(parseFloat(e.target.value));
        });

        // Gesture controls on RSVP display
        this.initGestureControls();

        // Keyboard controls
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
    }

    initGestureControls() {
        // Tap to play/pause (center area)
        this.rsvpDisplay.addEventListener('click', (e) => {
            // Ignore if it's a control button
            if (e.target.closest('.reader-controls') || e.target.closest('.reader-header')) {
                return;
            }
            this.playback.toggle();
            this.showTapFeedback();
        });

        // WPM drag zone (bottom-right area)
        // We'll use the entire display but track position
        let wpmDragZone = this.rsvpDisplay;

        const isInWpmZone = (x, y, rect) => {
            const relX = (x - rect.left) / rect.width;
            const relY = (y - rect.top) / rect.height;
            return relX > 0.75 && relY > 0.55;
        };

        wpmDragZone.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            const rect = wpmDragZone.getBoundingClientRect();

            if (isInWpmZone(touch.clientX, touch.clientY, rect)) {
                e.preventDefault();
                this.startWpmDrag(touch.clientY);
            }
        }, { passive: false });

        wpmDragZone.addEventListener('touchmove', (e) => {
            if (this.gestureState.isDragging) {
                e.preventDefault();
                const touch = e.touches[0];
                this.updateWpmDrag(touch.clientY);
            }
        }, { passive: false });

        wpmDragZone.addEventListener('touchend', () => {
            if (this.gestureState.isDragging) {
                this.endWpmDrag();
            }
        });

        // Swipe gestures
        let swipeStartX = 0;
        let swipeStartY = 0;

        this.rsvpDisplay.addEventListener('touchstart', (e) => {
            if (this.gestureState.isDragging) return;
            const touch = e.touches[0];
            swipeStartX = touch.clientX;
            swipeStartY = touch.clientY;
        });

        this.rsvpDisplay.addEventListener('touchend', (e) => {
            if (this.gestureState.isDragging) return;

            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - swipeStartX;
            const deltaY = touch.clientY - swipeStartY;

            // Only count horizontal swipes
            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
                if (deltaX < 0) {
                    // Swipe left - rewind
                    this.playback.rewind(5);
                } else {
                    // Swipe right - skip forward
                    this.playback.step(5);
                }
            }
        });

        // Long press for overlay (TODO: implement overlay menu)
        let longPressTimer = null;

        this.rsvpDisplay.addEventListener('touchstart', () => {
            longPressTimer = setTimeout(() => {
                // Show overlay menu
                // For now, just open settings
                this.openSettings();
            }, 800);
        });

        this.rsvpDisplay.addEventListener('touchend', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        this.rsvpDisplay.addEventListener('touchmove', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });
    }

    // ============ WPM Drag Gesture ============

    startWpmDrag(y) {
        this.gestureState.isDragging = true;
        this.gestureState.startY = y;
        this.gestureState.startWPM = this.playback.wpm;

        // Show WPM overlay
        this.showWpmOverlay();
    }

    updateWpmDrag(y) {
        const deltaY = this.gestureState.startY - y; // Inverted: drag up = faster
        const wpmDelta = Math.round(deltaY / 2); // 2px per WPM

        const newWPM = Math.round((this.gestureState.startWPM + wpmDelta) / 10) * 10;
        this.playback.setWPM(newWPM);

        this.updateWpmOverlay();
    }

    endWpmDrag() {
        this.gestureState.isDragging = false;
        this.hideWpmOverlay();
        this.saveProgress();
    }

    showWpmOverlay() {
        // Create overlay if not exists
        let overlay = document.getElementById('wpm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'wpm-overlay';
            overlay.innerHTML = `
                <div class="wpm-overlay-content">
                    <span class="wpm-overlay-label">Flow speed</span>
                    <span class="wpm-overlay-value">${this.playback.wpm}</span>
                </div>
            `;
            overlay.style.cssText = `
                position: fixed;
                bottom: 30%;
                right: 10%;
                background: rgba(0,0,0,0.8);
                padding: 16px 24px;
                border-radius: 12px;
                z-index: 50;
                text-align: center;
                transition: opacity 0.3s;
            `;
            document.body.appendChild(overlay);
        }
        overlay.style.opacity = '1';
        overlay.style.display = 'block';
    }

    updateWpmOverlay() {
        const overlay = document.getElementById('wpm-overlay');
        if (overlay) {
            overlay.querySelector('.wpm-overlay-value').textContent = this.playback.wpm;
        }
    }

    hideWpmOverlay() {
        const overlay = document.getElementById('wpm-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }
    }

    showTapFeedback() {
        // Brief pulse on the display
        this.rsvpDisplay.style.transition = 'background 0.1s';
        this.rsvpDisplay.style.background = 'rgba(255,255,255,0.02)';
        setTimeout(() => {
            this.rsvpDisplay.style.background = '';
        }, 100);
    }

    // ============ Keyboard Controls ============

    handleKeydown(e) {
        // Ignore when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Only handle in reader view
        if (!this.readerView.classList.contains('active')) {
            return;
        }

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                this.playback.toggle();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.playback.step(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.playback.step(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.playback.adjustWPM(50);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.playback.adjustWPM(-50);
                break;
            case 'Escape':
                e.preventDefault();
                if (this.settingsPanel.classList.contains('open')) {
                    this.closeSettings();
                } else {
                    this.showLibrary();
                }
                break;
        }
    }

    // ============ Word Rendering ============

    renderWord(token) {
        if (!token) {
            this.wordBefore.textContent = '';
            this.wordPivot.textContent = '';
            this.wordAfter.textContent = '';
            return;
        }

        const { word, orpIndex } = token;

        this.wordBefore.textContent = word.substring(0, orpIndex);
        this.wordPivot.textContent = word.charAt(orpIndex);
        this.wordAfter.textContent = word.substring(orpIndex + 1);
    }

    // ============ UI Updates ============

    updatePlaybackUI(state) {
        // Play/pause icons
        this.iconPlay.style.display = state.isPlaying ? 'none' : 'block';
        this.iconPause.style.display = state.isPlaying ? 'block' : 'none';

        // WPM display
        this.wpmValue.textContent = state.wpm;
        this.modeIndicator.textContent = state.mode;
    }

    updateProgress(percent) {
        this.progressSlider.value = percent;

        const progress = this.playback.getProgress();
        this.progressCurrent.textContent = progress.current;
        this.progressTotal.textContent = progress.total;
    }

    // ============ File Import ============

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        this.showLoading('Processing file...');

        try {
            const docId = await generateDocumentId(file);
            const extension = file.name.split('.').pop().toLowerCase();

            let content, metadata;

            switch (extension) {
                case 'epub':
                    this.showLoading('Parsing EPUB...');
                    const epub = await parseEpub(file);
                    content = epub.text;
                    metadata = epub.metadata;
                    break;

                case 'txt':
                    content = await file.text();
                    metadata = { title: file.name.replace(/\.txt$/i, ''), author: '' };
                    break;

                case 'html':
                case 'htm':
                    const html = await file.text();
                    content = this.parseHTML(html);
                    metadata = { title: file.name.replace(/\.html?$/i, ''), author: '' };
                    break;

                case 'pdf':
                    this.showLoading('Parsing PDF...');
                    content = await this.parsePDF(file);
                    metadata = { title: file.name.replace(/\.pdf$/i, ''), author: '' };
                    break;

                default:
                    throw new Error('Unsupported file format');
            }

            // Tokenize
            this.showLoading('Tokenizing...');
            this.tokens = tokenize(content, this.settings.mode);

            // Create document record
            const doc = {
                id: docId,
                title: metadata.title || file.name,
                author: metadata.author || '',
                sourceType: extension,
                fileName: file.name,
                fileSize: file.size,
                wordCount: this.tokens.length,
                addedAt: Date.now(),
                lastOpened: Date.now(),
                progress: {
                    currentIndex: 0,
                    wpm: this.settings.defaultWPM,
                    mode: this.settings.mode,
                    updatedAt: Date.now()
                }
            };

            // Save to persistence
            await this.persistence.saveDocument(doc);
            await this.persistence.saveTokens(docId, this.tokens);

            this.currentDocument = doc;

            // Open reader
            this.hideLoading();
            this.openReader(doc);

        } catch (error) {
            console.error('Import error:', error);
            this.hideLoading();
            alert('Error importing file: ' + error.message);
        }

        // Clear file input
        this.fileInput.value = '';
    }

    parseHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove non-content elements
        const remove = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
        remove.forEach(tag => {
            doc.querySelectorAll(tag).forEach(el => el.remove());
        });

        const main = doc.querySelector('article, main, .content') || doc.body;
        return main.textContent || '';
    }

    async parsePDF(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js not loaded');
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n\n';
        }

        return text;
    }

    // ============ Library Management ============

    async loadLibrary() {
        try {
            const docs = await this.persistence.getRecentDocuments(20);
            this.renderLibrary(docs);
        } catch (error) {
            console.error('Error loading library:', error);
        }
    }

    renderLibrary(docs) {
        if (docs.length === 0) {
            this.recentList.innerHTML = '<p class="empty-state">No documents yet</p>';
            return;
        }

        this.recentList.innerHTML = docs.map(doc => {
            const progress = doc.progress || {};
            const percent = doc.wordCount > 0
                ? Math.round((progress.currentIndex || 0) / doc.wordCount * 100)
                : 0;

            return `
                <div class="recent-item" data-doc-id="${doc.id}">
                    <div class="recent-item-title">${this.escapeHtml(doc.title)}</div>
                    <div class="recent-item-meta">
                        <span>${doc.author || doc.sourceType.toUpperCase()}</span>
                        <span>${this.formatWordCount(doc.wordCount)}</span>
                    </div>
                    <div class="recent-item-progress">
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width: ${percent}%"></div>
                        </div>
                        <span>${percent}%</span>
                    </div>
                    <div class="recent-item-actions">
                        <button class="btn-resume" data-action="resume">Resume</button>
                        <button class="btn-restart" data-action="restart">Restart</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers
        this.recentList.querySelectorAll('.recent-item').forEach(item => {
            const docId = item.dataset.docId;

            item.querySelector('.btn-resume').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDocumentById(docId, true);
            });

            item.querySelector('.btn-restart').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDocumentById(docId, false);
            });
        });
    }

    async openDocumentById(docId, resume = true) {
        this.showLoading('Loading document...');

        try {
            const doc = await this.persistence.getDocument(docId);
            if (!doc) {
                throw new Error('Document not found');
            }

            // Try to load cached tokens
            let tokens = await this.persistence.getTokens(docId);

            if (!tokens) {
                // No cached tokens - would need to re-import
                // For now, show error
                throw new Error('Document data not found. Please re-import the file.');
            }

            this.tokens = tokens;
            this.currentDocument = doc;

            // Update last opened
            doc.lastOpened = Date.now();
            await this.persistence.saveDocument(doc);

            this.hideLoading();
            this.openReader(doc, resume);

        } catch (error) {
            console.error('Error opening document:', error);
            this.hideLoading();
            alert(error.message);
        }
    }

    // ============ Reader ============

    openReader(doc, resume = true) {
        this.currentDocument = doc;
        this.docTitle.textContent = doc.title;

        // Load playback
        const startIndex = resume && doc.progress ? doc.progress.currentIndex : 0;
        const wpm = doc.progress?.wpm || this.settings.defaultWPM;
        const mode = doc.progress?.mode || this.settings.mode;

        this.playback.load(this.tokens, startIndex);
        this.playback.setWPM(wpm);
        this.playback.setMode(mode);

        // Update UI
        this.progressTotal.textContent = this.tokens.length;

        // Show reader view
        this.showReader();
    }

    onPlaybackComplete() {
        // Optionally show completion message
        this.saveProgress();
    }

    async saveProgress() {
        if (!this.currentDocument) return;

        const state = this.playback.getState();
        await this.persistence.updateProgress(this.currentDocument.id, {
            currentIndex: state.currentIndex,
            wpm: state.wpm,
            mode: state.mode
        });
    }

    // ============ View Navigation ============

    showLibrary() {
        // Save progress before leaving
        this.saveProgress();
        this.playback.pause();

        this.libraryView.classList.add('active');
        this.readerView.classList.remove('active');

        // Refresh library
        this.loadLibrary();
    }

    showReader() {
        this.libraryView.classList.remove('active');
        this.readerView.classList.add('active');
    }

    // ============ Settings ============

    async loadSettings() {
        try {
            const saved = await this.persistence.getAllSettings();
            this.settings = { ...this.settings, ...saved };

            // Apply settings to UI
            this.applySettings();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    applySettings() {
        // Font size
        document.documentElement.style.setProperty('--word-font-size', `${this.settings.fontSize}px`);
        this.fontSizeSetting.value = this.settings.fontSize;
        this.fontSizeLabel.textContent = `${this.settings.fontSize}px`;

        // Default WPM
        this.defaultWpmSetting.value = this.settings.defaultWPM;

        // Guides
        this.showGuidesSetting.checked = this.settings.showGuides;
        this.rsvpDisplay?.classList.toggle('hide-guides', !this.settings.showGuides);

        // Flow mode
        this.flowModeSetting.checked = this.settings.flowMode;
        this.readerView?.classList.toggle('flow-mode', this.settings.flowMode);

        // Mode toggle
        this.modeToggleBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === this.settings.mode);
        });
    }

    async setFontSize(size) {
        this.settings.fontSize = parseInt(size);
        document.documentElement.style.setProperty('--word-font-size', `${size}px`);
        this.fontSizeLabel.textContent = `${size}px`;
        await this.persistence.saveSetting('fontSize', this.settings.fontSize);
    }

    async setDefaultWPM(wpm) {
        this.settings.defaultWPM = parseInt(wpm);
        await this.persistence.saveSetting('defaultWPM', this.settings.defaultWPM);
    }

    async setShowGuides(show) {
        this.settings.showGuides = show;
        this.rsvpDisplay.classList.toggle('hide-guides', !show);
        await this.persistence.saveSetting('showGuides', show);
    }

    async setFlowMode(enabled) {
        this.settings.flowMode = enabled;
        this.readerView.classList.toggle('flow-mode', enabled);
        await this.persistence.saveSetting('flowMode', enabled);
    }

    async setMode(mode) {
        this.settings.mode = mode;
        this.playback.setMode(mode);

        this.modeToggleBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        await this.persistence.saveSetting('mode', mode);
    }

    openSettings() {
        this.settingsPanel.classList.add('open');
    }

    closeSettings() {
        this.settingsPanel.classList.remove('open');
    }

    async clearLibrary() {
        if (!confirm('This will delete all documents from your library. Continue?')) {
            return;
        }

        try {
            const docs = await this.persistence.getRecentDocuments(100);
            for (const doc of docs) {
                await this.persistence.deleteDocument(doc.id);
            }
            this.loadLibrary();
            this.closeSettings();
        } catch (error) {
            console.error('Error clearing library:', error);
        }
    }

    // ============ Utilities ============

    showLoading(text = 'Loading...') {
        this.loadingText.textContent = text;
        this.loadingOverlay.classList.add('show');
    }

    hideLoading() {
        this.loadingOverlay.classList.remove('show');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatWordCount(count) {
        if (count >= 1000) {
            return (count / 1000).toFixed(1) + 'k words';
        }
        return count + ' words';
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SpeedReaderApp();
});

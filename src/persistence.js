/**
 * Persistence Layer
 * IndexedDB-backed storage for library, tokens cache, and settings
 */

const DB_NAME = 'speed-reader-db';
const DB_VERSION = 1;

class PersistenceLayer {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Library store: document metadata
                if (!db.objectStoreNames.contains('library')) {
                    const libraryStore = db.createObjectStore('library', { keyPath: 'id' });
                    libraryStore.createIndex('lastOpened', 'lastOpened', { unique: false });
                    libraryStore.createIndex('title', 'title', { unique: false });
                }

                // Tokens cache: pre-tokenized documents
                if (!db.objectStoreNames.contains('tokens')) {
                    db.createObjectStore('tokens', { keyPath: 'docId' });
                }

                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    // ============ Library Operations ============

    /**
     * Save or update a document in the library
     * @param {DocumentMeta} doc
     */
    async saveDocument(doc) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('library', 'readwrite');
            const store = tx.objectStore('library');
            const request = store.put(doc);
            request.onsuccess = () => resolve(doc);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a document by ID
     * @param {string} id
     */
    async getDocument(id) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('library', 'readonly');
            const store = tx.objectStore('library');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all documents, sorted by lastOpened (most recent first)
     * @param {number} limit
     */
    async getRecentDocuments(limit = 20) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('library', 'readonly');
            const store = tx.objectStore('library');
            const index = store.index('lastOpened');
            const request = index.openCursor(null, 'prev');

            const results = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a document from the library
     * @param {string} id
     */
    async deleteDocument(id) {
        await this.ready;

        // Delete from both library and tokens cache
        const tx = this.db.transaction(['library', 'tokens'], 'readwrite');

        return new Promise((resolve, reject) => {
            tx.objectStore('library').delete(id);
            tx.objectStore('tokens').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Update reading progress for a document
     * @param {string} docId
     * @param {ProgressData} progress
     */
    async updateProgress(docId, progress) {
        await this.ready;
        const doc = await this.getDocument(docId);
        if (!doc) return null;

        doc.progress = {
            ...doc.progress,
            ...progress,
            updatedAt: Date.now()
        };
        doc.lastOpened = Date.now();

        return this.saveDocument(doc);
    }

    // ============ Tokens Cache Operations ============

    /**
     * Save tokenized document to cache
     * @param {string} docId
     * @param {Token[]} tokens
     */
    async saveTokens(docId, tokens) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tokens', 'readwrite');
            const store = tx.objectStore('tokens');
            const request = store.put({ docId, tokens, cachedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cached tokens for a document
     * @param {string} docId
     */
    async getTokens(docId) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tokens', 'readonly');
            const store = tx.objectStore('tokens');
            const request = store.get(docId);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.tokens : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ============ Settings Operations ============

    /**
     * Save a setting
     * @param {string} key
     * @param {any} value
     */
    async saveSetting(key, value) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a setting
     * @param {string} key
     * @param {any} defaultValue
     */
    async getSetting(key, defaultValue = null) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : defaultValue);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all settings as an object
     */
    async getAllSettings() {
        await this.ready;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.getAll();
            request.onsuccess = () => {
                const settings = {};
                request.result.forEach(item => {
                    settings[item.key] = item.value;
                });
                resolve(settings);
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Generate a stable document ID from file content
async function generateDocumentId(file) {
    // Use file name + size + last modified as a quick hash
    // For true content-based hashing, we'd need to read the file
    const input = `${file.name}-${file.size}-${file.lastModified}`;

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }

    return `doc_${Math.abs(hash).toString(16)}`;
}

/**
 * @typedef {Object} DocumentMeta
 * @property {string} id - Unique document identifier
 * @property {string} title - Document title
 * @property {string} author - Document author (if available)
 * @property {string} sourceType - 'epub' | 'pdf' | 'txt' | 'html'
 * @property {string} fileName - Original file name
 * @property {number} fileSize - File size in bytes
 * @property {number} wordCount - Total word count
 * @property {number} addedAt - Timestamp when added to library
 * @property {number} lastOpened - Timestamp of last access
 * @property {ProgressData} progress - Reading progress
 */

/**
 * @typedef {Object} ProgressData
 * @property {number} currentIndex - Current word index
 * @property {number} wpm - Last used WPM
 * @property {string} mode - 'reading' | 'skim'
 * @property {number} updatedAt - Last update timestamp
 */

export { PersistenceLayer, generateDocumentId };

/**
 * Tokenizer Engine
 * Converts raw text into a structured token stream with ORP and timing data
 */

/**
 * @typedef {Object} Token
 * @property {string} word - The display word
 * @property {number} orpIndex - Index of pivot character (0-based)
 * @property {number} baseDurationMs - Base display time (before WPM scaling)
 * @property {TokenFlags} flags - Metadata for timing adjustments
 */

/**
 * @typedef {Object} TokenFlags
 * @property {boolean} isParagraphStart
 * @property {boolean} isParagraphEnd
 * @property {'none'|'minor'|'major'|'terminal'} punctuation
 * @property {boolean} isLongWord - > 8 chars
 * @property {boolean} isNumeric
 * @property {boolean} isAbbreviation
 */

// Punctuation classification
const TERMINAL_PUNCT = /[.!?…]+$/;
const MAJOR_PUNCT = /[:;—–]+$/;
const MINOR_PUNCT = /[,()'""\-]+$/;

// Patterns
const ABBREVIATION_PATTERN = /^([A-Z]\.)+$/;
const NUMERIC_PATTERN = /^[\d,.$%]+$/;
const LONG_WORD_THRESHOLD = 8;

/**
 * Calculate the Optimal Recognition Point (ORP) index for a word
 * Research suggests fixation point is slightly left of center (~25-30%)
 *
 * @param {string} word
 * @returns {number} 0-based index of the pivot character
 */
function calculateORP(word) {
    // Strip any trailing punctuation for length calculation
    const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');
    const len = cleanWord.length;

    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;

    // Alternative formula: Math.max(0, Math.floor((len - 2) / 4))
}

/**
 * Find the ORP index in the original word (accounting for leading punctuation)
 * @param {string} word
 * @returns {number}
 */
function findORPInWord(word) {
    // Find where the actual letters start (skip leading punctuation/quotes)
    const leadingMatch = word.match(/^[^a-zA-Z0-9]*/);
    const leadingOffset = leadingMatch ? leadingMatch[0].length : 0;

    // Calculate ORP on the clean word
    const cleanWord = word.slice(leadingOffset).replace(/[^a-zA-Z0-9]/g, '');
    const orpInClean = calculateORP(cleanWord);

    // Map back to original word position
    let cleanIndex = 0;
    for (let i = leadingOffset; i < word.length; i++) {
        if (/[a-zA-Z0-9]/.test(word[i])) {
            if (cleanIndex === orpInClean) {
                return i;
            }
            cleanIndex++;
        }
    }

    return leadingOffset; // Fallback
}

/**
 * Classify punctuation type at end of word
 * @param {string} word
 * @returns {'none'|'minor'|'major'|'terminal'}
 */
function classifyPunctuation(word) {
    if (TERMINAL_PUNCT.test(word)) return 'terminal';
    if (MAJOR_PUNCT.test(word)) return 'major';
    if (MINOR_PUNCT.test(word)) return 'minor';
    return 'none';
}

/**
 * Create flags for a token
 * @param {string} word
 * @param {boolean} isParagraphStart
 * @param {boolean} isParagraphEnd
 * @returns {TokenFlags}
 */
function createFlags(word, isParagraphStart, isParagraphEnd) {
    const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');

    return {
        isParagraphStart,
        isParagraphEnd,
        punctuation: classifyPunctuation(word),
        isLongWord: cleanWord.length > LONG_WORD_THRESHOLD,
        isNumeric: NUMERIC_PATTERN.test(word),
        isAbbreviation: ABBREVIATION_PATTERN.test(word)
    };
}

/**
 * Timing configuration for different modes
 */
const TIMING_CONFIGS = {
    reading: {
        // Base duration multipliers
        longWordMultiplier: 1.2,
        minorPunctMultiplier: 1.3,
        majorPunctMultiplier: 1.6,
        terminalPunctMultiplier: 2.0,
        paragraphEndMultiplier: 2.5,
        paragraphStartMultiplier: 1.3,
        // Abbreviations and numbers get extra time
        abbreviationMultiplier: 1.4,
        numericMultiplier: 1.3
    },
    skim: {
        longWordMultiplier: 1.0,
        minorPunctMultiplier: 1.1,
        majorPunctMultiplier: 1.2,
        terminalPunctMultiplier: 1.4,
        paragraphEndMultiplier: 1.6,
        paragraphStartMultiplier: 1.1,
        abbreviationMultiplier: 1.1,
        numericMultiplier: 1.1
    }
};

/**
 * Calculate base duration for a token (at "1x" speed, ~200 WPM baseline)
 * Actual display time = baseDuration * (200 / currentWPM)
 *
 * @param {TokenFlags} flags
 * @param {string} mode - 'reading' | 'skim'
 * @returns {number} Duration in ms at baseline speed
 */
function calculateBaseDuration(flags, mode = 'reading') {
    const config = TIMING_CONFIGS[mode] || TIMING_CONFIGS.reading;

    // Base: 300ms at 200 WPM
    const BASE_MS = 300;
    let multiplier = 1.0;

    // Word characteristics
    if (flags.isLongWord) multiplier *= config.longWordMultiplier;
    if (flags.isAbbreviation) multiplier *= config.abbreviationMultiplier;
    if (flags.isNumeric) multiplier *= config.numericMultiplier;

    // Punctuation (applied cumulatively with paragraph)
    switch (flags.punctuation) {
        case 'minor':
            multiplier *= config.minorPunctMultiplier;
            break;
        case 'major':
            multiplier *= config.majorPunctMultiplier;
            break;
        case 'terminal':
            multiplier *= config.terminalPunctMultiplier;
            break;
    }

    // Paragraph boundaries
    if (flags.isParagraphEnd) multiplier *= config.paragraphEndMultiplier;
    if (flags.isParagraphStart) multiplier *= config.paragraphStartMultiplier;

    return Math.round(BASE_MS * multiplier);
}

/**
 * Split text into paragraphs
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoParagraphs(text) {
    // Normalize line endings and split on double newlines
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

/**
 * Split a paragraph into words
 * Handles hyphenation, numbers, abbreviations
 * @param {string} paragraph
 * @returns {string[]}
 */
function splitIntoWords(paragraph) {
    // Normalize whitespace
    const normalized = paragraph.replace(/\s+/g, ' ').trim();

    // Split on spaces but keep punctuation attached to words
    return normalized.split(' ').filter(w => w.length > 0);
}

/**
 * Main tokenization function
 * @param {string} text - Raw text to tokenize
 * @param {string} mode - 'reading' | 'skim'
 * @returns {Token[]}
 */
function tokenize(text, mode = 'reading') {
    const tokens = [];
    const paragraphs = splitIntoParagraphs(text);

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const paragraph = paragraphs[pIdx];
        const words = splitIntoWords(paragraph);

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
            const word = words[wIdx];
            const isParagraphStart = wIdx === 0;
            const isParagraphEnd = wIdx === words.length - 1;

            const flags = createFlags(word, isParagraphStart, isParagraphEnd);

            tokens.push({
                word,
                orpIndex: findORPInWord(word),
                baseDurationMs: calculateBaseDuration(flags, mode),
                flags
            });
        }
    }

    return tokens;
}

/**
 * Calculate actual display duration for a token at a given WPM
 * @param {Token} token
 * @param {number} wpm
 * @returns {number} Duration in milliseconds
 */
function getDisplayDuration(token, wpm) {
    // baseDurationMs is calibrated for 200 WPM
    // Scale inversely with WPM
    const BASE_WPM = 200;
    return Math.round(token.baseDurationMs * (BASE_WPM / wpm));
}

/**
 * Estimate total reading time
 * @param {Token[]} tokens
 * @param {number} wpm
 * @returns {number} Time in seconds
 */
function estimateReadingTime(tokens, wpm) {
    const totalMs = tokens.reduce((sum, token) => sum + getDisplayDuration(token, wpm), 0);
    return Math.round(totalMs / 1000);
}

/**
 * Format seconds as MM:SS or HH:MM:SS
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export {
    tokenize,
    calculateORP,
    findORPInWord,
    getDisplayDuration,
    estimateReadingTime,
    formatTime,
    TIMING_CONFIGS
};

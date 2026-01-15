/**
 * EPUB Importer
 * Extracts clean reading text from EPUB files in proper reading order
 */

/**
 * @typedef {Object} EpubMetadata
 * @property {string} title
 * @property {string} author
 * @property {string} language
 * @property {string} publisher
 * @property {string} description
 */

/**
 * @typedef {Object} EpubContent
 * @property {EpubMetadata} metadata
 * @property {string} text - Full extracted text
 * @property {number} wordCount
 */

/**
 * Parse an EPUB file and extract text content
 * @param {File} file - EPUB file from file picker
 * @returns {Promise<EpubContent>}
 */
async function parseEpub(file) {
    // Dynamically load JSZip if not present
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library required for EPUB parsing');
    }

    const zip = await JSZip.loadAsync(file);

    // Step 1: Find and parse container.xml
    const containerPath = 'META-INF/container.xml';
    const containerXml = await zip.file(containerPath)?.async('string');

    if (!containerXml) {
        throw new Error('Invalid EPUB: missing container.xml');
    }

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'text/xml');
    const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');

    if (!rootfilePath) {
        throw new Error('Invalid EPUB: cannot locate content file');
    }

    // Step 2: Parse the OPF (Open Packaging Format) file
    const opfContent = await zip.file(rootfilePath)?.async('string');

    if (!opfContent) {
        throw new Error('Invalid EPUB: cannot read OPF file');
    }

    const opfDoc = parser.parseFromString(opfContent, 'text/xml');

    // Get base path for resolving relative URLs
    const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

    // Step 3: Extract metadata
    const metadata = extractMetadata(opfDoc);

    // Step 4: Build manifest (id -> href mapping)
    const manifest = buildManifest(opfDoc);

    // Step 5: Get spine items in reading order
    const spineItems = getSpineItems(opfDoc, manifest);

    // Step 6: Extract text from each spine item
    const textParts = [];

    for (const item of spineItems) {
        const filePath = resolvePath(basePath, item.href);
        const content = await zip.file(filePath)?.async('string');

        if (content) {
            const text = extractTextFromXhtml(content);
            if (text.trim()) {
                textParts.push(text);
            }
        }
    }

    const fullText = textParts.join('\n\n');
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    return {
        metadata,
        text: fullText,
        wordCount
    };
}

/**
 * Extract metadata from OPF document
 * @param {Document} opfDoc
 * @returns {EpubMetadata}
 */
function extractMetadata(opfDoc) {
    // Handle both EPUB 2 and EPUB 3 namespaces
    const dcNS = 'http://purl.org/dc/elements/1.1/';

    const getMetaValue = (tagName) => {
        // Try with namespace
        let el = opfDoc.getElementsByTagNameNS(dcNS, tagName)[0];
        // Fallback to non-namespaced
        if (!el) {
            el = opfDoc.querySelector(`metadata ${tagName}, metadata dc\\:${tagName}`);
        }
        return el?.textContent?.trim() || '';
    };

    return {
        title: getMetaValue('title') || 'Untitled',
        author: getMetaValue('creator') || 'Unknown Author',
        language: getMetaValue('language') || 'en',
        publisher: getMetaValue('publisher') || '',
        description: getMetaValue('description') || ''
    };
}

/**
 * Build manifest from OPF document
 * @param {Document} opfDoc
 * @returns {Map<string, {href: string, mediaType: string}>}
 */
function buildManifest(opfDoc) {
    const manifest = new Map();
    const items = opfDoc.querySelectorAll('manifest item');

    items.forEach(item => {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        const mediaType = item.getAttribute('media-type');

        if (id && href) {
            manifest.set(id, { href, mediaType });
        }
    });

    return manifest;
}

/**
 * Get spine items in reading order
 * @param {Document} opfDoc
 * @param {Map} manifest
 * @returns {Array<{href: string, linear: boolean}>}
 */
function getSpineItems(opfDoc, manifest) {
    const items = [];
    const itemrefs = opfDoc.querySelectorAll('spine itemref');

    itemrefs.forEach(itemref => {
        const idref = itemref.getAttribute('idref');
        const linear = itemref.getAttribute('linear') !== 'no';

        const manifestItem = manifest.get(idref);
        if (manifestItem && isTextContent(manifestItem.mediaType)) {
            items.push({
                href: manifestItem.href,
                linear
            });
        }
    });

    return items;
}

/**
 * Check if media type is text content we should extract
 * @param {string} mediaType
 * @returns {boolean}
 */
function isTextContent(mediaType) {
    const textTypes = [
        'application/xhtml+xml',
        'text/html',
        'application/html',
        'text/xml'
    ];
    return textTypes.includes(mediaType);
}

/**
 * Resolve a potentially relative path against a base
 * @param {string} base
 * @param {string} href
 * @returns {string}
 */
function resolvePath(base, href) {
    // Handle absolute paths
    if (href.startsWith('/')) {
        return href.slice(1);
    }

    // Handle relative paths
    if (href.startsWith('../')) {
        // Go up directories
        const baseParts = base.split('/').filter(p => p);
        const hrefParts = href.split('/');

        while (hrefParts[0] === '..') {
            baseParts.pop();
            hrefParts.shift();
        }

        return [...baseParts, ...hrefParts].join('/');
    }

    return base + href;
}

/**
 * Extract clean text from XHTML content
 * @param {string} xhtml
 * @returns {string}
 */
function extractTextFromXhtml(xhtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, 'text/html');

    // Remove elements that shouldn't be read
    const removeSelectors = [
        'script',
        'style',
        'nav',
        'aside',
        'figure figcaption',  // Keep figures, remove captions
        '.pagebreak',
        '.page-break',
        '[role="navigation"]',
        '[role="contentinfo"]',
        '[epub\\:type="pagebreak"]',
        '[epub\\:type="footnote"]'
    ];

    removeSelectors.forEach(selector => {
        try {
            doc.querySelectorAll(selector).forEach(el => el.remove());
        } catch (e) {
            // Some selectors may not be valid in all browsers
        }
    });

    // Process the body
    const body = doc.body || doc.documentElement;

    // Convert to text with proper paragraph handling
    return extractTextWithParagraphs(body);
}

/**
 * Extract text preserving paragraph structure
 * @param {Element} element
 * @returns {string}
 */
function extractTextWithParagraphs(element) {
    const blocks = [];
    const blockElements = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article']);

    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) {
                return text;
            }
            return '';
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();

            // Skip hidden elements
            if (node.hidden || node.style?.display === 'none') {
                return '';
            }

            const childTexts = [];
            for (const child of node.childNodes) {
                const text = processNode(child);
                if (text) {
                    childTexts.push(text);
                }
            }

            const combined = childTexts.join(' ').replace(/\s+/g, ' ').trim();

            if (blockElements.has(tagName) && combined) {
                blocks.push(combined);
                return '';
            }

            return combined;
        }

        return '';
    }

    processNode(element);

    // Join blocks with double newlines to preserve paragraph structure
    return blocks.join('\n\n');
}

/**
 * Validate that a file is an EPUB
 * @param {File} file
 * @returns {boolean}
 */
function isEpubFile(file) {
    // Check extension
    if (file.name.toLowerCase().endsWith('.epub')) {
        return true;
    }

    // Check MIME type
    if (file.type === 'application/epub+zip') {
        return true;
    }

    return false;
}

export { parseEpub, isEpubFile };

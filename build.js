#!/usr/bin/env node
/**
 * Build script for Red Read PWA
 * Copies all necessary files to dist/ for static deployment
 *
 * Usage: node build.js
 * Output: dist/ folder ready for Cloudflare Pages / Netlify / GitHub Pages
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = __dirname;
const DIST_DIR = path.join(__dirname, 'dist');

// Files to copy to dist
const FILES = [
    'index.html',
    'styles.css',
    'sw.js',
    'manifest.json'
];

// Directories to copy
const DIRS = [
    'icons'
];

// Clean dist directory
function cleanDist() {
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true });
    }
    fs.mkdirSync(DIST_DIR, { recursive: true });
    console.log('✓ Cleaned dist/');
}

// Copy a single file
function copyFile(filename) {
    const src = path.join(SOURCE_DIR, filename);
    const dest = path.join(DIST_DIR, filename);

    if (!fs.existsSync(src)) {
        console.warn(`⚠ File not found: ${filename}`);
        return false;
    }

    fs.copyFileSync(src, dest);
    console.log(`✓ Copied ${filename}`);
    return true;
}

// Copy a directory recursively
function copyDir(dirname) {
    const src = path.join(SOURCE_DIR, dirname);
    const dest = path.join(DIST_DIR, dirname);

    if (!fs.existsSync(src)) {
        console.warn(`⚠ Directory not found: ${dirname}`);
        return false;
    }

    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(src);
    for (const file of files) {
        const srcFile = path.join(src, file);
        const destFile = path.join(dest, file);

        if (fs.statSync(srcFile).isDirectory()) {
            copyDir(path.join(dirname, file));
        } else {
            fs.copyFileSync(srcFile, destFile);
        }
    }

    console.log(`✓ Copied ${dirname}/`);
    return true;
}

// Update cache version in service worker
function updateCacheVersion() {
    const swPath = path.join(DIST_DIR, 'sw.js');
    if (!fs.existsSync(swPath)) return;

    let content = fs.readFileSync(swPath, 'utf8');
    const version = `v${Date.now()}`;
    content = content.replace(/speed-reader-v\d+/, `speed-reader-${version}`);
    fs.writeFileSync(swPath, content);
    console.log(`✓ Updated cache version to ${version}`);
}

// Create _headers file for Cloudflare Pages
function createHeaders() {
    const headers = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin

/sw.js
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable
`;
    fs.writeFileSync(path.join(DIST_DIR, '_headers'), headers);
    console.log('✓ Created _headers');
}

// Create _redirects for SPA routing (Netlify)
function createRedirects() {
    const redirects = `# SPA fallback
/*    /index.html   200
`;
    fs.writeFileSync(path.join(DIST_DIR, '_redirects'), redirects);
    console.log('✓ Created _redirects');
}

// Main build function
function build() {
    console.log('Building Red Read PWA...\n');

    cleanDist();

    // Copy files
    for (const file of FILES) {
        copyFile(file);
    }

    // Copy directories
    for (const dir of DIRS) {
        copyDir(dir);
    }

    // Post-processing
    updateCacheVersion();
    createHeaders();
    createRedirects();

    console.log('\n✅ Build complete! Deploy the dist/ folder to your static host.');
    console.log('\nSupported hosts:');
    console.log('  • Cloudflare Pages: npx wrangler pages deploy dist');
    console.log('  • Netlify: netlify deploy --prod --dir=dist');
    console.log('  • GitHub Pages: copy dist/* to gh-pages branch');
}

build();

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import StyleDictionary from 'style-dictionary';

// ---------- HELPERS ----------

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function toKebabCase(str) {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function toCamelCase(str) {
    return str
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
}

// ---------- CONFIG ----------
const getWorkflowContent = (platform) => {
    const p = (platform || 'all').toLowerCase();
    const patterns = [];

    if (p === 'web' || p === 'all') patterns.push('src/styles/*.css src/styles/*.ts');
    if (p === 'android' || p === 'all') patterns.push('tokens/android/*.xml');
    if (p === 'ios' || p === 'all') patterns.push('tokens/ios/*.swift');
    if (p === 'flutter' || p === 'all') patterns.push('tokens/flutter/*.dart');

    const filePattern = patterns.join(' ');

    return `# .github/workflows/build-tokens.yml
name: Orchestra Design System Sync

on:
  push:
    paths:
      - 'tokens/**/*.json'

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-tokens:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Pull latest changes
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git checkout \${{ github.ref_name }} || git checkout -b \${{ github.ref_name }}
          git pull origin \${{ github.ref_name }} --rebase

      - name: Install Dependencies
        run: npm ci

      - name: Run Build Script
        run: npm run tokens

      - name: Debug Output
        run: |
          echo "--- Generated Files ---"
          git status --porcelain

      - name: Commit Design Tokens
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "🎨 Design Token Updates"
          file_pattern: '${filePattern}'
          skip_dirty_check: false
`;
};

// ---------- BUILDERS ----------

async function runBuild(platformArg) {
    const cwd = process.cwd();
    const tokenDir = path.join(cwd, 'tokens');
    const tokenFile = path.join(tokenDir, 'design-tokens.json');

    if (!fs.existsSync(tokenFile)) {
        console.error('❌ design-tokens.json not found!');
        process.exit(1);
    }

    const rawTokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));

    // improved key finding logic
    const keys = Object.keys(rawTokens);
    let primitiveKey = keys.find(k => /primitive|base|core|global/i.test(k));
    // If no explicit primitive key, assume the first one is primitive
    if (!primitiveKey) primitiveKey = keys[0];

    // Find component key (anything that isn't primitive)
    let componentKey = keys.find(k => k !== primitiveKey && /component|brand|semantic|token/i.test(k)) || keys[1];

    if (!primitiveKey || !componentKey) {
        console.error('❌ Could not identify Primitives vs Components/Brands in design-tokens.json');
        console.error(`   Keys found: ${keys.join(', ')}`);
        process.exit(1);
    }

    console.log(`✅ Using Primitives: "${primitiveKey}"`);
    console.log(`✅ Using Components: "${componentKey}"`);

    const primitives = rawTokens[primitiveKey];
    const componentGroup = rawTokens[componentKey];

    // Safety check: Ensure componentGroup is an object
    if (!componentGroup || typeof componentGroup !== 'object') {
        console.error(`❌ Component group "${componentKey}" is empty or not an object.`);
        process.exit(1);
    }

    const brandNames = Object.keys(componentGroup);
    console.log(`🔍 Found brands: ${brandNames.join(', ')}`);

    for (const brand of brandNames) {
        console.log(`\n🏗️  Building brand: ${brand}`);

        // Logic to detect if primitives are nested in modes (e.g. "Mode 1") or flat
        const primitiveKeys = Object.keys(primitives);
        const hasModes = primitiveKeys.some(k => typeof primitives[k] === 'object' && !primitives[k].value && !primitives[k].$value);

        let basePrimitives;
        if (hasModes) {
            const baseMode = primitiveKeys[0];
            console.log(`ℹ️  Flattening references for mode "${baseMode}" to root.`);
            basePrimitives = primitives[baseMode];
        } else {
            console.log(`ℹ️  Primitives appear flat (no modes detected). Using directly.`);
            basePrimitives = primitives;
        }

        // Construct the combined token tree
        // We explicitly nest the brand tokens under their brand name to ensure uniqueness
        const themeTokens = {
            ...basePrimitives,
            [componentKey]: {
                [brand]: componentGroup[brand]
            }
        };

        // Optional debug: show the top-level keys and the brand subtree when TOKENS_DEBUG=1
        if (process.env.TOKENS_DEBUG === '1') {
            console.log(`   [DEBUG] themeTokens keys: ${Object.keys(themeTokens).join(', ')}`);
            if (themeTokens[componentKey] && themeTokens[componentKey][brand]) {
                console.log(`   [DEBUG] brand subtree keys: ${Object.keys(themeTokens[componentKey][brand]).join(', ')}`);
            } else {
                console.log('   [DEBUG] brand subtree: <missing>');
            }
        }
        // Debugging flag to prevent spamming console
        let debugLogged = false;

        // Normalize brand for robust matching (case/format-insensitive)
        const normalizedBrand = toKebabCase(brand);

        const sd = new StyleDictionary({
            tokens: themeTokens,
            platforms: {
                css: {
                    transformGroup: 'css',
                    buildPath: 'src/styles/',
                    files: [{
                        destination: `theme-${toKebabCase(brand)}.css`,
                        format: 'css/variables',
                        options: {
                            outputReferences: false,
                            selector: `[data-theme="${toKebabCase(brand)}"]`
                        },
                        // PRO FIX: Robust filtering + Debugging
                        filter: (token) => {
                            if (!debugLogged && process.env.TOKENS_DEBUG === '1') {
                                console.log(`   [DEBUG] Sample token path: ${token.path.join(' -> ')}`);
                                debugLogged = true;
                            }
                            return token.path.map(p => toKebabCase(String(p))).includes(normalizedBrand);
                        }
                    }]
                },
                ts: {
                    transformGroup: 'js',
                    buildPath: 'src/styles/',
                    files: [{
                        destination: `theme-${toKebabCase(brand)}.ts`,
                        format: 'javascript/es6',
                        // PRO FIX: Robust filtering
                        filter: (token) => token.path.map(p => toKebabCase(String(p))).includes(normalizedBrand)
                    }]
                },
                android: {
                    transformGroup: 'android',
                    buildPath: 'tokens/android/',
                    files: [{
                        destination: `theme_${toKebabCase(brand)}.xml`,
                        format: 'android/resources',
                        filter: (token) => token.path.map(p => toKebabCase(String(p))).includes(normalizedBrand)
                    }]
                },
                ios: {
                    transformGroup: 'ios',
                    buildPath: 'tokens/ios/',
                    files: [{
                        destination: `Theme${toCamelCase(brand)}.swift`,
                        format: 'ios-swift/class.swift',
                        options: {
                            className: `Theme${toCamelCase(brand)}`
                        },
                        filter: (token) => token.path.map(p => toKebabCase(String(p))).includes(normalizedBrand)
                    }]
                },
                flutter: {
                    transformGroup: 'flutter',
                    buildPath: 'tokens/flutter/',
                    files: [{
                        destination: `theme_${toKebabCase(brand)}.dart`,
                        format: 'flutter/class.dart',
                        className: `${toCamelCase(brand)}Theme`,
                        filter: (token) => token.path.map(p => toKebabCase(String(p))).includes(normalizedBrand)
                    }]
                }
            }
        });

        // Platform mapping logic
        const target = (platformArg || 'all').toLowerCase();
        const platformMap = {
            web: ['css', 'ts'],
            android: ['android'],
            ios: ['ios'],
            flutter: ['flutter'],
            all: ['css', 'ts', 'android', 'ios', 'flutter']
        };

        let platformsToBuild = platformMap[target] || (['css', 'ts', 'android', 'ios', 'flutter'].includes(target) ? [target] : []);

        if (platformsToBuild.length === 0) {
            console.warn(`⚠️  Unknown platform argument "${target}". Valid: web, android, ios, flutter, all.`);
        }

        // Ensure directories exist
        platformsToBuild.forEach(p => {
            if (p === 'css' || p === 'ts') ensureDir(path.join(process.cwd(), 'src', 'styles'));
            if (p === 'android') ensureDir(path.join(process.cwd(), 'tokens', 'android'));
            if (p === 'ios') ensureDir(path.join(process.cwd(), 'tokens', 'ios'));
            if (p === 'flutter') ensureDir(path.join(process.cwd(), 'tokens', 'flutter'));
        });

        if (platformsToBuild.length > 0) {
            await Promise.all(platformsToBuild.map(p => sd.buildPlatform(p)));
        }
    }
}

// ---------- COMMANDS ----------

function runInit(platformArg) {
    const cwd = process.cwd();
    const target = platformArg || 'all';

    // 1. Create Workflow File
    const workflowPath = path.join(cwd, '.github', 'workflows', 'design-syncs.yml');
    ensureDir(path.dirname(workflowPath));
    // We overwrite to ensure it matches the new file extensions (e.g. .xml for android)
    fs.writeFileSync(workflowPath, getWorkflowContent(target), 'utf8');
    console.log('✅ Generated/Updated .github/workflows/design-syncs.yml');

    // 2. Add Script to package.json
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            if (!pkg.scripts) pkg.scripts = {};

            // Always update or set the script to match the requested platform
            pkg.scripts.tokens = `orchestra-cli build ${target}`;
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            console.log(`✅ Set "tokens" script in package.json to: orchestra-cli build ${target}`);
        } catch (error) {
            console.error('❌ Failed to parse package.json:', error);
        }
    } else {
        console.warn('⚠️  No package.json found in current directory.');
    }
}

// ---------- MAIN ----------

const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
    runInit(args[1]);
} else if (command === 'build') {
    runBuild(args[1]).catch(err => {
        console.error(err);
        process.exit(1);
    });
} else if (command === 'help' || !command) {
    console.log(`
Usage:
  orchestra-cli init [platform]  Generate GitHub workflow and package.json script
                                 [platform] options: web, android, ios, flutter, all (default)
  
  orchestra-cli build [platform] Build design tokens manually
                                 [platform] options: web, android, ios, flutter, all
`);
} else {
    console.log(`Unknown command: ${command}`);
    process.exit(1);
}

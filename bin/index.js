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

    const keys = Object.keys(rawTokens);
    let primitiveKey = keys.find(k => /primitive|base/i.test(k)) || keys[0];
    let componentKey = keys.find(k => /component|brand|start-up/i.test(k) && k !== primitiveKey) || keys[1];

    if (!primitiveKey || !componentKey) {
        console.error('❌ Could not identify Primitives vs Components/Brands in design-tokens.json');
        process.exit(1);
    }

    console.log(`✅ Using Primitives: "${primitiveKey}"`);
    console.log(`✅ Using Components: "${componentKey}"`);

    const primitives = rawTokens[primitiveKey];
    const componentGroup = rawTokens[componentKey];
    const brandNames = Object.keys(componentGroup);

    console.log(`🔍 Found brands: ${brandNames.join(', ')}`);

    for (const brand of brandNames) {
        console.log(`\n🏗️  Building brand: ${brand}`);

        const primitiveModes = Object.keys(primitives);
        const baseMode = primitiveModes[0];
        const basePrimitives = primitives[baseMode] || primitives;

        const themeTokens = {
            ...basePrimitives,
            [componentKey]: {
                [brand]: componentGroup[brand]
            }
        };

        console.log(`ℹ️  Flattening references for mode "${baseMode}" to root.`);

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
                        filter: (token) => token.path[0] === componentKey
                    }]
                },
                ts: {
                    transformGroup: 'js',
                    buildPath: 'src/styles/',
                    files: [{
                        destination: `theme-${toKebabCase(brand)}.ts`,
                        format: 'javascript/es6',
                        filter: (token) => token.path[0] === componentKey
                    }]
                },
                android: {
                    transformGroup: 'android',
                    buildPath: 'tokens/android/',
                    files: [{
                        destination: `theme_${toKebabCase(brand)}.xml`,
                        format: 'android/resources',
                        filter: (token) => token.path[0] === componentKey
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
                        filter: (token) => token.path[0] === componentKey
                    }]
                },
                flutter: {
                    transformGroup: 'flutter',
                    buildPath: 'tokens/flutter/',
                    files: [{
                        destination: `theme_${toKebabCase(brand)}.dart`,
                        format: 'flutter/class.dart',
                        className: `${brand}Theme`,
                        filter: (token) => token.path[0] === componentKey
                    }]
                }
            }
        });

        // PLATFORM MAPPING logic
        const target = (platformArg || 'all').toLowerCase();

        // Map user-facing arguments to Style Dictionary platform keys
        const platformMap = {
            web: ['css', 'ts'],
            android: ['android'],
            ios: ['ios'],
            flutter: ['flutter'],
            all: ['css', 'ts', 'android', 'ios', 'flutter']
        };

        // Fallback: If user passes 'css' or 'ts' directly (not standard init arg but valid SD key)
        let platformsToBuild = [];
        if (platformMap[target]) {
            platformsToBuild = platformMap[target];
        } else if (['css', 'ts', 'android', 'ios', 'flutter'].includes(target)) {
            platformsToBuild = [target];
        } else {
            console.warn(`⚠️  Unknown platform argument "${target}". Valid: web, android, ios, flutter, all.`);
        }

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

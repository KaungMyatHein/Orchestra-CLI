#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- CONFIG ----------
const WORKFLOW_CONTENT = `# .github/workflows/build-tokens.yml
name: Orchestra Design System Sync

on:
  push:
    paths:
      - 'tokens/**/*.json'

# --- FIX 2: CONCURRENCY ---
# If you push 3 times in a row, this cancels the first 2 runs
# so only the latest (most important) one finishes.
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-tokens:
    runs-on: ubuntu-latest
    permissions:
      contents: write # Required to push changes back

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          # Fetch full history so rebase works correctly
          fetch-depth: 0
          ref: \${{ github.ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          # style-dictionary@5 requires Node >= 22
          node-version: '22'

      # Pull latest main first (before generating untracked files)
      - name: Pull latest changes
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git checkout \${{ github.ref_name }} || git checkout -b \${{ github.ref_name }}
          git pull origin \${{ github.ref_name }} --rebase

      - name: Install Dependencies
        run: npm ci

      - name: Run Build Script
        # We assume the user has added this script or uses npx
        run: npm run tokens

      - name: Debug generated outputs
        run: |
          echo "--- src/styles ---"
          ls -la src/styles || true
          echo "--- git status ---"
          git status --porcelain

      - name: Commit Design Tokens
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "🎨 Design Token Updates"
          file_pattern: 'src/styles/*.css src/styles/*.ts tokens/android/*.kt tokens/ios/*.swift tokens/flutter/*.dart'
          skip_dirty_check: false
`;

// ---------- HELPERS ----------

function toKebabCase(str) {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function toCamelCase(str) {
    const parts = str
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((p) => p.trim());
    if (!parts.length) return '';
    return (
        parts[0].toLowerCase() +
        parts
            .slice(1)
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
            .join('')
    );
}

function toSnakeCase(str) {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function toUpperSnakeCase(str) {
    return toSnakeCase(str).toUpperCase();
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function flattenToMap(obj, prefix = '', out = {}) {
    Object.keys(obj).forEach((key) => {
        const value = obj[key];
        const nextKey = prefix ? `${prefix}/${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenToMap(value, nextKey, out);
        } else {
            out[nextKey] = value;
        }
    });
    return out;
}

function resolveAlias(raw, primitiveMap) {
    if (typeof raw !== 'string') return raw;
    const match = raw.match(/^\\{([^}]+)\\}$/);
    if (!match) return raw;
    const key = match[1];
    return primitiveMap[key] ?? raw;
}

function readExistingCssVars(cssPath) {
    if (!fs.existsSync(cssPath)) return {};
    const content = fs.readFileSync(cssPath, 'utf8');
    const vars = {};
    const regex = /--([a-z0-9\\-]+)\\s*:\\s*([^;]+);/gi;
    let m;
    while ((m = regex.exec(content))) {
        vars[m[1]] = m[2].trim();
    }
    return vars;
}

function readExistingTsConsts(tsPath) {
    if (!fs.existsSync(tsPath)) return {};
    const content = fs.readFileSync(tsPath, 'utf8');
    const consts = {};
    const regex = /export const\\s+(\\w+)\\s*=\\s*["'`]([^"'`]+)["'`];/g;
    let m;
    while ((m = regex.exec(content))) {
        consts[m[1]] = m[2];
    }
    return consts;
}

// ---- WRITERS ----

function writeWebThemeFiles(themeName, tokens) {
    const buildPath = path.join(process.cwd(), 'src', 'styles');
    ensureDir(buildPath);

    const slug = toKebabCase(themeName);
    const cssPath = path.join(buildPath, `theme-${slug}.css`);
    const tsPath = path.join(buildPath, `theme-${slug}.ts`);

    const existingCss = readExistingCssVars(cssPath);
    const existingTs = readExistingTsConsts(tsPath);

    const cssVars = { ...existingCss };
    const tsConsts = { ...existingTs };

    tokens.forEach((t) => {
        cssVars[t.cssVar] = t.value;
        tsConsts[t.tsName] = t.value;
    });

    const cssLines = [
        '/**',
        ' * Auto-generated from tokens/design-tokens.json',
        ' * Do not edit manually.',
        ' */',
        '',
        `[data-theme="${slug}"] {`,
    ];

    Object.keys(cssVars)
        .sort()
        .forEach((name) => {
            cssLines.push(`  --${name}: ${cssVars[name]};`);
        });
    cssLines.push('}', '');

    const tsLines = [
        '/**',
        ' * Auto-generated from tokens/design-tokens.json',
        ' * Do not edit manually.',
        ' */',
        '',
    ];

    Object.keys(tsConsts)
        .sort()
        .forEach((name) => {
            tsLines.push(`export const ${name} = "${tsConsts[name]}";`);
        });

    fs.writeFileSync(cssPath, cssLines.join('\\n'), 'utf8');
    fs.writeFileSync(tsPath, tsLines.join('\\n'), 'utf8');
}

function writeAndroidThemeFiles(themeName, tokens) {
    const outDir = path.join(process.cwd(), 'tokens', 'android');
    ensureDir(outDir);
    const slug = toKebabCase(themeName);
    const filePath = path.join(outDir, `theme_${slug}.kt`);

    const lines = [
        '// Auto-generated from tokens/design-tokens.json',
        '// Do not edit manually.',
        '',
        'package tokens',
        '',
        `object ${toCamelCase(themeName[0].toUpperCase() + themeName.slice(1))}ThemeTokens {`,
    ];

    tokens.forEach((t) => {
        const constName = toUpperSnakeCase(t.logicalName);
        lines.push(`  const val ${constName} = "${t.value}"`);
    });

    lines.push('}', '');
    fs.writeFileSync(filePath, lines.join('\\n'), 'utf8');
}

function writeIOSTokenFiles(themeName, tokens) {
    const outDir = path.join(process.cwd(), 'tokens', 'ios');
    ensureDir(outDir);
    const slug = toKebabCase(themeName);
    const filePath = path.join(outDir, `Theme${slug[0].toUpperCase()}${slug.slice(1)}.swift`);

    const typeName = `${themeName}ThemeTokens`;
    const lines = [
        '// Auto-generated from tokens/design-tokens.json',
        '// Do not edit manually.',
        '',
        'import Foundation',
        '',
        `public enum ${typeName} {`,
    ];

    tokens.forEach((t) => {
        const constName = toCamelCase(t.logicalName);
        lines.push(`  public static let ${constName} = "${t.value}"`);
    });

    lines.push('}', '');
    fs.writeFileSync(filePath, lines.join('\\n'), 'utf8');
}

function writeFlutterThemeFiles(themeName, tokens) {
    const outDir = path.join(process.cwd(), 'tokens', 'flutter');
    ensureDir(outDir);
    const slug = toKebabCase(themeName);
    const filePath = path.join(outDir, `theme_${slug}.dart`);

    const className = `${themeName}ThemeTokens`;
    const lines = [
        '// Auto-generated from tokens/design-tokens.json',
        '// Do not edit manually.',
        '',
        'class ' + className + ' {',
    ];

    tokens.forEach((t) => {
        const constName = toCamelCase(t.logicalName);
        lines.push(`  static const String ${constName} = "${t.value}";`);
    });

    lines.push('}', '');
    fs.writeFileSync(filePath, lines.join('\\n'), 'utf8');
}

// ---------- COMMANDS ----------

function runInit(platformArg) {
    const cwd = process.cwd();
    const target = platformArg || 'all';

    // 1. Create Workflow File
    const workflowPath = path.join(cwd, '.github', 'workflows', 'design-syncs.yml');
    ensureDir(path.dirname(workflowPath));
    if (fs.existsSync(workflowPath)) {
        console.log('⚠️  Workflow file already exists. Skipping overwrite.');
    } else {
        fs.writeFileSync(workflowPath, WORKFLOW_CONTENT, 'utf8');
        console.log('✅ Generated .github/workflows/design-syncs.yml');
    }

    // 2. Add Script to package.json
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            if (!pkg.scripts) pkg.scripts = {};

            if (pkg.scripts.tokens) {
                console.log('⚠️  "tokens" script already exists in package.json. Skipping.');
            } else {
                pkg.scripts.tokens = `orchestra-cli build ${target}`;
                fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
                console.log(`✅ Added "tokens" script for "${target}" to package.json`);
            }
        } catch (error) {
            console.error('❌ Failed to parse package.json:', error);
        }
    } else {
        console.warn('⚠️  No package.json found in current directory.');
    }
}

function runBuild(platformArg) {
    const tokenDir = path.join(process.cwd(), 'tokens');
    if (!fs.existsSync(tokenDir)) {
        console.error(`❌ Tokens folder not found at ${tokenDir}`);
        console.error(`👉 Have you synced your design tokens from Figma yet?`);
        console.error(`   Run the Orchestra Figma Plugin to push your tokens to this repository.`);
        process.exit(1);
    }

    const designTokensPath = path.join(tokenDir, 'design-tokens.json');
    if (!fs.existsSync(designTokensPath)) {
        console.error(`❌ design-tokens.json not found at ${designTokensPath}`);
        console.error(`👉 Have you synced your design tokens from Figma yet?`);
        console.error(`   Run the Orchestra Figma Plugin to push your tokens to this repository.`);
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(designTokensPath, 'utf8'));

    const topLevelKeys = Object.keys(raw);

    let primitiveKey = process.env.TOKENS_PRIMITIVE_KEY;
    let componentKey = process.env.TOKENS_COMPONENT_KEY;

    if (!primitiveKey || !raw[primitiveKey]) {
        primitiveKey =
            topLevelKeys.find((k) => /primitive/i.test(k)) ??
            topLevelKeys.find((k) => /base/i.test(k)) ??
            topLevelKeys[0];
    }

    if (!componentKey || !raw[componentKey]) {
        componentKey =
            topLevelKeys.find((k) => /component/i.test(k)) ??
            topLevelKeys.find((k) => /brand/i.test(k)) ??
            topLevelKeys.find((k) => k !== primitiveKey) ??
            topLevelKeys[1];
    }

    const primitiveCollection = raw[primitiveKey];
    const componentCollection = raw[componentKey];

    if (!primitiveCollection || !componentCollection) {
        console.error(
            `❌ Could not resolve primitive/component collections. ` +
            `Checked primitiveKey="${primitiveKey}", componentKey="${componentKey}".`,
        );
        process.exit(1);
    }

    console.log(`Using "${primitiveKey}" as primitives and "${componentKey}" as components.`);

    const primitiveModes = Object.keys(primitiveCollection);
    if (!primitiveModes.length) {
        console.error('❌ No modes found under "Primitive Tokens"');
        process.exit(1);
    }

    const baseModeName = primitiveModes[0];
    const primitiveMap = flattenToMap(primitiveCollection[baseModeName]);

    const validPlatforms = new Set(['web', 'android', 'ios', 'flutter', 'all']);
    const target = (platformArg || 'web').toLowerCase();

    if (!validPlatforms.has(target)) {
        console.error(
            `❌ Unknown platform "${target}". Use one of: web, android, ios, flutter, all.`,
        );
        process.exit(1);
    }

    const targetPlatforms =
        target === 'all' ? ['web', 'android', 'ios', 'flutter'] : [target];

    const brandKeys = Object.keys(componentCollection);

    console.log(`\\n🔍 Found ${brandKeys.length} brands.`);

    brandKeys.forEach((brandKey, index) => {
        const brandTokens = componentCollection[brandKey];
        const themeName = brandKey;

        console.log(`\\n🤖 Building Theme ${index + 1}: ${toKebabCase(themeName)}...`);

        const collected = [];

        function walk(node, pathParts = []) {
            if (node && typeof node === 'object' && !Array.isArray(node)) {
                Object.keys(node).forEach((k) => {
                    walk(node[k], [...pathParts, k]);
                });
                return;
            }

            const rawValue = node;
            const resolved = resolveAlias(rawValue, primitiveMap);
            if (resolved == null) return;

            const logicalName = pathParts.join('-');
            const baseCss = `${toKebabCase(brandKey)}`;
            const cssVar = `${baseCss}-${toKebabCase(logicalName)}`;
            const tsName = toCamelCase(`${brandKey}-${logicalName}`);

            collected.push({
                brandKey,
                logicalName,
                cssVar,
                tsName,
                value: resolved,
            });
        }

        walk(brandTokens, []);

        if (targetPlatforms.includes('web')) {
            writeWebThemeFiles(themeName, collected);
        }
        if (targetPlatforms.includes('android')) {
            writeAndroidThemeFiles(themeName, collected);
        }
        if (targetPlatforms.includes('ios')) {
            writeIOSTokenFiles(themeName, collected);
        }
        if (targetPlatforms.includes('flutter')) {
            writeFlutterThemeFiles(themeName, collected);
        }
    });
}

// ---------- MAIN ----------

const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
    // args[1] would be the platform (optional)
    runInit(args[1]);
} else if (command === 'build') {
    runBuild(args[1]);
} else if (command === 'help' || !command) {
    console.log(`
Usage:
  orchestra-cli init [platform] Generate GitHub workflow and package.json script for a specific platform (default: all)
  orchestra-cli build [files] Build design tokens
                              [files] can be: web, android, ios, flutter, all
`);
} else {
    // Fallback: if user just passed "web" or "all" without "build", treat as build command for backward compatibility logic if desired.
    // But better to be explicit.
    console.log(`Unknown command: ${command}`);
    process.exit(1);
}

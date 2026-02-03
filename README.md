# Orchestra Design System CLI

A CLI tool to automate syncing and building design tokens for Orchestra projects.

## Prerequisites


- **Node.js**: v22 or higher
- **npm**: v7 or higher

## Workflow

1.  **Initialize**: Run `orchestra-cli init` to set up GitHub Actions and scripts.
2.  **Sync**: Push design tokens from Figma using the Orchestra plugin.
3.  **Build**: The GitHub Action automatically runs `npm run tokens` to generate your theme files.

## Platform Setup

Choose your platform to get started:

### 🌐 Web (React, HTML/CSS)

**1. Installation**
Install the CLI in your project's dev dependencies:
```bash
npm install git+https://github.com/KaungMyatHein/Orchestra-CLI.git --save-dev
```

**2. Initialize**
Generate the GitHub Actions workflow and add the build script to your `package.json`.
```bash
npx orchestra-cli init web
```

**3. Build Tokens**
The build runs automatically when tokens are synced. To run manually:
```bash
npm run tokens
```
**Output Location:** `src/styles/`

---

### 🤖 Android (Kotlin)

**1. Installation**
You can install the CLI globally or in a separate build toolchain directory:
```bash
npm install -g git+https://github.com/KaungMyatHein/Orchestra-CLI.git
```

**2. Initialize**
Set up the workflow and scripts.
```bash
npx orchestra-cli init android
```

**3. Build Tokens**
The build runs automatically when tokens are synced. To run manually:
```bash
npm run tokens
```
**Output Location:** `tokens/android/`

---

### 🍎 iOS (Swift)

**1. Installation**
Install via npm (requires Node.js environment):
```bash
npm install git+https://github.com/KaungMyatHein/Orchestra-CLI.git --save-dev
```

**2. Initialize**
Initialize for iOS to set up automation.
```bash
npx orchestra-cli init ios
```

**3. Build Tokens**
The build runs automatically when tokens are synced. To run manually:
```bash
npm run tokens
```
**Output Location:** `tokens/ios/`

---

### 💙 Flutter (Dart)

**1. Installation**
Install via npm into your build environment:
```bash
npm install git+https://github.com/KaungMyatHein/Orchestra-CLI.git --save-dev
```

**2. Initialize**
Prepare your project for token automation.
```bash
npx orchestra-cli init flutter
```

**3. Build Tokens**
The build runs automatically when tokens are synced. To run manually:
```bash
npm run tokens
```
**Output Location:** `tokens/flutter/`

## Development

1. Clone this repository
2. Run `npm install`
3. Make changes to `bin/index.js`

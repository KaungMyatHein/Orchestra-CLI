# Orchestra Design System CLI

A CLI tool to automate syncing and building design tokens for Orchestra projects.

## Installation

You can install this directly from GitHub into your project:

```bash
npm install git+https://github.com/YOUR_USERNAME/orchestra-cli.git --save-dev
```

*(Replace `YOUR_USERNAME/orchestra-cli` with your actual repository path)*

## Usage

### 1. Initialize Workflow
In a new project, verify your setup by running:

```bash
npx orchestra-cli init
```
This will generate the `.github/workflows/design-syncs.yml` file.

### 2. Build Tokens
To build tokens manually:

```bash
npx orchestra-cli build all
```

Or add it to your `package.json` scripts:
```json
"scripts": {
  "tokens": "orchestra-cli build all"
}
```

## Development

1. Clone this repository
2. Run `npm install`
3. Make changes to `bin/index.js`

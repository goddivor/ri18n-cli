# react-i18n-extract

CLI tool for extracting and managing i18n translations in React applications.

## Installation

```bash
npm install -g react-i18n-extract
```

Or use with npx:

```bash
npx react-i18n-extract extract
```

## Usage

### Initialize configuration

```bash
react-i18n init
```

This creates a `i18n.config.json` file with your preferences.

### Extract texts

```bash
react-i18n extract
```

Options:
- `-c, --config <path>` - Path to config file
- `-s, --source <dir>` - Source directory (default: `./src`)
- `-o, --output <dir>` - Output directory (default: `./locales`)
- `-l, --lang <code>` - Source language code (default: `en`)
- `-t, --targets <codes>` - Target languages, comma-separated (default: `fr,es`)
- `-f, --format <type>` - Output format: `json`, `typescript`, or `both`
- `--flat` - Generate flat key structure
- `--string-literals` - Extract string literals outside JSX
- `-v, --verbose` - Show detailed output

### Scan texts (preview)

```bash
react-i18n scan
```

Scans and displays extractable texts without generating files.

### Translate texts

```bash
react-i18n translate
```

Automatically translates extracted texts using AI translation providers.

Options:
- `-c, --config <path>` - Path to config file
- `-i, --input <dir>` - Input directory with source files (default: `./locales`)
- `-o, --output <dir>` - Output directory (defaults to input)
- `-s, --source <lang>` - Source language code (default: `en`)
- `-t, --target <langs>` - Target languages, comma-separated
- `-p, --provider <name>` - Translation provider
- `-k, --api-key <key>` - API key for the provider
- `--credentials <path>` - Path to credentials file (for Google Cloud)
- `-l, --list` - List available translation providers

## Translation Providers

The CLI supports multiple translation providers. It will automatically use the first available provider.

| Provider | Environment Variable | Notes |
|----------|---------------------|-------|
| **Google Cloud Translate** | `GOOGLE_APPLICATION_CREDENTIALS` | Or place credentials JSON in project root |
| **DeepL** | `DEEPL_API_KEY` | Supports free and pro API keys |
| **LibreTranslate** | `LIBRETRANSLATE_URL` | Optional, defaults to public instance |
| **OpenAI** | `OPENAI_API_KEY` | Uses GPT-4o-mini by default |
| **Claude** | `ANTHROPIC_API_KEY` | Uses Claude Sonnet by default |
| **Gemini** | `GEMINI_API_KEY` | Uses Gemini 1.5 Flash by default |

### Provider Priority

When no provider is specified, the CLI tries providers in this order:
1. Google Cloud Translate
2. DeepL
3. Claude
4. OpenAI
5. Gemini
6. LibreTranslate

### Specifying a Provider

```bash
# Use a specific provider
react-i18n translate -p deepl -k YOUR_API_KEY

# List available providers
react-i18n translate --list
```

## Configuration

Create a `i18n.config.json` file in your project root:

```json
{
  "sourceDir": "./src",
  "outputDir": "./locales",
  "sourceLanguage": "en",
  "targetLanguages": ["fr", "es", "de"],
  "fileExtensions": [".tsx", ".jsx", ".ts", ".js"],
  "excludePaths": ["node_modules", "dist", "**/*.test.*"],
  "extractAttributes": ["placeholder", "title", "alt", "aria-label"],
  "extractStringLiterals": false,
  "minTextLength": 2,
  "generateKeys": "auto",
  "outputFormat": "json",
  "flat": false
}
```

## Output

The tool generates translation files in your output directory:

```
locales/
├── en.json          # Source language with extracted texts
├── fr.json          # Translated to French
├── es.json          # Translated to Spanish
├── keys.ts          # TypeScript type definitions for keys
└── index.ts         # Export file (if using typescript format)
```

## Workflow Example

```bash
# 1. Initialize configuration
react-i18n init

# 2. Extract texts from your React app
react-i18n extract -s ./src -o ./locales

# 3. Translate to target languages
react-i18n translate -t fr,es,de

# 4. Use the generated files in your app
```

## What gets extracted

- JSX text content: `<h1>Hello World</h1>`
- JSX expressions with strings: `<div>{"Welcome"}</div>`
- JSX attributes: `<input placeholder="Enter name" />`
- String literals (optional): `const msg = "Hello";`

## What gets ignored

- URLs and file paths
- CSS class names (Tailwind, etc.)
- Color values
- Technical identifiers
- Package names
- SVG paths

## License

MIT

export interface ExtractedText {
  id: string;
  text: string;
  key: string;
  file: string;
  line: number;
  column: number;
  type: 'jsx-text' | 'jsx-attribute' | 'jsx-expression' | 'string-literal' | 'template-literal';
  context: ExtractedTextContext;
  confidence: number;
  variables?: string[];
}

export interface ExtractedTextContext {
  componentName: string | null;
  elementType: string | null;
  parentElement: string | null;
  attributeName: string | null;
  functionName: string | null;
  surroundingCode: string;
}

export interface ExtractionConfig {
  sourceDir: string;
  outputDir: string;
  sourceLanguage: string;
  targetLanguages: string[];
  fileExtensions: string[];
  excludePaths: string[];
  includePaths: string[];
  extractAttributes: string[];
  extractStringLiterals: boolean;
  minTextLength: number;
  generateKeys: 'auto' | 'hash' | 'path';
  outputFormat: 'json' | 'typescript' | 'both';
  flat: boolean;
}

export interface ExtractionResult {
  texts: ExtractedText[];
  stats: ExtractionStats;
}

export interface ExtractionStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  totalTexts: number;
  byType: Record<string, number>;
  byFile: Record<string, number>;
}

export interface TranslationResult {
  key: string;
  original: string;
  translations: Record<string, string>;
}

export interface I18nOutput {
  [key: string]: string | I18nOutput;
}

// Translation Provider Types
export type TranslationProviderType =
  | 'google'
  | 'deepl'
  | 'libretranslate'
  | 'openai'
  | 'claude'
  | 'gemini';

export interface TranslationProviderConfig {
  provider: TranslationProviderType;
  apiKey?: string;
  credentialsPath?: string;
  apiUrl?: string; // For LibreTranslate self-hosted
  model?: string; // For LLM providers
}

export interface TranslationConfig {
  provider?: TranslationProviderType;
  providers?: Partial<Record<TranslationProviderType, TranslationProviderConfig>>;
  batchSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface TranslateOptions {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslatedText {
  original: string;
  translated: string;
  provider: TranslationProviderType;
}

export const DEFAULT_CONFIG: ExtractionConfig = {
  sourceDir: './src',
  outputDir: './locales',
  sourceLanguage: 'en',
  targetLanguages: ['fr', 'es'],
  fileExtensions: ['.tsx', '.jsx', '.ts', '.js'],
  excludePaths: ['node_modules', 'dist', 'build', '.git', '**/*.test.*', '**/*.spec.*'],
  includePaths: ['**/*'],
  extractAttributes: ['placeholder', 'title', 'alt', 'aria-label', 'aria-description'],
  extractStringLiterals: false,
  minTextLength: 2,
  generateKeys: 'auto',
  outputFormat: 'json',
  flat: false,
};

import ora from 'ora';
import type {
  TranslationProviderType,
  TranslationProviderConfig,
  TranslationConfig,
  I18nOutput,
} from '../types/index.js';
import {
  BaseProvider,
  GoogleProvider,
  DeepLProvider,
  LibreTranslateProvider,
  OpenAIProvider,
  ClaudeProvider,
  GeminiProvider,
} from '../providers/index.js';
import { logger } from '../utils/logger.js';

const PROVIDER_PRIORITY: TranslationProviderType[] = [
  'google',
  'deepl',
  'claude',
  'openai',
  'gemini',
  'libretranslate',
];

export class TranslationService {
  private config: TranslationConfig;
  private providers: Map<TranslationProviderType, BaseProvider> = new Map();

  constructor(config: TranslationConfig = {}) {
    this.config = {
      batchSize: 50,
      concurrency: 3,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    this.initializeProviders();
  }

  private initializeProviders(): void {
    const providerConfigs = this.config.providers || {};

    // Initialize all providers with their configs
    const providerClasses: Record<TranslationProviderType, new (config: TranslationProviderConfig) => BaseProvider> = {
      google: GoogleProvider,
      deepl: DeepLProvider,
      libretranslate: LibreTranslateProvider,
      openai: OpenAIProvider,
      claude: ClaudeProvider,
      gemini: GeminiProvider,
    };

    for (const [type, ProviderClass] of Object.entries(providerClasses)) {
      const config = providerConfigs[type as TranslationProviderType] || { provider: type as TranslationProviderType };
      this.providers.set(type as TranslationProviderType, new ProviderClass(config));
    }
  }

  async getAvailableProvider(): Promise<BaseProvider | null> {
    // If a specific provider is requested, try that one first
    if (this.config.provider) {
      const provider = this.providers.get(this.config.provider);
      if (provider && await provider.isAvailable()) {
        return provider;
      }
      logger.warning(`Requested provider '${this.config.provider}' is not available`);
    }

    // Try providers in priority order
    for (const providerType of PROVIDER_PRIORITY) {
      const provider = this.providers.get(providerType);
      if (provider && await provider.isAvailable()) {
        return provider;
      }
    }

    return null;
  }

  async translateTexts(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<Map<string, string>> {
    const provider = await this.getAvailableProvider();

    if (!provider) {
      throw new Error(
        'No translation provider available. Please configure one of: ' +
        PROVIDER_PRIORITY.join(', ')
      );
    }

    const spinner = ora(`Translating ${texts.length} texts with ${provider.name}...`).start();

    try {
      const response = await provider.translate({
        texts,
        sourceLanguage,
        targetLanguage,
      });

      spinner.succeed(`Translated ${texts.length} texts with ${provider.name}`);

      const result = new Map<string, string>();
      texts.forEach((original, index) => {
        result.set(original, response.translations[index] || original);
      });

      return result;
    } catch (error) {
      spinner.fail(`Translation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async translateI18nFile(
    sourceData: I18nOutput,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<I18nOutput> {
    // Flatten the nested structure to get all texts
    const flatTexts = this.flattenI18nObject(sourceData);
    const keys = Array.from(flatTexts.keys());
    const texts = Array.from(flatTexts.values());

    // Translate all texts
    const translations = await this.translateTexts(texts, sourceLanguage, targetLanguage);

    // Rebuild the nested structure with translations
    const translatedFlat = new Map<string, string>();
    keys.forEach((key, index) => {
      const original = texts[index];
      const translated = translations.get(original) || original;
      translatedFlat.set(key, translated);
    });

    return this.unflattenI18nObject(translatedFlat);
  }

  private flattenI18nObject(obj: I18nOutput, prefix = ''): Map<string, string> {
    const result = new Map<string, string>();

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        result.set(fullKey, value);
      } else {
        const nested = this.flattenI18nObject(value, fullKey);
        nested.forEach((v, k) => result.set(k, v));
      }
    }

    return result;
  }

  private unflattenI18nObject(flatMap: Map<string, string>): I18nOutput {
    const result: I18nOutput = {};

    for (const [key, value] of flatMap) {
      const keys = key.split('.');
      let current: I18nOutput = result;

      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!current[k] || typeof current[k] === 'string') {
          current[k] = {};
        }
        current = current[k] as I18nOutput;
      }

      current[keys[keys.length - 1]] = value;
    }

    return result;
  }

  async listAvailableProviders(): Promise<TranslationProviderType[]> {
    const available: TranslationProviderType[] = [];

    for (const [type, provider] of this.providers) {
      if (await provider.isAvailable()) {
        available.push(type);
      }
    }

    return available;
  }
}

import type { TranslationProviderType, TranslationProviderConfig } from '../types/index.js';

export interface TranslationRequest {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationResponse {
  translations: string[];
  provider: TranslationProviderType;
}

export abstract class BaseProvider {
  protected config: TranslationProviderConfig;
  abstract readonly name: TranslationProviderType;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  abstract translate(request: TranslationRequest): Promise<TranslationResponse>;

  abstract isAvailable(): Promise<boolean>;

  protected async translateBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    batchSize: number = 50
  ): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.translate({
        texts: batch,
        sourceLanguage,
        targetLanguage,
      });
      results.push(...response.translations);
    }

    return results;
  }
}

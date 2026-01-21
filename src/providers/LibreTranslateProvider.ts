import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

interface LibreTranslateResponse {
  translatedText: string;
}

export class LibreTranslateProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'libretranslate';
  private apiUrl: string;

  constructor(config: TranslationProviderConfig) {
    super(config);
    // Default to public instance, but can be self-hosted
    this.apiUrl = config.apiUrl || process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/languages`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const { texts, sourceLanguage, targetLanguage } = request;
    const apiKey = this.config.apiKey || process.env.LIBRETRANSLATE_API_KEY;

    const translations: string[] = [];

    // LibreTranslate doesn't support batch, so we translate one by one
    for (const text of texts) {
      try {
        const body: Record<string, string> = {
          q: text,
          source: sourceLanguage,
          target: targetLanguage,
          format: 'text',
        };

        if (apiKey) {
          body.api_key = apiKey;
        }

        const response = await fetch(`${this.apiUrl}/translate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`LibreTranslate error: ${response.statusText}`);
        }

        const data = (await response.json()) as LibreTranslateResponse;
        translations.push(data.translatedText);
      } catch (error) {
        console.error(`Failed to translate: "${text.substring(0, 30)}..."`);
        translations.push(text);
      }
    }

    return {
      translations,
      provider: this.name,
    };
  }
}

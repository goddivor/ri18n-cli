import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

interface DeepLTranslation {
  detected_source_language: string;
  text: string;
}

interface DeepLResponse {
  translations: DeepLTranslation[];
}

export class DeepLProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'deepl';
  private apiUrl: string;

  constructor(config: TranslationProviderConfig) {
    super(config);
    // DeepL has two endpoints: free and pro
    const isFreeKey = config.apiKey?.endsWith(':fx');
    this.apiUrl = isFreeKey
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey || process.env.DEEPL_API_KEY;
    if (!apiKey) return false;

    try {
      const response = await fetch('https://api-free.deepl.com/v2/usage', {
        headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const apiKey = this.config.apiKey || process.env.DEEPL_API_KEY;
    if (!apiKey) {
      throw new Error('DeepL API key not found. Set DEEPL_API_KEY or provide in config.');
    }

    const { texts, sourceLanguage, targetLanguage } = request;

    // DeepL uses uppercase language codes
    const sourceLang = this.mapLanguageCode(sourceLanguage);
    const targetLang = this.mapLanguageCode(targetLanguage);

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepL API error: ${error}`);
    }

    const data = (await response.json()) as DeepLResponse;

    return {
      translations: data.translations.map(t => t.text),
      provider: this.name,
    };
  }

  private mapLanguageCode(code: string): string {
    // DeepL uses specific codes for some languages
    const mapping: Record<string, string> = {
      en: 'EN',
      'en-us': 'EN-US',
      'en-gb': 'EN-GB',
      de: 'DE',
      fr: 'FR',
      es: 'ES',
      it: 'IT',
      nl: 'NL',
      pl: 'PL',
      pt: 'PT-PT',
      'pt-br': 'PT-BR',
      ru: 'RU',
      ja: 'JA',
      zh: 'ZH',
    };

    return mapping[code.toLowerCase()] || code.toUpperCase();
  }
}

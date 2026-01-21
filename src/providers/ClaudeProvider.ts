import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

interface ClaudeResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export class ClaudeProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'claude';
  private apiUrl = 'https://api.anthropic.com/v1/messages';

  constructor(config: TranslationProviderConfig) {
    super(config);
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey || process.env.ANTHROPIC_API_KEY;
    return !!apiKey;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const apiKey = this.config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY or provide in config.');
    }

    const { texts, sourceLanguage, targetLanguage } = request;
    const model = this.config.model || 'claude-sonnet-4-20250514';

    const translations: string[] = [];

    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchTranslations = await this.translateBatchLLM(
        batch,
        sourceLanguage,
        targetLanguage,
        model,
        apiKey
      );
      translations.push(...batchTranslations);
    }

    return {
      translations,
      provider: this.name,
    };
  }

  private async translateBatchLLM(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    model: string,
    apiKey: string
  ): Promise<string[]> {
    const textsJson = JSON.stringify(texts);

    const systemPrompt = `You are a professional translator. Translate the following JSON array of texts from ${sourceLanguage} to ${targetLanguage}.
Keep the same array structure and order. Only return the translated JSON array, nothing else.
Preserve any placeholders like {name}, {{count}}, etc.
Keep technical terms, brand names, and code identifiers unchanged.`;

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: textsJson,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${error}`);
    }

    const data = (await response.json()) as ClaudeResponse;
    const content = data.content[0]?.text || '[]';

    try {
      const parsed = JSON.parse(content) as string[];
      if (Array.isArray(parsed) && parsed.length === texts.length) {
        return parsed;
      }
    } catch {
      // If parsing fails, return original texts
    }

    return texts;
  }
}

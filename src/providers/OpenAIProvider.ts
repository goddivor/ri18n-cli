import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class OpenAIProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'openai';
  private apiUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(config: TranslationProviderConfig) {
    super(config);
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    return !!apiKey;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not found. Set OPENAI_API_KEY or provide in config.');
    }

    const { texts, sourceLanguage, targetLanguage } = request;
    const model = this.config.model || 'gpt-4o-mini';

    const translations: string[] = [];

    // Process in batches to reduce API calls
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

    const messages: OpenAIMessage[] = [
      {
        role: 'system',
        content: `You are a professional translator. Translate the following JSON array of texts from ${sourceLanguage} to ${targetLanguage}.
Keep the same array structure and order. Only return the translated JSON array, nothing else.
Preserve any placeholders like {name}, {{count}}, etc.
Keep technical terms, brand names, and code identifiers unchanged.`,
      },
      {
        role: 'user',
        content: textsJson,
      },
    ];

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const content = data.choices[0]?.message?.content || '[]';

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

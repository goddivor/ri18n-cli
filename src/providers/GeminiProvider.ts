import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

export class GeminiProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'gemini';

  constructor(config: TranslationProviderConfig) {
    super(config);
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    return !!apiKey;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const apiKey = this.config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not found. Set GEMINI_API_KEY or provide in config.');
    }

    const { texts, sourceLanguage, targetLanguage } = request;
    const model = this.config.model || 'gemini-1.5-flash';

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
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = `You are a professional translator. Translate the following JSON array of texts from ${sourceLanguage} to ${targetLanguage}.
Keep the same array structure and order. Only return the translated JSON array, nothing else.
Preserve any placeholders like {name}, {{count}}, etc.
Keep technical terms, brand names, and code identifiers unchanged.

${textsJson}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const content = data.candidates[0]?.content?.parts[0]?.text || '[]';

    // Extract JSON from response (Gemini might wrap it in markdown)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as string[];
        if (Array.isArray(parsed) && parsed.length === texts.length) {
          return parsed;
        }
      } catch {
        // If parsing fails, return original texts
      }
    }

    return texts;
  }
}

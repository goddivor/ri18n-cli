import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BaseProvider, type TranslationRequest, type TranslationResponse } from './BaseProvider.js';
import type { TranslationProviderConfig, TranslationProviderType } from '../types/index.js';

// Get CLI installation directory (resolve symlinks from npm link)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve symlinks to get the real path (important for npm link)
const realDirname = fs.realpathSync(__dirname);
const CLI_ROOT = path.resolve(realDirname, '..');

export class GoogleProvider extends BaseProvider {
  readonly name: TranslationProviderType = 'google';
  private client: any = null;

  constructor(config: TranslationProviderConfig) {
    super(config);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.getClient();
      return true;
    } catch {
      return false;
    }
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    // Dynamic import to avoid requiring the package if not used
    const { Translate } = await import('@google-cloud/translate').then(m => m.v2);

    let credentials: object | undefined;

    // Try to load credentials from config path (absolute or relative to cwd)
    if (this.config.credentialsPath) {
      const credPath = path.isAbsolute(this.config.credentialsPath)
        ? this.config.credentialsPath
        : path.resolve(process.cwd(), this.config.credentialsPath);
      if (fs.existsSync(credPath)) {
        credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      }
    }

    // Try default locations in current working directory
    if (!credentials) {
      const defaultFiles = [
        'autotrans-464509-8c7cdd6215b7.json',
        'google-credentials.json',
        'credentials.json',
      ];

      // Search in multiple locations: cwd, home directory, and CLI installation directory
      const searchDirs = [
        process.cwd(),
        process.env.HOME || '',
        CLI_ROOT,
      ].filter(Boolean);

      for (const dir of searchDirs) {
        for (const file of defaultFiles) {
          const fullPath = path.join(dir, file);
          if (fs.existsSync(fullPath)) {
            credentials = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            break;
          }
        }
        if (credentials) break;
      }
    }

    // Check environment variable
    if (!credentials && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (fs.existsSync(envPath)) {
        credentials = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
      }
    }

    if (!credentials) {
      throw new Error('Google Cloud credentials not found');
    }

    this.client = new Translate({ credentials });
    return this.client;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const client = await this.getClient();
    const { texts, sourceLanguage, targetLanguage } = request;

    const translations: string[] = [];

    // Google Translate API supports batch translations
    for (const text of texts) {
      try {
        const [translation] = await client.translate(text, {
          from: sourceLanguage,
          to: targetLanguage,
        });
        translations.push(translation);
      } catch (error) {
        // If translation fails, keep original text
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

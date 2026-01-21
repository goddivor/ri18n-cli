import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { TranslationService } from '../services/TranslationService.js';
import { logger } from '../utils/logger.js';
import type { TranslationProviderType, I18nOutput } from '../types/index.js';

interface TranslateOptions {
  config?: string;
  input?: string;
  output?: string;
  source?: string;
  target?: string;
  provider?: TranslationProviderType;
  apiKey?: string;
  credentials?: string;
  list?: boolean;
}

export function registerTranslateCommand(program: Command): void {
  program
    .command('translate')
    .description('Translate extracted texts using AI translation providers')
    .option('-c, --config <path>', 'Path to config file')
    .option('-i, --input <dir>', 'Input directory with source translation files', './locales')
    .option('-o, --output <dir>', 'Output directory (defaults to input dir)')
    .option('-s, --source <lang>', 'Source language code', 'en')
    .option('-t, --target <langs>', 'Target language codes (comma-separated)')
    .option('-p, --provider <name>', 'Translation provider (google, deepl, libretranslate, openai, claude, gemini)')
    .option('-k, --api-key <key>', 'API key for the translation provider')
    .option('--credentials <path>', 'Path to credentials file (for Google Cloud)')
    .option('-l, --list', 'List available translation providers')
    .action(async (options: TranslateOptions) => {
      await runTranslate(options);
    });
}

async function runTranslate(options: TranslateOptions): Promise<void> {
  logger.title('React i18n Translator');

  // Initialize translation service
  const translationService = new TranslationService({
    provider: options.provider,
    providers: options.provider
      ? {
          [options.provider]: {
            provider: options.provider,
            apiKey: options.apiKey,
            credentialsPath: options.credentials,
          },
        }
      : undefined,
  });

  // List available providers if requested
  if (options.list) {
    await listProviders(translationService);
    return;
  }

  // Load config
  let config = loadConfig(options.config);
  config = resolveConfigPaths(config);

  const inputDir = options.input ? path.resolve(options.input) : path.resolve(config.outputDir);
  const outputDir = options.output ? path.resolve(options.output) : inputDir;
  const sourceLanguage = options.source || config.sourceLanguage;
  const targetLanguages = options.target
    ? options.target.split(',').map(s => s.trim())
    : config.targetLanguages;

  // Check source file exists
  const sourceFile = path.join(inputDir, `${sourceLanguage}.json`);
  if (!fs.existsSync(sourceFile)) {
    logger.error(`Source file not found: ${sourceFile}`);
    logger.info('Run "react-i18n extract" first to generate source translations.');
    return;
  }

  // Load source data
  const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as I18nOutput;
  const textCount = countTexts(sourceData);

  logger.info(`Source: ${sourceFile} (${textCount} texts)`);
  logger.info(`Target languages: ${targetLanguages.join(', ')}`);

  // Check available provider
  const availableProviders = await translationService.listAvailableProviders();
  if (availableProviders.length === 0) {
    logger.error('No translation provider available.');
    logger.newLine();
    logger.info('Configure one of the following:');
    logger.dim('  • Google Cloud: Place credentials file in project root');
    logger.dim('  • DeepL: Set DEEPL_API_KEY environment variable');
    logger.dim('  • OpenAI: Set OPENAI_API_KEY environment variable');
    logger.dim('  • Claude: Set ANTHROPIC_API_KEY environment variable');
    logger.dim('  • Gemini: Set GEMINI_API_KEY environment variable');
    logger.dim('  • LibreTranslate: Set LIBRETRANSLATE_URL (optional)');
    return;
  }

  logger.info(`Available providers: ${availableProviders.join(', ')}`);
  logger.newLine();

  // Translate to each target language
  for (const targetLang of targetLanguages) {
    logger.info(`Translating to ${targetLang}...`);

    try {
      const translatedData = await translationService.translateI18nFile(
        sourceData,
        sourceLanguage,
        targetLang
      );

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write translated file
      const outputFile = path.join(outputDir, `${targetLang}.json`);
      fs.writeFileSync(outputFile, JSON.stringify(translatedData, null, 2) + '\n', 'utf-8');
      logger.success(`Created ${outputFile}`);
    } catch (error) {
      logger.error(`Failed to translate to ${targetLang}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logger.newLine();
  logger.box('Translation Complete', [
    `Source: ${sourceLanguage}`,
    `Targets: ${targetLanguages.join(', ')}`,
    `Texts translated: ${textCount}`,
    `Output: ${outputDir}`,
  ]);
}

async function listProviders(service: TranslationService): Promise<void> {
  logger.info('Checking available translation providers...');
  logger.newLine();

  const available = await service.listAvailableProviders();
  const allProviders: TranslationProviderType[] = [
    'google',
    'deepl',
    'libretranslate',
    'openai',
    'claude',
    'gemini',
  ];

  for (const provider of allProviders) {
    const isAvailable = available.includes(provider);
    const status = isAvailable ? '✓' : '✗';
    const color = isAvailable ? 'green' : 'red';

    const envVars: Record<string, string> = {
      google: 'credentials file or GOOGLE_APPLICATION_CREDENTIALS',
      deepl: 'DEEPL_API_KEY',
      libretranslate: 'LIBRETRANSLATE_URL (optional)',
      openai: 'OPENAI_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY or GOOGLE_AI_API_KEY',
    };

    if (isAvailable) {
      logger.success(`${provider.padEnd(15)} - Available`);
    } else {
      logger.dim(`${status} ${provider.padEnd(15)} - Set ${envVars[provider]}`);
    }
  }

  logger.newLine();
  if (available.length > 0) {
    logger.info(`Default provider: ${available[0]}`);
  } else {
    logger.warning('No providers available. Configure at least one to enable translation.');
  }
}

function countTexts(obj: I18nOutput): number {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      count++;
    } else {
      count += countTexts(value);
    }
  }
  return count;
}

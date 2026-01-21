import type { Command } from 'commander';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { ExtractionService } from '../services/ExtractionService.js';
import { OutputService } from '../services/OutputService.js';
import { logger } from '../utils/logger.js';
import type { ExtractionConfig } from '../types/index.js';

interface ExtractOptions {
  config?: string;
  source?: string;
  output?: string;
  lang?: string;
  targets?: string;
  format?: 'json' | 'typescript' | 'both';
  flat?: boolean;
  stringLiterals?: boolean;
  verbose?: boolean;
}

export function registerExtractCommand(program: Command): void {
  program
    .command('extract')
    .description('Extract translatable texts from React source files')
    .option('-c, --config <path>', 'Path to config file')
    .option('-s, --source <dir>', 'Source directory', './src')
    .option('-o, --output <dir>', 'Output directory for translation files', './locales')
    .option('-l, --lang <code>', 'Source language code', 'en')
    .option('-t, --targets <codes>', 'Target language codes (comma-separated)', 'fr,es')
    .option('-f, --format <type>', 'Output format: json, typescript, or both', 'json')
    .option('--flat', 'Generate flat key structure instead of nested')
    .option('--string-literals', 'Also extract string literals (not just JSX)')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: ExtractOptions) => {
      await runExtract(options);
    });
}

async function runExtract(options: ExtractOptions): Promise<void> {
  logger.title('React i18n Extractor');

  // Load and merge configuration
  let config = loadConfig(options.config);

  // Override with CLI options
  if (options.source) config.sourceDir = options.source;
  if (options.output) config.outputDir = options.output;
  if (options.lang) config.sourceLanguage = options.lang;
  if (options.targets) config.targetLanguages = options.targets.split(',').map(s => s.trim());
  if (options.format) config.outputFormat = options.format;
  if (options.flat) config.flat = true;
  if (options.stringLiterals) config.extractStringLiterals = true;

  // Resolve paths
  config = resolveConfigPaths(config);

  if (options.verbose) {
    logConfig(config);
  }

  // Run extraction
  const extractionService = new ExtractionService(config);
  const result = await extractionService.extract();

  if (result.texts.length === 0) {
    logger.warning('No translatable texts found');
    return;
  }

  // Display extraction statistics
  if (options.verbose) {
    displayStats(result.stats);
  }

  // Generate output files
  logger.newLine();
  logger.info('Generating translation files...');

  const outputService = new OutputService(config);
  const createdFiles = await outputService.generateOutputFiles(result.texts);

  logger.newLine();
  logger.success(`Created ${createdFiles.length} files in ${config.outputDir}`);

  // Summary
  logger.newLine();
  logger.box('Extraction Summary', [
    `Texts extracted: ${result.texts.length}`,
    `Files processed: ${result.stats.processedFiles}`,
    `Output directory: ${config.outputDir}`,
    `Languages: ${config.sourceLanguage} → ${config.targetLanguages.join(', ')}`,
  ]);
}

function logConfig(config: ExtractionConfig): void {
  logger.info('Configuration:');
  logger.dim(`  Source: ${config.sourceDir}`);
  logger.dim(`  Output: ${config.outputDir}`);
  logger.dim(`  Source language: ${config.sourceLanguage}`);
  logger.dim(`  Target languages: ${config.targetLanguages.join(', ')}`);
  logger.dim(`  File extensions: ${config.fileExtensions.join(', ')}`);
  logger.dim(`  Output format: ${config.outputFormat}`);
  logger.newLine();
}

function displayStats(stats: { byType: Record<string, number>; processedFiles: number; skippedFiles: number }): void {
  logger.newLine();
  logger.info('Extraction by type:');
  Object.entries(stats.byType).forEach(([type, count]) => {
    logger.dim(`  ${type}: ${count}`);
  });
  logger.dim(`  Files with texts: ${stats.processedFiles}`);
  logger.dim(`  Files skipped: ${stats.skippedFiles}`);
}

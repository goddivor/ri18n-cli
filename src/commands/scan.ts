import type { Command } from 'commander';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { ExtractionService } from '../services/ExtractionService.js';
import { logger } from '../utils/logger.js';

interface ScanOptions {
  config?: string;
  source?: string;
  json?: boolean;
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan and preview extractable texts without generating files')
    .option('-c, --config <path>', 'Path to config file')
    .option('-s, --source <dir>', 'Source directory', './src')
    .option('--json', 'Output results as JSON')
    .action(async (options: ScanOptions) => {
      await runScan(options);
    });
}

async function runScan(options: ScanOptions): Promise<void> {
  if (!options.json) {
    logger.title('React i18n Scanner');
  }

  // Load configuration
  let config = loadConfig(options.config);
  if (options.source) config.sourceDir = options.source;
  config = resolveConfigPaths(config);

  // Run extraction
  const extractionService = new ExtractionService(config);
  const result = await extractionService.extract();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.texts.length === 0) {
    logger.warning('No translatable texts found');
    return;
  }

  // Display found texts
  logger.newLine();
  logger.info(`Found ${result.texts.length} translatable texts:`);
  logger.newLine();

  // Group by file
  const byFile = new Map<string, typeof result.texts>();
  for (const text of result.texts) {
    const existing = byFile.get(text.file) || [];
    existing.push(text);
    byFile.set(text.file, existing);
  }

  for (const [file, texts] of byFile) {
    logger.info(`${file}`);
    for (const text of texts) {
      const preview = text.text.length > 50 ? text.text.substring(0, 47) + '...' : text.text;
      logger.dim(`  L${text.line}: "${preview}" → ${text.key}`);
    }
    logger.newLine();
  }

  // Summary
  logger.box('Scan Summary', [
    `Total texts: ${result.texts.length}`,
    `Files with texts: ${result.stats.processedFiles}`,
    `JSX texts: ${result.stats.byType['jsx-text'] || 0}`,
    `JSX expressions: ${result.stats.byType['jsx-expression'] || 0}`,
    `Attributes: ${result.stats.byType['jsx-attribute'] || 0}`,
  ]);
}

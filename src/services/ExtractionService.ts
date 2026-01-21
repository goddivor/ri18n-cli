import ora from 'ora';
import type { ExtractedText, ExtractionConfig, ExtractionResult, ExtractionStats } from '../types/index.js';
import { ReactExtractor } from '../extractors/ReactExtractor.js';
import { scanFiles } from '../utils/fileScanner.js';
import { logger } from '../utils/logger.js';

export class ExtractionService {
  private config: ExtractionConfig;
  private extractor: ReactExtractor;

  constructor(config: ExtractionConfig) {
    this.config = config;
    this.extractor = new ReactExtractor(config);
  }

  async extract(): Promise<ExtractionResult> {
    const spinner = ora('Scanning files...').start();

    const files = await scanFiles(this.config);

    if (files.length === 0) {
      spinner.warn('No files found matching the configuration');
      return {
        texts: [],
        stats: this.createEmptyStats(),
      };
    }

    spinner.text = `Found ${files.length} files to process`;

    const allTexts: ExtractedText[] = [];
    const allErrors: string[] = [];
    const stats: ExtractionStats = {
      totalFiles: files.length,
      processedFiles: 0,
      skippedFiles: 0,
      totalTexts: 0,
      byType: {},
      byFile: {},
    };

    spinner.text = `Processing files... (0/${files.length})`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      spinner.text = `Processing files... (${i + 1}/${files.length})`;

      try {
        const result = await this.extractor.extractFromFile(file);

        if (result.texts.length > 0) {
          allTexts.push(...result.texts);
          stats.processedFiles++;

          result.texts.forEach(text => {
            stats.byType[text.type] = (stats.byType[text.type] || 0) + 1;
            stats.byFile[text.file] = (stats.byFile[text.file] || 0) + 1;
          });
        } else {
          stats.skippedFiles++;
        }

        if (result.errors.length > 0) {
          allErrors.push(...result.errors);
        }
      } catch (error) {
        stats.skippedFiles++;
        const message = error instanceof Error ? error.message : String(error);
        allErrors.push(`Failed to process ${file}: ${message}`);
      }
    }

    stats.totalTexts = allTexts.length;

    spinner.succeed(`Extraction complete: ${allTexts.length} texts from ${stats.processedFiles} files`);

    if (allErrors.length > 0) {
      logger.newLine();
      logger.warning(`${allErrors.length} error(s) occurred during extraction:`);
      allErrors.slice(0, 5).forEach(err => logger.dim(`  ${err}`));
      if (allErrors.length > 5) {
        logger.dim(`  ... and ${allErrors.length - 5} more`);
      }
    }

    // Deduplicate texts by key
    const uniqueTexts = this.deduplicateTexts(allTexts);

    return {
      texts: uniqueTexts,
      stats,
    };
  }

  private deduplicateTexts(texts: ExtractedText[]): ExtractedText[] {
    const seen = new Map<string, ExtractedText>();

    for (const text of texts) {
      const existing = seen.get(text.key);
      if (!existing || text.confidence > existing.confidence) {
        seen.set(text.key, text);
      }
    }

    return Array.from(seen.values());
  }

  private createEmptyStats(): ExtractionStats {
    return {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      totalTexts: 0,
      byType: {},
      byFile: {},
    };
  }
}

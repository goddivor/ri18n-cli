import * as fs from 'fs';
import * as path from 'path';
import type { ExtractedText, ExtractionConfig, I18nOutput } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class OutputService {
  private config: ExtractionConfig;

  constructor(config: ExtractionConfig) {
    this.config = config;
  }

  async generateOutputFiles(texts: ExtractedText[]): Promise<string[]> {
    const outputDir = this.config.outputDir;
    const createdFiles: string[] = [];

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate source language file
    const sourceData = this.buildI18nObject(texts, this.config.sourceLanguage);

    if (this.config.outputFormat === 'json' || this.config.outputFormat === 'both') {
      const jsonPath = await this.writeJsonFile(sourceData, this.config.sourceLanguage);
      createdFiles.push(jsonPath);
    }

    if (this.config.outputFormat === 'typescript' || this.config.outputFormat === 'both') {
      const tsPath = await this.writeTypescriptFile(sourceData, this.config.sourceLanguage);
      createdFiles.push(tsPath);
    }

    // Generate target language files (empty templates)
    for (const lang of this.config.targetLanguages) {
      const targetData = this.buildEmptyI18nObject(texts);

      if (this.config.outputFormat === 'json' || this.config.outputFormat === 'both') {
        const jsonPath = await this.writeJsonFile(targetData, lang);
        createdFiles.push(jsonPath);
      }

      if (this.config.outputFormat === 'typescript' || this.config.outputFormat === 'both') {
        const tsPath = await this.writeTypescriptFile(targetData, lang);
        createdFiles.push(tsPath);
      }
    }

    // Generate index file for TypeScript
    if (this.config.outputFormat === 'typescript' || this.config.outputFormat === 'both') {
      const indexPath = await this.writeIndexFile();
      createdFiles.push(indexPath);
    }

    // Generate keys type file
    const keysPath = await this.writeKeysFile(texts);
    createdFiles.push(keysPath);

    return createdFiles;
  }

  private buildI18nObject(texts: ExtractedText[], _lang: string): I18nOutput {
    if (this.config.flat) {
      return this.buildFlatObject(texts);
    }
    return this.buildNestedObject(texts);
  }

  private buildEmptyI18nObject(texts: ExtractedText[]): I18nOutput {
    if (this.config.flat) {
      return this.buildFlatEmptyObject(texts);
    }
    return this.buildNestedEmptyObject(texts);
  }

  private buildFlatObject(texts: ExtractedText[]): I18nOutput {
    const result: I18nOutput = {};
    for (const text of texts) {
      result[text.key] = text.text;
    }
    return result;
  }

  private buildFlatEmptyObject(texts: ExtractedText[]): I18nOutput {
    const result: I18nOutput = {};
    for (const text of texts) {
      result[text.key] = '';
    }
    return result;
  }

  private buildNestedObject(texts: ExtractedText[]): I18nOutput {
    const result: I18nOutput = {};

    for (const text of texts) {
      const keys = text.key.split('.');
      let current: I18nOutput = result;

      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] === 'string') {
          current[key] = {};
        }
        current = current[key] as I18nOutput;
      }

      const lastKey = keys[keys.length - 1];
      current[lastKey] = text.text;
    }

    return result;
  }

  private buildNestedEmptyObject(texts: ExtractedText[]): I18nOutput {
    const result: I18nOutput = {};

    for (const text of texts) {
      const keys = text.key.split('.');
      let current: I18nOutput = result;

      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] === 'string') {
          current[key] = {};
        }
        current = current[key] as I18nOutput;
      }

      const lastKey = keys[keys.length - 1];
      current[lastKey] = '';
    }

    return result;
  }

  private async writeJsonFile(data: I18nOutput, lang: string): Promise<string> {
    const fileName = `${lang}.json`;
    const filePath = path.join(this.config.outputDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    logger.dim(`  Created ${fileName}`);

    return filePath;
  }

  private async writeTypescriptFile(data: I18nOutput, lang: string): Promise<string> {
    const fileName = `${lang}.ts`;
    const filePath = path.join(this.config.outputDir, fileName);

    const content = `export default ${JSON.stringify(data, null, 2)} as const;\n`;

    fs.writeFileSync(filePath, content, 'utf-8');
    logger.dim(`  Created ${fileName}`);

    return filePath;
  }

  private async writeIndexFile(): Promise<string> {
    const filePath = path.join(this.config.outputDir, 'index.ts');
    const allLangs = [this.config.sourceLanguage, ...this.config.targetLanguages];

    const imports = allLangs.map(lang => `import ${lang} from './${lang}.js';`).join('\n');
    const exports = `export { ${allLangs.join(', ')} };`;
    const defaultExport = `\nexport default { ${allLangs.join(', ')} } as const;\n`;
    const typeExport = `\nexport type SupportedLocale = ${allLangs.map(l => `'${l}'`).join(' | ')};\n`;

    const content = `${imports}\n\n${exports}\n${typeExport}${defaultExport}`;

    fs.writeFileSync(filePath, content, 'utf-8');
    logger.dim(`  Created index.ts`);

    return filePath;
  }

  private async writeKeysFile(texts: ExtractedText[]): Promise<string> {
    const filePath = path.join(this.config.outputDir, 'keys.ts');
    const keys = texts.map(t => t.key);

    const content = `// Auto-generated translation keys
export const translationKeys = [
${keys.map(k => `  '${k}',`).join('\n')}
] as const;

export type TranslationKey = typeof translationKeys[number];
`;

    fs.writeFileSync(filePath, content, 'utf-8');
    logger.dim(`  Created keys.ts`);

    return filePath;
  }
}

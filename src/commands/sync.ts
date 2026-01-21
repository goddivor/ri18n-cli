import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { I18nOutput } from '../types/index.js';

interface SyncOptions {
  config?: string;
  locales?: string;
  fill?: 'empty' | 'source' | 'key';
  remove?: boolean;
}

interface SyncResult {
  lang: string;
  added: string[];
  removed: string[];
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Synchronize translation files across all languages')
    .option('-c, --config <path>', 'Path to config file')
    .option('--locales <dir>', 'Locales directory', './locales')
    .option('--fill <mode>', 'How to fill missing keys: empty, source, key', 'source')
    .option('--remove', 'Remove keys not present in source file')
    .action(async (options: SyncOptions) => {
      await runSync(options);
    });
}

async function runSync(options: SyncOptions): Promise<void> {
  logger.title('React i18n Sync');

  // Load config
  let config = loadConfig(options.config);
  config = resolveConfigPaths(config);

  const localesDir = options.locales ? path.resolve(options.locales) : path.resolve(config.outputDir);
  const fillMode = options.fill || 'source';

  // Check if locales directory exists
  if (!fs.existsSync(localesDir)) {
    logger.error(`Locales directory not found: ${localesDir}`);
    logger.info('Run "ri18n extract" first to generate translation files.');
    return;
  }

  // Load source file
  const sourceFile = path.join(localesDir, `${config.sourceLanguage}.json`);
  if (!fs.existsSync(sourceFile)) {
    logger.error(`Source translations not found: ${sourceFile}`);
    logger.info('Run "ri18n extract" first to generate translation files.');
    return;
  }

  const spinner = ora('Loading translation files...').start();

  const sourceTranslations = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as I18nOutput;
  const sourceKeys = getAllKeys(sourceTranslations);

  spinner.succeed(`Loaded source file: ${config.sourceLanguage}.json (${sourceKeys.size} keys)`);

  // Find all language files
  const languageFiles = fs.readdirSync(localesDir)
    .filter(f => f.endsWith('.json') && f !== `${config.sourceLanguage}.json`)
    .map(f => f.replace('.json', ''));

  if (languageFiles.length === 0) {
    logger.warning('No target language files found to sync.');
    return;
  }

  logger.info(`Found ${languageFiles.length} target language(s): ${languageFiles.join(', ')}`);
  logger.newLine();

  const results: SyncResult[] = [];

  for (const lang of languageFiles) {
    const langFile = path.join(localesDir, `${lang}.json`);
    const langTranslations = JSON.parse(fs.readFileSync(langFile, 'utf-8')) as I18nOutput;
    const langKeys = getAllKeys(langTranslations);

    const result: SyncResult = { lang, added: [], removed: [] };

    // Find missing keys (in source but not in target)
    const missingKeys: string[] = [];
    sourceKeys.forEach(key => {
      if (!langKeys.has(key)) {
        missingKeys.push(key);
      }
    });

    // Find extra keys (in target but not in source)
    const extraKeys: string[] = [];
    langKeys.forEach(key => {
      if (!sourceKeys.has(key)) {
        extraKeys.push(key);
      }
    });

    // Add missing keys
    for (const key of missingKeys) {
      const sourceValue = getValueByKey(sourceTranslations, key);
      let newValue: string;

      switch (fillMode) {
        case 'empty':
          newValue = '';
          break;
        case 'key':
          newValue = key;
          break;
        case 'source':
        default:
          newValue = sourceValue;
          break;
      }

      setValueByKey(langTranslations, key, newValue);
      result.added.push(key);
    }

    // Remove extra keys if --remove flag is set
    if (options.remove) {
      for (const key of extraKeys) {
        removeKeyByPath(langTranslations, key);
        result.removed.push(key);
      }
    }

    // Save updated translations
    fs.writeFileSync(langFile, JSON.stringify(langTranslations, null, 2) + '\n', 'utf-8');

    results.push(result);

    // Log result
    if (result.added.length > 0 || result.removed.length > 0) {
      logger.success(`${lang}.json:`);
      if (result.added.length > 0) {
        logger.dim(`  + Added ${result.added.length} missing keys`);
      }
      if (result.removed.length > 0) {
        logger.dim(`  - Removed ${result.removed.length} extra keys`);
      }
    } else {
      logger.dim(`${lang}.json: Already in sync`);
    }
  }

  // Summary
  logger.newLine();
  const totalAdded = results.reduce((sum, r) => sum + r.added.length, 0);
  const totalRemoved = results.reduce((sum, r) => sum + r.removed.length, 0);

  logger.box('Sync Summary', [
    `Languages synced: ${languageFiles.length}`,
    `Total keys added: ${totalAdded}`,
    `Total keys removed: ${totalRemoved}`,
    `Fill mode: ${fillMode}`,
  ]);
}

function getAllKeys(obj: I18nOutput, prefix = ''): Set<string> {
  const keys = new Set<string>();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      keys.add(fullKey);
    } else {
      const nested = getAllKeys(value, fullKey);
      nested.forEach(k => keys.add(k));
    }
  }

  return keys;
}

function getValueByKey(obj: I18nOutput, keyPath: string): string {
  const parts = keyPath.split('.');
  let current: I18nOutput | string = obj;

  for (const part of parts) {
    if (typeof current === 'string') return '';
    current = current[part];
    if (current === undefined) return '';
  }

  return typeof current === 'string' ? current : '';
}

function setValueByKey(obj: I18nOutput, keyPath: string, value: string): void {
  const parts = keyPath.split('.');
  let current: I18nOutput = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] === 'string') {
      current[part] = {};
    }
    current = current[part] as I18nOutput;
  }

  current[parts[parts.length - 1]] = value;
}

function removeKeyByPath(obj: I18nOutput, keyPath: string): void {
  const parts = keyPath.split('.');
  let current: I18nOutput = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) return;
    if (typeof current[part] === 'string') return;
    current = current[part] as I18nOutput;
  }

  delete current[parts[parts.length - 1]];

  // Clean up empty parent objects
  cleanEmptyObjects(obj, parts.slice(0, -1));
}

function cleanEmptyObjects(obj: I18nOutput, path: string[]): void {
  if (path.length === 0) return;

  let current: I18nOutput = obj;
  const parents: { obj: I18nOutput; key: string }[] = [];

  for (const part of path) {
    if (typeof current[part] !== 'object') return;
    parents.push({ obj: current, key: part });
    current = current[part] as I18nOutput;
  }

  // Check from deepest to shallowest
  for (let i = parents.length - 1; i >= 0; i--) {
    const { obj: parent, key } = parents[i];
    const child = parent[key];
    if (typeof child === 'object' && Object.keys(child).length === 0) {
      delete parent[key];
    } else {
      break;
    }
  }
}

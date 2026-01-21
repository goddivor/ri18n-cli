import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { I18nOutput } from '../types/index.js';

interface ValidateOptions {
  config?: string;
  locales?: string;
  strict?: boolean;
}

interface ValidationIssue {
  type: 'missing' | 'empty' | 'placeholder_mismatch' | 'extra';
  lang: string;
  key: string;
  details?: string;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate translation files for issues')
    .option('-c, --config <path>', 'Path to config file')
    .option('--locales <dir>', 'Locales directory', './locales')
    .option('--strict', 'Fail on any issue (exit code 1)')
    .action(async (options: ValidateOptions) => {
      const success = await runValidate(options);
      if (!success && options.strict) {
        process.exit(1);
      }
    });
}

async function runValidate(options: ValidateOptions): Promise<boolean> {
  logger.title('React i18n Validate');

  // Load config
  let config = loadConfig(options.config);
  config = resolveConfigPaths(config);

  const localesDir = options.locales ? path.resolve(options.locales) : path.resolve(config.outputDir);

  // Check if locales directory exists
  if (!fs.existsSync(localesDir)) {
    logger.error(`Locales directory not found: ${localesDir}`);
    logger.info('Run "ri18n extract" first to generate translation files.');
    return false;
  }

  // Load source file
  const sourceFile = path.join(localesDir, `${config.sourceLanguage}.json`);
  if (!fs.existsSync(sourceFile)) {
    logger.error(`Source translations not found: ${sourceFile}`);
    logger.info('Run "ri18n extract" first to generate translation files.');
    return false;
  }

  const spinner = ora('Loading translation files...').start();

  const sourceTranslations = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as I18nOutput;
  const sourceKeys = getAllKeysWithValues(sourceTranslations);

  spinner.succeed(`Loaded source file: ${config.sourceLanguage}.json (${sourceKeys.size} keys)`);

  // Find all language files
  const languageFiles = fs.readdirSync(localesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));

  logger.info(`Validating ${languageFiles.length} language(s): ${languageFiles.join(', ')}`);
  logger.newLine();

  const issues: ValidationIssue[] = [];

  for (const lang of languageFiles) {
    const langFile = path.join(localesDir, `${lang}.json`);
    const langTranslations = JSON.parse(fs.readFileSync(langFile, 'utf-8')) as I18nOutput;
    const langKeys = getAllKeysWithValues(langTranslations);

    // Check for empty values
    langKeys.forEach((value, key) => {
      if (value === '') {
        issues.push({
          type: 'empty',
          lang,
          key,
        });
      }
    });

    // Skip comparison for source language
    if (lang === config.sourceLanguage) continue;

    // Check for missing keys
    sourceKeys.forEach((sourceValue, key) => {
      if (!langKeys.has(key)) {
        issues.push({
          type: 'missing',
          lang,
          key,
        });
      } else {
        // Check for placeholder mismatches
        const langValue = langKeys.get(key) || '';
        const sourcePlaceholders = extractPlaceholders(sourceValue);
        const langPlaceholders = extractPlaceholders(langValue);

        if (!placeholdersMatch(sourcePlaceholders, langPlaceholders)) {
          issues.push({
            type: 'placeholder_mismatch',
            lang,
            key,
            details: `Source: ${sourcePlaceholders.join(', ')} | ${lang}: ${langPlaceholders.join(', ')}`,
          });
        }
      }
    });

    // Check for extra keys (not in source)
    langKeys.forEach((_, key) => {
      if (!sourceKeys.has(key)) {
        issues.push({
          type: 'extra',
          lang,
          key,
        });
      }
    });
  }

  // Display issues
  if (issues.length === 0) {
    logger.success('All translation files are valid!');
    return true;
  }

  // Group issues by type
  const missingIssues = issues.filter(i => i.type === 'missing');
  const emptyIssues = issues.filter(i => i.type === 'empty');
  const placeholderIssues = issues.filter(i => i.type === 'placeholder_mismatch');
  const extraIssues = issues.filter(i => i.type === 'extra');

  if (missingIssues.length > 0) {
    logger.error(`Missing translations: ${missingIssues.length}`);
    const grouped = groupByLang(missingIssues);
    for (const [lang, langIssues] of Object.entries(grouped)) {
      logger.dim(`  ${lang}:`);
      langIssues.slice(0, 5).forEach(i => logger.dim(`    - ${i.key}`));
      if (langIssues.length > 5) {
        logger.dim(`    ... and ${langIssues.length - 5} more`);
      }
    }
    logger.newLine();
  }

  if (emptyIssues.length > 0) {
    logger.warning(`Empty translations: ${emptyIssues.length}`);
    const grouped = groupByLang(emptyIssues);
    for (const [lang, langIssues] of Object.entries(grouped)) {
      logger.dim(`  ${lang}:`);
      langIssues.slice(0, 5).forEach(i => logger.dim(`    - ${i.key}`));
      if (langIssues.length > 5) {
        logger.dim(`    ... and ${langIssues.length - 5} more`);
      }
    }
    logger.newLine();
  }

  if (placeholderIssues.length > 0) {
    logger.error(`Placeholder mismatches: ${placeholderIssues.length}`);
    placeholderIssues.slice(0, 5).forEach(i => {
      logger.dim(`  ${i.lang}: ${i.key}`);
      logger.dim(`    ${i.details}`);
    });
    if (placeholderIssues.length > 5) {
      logger.dim(`  ... and ${placeholderIssues.length - 5} more`);
    }
    logger.newLine();
  }

  if (extraIssues.length > 0) {
    logger.warning(`Extra keys (not in source): ${extraIssues.length}`);
    const grouped = groupByLang(extraIssues);
    for (const [lang, langIssues] of Object.entries(grouped)) {
      logger.dim(`  ${lang}:`);
      langIssues.slice(0, 5).forEach(i => logger.dim(`    - ${i.key}`));
      if (langIssues.length > 5) {
        logger.dim(`    ... and ${langIssues.length - 5} more`);
      }
    }
    logger.newLine();
  }

  // Summary
  logger.box('Validation Summary', [
    `Total issues: ${issues.length}`,
    `Missing: ${missingIssues.length}`,
    `Empty: ${emptyIssues.length}`,
    `Placeholder mismatches: ${placeholderIssues.length}`,
    `Extra keys: ${extraIssues.length}`,
    '',
    'Run "ri18n sync" to fix missing/extra keys',
    'Run "ri18n translate" to fill empty values',
  ]);

  return issues.length === 0;
}

function getAllKeysWithValues(obj: I18nOutput, prefix = ''): Map<string, string> {
  const keys = new Map<string, string>();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      keys.set(fullKey, value);
    } else {
      const nested = getAllKeysWithValues(value, fullKey);
      nested.forEach((v, k) => keys.set(k, v));
    }
  }

  return keys;
}

function extractPlaceholders(text: string): string[] {
  // Match {{name}}, {name}, %{name}, %(name)s, :name, $t(key)
  const patterns = [
    /\{\{([^}]+)\}\}/g,  // {{name}}
    /\{([^}]+)\}/g,      // {name}
    /%\{([^}]+)\}/g,     // %{name}
    /%\(([^)]+)\)s/g,    // %(name)s
    /:([a-zA-Z_]+)/g,    // :name
    /\$t\(([^)]+)\)/g,   // $t(key)
  ];

  const placeholders = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      placeholders.add(match[1]);
    }
  }

  return Array.from(placeholders).sort();
}

function placeholdersMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

function groupByLang(issues: ValidationIssue[]): Record<string, ValidationIssue[]> {
  return issues.reduce((acc, issue) => {
    if (!acc[issue.lang]) {
      acc[issue.lang] = [];
    }
    acc[issue.lang].push(issue);
    return acc;
  }, {} as Record<string, ValidationIssue[]>);
}

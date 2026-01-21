import type { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import { saveConfig, findConfigFile } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_CONFIG, type ExtractionConfig } from '../types/index.js';

interface InitOptions {
  force?: boolean;
  yes?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new i18n configuration file')
    .option('-f, --force', 'Overwrite existing config file')
    .option('-y, --yes', 'Use default values without prompting')
    .action(async (options: InitOptions) => {
      await runInit(options);
    });
}

async function runInit(options: InitOptions): Promise<void> {
  logger.title('Initialize i18n Configuration');

  // Check for existing config
  const existingConfig = findConfigFile();
  if (existingConfig && !options.force) {
    logger.error(`Configuration file already exists: ${existingConfig}`);
    logger.info('Use --force to overwrite');
    return;
  }

  let config: ExtractionConfig;

  if (options.yes) {
    config = { ...DEFAULT_CONFIG };
    logger.info('Using default configuration');
  } else {
    config = await promptForConfig();
  }

  // Save configuration
  const configPath = saveConfig(config);
  logger.newLine();
  logger.success(`Configuration saved to ${configPath}`);

  // Show next steps
  logger.newLine();
  logger.box('Next Steps', [
    '1. Review the configuration file',
    '2. Run `react-i18n extract` to extract texts',
    '3. Translate the generated files',
  ]);
}

async function promptForConfig(): Promise<ExtractionConfig> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'sourceDir',
      message: 'Source directory:',
      default: DEFAULT_CONFIG.sourceDir,
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Output directory for translations:',
      default: DEFAULT_CONFIG.outputDir,
    },
    {
      type: 'input',
      name: 'sourceLanguage',
      message: 'Source language code:',
      default: DEFAULT_CONFIG.sourceLanguage,
    },
    {
      type: 'input',
      name: 'targetLanguages',
      message: 'Target language codes (comma-separated):',
      default: DEFAULT_CONFIG.targetLanguages.join(','),
      filter: (input: string) => input.split(',').map(s => s.trim()),
    },
    {
      type: 'checkbox',
      name: 'fileExtensions',
      message: 'File extensions to scan:',
      choices: [
        { name: '.tsx', checked: true },
        { name: '.jsx', checked: true },
        { name: '.ts', checked: true },
        { name: '.js', checked: true },
      ],
    },
    {
      type: 'list',
      name: 'outputFormat',
      message: 'Output format:',
      choices: [
        { name: 'JSON files', value: 'json' },
        { name: 'TypeScript files', value: 'typescript' },
        { name: 'Both', value: 'both' },
      ],
      default: 'json',
    },
    {
      type: 'confirm',
      name: 'flat',
      message: 'Use flat key structure?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'extractStringLiterals',
      message: 'Extract string literals (not just JSX)?',
      default: false,
    },
  ]);

  return {
    ...DEFAULT_CONFIG,
    ...answers,
  };
}

export function checkSrcDirectory(): boolean {
  return fs.existsSync('./src');
}

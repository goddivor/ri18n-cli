import * as fs from 'fs';
import * as path from 'path';
import type { ExtractionConfig } from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';

const CONFIG_FILE_NAMES = [
  'i18n.config.json',
  'react-i18n.config.json',
  '.i18nrc.json',
];

export function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = path.join(cwd, fileName);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export function loadConfig(configPath?: string): ExtractionConfig {
  const cwd = process.cwd();
  const resolvedPath = configPath
    ? path.resolve(cwd, configPath)
    : findConfigFile(cwd);

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<ExtractionConfig>;
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: ExtractionConfig, outputPath?: string): string {
  const cwd = process.cwd();
  const configPath = outputPath
    ? path.resolve(cwd, outputPath)
    : path.join(cwd, CONFIG_FILE_NAMES[0]);

  const configToSave: Partial<ExtractionConfig> = {};

  for (const [key, value] of Object.entries(config)) {
    const defaultValue = DEFAULT_CONFIG[key as keyof ExtractionConfig];
    if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
      (configToSave as Record<string, unknown>)[key] = value;
    }
  }

  // Always include essential fields
  configToSave.sourceDir = config.sourceDir;
  configToSave.outputDir = config.outputDir;
  configToSave.sourceLanguage = config.sourceLanguage;
  configToSave.targetLanguages = config.targetLanguages;

  fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2) + '\n', 'utf-8');
  return configPath;
}

function mergeConfig(
  defaults: ExtractionConfig,
  overrides: Partial<ExtractionConfig>
): ExtractionConfig {
  return {
    ...defaults,
    ...overrides,
    fileExtensions: overrides.fileExtensions || defaults.fileExtensions,
    excludePaths: overrides.excludePaths || defaults.excludePaths,
    includePaths: overrides.includePaths || defaults.includePaths,
    extractAttributes: overrides.extractAttributes || defaults.extractAttributes,
    targetLanguages: overrides.targetLanguages || defaults.targetLanguages,
  };
}

export function resolveConfigPaths(config: ExtractionConfig, cwd: string = process.cwd()): ExtractionConfig {
  return {
    ...config,
    sourceDir: path.resolve(cwd, config.sourceDir),
    outputDir: path.resolve(cwd, config.outputDir),
  };
}

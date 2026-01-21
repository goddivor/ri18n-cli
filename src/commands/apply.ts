import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import ora from 'ora';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { scanFiles } from '../utils/fileScanner.js';
import { logger } from '../utils/logger.js';
import type { I18nOutput } from '../types/index.js';

// Handle ESM/CJS interop
const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as { default: typeof _traverse }).default;
const generate = typeof _generate === 'function' ? _generate : (_generate as { default: typeof _generate }).default;

interface ApplyOptions {
  config?: string;
  source?: string;
  locales?: string;
  dryRun?: boolean;
  library?: 'react-i18next' | 'react-intl' | 'lingui';
}

interface TextMapping {
  text: string;
  key: string;
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Replace hardcoded texts with translation function calls')
    .option('-c, --config <path>', 'Path to config file')
    .option('-s, --source <dir>', 'Source directory', './src')
    .option('--locales <dir>', 'Locales directory', './locales')
    .option('--dry-run', 'Show changes without modifying files')
    .option('-l, --library <name>', 'i18n library (react-i18next, react-intl, lingui)', 'react-i18next')
    .action(async (options: ApplyOptions) => {
      await runApply(options);
    });
}

async function runApply(options: ApplyOptions): Promise<void> {
  logger.title('React i18n Apply');

  // Load config
  let config = loadConfig(options.config);
  if (options.source) config.sourceDir = options.source;
  config = resolveConfigPaths(config);

  const localesDir = options.locales ? path.resolve(options.locales) : path.resolve(config.outputDir);
  const library = options.library || 'react-i18next';

  // Load translations to build text -> key mapping
  const sourceFile = path.join(localesDir, `${config.sourceLanguage}.json`);
  if (!fs.existsSync(sourceFile)) {
    logger.error(`Source translations not found: ${sourceFile}`);
    logger.info('Run "ri18n extract" first to generate translation files.');
    return;
  }

  const translations = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as I18nOutput;
  const textToKey = buildTextToKeyMapping(translations);

  logger.info(`Loaded ${textToKey.size} text mappings from ${sourceFile}`);

  if (options.dryRun) {
    logger.warning('Dry run mode - no files will be modified');
  }

  // Scan source files
  const spinner = ora('Scanning files...').start();
  const files = await scanFiles(config);
  spinner.succeed(`Found ${files.length} files to process`);

  let totalReplacements = 0;
  let modifiedFiles = 0;

  for (const filePath of files) {
    const result = await processFile(filePath, textToKey, library, options.dryRun || false);

    if (result.replacements > 0) {
      modifiedFiles++;
      totalReplacements += result.replacements;

      if (options.dryRun) {
        logger.info(`Would modify: ${path.relative(config.sourceDir, filePath)} (${result.replacements} replacements)`);
      } else {
        logger.success(`Modified: ${path.relative(config.sourceDir, filePath)} (${result.replacements} replacements)`);
      }
    }
  }

  logger.newLine();
  logger.box('Apply Summary', [
    `Total replacements: ${totalReplacements}`,
    `Files modified: ${modifiedFiles}`,
    `Mode: ${options.dryRun ? 'Dry run' : 'Applied'}`,
  ]);

  if (!options.dryRun && modifiedFiles > 0) {
    logger.newLine();
    logger.info('Remember to:');
    logger.dim("  1. Import i18n config in main.tsx: import './i18n';");
    logger.dim('  2. Review the changes and test your application');
  }
}

function buildTextToKeyMapping(obj: I18nOutput, prefix = ''): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      // Map the text to its key
      mapping.set(value, fullKey);
    } else {
      // Recursively process nested objects
      const nested = buildTextToKeyMapping(value, fullKey);
      nested.forEach((k, v) => mapping.set(v, k));
    }
  }

  return mapping;
}

interface ProcessResult {
  replacements: number;
  errors: string[];
}

async function processFile(
  filePath: string,
  textToKey: Map<string, string>,
  library: string,
  dryRun: boolean
): Promise<ProcessResult> {
  const result: ProcessResult = { replacements: 0, errors: [] };

  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    });

    let needsHookImport = false;
    let needsHookCall = false;
    let hasHookImport = false;
    let hasHookCall = false;

    // First pass: check existing imports and hook usage
    traverse(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        if (library === 'react-i18next' && source === 'react-i18next') {
          const specifiers = path.node.specifiers;
          hasHookImport = specifiers.some(
            s => t.isImportSpecifier(s) && t.isIdentifier(s.imported) && s.imported.name === 'useTranslation'
          );
        }
      },
      CallExpression(path) {
        if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'useTranslation') {
          hasHookCall = true;
        }
      },
    });

    // Second pass: replace texts
    traverse(ast, {
      // Replace JSX text: <div>Hello</div> -> <div>{t('key')}</div>
      JSXText(path) {
        const text = path.node.value.trim();
        const key = textToKey.get(text);

        if (key) {
          const tCall = createTCall(key, library);
          path.replaceWith(t.jsxExpressionContainer(tCall));
          result.replacements++;
          needsHookImport = true;
          needsHookCall = true;
        }
      },

      // Replace JSX expression strings: <div>{"Hello"}</div> -> <div>{t('key')}</div>
      JSXExpressionContainer(path) {
        if (t.isStringLiteral(path.node.expression)) {
          const text = path.node.expression.value;
          const key = textToKey.get(text);

          if (key) {
            const tCall = createTCall(key, library);
            path.node.expression = tCall;
            result.replacements++;
            needsHookImport = true;
            needsHookCall = true;
          }
        }
      },

      // Replace JSX attributes: placeholder="Hello" -> placeholder={t('key')}
      JSXAttribute(path) {
        if (t.isStringLiteral(path.node.value)) {
          const text = path.node.value.value;
          const key = textToKey.get(text);

          if (key) {
            const tCall = createTCall(key, library);
            path.node.value = t.jsxExpressionContainer(tCall);
            result.replacements++;
            needsHookImport = true;
            needsHookCall = true;
          }
        }
      },
    });

    // If we made replacements, add import and hook call if needed
    if (result.replacements > 0) {
      if (library === 'react-i18next') {
        // Add import if needed
        if (needsHookImport && !hasHookImport) {
          addUseTranslationImport(ast);
        }

        // Add hook call inside component functions
        if (needsHookCall && !hasHookCall) {
          addUseTranslationHook(ast);
        }
      }

      // Generate new code
      const output = generate(ast, {
        retainLines: true,
        compact: false,
      }, code);

      // Post-process to add blank line before useTranslation import
      let finalCode = output.code;
      if (needsHookImport && !hasHookImport) {
        finalCode = finalCode.replace(
          /^(\/\/\n)?import { useTranslation } from ['"]react-i18next['"];/m,
          '\nimport { useTranslation } from \'react-i18next\';'
        );
      }

      if (!dryRun) {
        fs.writeFileSync(filePath, finalCode, 'utf-8');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Error processing ${filePath}: ${message}`);
  }

  return result;
}

function createTCall(key: string, library: string): t.CallExpression {
  switch (library) {
    case 'react-intl':
      // For react-intl, we'd use formatMessage, but t() is simpler for now
      return t.callExpression(t.identifier('t'), [t.stringLiteral(key)]);
    case 'lingui':
      // For lingui, we'd use t`` template literal
      return t.callExpression(t.identifier('t'), [t.stringLiteral(key)]);
    case 'react-i18next':
    default:
      return t.callExpression(t.identifier('t'), [t.stringLiteral(key)]);
  }
}

function addUseTranslationImport(ast: t.File): void {
  const importDeclaration = t.importDeclaration(
    [t.importSpecifier(t.identifier('useTranslation'), t.identifier('useTranslation'))],
    t.stringLiteral('react-i18next')
  );

  // Find the last import and add after it
  let lastImportIndex = -1;
  ast.program.body.forEach((node, index) => {
    if (t.isImportDeclaration(node)) {
      lastImportIndex = index;
    }
  });

  if (lastImportIndex >= 0) {
    ast.program.body.splice(lastImportIndex + 1, 0, importDeclaration);
  } else {
    ast.program.body.unshift(importDeclaration);
  }
}

function addUseTranslationHook(ast: t.File): void {
  // Create: const { t } = useTranslation();
  const hookCall = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.objectPattern([
        t.objectProperty(t.identifier('t'), t.identifier('t'), false, true)
      ]),
      t.callExpression(t.identifier('useTranslation'), [])
    )
  ]);

  traverse(ast, {
    // Handle: export default function ComponentName() { ... }
    ExportDefaultDeclaration(path) {
      const decl = path.node.declaration;
      if (t.isFunctionDeclaration(decl) && decl.body) {
        insertHookAtStart(decl.body, hookCall);
      }
      if (t.isArrowFunctionExpression(decl) && t.isBlockStatement(decl.body)) {
        insertHookAtStart(decl.body, hookCall);
      }
    },

    // Handle: export function ComponentName() { ... }
    ExportNamedDeclaration(path) {
      const decl = path.node.declaration;
      if (t.isFunctionDeclaration(decl) && decl.body) {
        // Check if it looks like a React component (starts with uppercase)
        if (decl.id && /^[A-Z]/.test(decl.id.name)) {
          insertHookAtStart(decl.body, hookCall);
        }
      }
      if (t.isVariableDeclaration(decl)) {
        decl.declarations.forEach(d => {
          if (t.isIdentifier(d.id) && /^[A-Z]/.test(d.id.name)) {
            if (t.isArrowFunctionExpression(d.init) && t.isBlockStatement(d.init.body)) {
              insertHookAtStart(d.init.body, hookCall);
            }
          }
        });
      }
    },

    // Handle: const ComponentName = () => { ... } (not exported inline)
    VariableDeclaration(path) {
      // Skip if already inside an export
      if (t.isExportNamedDeclaration(path.parent) || t.isExportDefaultDeclaration(path.parent)) {
        return;
      }

      path.node.declarations.forEach(d => {
        if (t.isIdentifier(d.id) && /^[A-Z]/.test(d.id.name)) {
          if (t.isArrowFunctionExpression(d.init) && t.isBlockStatement(d.init.body)) {
            insertHookAtStart(d.init.body, hookCall);
          }
        }
      });
    },

    // Handle: function ComponentName() { ... } (not exported inline)
    FunctionDeclaration(path) {
      // Skip if already inside an export
      if (t.isExportNamedDeclaration(path.parent) || t.isExportDefaultDeclaration(path.parent)) {
        return;
      }

      if (path.node.id && /^[A-Z]/.test(path.node.id.name) && path.node.body) {
        insertHookAtStart(path.node.body, hookCall);
      }
    },
  });
}

function insertHookAtStart(body: t.BlockStatement, hookCall: t.VariableDeclaration): void {
  // Check if hook already exists
  const hasHook = body.body.some(stmt => {
    if (t.isVariableDeclaration(stmt)) {
      return stmt.declarations.some(d => {
        if (t.isObjectPattern(d.id)) {
          return d.id.properties.some(prop => {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              return prop.key.name === 't';
            }
            return false;
          });
        }
        return false;
      });
    }
    return false;
  });

  if (!hasHook) {
    // Clone the hook call to avoid reference issues
    const newHookCall = t.cloneNode(hookCall, true);
    body.body.unshift(newHookCall);
  }
}

import type { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import ora from 'ora';
import { loadConfig, resolveConfigPaths } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

type I18nLibrary = 'react-i18next' | 'react-intl' | 'lingui';

interface SetupOptions {
  config?: string;
  library?: I18nLibrary;
  locales?: string;
  output?: string;
  yes?: boolean;
  skipInstall?: boolean;
}

interface SetupAnswers {
  library: I18nLibrary;
  localesDir: string;
  outputDir: string;
  defaultLang: string;
  languages: string[];
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Generate i18n configuration for your React project')
    .option('-c, --config <path>', 'Path to config file')
    .option('-l, --library <name>', 'i18n library (react-i18next, react-intl, lingui)')
    .option('--locales <dir>', 'Locales directory', './locales')
    .option('-o, --output <dir>', 'Output directory for config files', './src')
    .option('-y, --yes', 'Use default values without prompting')
    .option('--skip-install', 'Skip automatic npm install')
    .action(async (options: SetupOptions) => {
      await runSetup(options);
    });
}

async function runSetup(options: SetupOptions): Promise<void> {
  logger.title('React i18n Setup');

  // Load existing config
  let config = loadConfig(options.config);
  config = resolveConfigPaths(config);

  let answers: SetupAnswers;

  if (options.yes) {
    answers = {
      library: options.library || 'react-i18next',
      localesDir: options.locales || config.outputDir || './locales',
      outputDir: options.output || './src',
      defaultLang: config.sourceLanguage || 'en',
      languages: [config.sourceLanguage, ...config.targetLanguages],
    };
  } else {
    answers = await promptForSetup(config, options);
  }

  // Step 1: Install dependencies
  if (!options.skipInstall) {
    await installDependencies(answers.library);
  }

  // Step 2: Generate config files
  const createdFiles: string[] = [];

  switch (answers.library) {
    case 'react-i18next':
      createdFiles.push(...await generateReactI18next(answers));
      break;
    case 'react-intl':
      createdFiles.push(...await generateReactIntl(answers));
      break;
    case 'lingui':
      createdFiles.push(...await generateLingui(answers));
      break;
  }

  logger.newLine();
  logger.success(`Created ${createdFiles.length} config files`);
  createdFiles.forEach(f => logger.dim(`  ${f}`));

  // Step 3: Auto-add import to main.tsx/main.ts
  const mainFileUpdated = await addI18nImportToMain(answers.outputDir);
  if (mainFileUpdated) {
    logger.success(`Added i18n import to ${mainFileUpdated}`);
  }

  // Show summary
  logger.newLine();
  logger.box('Setup Complete', [
    `Library: ${answers.library}`,
    `Config: ${answers.outputDir}/i18n.ts`,
    `Languages: ${answers.languages.join(', ')}`,
    '',
    'Next: Run "ri18n apply" to replace texts with t() calls',
  ]);
}

async function installDependencies(library: I18nLibrary): Promise<void> {
  const deps: Record<I18nLibrary, { prod: string[]; dev: string[] }> = {
    'react-i18next': {
      prod: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
      dev: [],
    },
    'react-intl': {
      prod: ['react-intl'],
      dev: [],
    },
    'lingui': {
      prod: ['@lingui/core', '@lingui/react'],
      dev: ['@lingui/cli', '@lingui/macro'],
    },
  };

  const { prod, dev } = deps[library];

  // Detect package manager
  const packageManager = detectPackageManager();

  if (prod.length > 0) {
    const spinner = ora(`Installing ${prod.join(', ')}...`).start();
    try {
      const installCmd = packageManager === 'yarn'
        ? `yarn add ${prod.join(' ')}`
        : packageManager === 'pnpm'
          ? `pnpm add ${prod.join(' ')}`
          : `npm install ${prod.join(' ')}`;

      await execAsync(installCmd, { cwd: process.cwd() });
      spinner.succeed(`Installed ${prod.join(', ')}`);
    } catch (error) {
      spinner.fail(`Failed to install dependencies`);
      logger.warning('Please install manually:');
      logger.dim(`  npm install ${prod.join(' ')}`);
    }
  }

  if (dev.length > 0) {
    const spinner = ora(`Installing dev dependencies...`).start();
    try {
      const installCmd = packageManager === 'yarn'
        ? `yarn add -D ${dev.join(' ')}`
        : packageManager === 'pnpm'
          ? `pnpm add -D ${dev.join(' ')}`
          : `npm install -D ${dev.join(' ')}`;

      await execAsync(installCmd, { cwd: process.cwd() });
      spinner.succeed(`Installed dev: ${dev.join(', ')}`);
    } catch (error) {
      spinner.fail(`Failed to install dev dependencies`);
      logger.warning('Please install manually:');
      logger.dim(`  npm install -D ${dev.join(' ')}`);
    }
  }
}

function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}

async function addI18nImportToMain(srcDir: string): Promise<string | null> {
  // Look for main.tsx, main.ts, index.tsx, index.ts
  const possibleMains = [
    'main.tsx',
    'main.ts',
    'index.tsx',
    'index.ts',
  ];

  for (const mainFile of possibleMains) {
    const mainPath = path.join(srcDir, mainFile);
    if (fs.existsSync(mainPath)) {
      const content = fs.readFileSync(mainPath, 'utf-8');

      // Check if import already exists
      if (content.includes("import './i18n'") || content.includes('import "./i18n"')) {
        logger.dim(`  i18n import already exists in ${mainFile}`);
        return null;
      }

      // Add import after the last import statement
      const lines = content.split('\n');
      let lastImportIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) {
          lastImportIndex = i;
        }
      }

      if (lastImportIndex >= 0) {
        // Insert after last import with a blank line before
        lines.splice(lastImportIndex + 1, 0, '', "import './i18n';");
      } else {
        // No imports found, add at the beginning
        lines.unshift("import './i18n';", '');
      }

      fs.writeFileSync(mainPath, lines.join('\n'), 'utf-8');
      return mainFile;
    }
  }

  logger.warning('Could not find main.tsx or index.tsx to add i18n import');
  logger.dim("  Please add: import './i18n'; to your entry file");
  return null;
}

async function promptForSetup(config: ReturnType<typeof loadConfig>, options: SetupOptions): Promise<SetupAnswers> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'library',
      message: 'Which i18n library do you want to use?',
      choices: [
        { name: 'react-i18next (Recommended)', value: 'react-i18next' },
        { name: 'react-intl (FormatJS)', value: 'react-intl' },
        { name: 'lingui', value: 'lingui' },
      ],
      default: options.library || 'react-i18next',
    },
    {
      type: 'input',
      name: 'localesDir',
      message: 'Locales directory:',
      default: options.locales || config.outputDir || './locales',
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Output directory for config files:',
      default: options.output || './src',
    },
    {
      type: 'input',
      name: 'defaultLang',
      message: 'Default language:',
      default: config.sourceLanguage || 'en',
    },
    {
      type: 'input',
      name: 'languagesStr',
      message: 'Supported languages (comma-separated):',
      default: [config.sourceLanguage, ...config.targetLanguages].join(','),
    },
  ]);

  return {
    ...answers,
    languages: answers.languagesStr.split(',').map((s: string) => s.trim()),
  };
}

async function generateReactI18next(answers: SetupAnswers): Promise<string[]> {
  const files: string[] = [];
  const { localesDir, outputDir, defaultLang, languages } = answers;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const relativePath = path.relative(outputDir, localesDir);
  const imports = languages
    .map(lang => `import ${lang} from '${relativePath}/${lang}.json';`)
    .join('\n');

  const resources = languages
    .map(lang => `    ${lang}: { translation: ${lang} },`)
    .join('\n');

  const i18nConfig = `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

${imports}

export const supportedLanguages = [${languages.map(l => `'${l}'`).join(', ')}] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
${resources}
    },
    lng: '${defaultLang}',
    fallbackLng: '${defaultLang}',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;
`;

  const i18nPath = path.join(outputDir, 'i18n.ts');
  fs.writeFileSync(i18nPath, i18nConfig, 'utf-8');
  files.push(i18nPath);
  logger.dim(`  Created ${i18nPath}`);

  // Generate LanguageSwitcher component
  const switcherContent = `import { useTranslation } from 'react-i18next';
import { supportedLanguages, type SupportedLanguage } from '../i18n';

const languageNames: Record<SupportedLanguage, string> = {
${languages.map(lang => `  ${lang}: '${getLanguageName(lang)}',`).join('\n')}
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lang: SupportedLanguage) => {
    i18n.changeLanguage(lang);
  };

  return (
    <select
      value={i18n.language}
      onChange={(e) => changeLanguage(e.target.value as SupportedLanguage)}
      className="language-switcher"
    >
      {supportedLanguages.map((lang) => (
        <option key={lang} value={lang}>
          {languageNames[lang]}
        </option>
      ))}
    </select>
  );
}
`;

  const switcherPath = path.join(outputDir, 'components', 'LanguageSwitcher.tsx');
  const componentsDir = path.dirname(switcherPath);
  if (!fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
  }
  fs.writeFileSync(switcherPath, switcherContent, 'utf-8');
  files.push(switcherPath);
  logger.dim(`  Created ${switcherPath}`);

  return files;
}

async function generateReactIntl(answers: SetupAnswers): Promise<string[]> {
  const files: string[] = [];
  const { localesDir, outputDir, defaultLang, languages } = answers;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const relativePath = path.relative(outputDir, localesDir);
  const imports = languages
    .map(lang => `import ${lang}Messages from '${relativePath}/${lang}.json';`)
    .join('\n');

  const messagesObj = languages
    .map(lang => `  ${lang}: ${lang}Messages,`)
    .join('\n');

  const intlConfig = `import { IntlProvider } from 'react-intl';
import { useState, createContext, useContext, type ReactNode } from 'react';

${imports}

export const supportedLanguages = [${languages.map(l => `'${l}'`).join(', ')}] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

const messages: Record<SupportedLanguage, Record<string, string>> = {
${messagesObj}
};

function flattenMessages(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const newKey = prefix ? \`\${prefix}.\${key}\` : key;
    if (typeof value === 'string') {
      acc[newKey] = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(acc, flattenMessages(value as Record<string, unknown>, newKey));
    }
    return acc;
  }, {} as Record<string, string>);
}

interface I18nContextType {
  locale: SupportedLanguage;
  setLocale: (locale: SupportedLanguage) => void;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function useLocale() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useLocale must be used within I18nProvider');
  return context;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<SupportedLanguage>('${defaultLang}');
  const flatMessages = flattenMessages(messages[locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      <IntlProvider locale={locale} messages={flatMessages} defaultLocale="${defaultLang}">
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  );
}
`;

  const intlPath = path.join(outputDir, 'i18n.tsx');
  fs.writeFileSync(intlPath, intlConfig, 'utf-8');
  files.push(intlPath);
  logger.dim(`  Created ${intlPath}`);

  return files;
}

async function generateLingui(answers: SetupAnswers): Promise<string[]> {
  const files: string[] = [];
  const { localesDir, outputDir, defaultLang, languages } = answers;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const linguiConfig = `import type { LinguiConfig } from '@lingui/conf';

const config: LinguiConfig = {
  locales: [${languages.map(l => `'${l}'`).join(', ')}],
  sourceLocale: '${defaultLang}',
  catalogs: [
    {
      path: '${localesDir}/{locale}',
      include: ['src'],
    },
  ],
};

export default config;
`;

  const linguiConfigPath = path.join(process.cwd(), 'lingui.config.ts');
  fs.writeFileSync(linguiConfigPath, linguiConfig, 'utf-8');
  files.push(linguiConfigPath);
  logger.dim(`  Created ${linguiConfigPath}`);

  const i18nContent = `import { i18n } from '@lingui/core';
${languages.map(lang => `import { messages as ${lang}Messages } from '${path.relative(outputDir, localesDir)}/${lang}';`).join('\n')}

export const supportedLanguages = [${languages.map(l => `'${l}'`).join(', ')}] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

export function loadLocale(locale: SupportedLanguage) {
  switch (locale) {
${languages.map(lang => `    case '${lang}':
      i18n.load(locale, ${lang}Messages);
      break;`).join('\n')}
  }
  i18n.activate(locale);
}

loadLocale('${defaultLang}');

export { i18n };
`;

  const i18nPath = path.join(outputDir, 'i18n.ts');
  fs.writeFileSync(i18nPath, i18nContent, 'utf-8');
  files.push(i18nPath);
  logger.dim(`  Created ${i18nPath}`);

  return files;
}

function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
    it: 'Italiano',
    pt: 'Português',
    nl: 'Nederlands',
    ru: 'Русский',
    zh: '中文',
    ja: '日本語',
    ko: '한국어',
    ar: 'العربية',
  };
  return names[code] || code.toUpperCase();
}

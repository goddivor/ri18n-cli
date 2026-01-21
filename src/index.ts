#!/usr/bin/env node

import { Command } from 'commander';
import { registerExtractCommand } from './commands/extract.js';
import { registerInitCommand } from './commands/init.js';
import { registerScanCommand } from './commands/scan.js';
import { registerTranslateCommand } from './commands/translate.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerValidateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('react-i18n')
  .description('CLI tool for extracting and managing i18n translations in React applications')
  .version('1.0.0');

// Register commands
registerInitCommand(program);
registerExtractCommand(program);
registerScanCommand(program);
registerTranslateCommand(program);
registerSetupCommand(program);
registerApplyCommand(program);
registerSyncCommand(program);
registerValidateCommand(program);

// Parse arguments
program.parse();

import chalk from 'chalk';

export const logger = {
  info: (message: string) => {
    console.log(chalk.blue('ℹ'), message);
  },

  success: (message: string) => {
    console.log(chalk.green('✓'), message);
  },

  warning: (message: string) => {
    console.log(chalk.yellow('⚠'), message);
  },

  error: (message: string) => {
    console.log(chalk.red('✗'), message);
  },

  dim: (message: string) => {
    console.log(chalk.dim(message));
  },

  title: (message: string) => {
    console.log();
    console.log(chalk.bold.cyan(message));
    console.log(chalk.dim('─'.repeat(50)));
  },

  table: (data: Record<string, string | number>[]) => {
    console.table(data);
  },

  newLine: () => {
    console.log();
  },

  box: (title: string, content: string[]) => {
    const maxLength = Math.max(title.length, ...content.map(c => c.length));
    const border = '─'.repeat(maxLength + 4);

    console.log(chalk.cyan(`┌${border}┐`));
    console.log(chalk.cyan('│'), chalk.bold(title.padEnd(maxLength + 2)), chalk.cyan('│'));
    console.log(chalk.cyan(`├${border}┤`));
    content.forEach(line => {
      console.log(chalk.cyan('│'), line.padEnd(maxLength + 2), chalk.cyan('│'));
    });
    console.log(chalk.cyan(`└${border}┘`));
  },

  stats: (stats: Record<string, number>) => {
    logger.newLine();
    Object.entries(stats).forEach(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').trim();
      console.log(chalk.dim('  •'), `${label}:`, chalk.bold(value.toString()));
    });
  },
};

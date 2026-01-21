import fg from 'fast-glob';
import * as path from 'path';
import type { ExtractionConfig } from '../types/index.js';

export async function scanFiles(config: ExtractionConfig): Promise<string[]> {
  const { sourceDir, fileExtensions, excludePaths, includePaths } = config;

  const patterns = fileExtensions.map(ext => {
    const extPattern = ext.startsWith('.') ? `*${ext}` : `*.${ext}`;
    return includePaths.map(include => {
      if (include === '**/*') {
        return `**/${extPattern}`;
      }
      return path.join(include, extPattern);
    });
  }).flat();

  const ignorePatterns = excludePaths.map(p => {
    if (p.startsWith('**/')) return p;
    if (p.includes('*')) return p;
    return `**/${p}/**`;
  });

  const files = await fg(patterns, {
    cwd: path.resolve(sourceDir),
    ignore: ignorePatterns,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  return files.sort();
}

export function getRelativePath(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath);
}

export function ensureAbsolutePath(filePath: string, baseDir: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(baseDir, filePath);
}

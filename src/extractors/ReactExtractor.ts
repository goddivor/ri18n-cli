import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ExtractedText, ExtractedTextContext, ExtractionConfig } from '../types/index.js';

// Handle ESM/CJS interop for @babel/traverse
const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as { default: typeof _traverse }).default;

export interface FileExtractionResult {
  texts: ExtractedText[];
  errors: string[];
}

export class ReactExtractor {
  private config: ExtractionConfig;
  private idCounter = 0;

  constructor(config: ExtractionConfig) {
    this.config = config;
  }

  async extractFromFile(filePath: string): Promise<FileExtractionResult> {
    const result: FileExtractionResult = { texts: [], errors: [] };

    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy'],
      });

      const componentName = this.getComponentName(filePath);
      const relativePath = path.relative(this.config.sourceDir, filePath);

      traverse(ast, {
        JSXText: (nodePath) => {
          // Check for i18n-ignore comment
          if (this.hasIgnoreComment(nodePath)) return;

          const text = nodePath.node.value.trim();
          if (this.shouldExtractText(text)) {
            result.texts.push(
              this.createExtractedText({
                filePath: relativePath,
                node: nodePath.node,
                text,
                componentName,
                type: 'jsx-text',
                parentElement: this.getParentJSXElement(nodePath),
              })
            );
          }
        },

        JSXExpressionContainer: (nodePath) => {
          // Check for i18n-ignore comment
          if (this.hasIgnoreComment(nodePath)) return;

          if (t.isStringLiteral(nodePath.node.expression)) {
            const text = nodePath.node.expression.value;
            if (this.shouldExtractText(text)) {
              result.texts.push(
                this.createExtractedText({
                  filePath: relativePath,
                  node: nodePath.node,
                  text,
                  componentName,
                  type: 'jsx-expression',
                  parentElement: this.getParentJSXElement(nodePath),
                })
              );
            }
          }
        },

        JSXAttribute: (nodePath) => {
          // Check for i18n-ignore comment
          if (this.hasIgnoreComment(nodePath)) return;

          const attrName = t.isJSXIdentifier(nodePath.node.name)
            ? nodePath.node.name.name
            : '';

          if (this.config.extractAttributes.includes(attrName)) {
            let text = '';

            if (t.isStringLiteral(nodePath.node.value)) {
              text = nodePath.node.value.value;
            } else if (
              t.isJSXExpressionContainer(nodePath.node.value) &&
              t.isStringLiteral(nodePath.node.value.expression)
            ) {
              text = nodePath.node.value.expression.value;
            }

            if (this.shouldExtractText(text)) {
              result.texts.push(
                this.createExtractedText({
                  filePath: relativePath,
                  node: nodePath.node,
                  text,
                  componentName,
                  type: 'jsx-attribute',
                  attributeName: attrName,
                  parentElement: this.getParentJSXElement(nodePath),
                })
              );
            }
          }
        },

        StringLiteral: (nodePath) => {
          // Check for i18n-ignore comment
          if (this.hasIgnoreComment(nodePath)) return;

          if (this.config.extractStringLiterals && !this.isInJSX(nodePath)) {
            const text = nodePath.node.value;
            if (this.shouldExtractText(text)) {
              result.texts.push(
                this.createExtractedText({
                  filePath: relativePath,
                  node: nodePath.node,
                  text,
                  componentName,
                  type: 'string-literal',
                  functionName: this.getFunctionContext(nodePath),
                })
              );
            }
          }
        },

        // Handle template literals: `Hello ${name}` -> "Hello {{name}}"
        TemplateLiteral: (nodePath) => {
          // Check for i18n-ignore comment
          if (this.hasIgnoreComment(nodePath)) return;

          const { quasis, expressions } = nodePath.node;

          // Build the text with placeholders
          let text = '';
          const variables: string[] = [];

          for (let i = 0; i < quasis.length; i++) {
            text += quasis[i].value.cooked || quasis[i].value.raw;

            if (i < expressions.length) {
              const expr = expressions[i];
              let varName = `var${i}`;

              // Try to get the variable name
              if (t.isIdentifier(expr)) {
                varName = expr.name;
              } else if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
                varName = expr.property.name;
              } else if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
                varName = expr.callee.name;
              }

              variables.push(varName);
              text += `{{${varName}}}`;
            }
          }

          // Skip if it looks like CSS classes (Tailwind, etc.)
          if (this.looksLikeCSSClasses(text)) return;

          if (this.shouldExtractText(text) && variables.length > 0) {
            result.texts.push(
              this.createExtractedText({
                filePath: relativePath,
                node: nodePath.node,
                text,
                componentName,
                type: 'template-literal',
                functionName: this.getFunctionContext(nodePath),
                variables,
              })
            );
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error parsing ${filePath}: ${message}`);
    }

    return result;
  }

  private shouldExtractText(text: string): boolean {
    if (!text || text.length < this.config.minTextLength) return false;

    const trimmed = text.trim();
    if (!trimmed) return false;

    // URLs et chemins
    if (/^https?:\/\//i.test(trimmed)) return false;
    if (/^\/[a-z0-9/_-]+$/i.test(trimmed)) return false;
    if (/^\.{1,2}\/[a-z0-9/_.-]+$/i.test(trimmed)) return false;
    if (/^@[a-z0-9/_-]+$/i.test(trimmed)) return false;

    // Extensions et fichiers
    if (/\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|json|xml|csv|txt|js|ts|jsx|tsx|css|scss)$/i.test(trimmed)) return false;

    // Classes CSS Tailwind
    if (/^[\w-]+:[\w-]+/.test(trimmed)) return false;
    if (/^(bg|text|border|flex|grid|p|m|w|h|rounded|shadow|opacity|translate|animate)-[\w-]+/.test(trimmed)) return false;
    if (trimmed.includes('_') && /^[a-z]+(_[a-z0-9]+)+$/.test(trimmed) && trimmed.split('_').length > 3) return false;

    // Couleurs
    if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return false;
    if (/^rgb\(|^rgba\(|^hsl\(|^hsla\(/i.test(trimmed)) return false;

    // Valeurs CSS et unités
    if (/^[0-9.]+(%|px|em|rem|vh|vw|ms|s|deg)$/i.test(trimmed)) return false;
    if (/^[0-9\s.]+$/i.test(trimmed)) return false;

    // SVG paths
    if (/^M[0-9.\s,MLHVCSQTAZ-]+$/i.test(trimmed)) return false;

    // Identifiants techniques
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) return false;
    if (/^[A-Z_][A-Z0-9_]*$/.test(trimmed)) return false;
    if (/^[a-z]+(-[a-z0-9]+)+$/.test(trimmed)) return false;

    // Nombres et symboles
    if (/^\d+$/.test(trimmed)) return false;
    if (/^[!@#$%^&*()_+=\[\]{}|;':",./<>?`~-]+$/.test(trimmed)) return false;

    // Noms de packages
    if (/^[a-z-]+\/[a-z-]+/.test(trimmed)) return false;
    if (/^@[a-z-]+\/[a-z-]+/.test(trimmed)) return false;

    // Codes de langue ISO
    if (/^[a-z]{2}(-[A-Z]{2})?$/.test(trimmed)) return false;

    // Accepter si phrase ou titre
    const hasSpaces = /\s/.test(trimmed);
    const startsWithCapital = /^[A-Z]/.test(trimmed);
    const hasPunctuation = /[.!?]/.test(trimmed);
    const hasMultipleWords = trimmed.split(/\s+/).length > 1;

    if (hasSpaces || hasPunctuation || hasMultipleWords) return true;
    if (startsWithCapital && trimmed.length >= 3 && trimmed.length <= 30) return true;

    return false;
  }

  private createExtractedText({
    filePath,
    node,
    text,
    componentName,
    type,
    attributeName,
    parentElement,
    functionName,
    variables,
  }: {
    filePath: string;
    node: t.Node;
    text: string;
    componentName: string;
    type: ExtractedText['type'];
    attributeName?: string;
    parentElement?: string;
    functionName?: string;
    variables?: string[];
  }): ExtractedText {
    const key = this.generateKey(text, componentName, type);
    const id = this.generateId(text, filePath, node.loc?.start.line || 0);

    const context: ExtractedTextContext = {
      componentName,
      elementType: type,
      parentElement: parentElement || null,
      attributeName: attributeName || null,
      functionName: functionName || null,
      surroundingCode: '',
    };

    const result: ExtractedText = {
      id,
      text,
      key,
      file: filePath,
      line: node.loc?.start.line || 0,
      column: node.loc?.start.column || 0,
      type,
      context,
      confidence: this.calculateConfidence(text, type),
    };

    if (variables && variables.length > 0) {
      result.variables = variables;
    }

    return result;
  }

  private generateKey(text: string, component: string, elementType: string): string {
    switch (this.config.generateKeys) {
      case 'hash':
        return this.generateHashKey(text);
      case 'path':
        return this.generatePathKey(text, component);
      case 'auto':
      default:
        return this.generateAutoKey(text, component, elementType);
    }
  }

  private generateHashKey(text: string): string {
    return createHash('md5').update(text).digest('hex').substring(0, 8);
  }

  private generatePathKey(text: string, component: string): string {
    const sanitized = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 30);
    return `${component.toLowerCase()}.${sanitized}`;
  }

  private generateAutoKey(text: string, component: string, elementType: string): string {
    const sanitized = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 30);
    return `${component.toLowerCase()}.${elementType.replace('-', '_')}.${sanitized}`;
  }

  private generateId(text: string, file: string, line: number): string {
    this.idCounter++;
    const hash = createHash('md5')
      .update(`${file}:${line}:${text}`)
      .digest('hex')
      .substring(0, 8);
    return `${this.idCounter}_${hash}`;
  }

  private calculateConfidence(text: string, elementType: string): number {
    let confidence = 1;

    if (elementType === 'string-literal') confidence -= 0.3;
    if (/^[A-Z_]+$/.test(text)) confidence -= 0.2;
    if (text.length < 3) confidence -= 0.2;
    if (/^\d/.test(text)) confidence -= 0.3;

    return Math.max(0, Math.round(confidence * 100) / 100);
  }

  private getComponentName(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    const dirName = path.basename(path.dirname(filePath));

    // Use parent directory name if:
    // - filename is 'index' (common pattern: pages/landing/index.tsx)
    // - filename contains brackets like [id], [slug] (dynamic routes)
    // - filename starts with underscore (like _app, _document)
    const useParentDir =
      fileName.toLowerCase() === 'index' ||
      /^\[.+\]$/.test(fileName) ||
      fileName.startsWith('_');

    let componentName: string;

    if (useParentDir && dirName && dirName !== '.' && dirName !== 'src') {
      // Clean up directory name (remove brackets, etc.)
      componentName = dirName.replace(/[\[\]]/g, '');
    } else {
      // Clean up filename (remove brackets, etc.)
      componentName = fileName.replace(/[\[\]]/g, '');
    }

    // Capitalize first letter
    return componentName.charAt(0).toUpperCase() + componentName.slice(1);
  }

  private getParentJSXElement(nodePath: { parent?: t.Node }): string {
    let parent = nodePath.parent;
    while (parent && !t.isJSXElement(parent)) {
      parent = (parent as { parent?: t.Node }).parent;
    }

    if (
      t.isJSXElement(parent) &&
      t.isJSXIdentifier(parent.openingElement.name)
    ) {
      return parent.openingElement.name.name;
    }

    return 'unknown';
  }

  private getFunctionContext(nodePath: { node: t.Node; parent?: t.Node }): string {
    let current: { node: t.Node; parent?: t.Node } | undefined = nodePath;
    while (current) {
      if (t.isFunctionDeclaration(current.node) && current.node.id) {
        return current.node.id.name;
      }
      if (
        t.isArrowFunctionExpression(current.node) ||
        t.isFunctionExpression(current.node)
      ) {
        const parent = current.parent;
        if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
          return parent.id.name;
        }
      }
      current = current.parent ? { node: current.parent, parent: (current.parent as { parent?: t.Node }).parent } : undefined;
    }
    return 'anonymous';
  }

  private isInJSX(nodePath: { node: t.Node; parent?: t.Node }): boolean {
    let current: { node: t.Node; parent?: t.Node } | undefined = nodePath;
    while (current) {
      if (t.isJSXElement(current.node) || t.isJSXFragment(current.node)) {
        return true;
      }
      current = current.parent ? { node: current.parent, parent: (current.parent as { parent?: t.Node }).parent } : undefined;
    }
    return false;
  }

  private hasIgnoreComment(nodePath: { node: t.Node; parent?: t.Node }): boolean {
    const node = nodePath.node;

    // Check leading comments on the node itself
    if (node.leadingComments) {
      for (const comment of node.leadingComments) {
        if (this.isIgnoreComment(comment.value)) {
          return true;
        }
      }
    }

    // Check trailing comments on previous sibling or parent
    if (node.trailingComments) {
      for (const comment of node.trailingComments) {
        if (this.isIgnoreComment(comment.value)) {
          return true;
        }
      }
    }

    // Check parent node's comments (for inline comments before JSX)
    let parent = nodePath.parent;
    while (parent) {
      if ((parent as t.Node).leadingComments) {
        for (const comment of (parent as t.Node).leadingComments!) {
          if (this.isIgnoreComment(comment.value)) {
            return true;
          }
        }
      }

      // Check if parent is a JSXElement and has ignore comment
      if (t.isJSXElement(parent) || t.isJSXExpressionContainer(parent)) {
        break;
      }

      parent = (parent as { parent?: t.Node }).parent;
    }

    return false;
  }

  private isIgnoreComment(commentValue: string): boolean {
    const trimmed = commentValue.trim().toLowerCase();
    return (
      trimmed === 'i18n-ignore' ||
      trimmed === 'i18n-skip' ||
      trimmed === '@i18n-ignore' ||
      trimmed === '@i18n-skip' ||
      trimmed.startsWith('i18n-ignore:') ||
      trimmed.startsWith('i18n-skip:')
    );
  }

  private looksLikeCSSClasses(text: string): boolean {
    // Remove placeholders for analysis
    const withoutPlaceholders = text.replace(/\{\{[^}]+\}\}/g, '').trim();

    // Common Tailwind/CSS class prefixes
    const cssClassPrefixes = [
      'flex', 'grid', 'block', 'inline', 'hidden',
      'absolute', 'relative', 'fixed', 'sticky',
      'w-', 'h-', 'min-', 'max-',
      'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-',
      'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-',
      'text-', 'font-', 'leading-', 'tracking-',
      'bg-', 'border-', 'rounded-', 'shadow-',
      'opacity-', 'transition-', 'transform-', 'translate-',
      'hover:', 'focus:', 'active:', 'group-',
      'items-', 'justify-', 'gap-', 'space-',
      'overflow-', 'z-', 'cursor-',
      'col-', 'row-', 'order-',
    ];

    // Split by spaces and check each "word"
    const parts = withoutPlaceholders.split(/\s+/).filter(Boolean);

    if (parts.length === 0) return false;

    // Count how many parts look like CSS classes
    let cssClassCount = 0;
    for (const part of parts) {
      const lowerPart = part.toLowerCase();

      // Check if it starts with a known CSS prefix
      const startsWithPrefix = cssClassPrefixes.some(prefix => lowerPart.startsWith(prefix));

      // Check if it matches common CSS class patterns
      const looksLikeClass =
        startsWithPrefix ||
        /^-?[a-z]+(-[a-z0-9]+)+$/.test(lowerPart) || // kebab-case like "flex-shrink-0"
        /^[a-z]+[0-9]+$/.test(lowerPart) ||           // like "p4", "m2"
        /^!?[a-z]+-\[.+\]$/.test(lowerPart);          // arbitrary values like "w-[100px]"

      if (looksLikeClass) {
        cssClassCount++;
      }
    }

    // If more than 50% of parts look like CSS classes, skip it
    const cssRatio = cssClassCount / parts.length;
    return cssRatio > 0.5;
  }
}

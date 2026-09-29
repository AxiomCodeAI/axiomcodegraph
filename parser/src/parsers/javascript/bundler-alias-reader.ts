import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

/**
 * The `resolve.alias` of a bundler config, as `compilerOptions.paths` would spell it.
 *
 * Vite and Vue apps usually have no `jsconfig.json`: `@` → `src` is declared only in
 * `vite.config.js` (webpack apps do the same in `webpack.config.js`), so every
 * `import … from '@/x'` was UNRESOLVED_MISSING and the call behind it "by name" (#1746).
 *
 * The config is read, never run. Only a replacement the syntax fixes is taken:
 * `path.resolve(__dirname, 'src')` / `path.join(…)` / `resolve(…)`,
 * `fileURLToPath(new URL('./src', import.meta.url))`, and a root-relative string
 * (`'/src'`). A regular-expression `find`, a computed key or a replacement built from
 * anything else is skipped, so the import stays unresolved rather than guessed.
 */
export type BundlerPaths = Record<string, string[]>;

export const BUNDLER_CONFIG_NAMES: readonly string[] = [
  'vite.config.js', 'vite.config.mjs', 'vite.config.cjs',
  'vite.config.ts', 'vite.config.mts', 'vite.config.cts',
  'webpack.config.js', 'webpack.config.mjs', 'webpack.config.cjs', 'webpack.config.ts',
];

export function readBundlerAliases(configPath: string): BundlerPaths | undefined {
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  const configDir = path.dirname(configPath);
  const source = ts.createSourceFile(configPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const paths: BundlerPaths = {};
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'alias'
      && ts.isObjectLiteralExpression(node.parent) && ts.isPropertyAssignment(node.parent.parent)
      && propertyName(node.parent.parent.name) === 'resolve') {
      for (const [find, replacement] of aliasEntries(node.initializer, configDir)) {
        addAlias(paths, find, replacement);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.keys(paths).length === 0 ? undefined : paths;
}

/** `{ '@': x }` or `[{ find: '@', replacement: x }]`: each string key with a fixed replacement. */
function aliasEntries(value: ts.Expression, configDir: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const take = (find: string | undefined, replacement: ts.Expression | undefined) => {
    const target = replacement === undefined ? undefined : fixedPath(replacement, configDir);
    if (find !== undefined && find !== '' && target !== undefined) {
      entries.push([find, target]);
    }
  };
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        take(propertyName(property.name), property.initializer);
      }
    }
  } else if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (!ts.isObjectLiteralExpression(element)) {
        continue;
      }
      let find: string | undefined;
      let replacement: ts.Expression | undefined;
      for (const property of element.properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue;
        }
        const key = propertyName(property.name);
        if (key === 'find' && ts.isStringLiteralLike(property.initializer)) {
          find = property.initializer.text;
        } else if (key === 'replacement') {
          replacement = property.initializer;
        }
      }
      take(find, replacement);
    }
  }
  return entries;
}

/**
 * Webpack's `key$` is an exact match only; any other key matches itself and `key/…`,
 * which is the rule of both bundlers for a string `find`.
 */
function addAlias(paths: BundlerPaths, find: string, target: string): void {
  if (find.endsWith('$')) {
    paths[find.slice(0, -1)] ??= [target];
    return;
  }
  const key = find.endsWith('/') ? find.slice(0, -1) : find;
  paths[key] ??= [target];
  paths[`${key}/*`] ??= [`${target}/*`];
}

/** An absolute directory the expression fixes, or undefined when it depends on anything else. */
function fixedPath(expression: ts.Expression, configDir: string): string | undefined {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) {
    // A bare relative string is replaced textually and read from the IMPORTER, so it
    // fixes no directory; a leading `/` is the project root in Vite.
    return node.text.startsWith('/') ? path.join(configDir, node.text) : undefined;
  }
  if (ts.isCallExpression(node)) {
    const callee = calleeName(node.expression);
    // `require.resolve('pkg/x')` names a file inside a package, not a directory here.
    const onRequire = ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'require';
    if ((callee === 'resolve' || callee === 'join') && !onRequire) {
      const segments: string[] = [];
      for (const argument of node.arguments) {
        const segment = segmentOf(argument, configDir);
        if (segment === undefined) {
          return undefined;
        }
        segments.push(segment);
      }
      return segments.length === 0 ? undefined : path.resolve(configDir, ...segments);
    }
    if (callee === 'fileURLToPath' && node.arguments.length === 1) {
      return urlRelativeToConfig(node.arguments[0]!, configDir);
    }
    return undefined;
  }
  // `new URL('./src', import.meta.url).pathname`
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'pathname') {
    return urlRelativeToConfig(node.expression, configDir);
  }
  return undefined;
}

/** One argument of `path.resolve` / `path.join`: a string, `__dirname`, or `process.cwd()`. */
function segmentOf(expression: ts.Expression, configDir: string): string | undefined {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node) && node.text === '__dirname') {
    return configDir;
  }
  if (ts.isCallExpression(node) && node.arguments.length === 0 && calleeName(node.expression) === 'cwd') {
    return configDir;
  }
  return undefined;
}

/** `new URL('./src', import.meta.url)`: the first argument read from the config's own directory. */
function urlRelativeToConfig(expression: ts.Expression, configDir: string): string | undefined {
  const node = unwrap(expression);
  if (!ts.isNewExpression(node) || calleeName(node.expression) !== 'URL' || node.arguments?.length !== 2) {
    return undefined;
  }
  const [relative, base] = node.arguments;
  if (!ts.isStringLiteralLike(relative!) || !isImportMetaUrl(unwrap(base!))) {
    return undefined;
  }
  return relative.text.startsWith('/') ? undefined : path.resolve(configDir, relative.text);
}

function isImportMetaUrl(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === 'url'
    && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

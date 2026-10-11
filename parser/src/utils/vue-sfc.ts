import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

import { isJsComponentFile, sfcScriptText } from '@/utils/javascript';

/**
 * A Vue single-file component read as the script it compiles to.
 *
 * ## Why a virtual script, and why it keeps every line
 *
 * A `.vue` file is three languages in one file: `<script>` / `<script setup>` is
 * TypeScript or JavaScript, `<template>` is HTML whose attribute values and
 * `{{ }}` interpolations are expressions in that script's scope, and `<style>` is
 * CSS. Parsed as a whole it is nothing; skipped, every helper a template calls
 * has no caller and every component it renders has no use.
 *
 * The virtual script is the file with everything BLANKED except:
 *
 *   - each inline `<script>` block's body, verbatim, at its own line and column;
 *   - one top-level statement per template reference, on the line it is written:
 *       `<Child/>` and `<my-child>`  -> `Child(/*<tag>*\/);` / `MyChild(/*<tag>*\/);`
 *                                       (a JSX tag is a call too; see VUE_TAG_MARKER)
 *       `@ping="onPing"`             -> `onPing();`   (Vue calls a bare handler)
 *       `@ping="count++; log(x)"`    -> `count++; log(x);`
 *       `:x="fmt(y)"`, `v-if="ok"`   -> `(fmt(y));`
 *       `{{ total(items) }}`          -> `(total(items));`
 *
 * Line numbers are never moved: every row the extractors emit points at the
 * line of the `.vue` file it came from. A column can drift only when two
 * references share a line and the first one's statement is longer than the
 * text it replaced.
 *
 * A template expression that does not parse on its own is dropped rather than
 * written, so one odd attribute cannot swallow the statements after it. A
 * component with no inline script is not a script at all: {@link vueScriptLanguage}
 * answers `undefined` and the file is not analysed.
 */

/** The language of a component's inline script, or `undefined` when it has none. */
export type VueScriptLanguage = 'ts' | 'tsx' | 'js' | 'jsx';

export const VUE_EXTENSION = '.vue';

export function isVueFile(fileName: string): boolean {
  return fileName.endsWith(VUE_EXTENSION);
}

interface SfcBlock {
  readonly tag: string;
  readonly attributes: string;
  /** Offset of the first character of the body, after the opening tag. */
  readonly bodyStart: number;
  /** Offset of the closing tag's `<`. */
  readonly bodyEnd: number;
}

/** A piece of text to write at an offset of the original file. */
interface Placement {
  readonly offset: number;
  readonly text: string;
}

export function vueScriptLanguage(sourceText: string): VueScriptLanguage | undefined {
  const scripts = topLevelBlocks(sourceText).filter((b) => b.tag === 'script' && !hasSrc(b));
  if (scripts.length === 0) {
    return undefined;
  }
  const langs = scripts.map((b) => attributeValue(b.attributes, 'lang')?.toLowerCase() ?? 'js');
  if (langs.includes('tsx')) {
    return 'tsx';
  }
  if (langs.includes('ts')) {
    return 'ts';
  }
  return langs.includes('jsx') ? 'jsx' : 'js';
}

/** The `ts.ScriptKind` a component's virtual script parses under. */
export function vueScriptKind(language: VueScriptLanguage): ts.ScriptKind {
  switch (language) {
    case 'ts': return ts.ScriptKind.TS;
    case 'tsx': return ts.ScriptKind.TSX;
    case 'jsx': return ts.ScriptKind.JSX;
    default: return ts.ScriptKind.JS;
  }
}

/** The component as a script, line for line. `undefined` when it has no inline script. */
export function vueVirtualScript(sourceText: string): string | undefined {
  const language = vueScriptLanguage(sourceText);
  if (language === undefined) {
    return undefined;
  }
  const kind = vueScriptKind(language);
  const placements: Placement[] = [];
  const blocks = topLevelBlocks(sourceText);
  for (const block of blocks) {
    if (block.tag === 'script' && !hasSrc(block)) {
      placements.push({ offset: block.bodyStart, text: sourceText.slice(block.bodyStart, block.bodyEnd) });
    }
  }
  const template = blocks.find((b) => b.tag === 'template');
  const templateLang = template === undefined ? undefined : attributeValue(template.attributes, 'lang');
  if (template !== undefined && (templateLang === undefined || templateLang === 'html')) {
    placements.push(...templateReferences(sourceText, template.bodyStart, template.bodyEnd, kind));
  }
  return layOut(sourceText, placements);
}

/**
 * The language of the component at `file`, read from disk; `undefined` when it
 * has no inline script or cannot be read. Decides which analyzer claims it: the
 * TypeScript one for `ts`/`tsx`, the JavaScript one otherwise.
 */
export function vueComponentLanguage(file: string): VueScriptLanguage | undefined {
  try {
    return vueScriptLanguage(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * A source file's text as a script parser reads it, and how it parses. The one
 * place a single-file component becomes a script, for every analyzer:
 *
 *   - a `.vue` component becomes its virtual script (script bodies plus template
 *     references, see above); `language` says which analyzer it belongs to;
 *   - a `.svelte` / `.astro` component keeps only its JavaScript `<script>` blocks
 *     (and Astro's frontmatter), the rest blanked (see `sfcScriptText`);
 *   - every other file is itself.
 *
 * `unread` is set when a component holds no script the JavaScript front end can
 * read, saying what was left out, so the caller records the absence.
 *
 * Each component is transformed exactly once, here: running a second reader over
 * text the first one already blanked finds no `<script>` left and yields nothing.
 */
export function scriptTextOf(
  file: string,
  text: string
): { text: string; scriptKind?: ts.ScriptKind; language?: VueScriptLanguage; unread?: string } {
  if (isVueFile(file)) {
    const language = vueScriptLanguage(text);
    return {
      text: vueVirtualScript(text) ?? '',
      scriptKind: vueScriptKind(language ?? 'js'),
      language,
      unread: language === undefined ? 'Vue component with no inline <script>'
        : language === 'ts' || language === 'tsx'
          ? `Vue component whose <script> is lang=${language}, read by the TypeScript analyzer` : undefined,
    };
  }
  if (isJsComponentFile(path.basename(file))) {
    const script = sfcScriptText(file, text);
    return {
      text: script.text,
      unread: script.blocks.length > 0 && !script.blocks.some((block) => block.kept)
        ? `single-file component with no JavaScript to read: ${script.blocks.map((block) =>
          `<script lang=${block.lang}> at line ${block.line}`).join(', ')}`
        : undefined,
    };
  }
  return { text };
}

/**
 * The file a `.vue` specifier names, when it is relative or goes through a path
 * alias. tsc resolves no `.vue` import itself (its extensions are fixed), so
 * without this every `import Comp from './Comp.vue'` would read as unresolved.
 *
 * `import Comp from '@/components/Comp.vue'` — the usual spelling in a Vite app —
 * is mapped through `options.paths` the way tsc maps any other aliased import: the
 * pattern with the longest prefix before its `*`, each substitution in order, the
 * first that exists.
 */
export function resolveVueSpecifier(
  specifier: string,
  fromFile: string,
  options?: ts.CompilerOptions
): string | undefined {
  if (!isVueFile(specifier)) {
    return undefined;
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const file = path.normalize(path.resolve(path.dirname(fromFile), specifier));
    return fs.existsSync(file) ? file : undefined;
  }
  const base = (options?.pathsBasePath as string | undefined) ?? options?.baseUrl;
  if (options?.paths === undefined || base === undefined) {
    return undefined;
  }
  let best: { prefix: string; star: string; targets: readonly string[] } | undefined;
  for (const [pattern, targets] of Object.entries(options.paths)) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (pattern === specifier) {
        best = { prefix: pattern, star: '', targets };
        break;
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix)
      && specifier.endsWith(suffix) && (best === undefined || prefix.length > best.prefix.length)) {
      best = { prefix, star: specifier.slice(prefix.length, specifier.length - suffix.length), targets };
    }
  }
  for (const target of best?.targets ?? []) {
    const file = path.normalize(path.resolve(base, target.replace('*', best!.star)));
    if (isVueFile(file) && fs.existsSync(file)) {
      return file;
    }
  }
  return undefined;
}

// ── the file's top-level blocks ────────────────────────────────────────────

function topLevelBlocks(sourceText: string): SfcBlock[] {
  const scan = blankComments(sourceText);
  const blocks: SfcBlock[] = [];
  const open = /<(script|template|style)\b([^>]*)>/gi;
  let at = 0;
  while (at < scan.length) {
    open.lastIndex = at;
    const match = open.exec(scan);
    if (match === null) {
      break;
    }
    const tag = match[1]!.toLowerCase();
    const attributes = match[2] ?? '';
    const bodyStart = match.index + match[0].length;
    if (attributes.trimEnd().endsWith('/')) {
      at = bodyStart;
      continue;
    }
    const bodyEnd = tag === 'template'
      ? matchingTemplateClose(scan, bodyStart)
      : scan.toLowerCase().indexOf(`</${tag}`, bodyStart);
    if (bodyEnd < 0) {
      break;
    }
    blocks.push({ tag, attributes, bodyStart, bodyEnd });
    const close = scan.indexOf('>', bodyEnd);
    at = close < 0 ? scan.length : close + 1;
  }
  return blocks;
}

/** The `</template>` that closes the root one, counting the nested `<template v-slot>`s. */
function matchingTemplateClose(scan: string, from: number): number {
  const tags = /<(\/?)template\b[^>]*?(\/?)>/gi;
  tags.lastIndex = from;
  let depth = 1;
  for (let m = tags.exec(scan); m !== null; m = tags.exec(scan)) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        return m.index;
      }
    } else if (m[2] !== '/') {
      depth += 1;
    }
  }
  return -1;
}

function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
}

function hasSrc(block: SfcBlock): boolean {
  return attributeValue(block.attributes, 'src') !== undefined;
}

function attributeValue(attributes: string, name: string): string | undefined {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, 'i')
    .exec(attributes);
  return m === null ? undefined : (m[1] ?? m[2] ?? m[3]);
}

// ── the template's references ──────────────────────────────────────────────

/** Tags Vue itself renders; none of them is a binding in the component's scope. */
const VUE_BUILT_IN_TAGS = new Set([
  'component', 'transition', 'transition-group', 'keep-alive', 'teleport', 'suspense', 'slot',
  'template', 'Component', 'Transition', 'TransitionGroup', 'KeepAlive', 'Teleport', 'Suspense',
]);

/** Directives whose value is not an expression, or introduces names rather than using them. */
const NON_EXPRESSION_DIRECTIVES = new Set(['v-slot', 'v-else', 'v-pre', 'v-once', 'v-cloak', 'v-memo']);

const MEMBER_PATH = /^\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*$/;

function templateReferences(
  sourceText: string,
  start: number,
  end: number,
  kind: ts.ScriptKind
): Placement[] {
  const scan = blankComments(sourceText);
  const out: Placement[] = [];
  const emit = (offset: number, text: string): void => {
    if (parsesAlone(text, kind)) {
      out.push({ offset, text });
    }
  };
  let i = start;
  while (i < end) {
    const lt = scan.indexOf('<', i);
    const textEnd = lt < 0 || lt > end ? end : lt;
    interpolations(scan, i, textEnd, emit);
    if (textEnd === end) {
      break;
    }
    i = readTag(scan, lt, end, emit);
  }
  return out;
}

function interpolations(
  scan: string,
  from: number,
  to: number,
  emit: (offset: number, text: string) => void
): void {
  let i = scan.indexOf('{{', from);
  while (i >= 0 && i < to) {
    const close = scan.indexOf('}}', i + 2);
    if (close < 0 || close > to) {
      return;
    }
    const expression = scan.slice(i + 2, close);
    if (expression.trim() !== '') {
      emit(i + 2, `(${expression});`);
    }
    i = scan.indexOf('{{', close + 2);
  }
}

/** Reads the tag at `lt`, emits what it references, and returns the offset after it. */
function readTag(
  scan: string,
  lt: number,
  end: number,
  emit: (offset: number, text: string) => void
): number {
  const nameMatch = /^<([A-Za-z][\w.:-]*)/.exec(scan.slice(lt, lt + 256));
  if (nameMatch === null) {
    // A closing tag, a doctype, or a stray `<` in text.
    const gt = scan.indexOf('>', lt + 1);
    return gt < 0 || gt > end ? end : gt + 1;
  }
  const tagName = nameMatch[1]!;
  const component = componentBinding(tagName);
  if (component !== undefined) {
    emit(lt + 1, `${component}(${VUE_TAG_MARKER});`);
  }
  let i = lt + nameMatch[0].length;
  while (i < end) {
    while (i < end && /\s/.test(scan[i]!)) {
      i += 1;
    }
    if (scan[i] === '>') {
      return i + 1;
    }
    if (scan.startsWith('/>', i)) {
      return i + 2;
    }
    const nameStart = i;
    while (i < end && !/[\s=>]/.test(scan[i]!) && !scan.startsWith('/>', i)) {
      i += 1;
    }
    const attribute = scan.slice(nameStart, i);
    let j = i;
    while (j < end && /\s/.test(scan[j]!)) {
      j += 1;
    }
    if (scan[j] !== '=') {
      if (attribute === '') {
        i += 1;
      }
      continue;
    }
    j += 1;
    while (j < end && /\s/.test(scan[j]!)) {
      j += 1;
    }
    let valueStart: number;
    let valueEnd: number;
    if (scan[j] === '"' || scan[j] === '\'') {
      valueStart = j + 1;
      valueEnd = scan.indexOf(scan[j]!, valueStart);
      if (valueEnd < 0 || valueEnd > end) {
        return end;
      }
      i = valueEnd + 1;
    } else {
      valueStart = j;
      valueEnd = j;
      while (valueEnd < end && !/[\s>]/.test(scan[valueEnd]!)) {
        valueEnd += 1;
      }
      i = valueEnd;
    }
    attributeReference(attribute, scan.slice(valueStart, valueEnd), valueStart, emit);
  }
  return end;
}

function attributeReference(
  attribute: string,
  value: string,
  valueStart: number,
  emit: (offset: number, text: string) => void
): void {
  if (value.trim() === '') {
    return;
  }
  const directive = attribute.startsWith('@') ? 'v-on'
    : attribute.startsWith(':') || attribute.startsWith('.') ? 'v-bind'
      : attribute.startsWith('#') ? 'v-slot'
        : attribute.startsWith('v-') ? attribute.split(/[:.]/)[0]!
          : undefined;
  if (directive === undefined || NON_EXPRESSION_DIRECTIVES.has(directive)) {
    return;
  }
  if (directive === 'v-on') {
    // A bare name or member path is the HANDLER, which Vue calls; anything else
    // is the statement Vue runs, written as it stands.
    emit(valueStart, MEMBER_PATH.test(value) ? `${value}();` : `${value};`);
    return;
  }
  if (directive === 'v-for') {
    const source = /^([\s\S]*?\s)(?:in|of)(\s[\s\S]*)$/.exec(value);
    if (source !== null) {
      emit(valueStart + source[1]!.length + 2, `(${source[2]!});`);
    }
    return;
  }
  emit(valueStart, `(${value});`);
}

/**
 * Written inside a tag's call, `Child(/*<tag>*\/)`: what makes the call a TAG
 * rather than a template expression that calls a function, so it is recorded as
 * a component render (a JSX tag's call kind) and resolves the way `<Child/>` in
 * TSX does, default imports of components included.
 */
export const VUE_TAG_MARKER = '/*<tag>*/';

/** Whether `call` is a template tag of a `.vue` component's virtual script. */
export function isVueTemplateTag(call: ts.Node): boolean {
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) {
    return false;
  }
  const sf = call.getSourceFile();
  if (!isVueFile(sf.fileName)) {
    return false;
  }
  const text = sf.text;
  return text.slice(call.expression.end, call.end).replace(/\s/g, '') === `(${VUE_TAG_MARKER})`;
}

/** The binding a tag names, or `undefined` for an HTML element or a Vue built-in. */
function componentBinding(tagName: string): string | undefined {
  if (VUE_BUILT_IN_TAGS.has(tagName)) {
    return undefined;
  }
  if (/^[A-Z][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tagName)) {
    return tagName;
  }
  // `<my-child>` resolves to `MyChild` (or `myChild`) in the component's scope.
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(tagName)) {
    return tagName.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }
  return undefined;
}

function parsesAlone(text: string, kind: ts.ScriptKind): boolean {
  const sf = ts.createSourceFile('template.ts', text, ts.ScriptTarget.Latest, false, kind);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics ?? [];
  return diagnostics.length === 0;
}

// ── writing it out, line for line ──────────────────────────────────────────

/**
 * Every placement written at its own line; everything else blank.
 *
 * A placement's first line goes at its column (or after the previous text on
 * that line, when that already reaches past it); each further line of it is
 * written whole at the start of its line, which is where its text began in the
 * original. No newline is added or removed, so every line keeps its number.
 */
function layOut(sourceText: string, placements: readonly Placement[]): string {
  const lineStarts = [0];
  for (let i = 0; i < sourceText.length; i += 1) {
    if (sourceText[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  };
  const pieces: Array<Array<{ column: number; order: number; text: string }>> =
    lineStarts.map(() => []);
  let order = 0;
  for (const placement of [...placements].sort((a, b) => a.offset - b.offset)) {
    const line = lineOf(placement.offset);
    const segments = placement.text.split('\n');
    segments.forEach((segment, k) => {
      if (line + k < pieces.length) {
        const column = k === 0 ? placement.offset - lineStarts[line]! : 0;
        pieces[line + k]!.push({ column, order: order++, text: segment });
      }
    });
  }
  return pieces.map((onLine) => {
    let text = '';
    for (const piece of onLine.sort((a, b) => a.column - b.column || a.order - b.order)) {
      if (text.length < piece.column) {
        text += ' '.repeat(piece.column - text.length);
      } else if (text.length > 0 && !/\s$/.test(text) && piece.text !== '') {
        text += ' ';
      }
      text += piece.text;
    }
    return text;
  }).join('\n');
}

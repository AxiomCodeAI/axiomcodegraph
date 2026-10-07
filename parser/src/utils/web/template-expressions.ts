import * as ts from 'typescript';

import { HtmlTemplateDialect } from '@/enums/html/HtmlTemplateDialect';
import { HtmlTemplateExpressionKind } from '@/enums/html/HtmlTemplateExpressionKind';

/** Which template dialects a page shows markers of, decided once per file from its text. */
export interface TemplateFlavour {
  readonly vue: boolean;
  readonly alpine: boolean;
  readonly angular: boolean;
  readonly thymeleaf: boolean;
  readonly htmx: boolean;
  readonly handlebars: boolean;
  readonly jinja: boolean;
}

/**
 * The dialect markers of a whole page, read before the walk so an ambiguous directive is
 * decided by the company it keeps: `@click` is Alpine beside `x-data` and Vue otherwise,
 * `#name` is a Vue slot beside `v-` directives and an Angular reference beside `*ngIf`.
 */
export function templateFlavourOf(text: string): TemplateFlavour {
  return {
    // `v-` directives name Vue outright; `:prop`, `@event` and `#slot` are shared with Alpine
    // and are decided by whichever of the two has its own markers in the page.
    vue: /\s(?:v-[a-z]|v-bind:|v-on:|v-slot)/.test(text),
    alpine: /\sx-(?:data|on:|bind:|show|if|for|model|text|init|cloak|ref|effect)\b/.test(text),
    angular: /\s(?:\*ng[A-Z]|\[[\w.()-]+\]\s*=|\([\w.-]+\)\s*=|ng-[a-z]+\s*=)/.test(text),
    thymeleaf: /\sth:[a-z]/.test(text),
    htmx: /\shx-[a-z]/.test(text),
    handlebars: /\{\{[#/>^]/.test(text),
    jinja: /\{%/.test(text),
  };
}

/** How one directive attribute reads: its dialect, what it does, and what it was applied to. */
export interface DirectiveReading {
  readonly dialect: HtmlTemplateDialect;
  readonly kind: HtmlTemplateExpressionKind;
  /** The event, property or slot the directive names; empty when it names none. */
  readonly argument: string;
  /** Dotted suffixes: `enter`, `prevent`, `lazy`. */
  readonly modifiers: readonly string[];
  /** Whether the value is JavaScript-shaped and worth reading with the TypeScript syntax layer. */
  readonly javascript: boolean;
}

const VUE_CONDITIONS = new Set(['v-if', 'v-else-if', 'v-show']);
const ALPINE_DIRECTIVES = new Set(['x-data', 'x-init', 'x-effect', 'x-cloak', 'x-ignore', 'x-id', 'x-teleport', 'x-modelable', 'x-transition']);
const HTMX_REQUESTS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const THYMELEAF_BINDINGS = new Set(['href', 'src', 'action', 'value', 'attr', 'class', 'classappend', 'style', 'text', 'utext', 'alt', 'title', 'placeholder', 'name', 'id', 'with', 'object', 'replace', 'insert', 'include', 'fragment', 'switch', 'case']);

/**
 * Reads an attribute NAME as a template directive, or returns `undefined` for a plain
 * attribute. The name is as written: dialect directives are case-sensitive even where
 * HTML is not (`*ngIf`, `[ngModel]`), so the caller must not lowercase it first.
 */
export function readDirective(name: string, flavour: TemplateFlavour): DirectiveReading | undefined {
  const split = (rest: string): { argument: string; modifiers: string[] } => {
    const [argument = '', ...modifiers] = rest.split('.');
    return { argument, modifiers: modifiers.filter((m) => m !== '') };
  };
  const vueOrAlpine = flavour.alpine && !flavour.vue ? HtmlTemplateDialect.ALPINE : HtmlTemplateDialect.VUE;
  let m: RegExpExecArray | null;
  // Vue and Alpine share `@event` and `:prop`.
  if ((m = /^@([\w-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    return { dialect: vueOrAlpine, kind: HtmlTemplateExpressionKind.EVENT_HANDLER, ...split(m[1]! + m[2]!), javascript: true };
  }
  if ((m = /^v-on:([\w-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.VUE, kind: HtmlTemplateExpressionKind.EVENT_HANDLER, ...split(m[1]! + m[2]!), javascript: true };
  }
  if ((m = /^x-on:([\w-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.ALPINE, kind: HtmlTemplateExpressionKind.EVENT_HANDLER, ...split(m[1]! + m[2]!), javascript: true };
  }
  if ((m = /^(?::|v-bind:|\.)([\w-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    return { dialect: name.startsWith('v-bind') ? HtmlTemplateDialect.VUE : vueOrAlpine, kind: HtmlTemplateExpressionKind.BINDING, ...split(m[1]! + m[2]!), javascript: true };
  }
  if ((m = /^x-bind:([\w-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.ALPINE, kind: HtmlTemplateExpressionKind.BINDING, ...split(m[1]! + m[2]!), javascript: true };
  }
  if ((m = /^(?:#|v-slot:)([\w-]*)$/.exec(name)) !== null) {
    if (name.startsWith('#') && flavour.angular && !flavour.vue) {
      return { dialect: HtmlTemplateDialect.ANGULAR, kind: HtmlTemplateExpressionKind.REFERENCE, argument: m[1]!, modifiers: [], javascript: false };
    }
    return { dialect: HtmlTemplateDialect.VUE, kind: HtmlTemplateExpressionKind.SLOT, argument: m[1]!, modifiers: [], javascript: false };
  }
  if ((m = /^(v-[a-z-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    const directive = m[1]!;
    const modifiers = m[2]!.split('.').filter((x) => x !== '');
    const kind = VUE_CONDITIONS.has(directive) ? HtmlTemplateExpressionKind.CONDITION
      : directive === 'v-for' ? HtmlTemplateExpressionKind.LOOP
        : directive === 'v-model' ? HtmlTemplateExpressionKind.MODEL
          : directive === 'v-text' || directive === 'v-html' ? HtmlTemplateExpressionKind.BINDING
            : HtmlTemplateExpressionKind.DIRECTIVE;
    return { dialect: HtmlTemplateDialect.VUE, kind, argument: kind === HtmlTemplateExpressionKind.BINDING ? directive.slice(2) : '', modifiers, javascript: directive !== 'v-else' && directive !== 'v-pre' && directive !== 'v-cloak' && directive !== 'v-once' };
  }
  if ((m = /^(x-[a-z-]+)((?:\.[\w-]+)*)$/.exec(name)) !== null) {
    const directive = m[1]!;
    const modifiers = m[2]!.split('.').filter((x) => x !== '');
    const kind = directive === 'x-if' || directive === 'x-show' ? HtmlTemplateExpressionKind.CONDITION
      : directive === 'x-for' ? HtmlTemplateExpressionKind.LOOP
        : directive === 'x-model' ? HtmlTemplateExpressionKind.MODEL
          : directive === 'x-ref' ? HtmlTemplateExpressionKind.REFERENCE
            : directive === 'x-text' || directive === 'x-html' ? HtmlTemplateExpressionKind.BINDING
              : ALPINE_DIRECTIVES.has(directive) || flavour.alpine ? HtmlTemplateExpressionKind.DIRECTIVE : undefined;
    if (kind === undefined) {
      return undefined;
    }
    return { dialect: HtmlTemplateDialect.ALPINE, kind, argument: kind === HtmlTemplateExpressionKind.BINDING ? directive.slice(2) : '', modifiers, javascript: kind !== HtmlTemplateExpressionKind.REFERENCE && directive !== 'x-cloak' && directive !== 'x-ignore' && directive !== 'x-transition' };
  }
  // Angular.
  if ((m = /^\(([\w.-]+)\)$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.ANGULAR, kind: HtmlTemplateExpressionKind.EVENT_HANDLER, argument: m[1]!, modifiers: [], javascript: true };
  }
  if ((m = /^\[\(([\w.-]+)\)\]$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.ANGULAR, kind: HtmlTemplateExpressionKind.MODEL, argument: m[1]!, modifiers: [], javascript: true };
  }
  if ((m = /^\[([\w.-]+)\]$/.exec(name)) !== null) {
    return { dialect: HtmlTemplateDialect.ANGULAR, kind: HtmlTemplateExpressionKind.BINDING, argument: m[1]!, modifiers: [], javascript: true };
  }
  if ((m = /^\*(\w+)$/.exec(name)) !== null) {
    const directive = m[1]!;
    const kind = directive === 'ngIf' ? HtmlTemplateExpressionKind.CONDITION : directive === 'ngFor' ? HtmlTemplateExpressionKind.LOOP : HtmlTemplateExpressionKind.DIRECTIVE;
    return { dialect: HtmlTemplateDialect.ANGULAR, kind, argument: '', modifiers: [], javascript: true };
  }
  if ((m = /^ng-([a-z-]+)$/.exec(name)) !== null) {
    const directive = m[1]!;
    const kind = /^(click|dblclick|change|submit|keyup|keydown|keypress|focus|blur|mouseenter|mouseleave|mousedown|mouseup|input)$/.test(directive) ? HtmlTemplateExpressionKind.EVENT_HANDLER
      : /^(if|show|hide|switch)$/.test(directive) ? HtmlTemplateExpressionKind.CONDITION
        : directive === 'repeat' ? HtmlTemplateExpressionKind.LOOP
          : directive === 'model' ? HtmlTemplateExpressionKind.MODEL
            : /^(bind|bind-html|src|href|class|style|value|disabled|checked|selected|readonly|required|open)$/.test(directive) ? HtmlTemplateExpressionKind.BINDING
              : HtmlTemplateExpressionKind.DIRECTIVE;
    return { dialect: HtmlTemplateDialect.ANGULAR, kind, argument: kind === HtmlTemplateExpressionKind.EVENT_HANDLER || kind === HtmlTemplateExpressionKind.BINDING ? directive : '', modifiers: [], javascript: true };
  }
  // Thymeleaf: its expressions (`${…}`, `*{…}`, `@{…}`) are not JavaScript.
  if ((m = /^th:([\w-]+)$/.exec(name)) !== null) {
    const directive = m[1]!.toLowerCase();
    const kind = directive === 'if' || directive === 'unless' ? HtmlTemplateExpressionKind.CONDITION
      : directive === 'each' ? HtmlTemplateExpressionKind.LOOP
        : directive === 'field' ? HtmlTemplateExpressionKind.MODEL
          : directive.startsWith('on') ? HtmlTemplateExpressionKind.EVENT_HANDLER
            : THYMELEAF_BINDINGS.has(directive) ? HtmlTemplateExpressionKind.BINDING
              : HtmlTemplateExpressionKind.DIRECTIVE;
    const argument = kind === HtmlTemplateExpressionKind.EVENT_HANDLER ? directive.slice(2) : kind === HtmlTemplateExpressionKind.BINDING ? directive : '';
    return { dialect: HtmlTemplateDialect.THYMELEAF, kind, argument, modifiers: [], javascript: kind === HtmlTemplateExpressionKind.EVENT_HANDLER };
  }
  // htmx: attribute values are URLs, selectors and keywords, never code.
  if ((m = /^hx-([\w-]+)$/.exec(name)) !== null) {
    const directive = m[1]!.toLowerCase();
    return { dialect: HtmlTemplateDialect.HTMX, kind: HTMX_REQUESTS.has(directive) ? HtmlTemplateExpressionKind.REQUEST : HtmlTemplateExpressionKind.DIRECTIVE, argument: HTMX_REQUESTS.has(directive) ? directive : '', modifiers: [], javascript: false };
  }
  return undefined;
}

/** What a JavaScript-shaped expression refers to. */
export interface ExpressionReading {
  /** Names of the functions called, `select` for `select(item)`, `log` for `console.log(x)`. */
  readonly callees: Set<string>;
  /** Free identifiers read: `item`, `current`; not property names, not parameters the expression declares. */
  readonly identifiers: Set<string>;
  /** Set when the text does not parse as JavaScript; the sets then hold what the recovered tree gave. */
  readonly error?: string;
}

/**
 * Reads a template expression with the TypeScript syntax layer. A binding is wrapped in
 * parentheses first, so an object literal (`:class="{ active: on }"`) is an expression and
 * not a block; a handler is read as statements, since Vue allows `count++; log(x)`.
 */
export function readJsExpression(text: string, shape: 'expression' | 'statements'): ExpressionReading {
  const source = shape === 'expression' ? `(${text})` : text;
  const sf = ts.createSourceFile('template.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callees = new Set<string>();
  const identifiers = new Set<string>();
  const declared = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) callees.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) callees.add(callee.name.text);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      declared.add(node.name.text);
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isMethodDeclaration(parent) && parent.name === node)
        || (ts.isParameter(parent) && parent.name === node)
        || ts.isBindingElement(parent) && parent.propertyName === node;
      if (!isPropertyName && !node.text.startsWith('$')) {
        identifiers.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const d of declared) identifiers.delete(d);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = diagnostics[0];
  return first === undefined ? { callees, identifiers } : { callees, identifiers, error: ts.flattenDiagnosticMessageText(first.messageText, ' ') };
}

/** A loop directive split into the names it declares and the expression it iterates. */
export function readLoop(dialect: HtmlTemplateDialect, text: string): { declares: string[]; source: string } {
  let m: RegExpExecArray | null;
  if (dialect === HtmlTemplateDialect.ANGULAR) {
    // `let item of items; let i = index; trackBy: fn` or AngularJS `item in items track by item.id`
    if ((m = /let\s+([\w$]+)\s+of\s+([\s\S]+?)(?:;|$)/.exec(text)) !== null) {
      const declares = [m[1]!];
      for (const extra of text.matchAll(/let\s+([\w$]+)\s*=\s*\w+/g)) declares.push(extra[1]!);
      return { declares, source: m[2]!.trim() };
    }
    if ((m = /^\s*\(?([^)]*?)\)?\s+in\s+([\s\S]+?)(?:\s+track\s+by\b|$)/.exec(text)) !== null) {
      return { declares: names(m[1]!), source: m[2]!.trim() };
    }
    return { declares: [], source: text.trim() };
  }
  if (dialect === HtmlTemplateDialect.THYMELEAF) {
    if ((m = /^\s*([\w$]+)(?:\s*,\s*([\w$]+))?\s*:\s*([\s\S]+)$/.exec(text)) !== null) {
      return { declares: m[2] === undefined ? [m[1]!] : [m[1]!, m[2]], source: m[3]!.trim() };
    }
    return { declares: [], source: text.trim() };
  }
  // Vue and Alpine: `item in items`, `(item, index) in items`, `{ id, name } of items`
  if ((m = /^\s*\(?([\s\S]*?)\)?\s+(?:in|of)\s+([\s\S]+)$/.exec(text)) !== null) {
    return { declares: names(m[1]!), source: m[2]!.trim() };
  }
  return { declares: [], source: text.trim() };
}

/** The names a loop alias list or a slot-props pattern introduces: `(item, index)`, `{ id, name }`, `[a, b]`. */
export function names(pattern: string): string[] {
  const out: string[] = [];
  for (const m of pattern.replace(/[{}[\]()]/g, ' ').matchAll(/(?:^|[\s,:])([A-Za-z_$][\w$]*)(?=\s*(?:[,=]|$))/g)) {
    out.push(m[1]!);
  }
  return out;
}

/** A bare identifier or member path, which a framework CALLS as the handler: `save`, `app.submit`. */
export const MEMBER_PATH = /^\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*$/;

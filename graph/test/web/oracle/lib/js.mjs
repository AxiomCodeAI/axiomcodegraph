// JavaScript side of the oracle (SPEC 4): acorn over inline <script> bodies, on* attribute bodies
// and every non-minified JS file; reports functions and DOM touch points with their literals.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import selectorParser from 'postcss-selector-parser';

const OPTS = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };

/** Parse JS; returns {ast, error}. Tries the declared goal first, then the other one. */
export function parseJs(text, isModule) {
  const goals = isModule ? ['module', 'script'] : ['script', 'module'];
  let first = null;
  for (const sourceType of goals) {
    try { return { ast: acorn.parse(text, { ...OPTS, sourceType }) }; } catch (e) { first = first ?? e; }
  }
  return { ast: null, error: `${first.message}` };
}

/** Shift an acorn {line, column(0-based)} into file coordinates given the body's start {line, col}. */
export const shiftLoc = (loc, base) => (loc.line === 1 ? { line: base.line, col: base.col + loc.column } : { line: base.line + loc.line - 1, col: loc.column + 1 });

const propName = (k) => (!k ? null : k.type === 'Identifier' ? k.name : k.type === 'Literal' ? String(k.value) : k.type === 'PrivateIdentifier' ? `#${k.name}` : null);

/** Every function node with an inferred name. */
export function functionsOf(ast) {
  const out = [];
  const named = new Map();
  walk.full(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.init && /Function/.test(n.init.type) && n.id.type === 'Identifier') named.set(n.init, n.id.name);
    if (n.type === 'AssignmentExpression' && /Function/.test(n.right.type)) {
      const l = n.left; named.set(n.right, l.type === 'Identifier' ? l.name : l.type === 'MemberExpression' ? propName(l.property) : null);
    }
    if ((n.type === 'Property' || n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && n.value && /Function/.test(n.value.type)) named.set(n.value, propName(n.key));
  });
  walk.full(ast, (n) => {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      out.push({ node: n, name: n.id?.name ?? named.get(n) ?? '' });
    }
  });
  return out;
}

const strOf = (a) => {
  if (!a) return null;
  if (a.type === 'Literal' && typeof a.value === 'string') return a.value;
  if (a.type === 'TemplateLiteral' && a.expressions.length === 0) return a.quasis[0].value.cooked;
  return null;
};

const DOM_CALLS = { __proto__: null,
  querySelector: ['selector', [0]], querySelectorAll: ['selector', [0]], closest: ['selector', [0]], matches: ['selector', [0]],
  getElementById: ['id', [0]], getElementsByClassName: ['class', [0]], getElementsByTagName: ['tag', [0]], getElementsByName: ['name', [0]],
  setAttribute: ['attribute', [0]], getAttribute: ['attribute', [0]], removeAttribute: ['attribute', [0]], toggleAttribute: ['attribute', [0]],
  hasAttribute: ['attribute', [0]], addEventListener: ['event', [0]], removeEventListener: ['event', [0]], insertAdjacentHTML: ['html', [1]],
  createElement: ['tag', [0]],
};
const CLASSLIST = { __proto__: null, add: 'all', remove: 'all', toggle: [0], contains: [0], replace: [0, 1] };
const JQ_ANY = { __proto__: null, addClass: 'class', removeClass: 'class', toggleClass: 'class', hasClass: 'class' };
const JQ_RECV = { __proto__: null, attr: 'attribute', prop: 'attribute', css: 'css_property', on: 'event', off: 'event', one: 'event', trigger: 'event',
  find: 'selector', closest: 'selector', children: 'selector', parents: 'selector' };
const HTML_PROPS = new Set(['innerHTML', 'outerHTML']);

function isJqReceiver(n) {
  // $(…)/jQuery(…) call, possibly chained through other calls; or an identifier starting with $
  for (let c = n; c;) {
    if (c.type === 'Identifier') return c.name.startsWith('$');
    if (c.type === 'CallExpression') {
      if (c.callee.type === 'Identifier' && (c.callee.name === '$' || c.callee.name === 'jQuery')) return true;
      c = c.callee.type === 'MemberExpression' ? c.callee.object : null; continue;
    }
    if (c.type === 'MemberExpression') { c = c.object; continue; }
    if (c.type === 'ThisExpression') return false;
    return false;
  }
  return false;
}

export function tokensOf(kind, lit) {
  if (lit === null || lit === undefined) return '';
  if (kind === 'class') return lit.split(/\s+/).filter(Boolean).map((t) => `.${t}`).join(',');
  if (kind === 'id') return `#${lit}`;
  if (kind === 'tag') return lit.toLowerCase();
  if (kind === 'selector') {
    const toks = [];
    try {
      selectorParser((r) => r.walk((n) => {
        if (n.type === 'class') toks.push(`.${n.value}`); else if (n.type === 'id') toks.push(`#${n.value}`);
        else if (n.type === 'tag') toks.push(n.value.toLowerCase()); else if (n.type === 'attribute') toks.push(`[${n.attribute}]`);
      })).processSync(lit);
    } catch { return ''; }
    return [...new Set(toks)].join(',');
  }
  if (kind === 'html') {
    const toks = [];
    for (const m of lit.matchAll(/<([a-zA-Z][\w-]*)/g)) toks.push(m[1].toLowerCase());
    for (const m of lit.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)) for (const t of m[1].split(/\s+/).filter(Boolean)) toks.push(`.${t}`);
    for (const m of lit.matchAll(/\bid\s*=\s*["']([^"']*)["']/g)) toks.push(`#${m[1]}`);
    return [...new Set(toks)].join(',');
  }
  return lit;
}

/** DOM touch points: [{node, api, argIndex, literal|null, kind}] */
export function domTouches(ast) {
  const out = [];
  const push = (node, api, argIndex, litNode, kind, literalOverride) => {
    const lit = literalOverride !== undefined ? literalOverride : strOf(litNode);
    out.push({ node, api, argIndex, literal: lit, kind, status: lit === null ? 'non_literal' : 'literal' });
  };
  walk.full(ast, (n) => {
    if (n.type === 'CallExpression') {
      const c = n.callee;
      if (c.type === 'Identifier' && (c.name === '$' || c.name === 'jQuery') && n.arguments.length > 0) {
        const s = strOf(n.arguments[0]);
        const kind = s !== null && /^\s*</.test(s) ? 'html' : 'selector';
        if (n.arguments[0].type !== 'FunctionExpression' && n.arguments[0].type !== 'ArrowFunctionExpression') push(n, `jquery:${c.name}()`, 0, n.arguments[0], kind);
        return;
      }
      if (c.type !== 'MemberExpression' || c.computed) return;
      const m = propName(c.property);
      if (c.object.type === 'MemberExpression' && !c.object.computed && propName(c.object.property) === 'classList' && CLASSLIST[m]) {
        const idx = CLASSLIST[m] === 'all' ? n.arguments.map((_, i) => i) : CLASSLIST[m];
        for (const i of idx.length ? idx : [0]) push(n, `classList.${m}`, i, n.arguments[i], 'class');
        return;
      }
      if (c.object.type === 'MemberExpression' && !c.object.computed && propName(c.object.property) === 'style' && m === 'setProperty') {
        push(n, 'style.setProperty', 0, n.arguments[0], 'css_property'); return;
      }
      // a jQuery chain first: `$(x).closest('.a')` is jquery:closest, `el.closest('.a')` the DOM one
      if (JQ_RECV[m] && isJqReceiver(c.object)) {
        push(n, `jquery:${m}`, 0, n.arguments[0], JQ_RECV[m]);
        if ((m === 'on' || m === 'off' || m === 'one') && n.arguments[1] && strOf(n.arguments[1]) !== null) push(n, `jquery:${m}`, 1, n.arguments[1], 'selector');
        return;
      }
      if (DOM_CALLS[m]) { const [kind, idx] = DOM_CALLS[m]; for (const i of idx) push(n, m, i, n.arguments[i], kind); return; }
      if (JQ_ANY[m]) { push(n, `jquery:${m}`, 0, n.arguments[0], JQ_ANY[m]); return; }
      return;
    }
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed) {
      const p = propName(n.left.property);
      const obj = n.left.object;
      if (p === 'className') { push(n, 'className=', 0, n.right, 'class'); return; }
      if (HTML_PROPS.has(p)) { push(n, `${p}=`, 0, n.right, 'html'); return; }
      if (p === 'textContent') { push(n, 'textContent=', 0, n.right, 'html', null); return; }
      if (/^on[a-z]+$/.test(p)) { push(n, 'on<event>=', 0, null, 'event', p.slice(2)); return; }
      if (obj.type === 'MemberExpression' && !obj.computed && propName(obj.property) === 'style') { push(n, 'style.<prop>=', 0, null, 'css_property', p); return; }
    }
    if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'MemberExpression' && !n.object.computed && propName(n.object.property) === 'dataset') {
      push(n, 'dataset', 0, null, 'attribute', propName(n.property));
    }
  });
  return out;
}

/** Callee names of every call/new in a handler body (SPEC handler_call): [{calleeName, receiver, isNew}] */
export function handlerCalls(ast) {
  const out = [];
  walk.full(ast, (n) => {
    if (n.type !== 'CallExpression' && n.type !== 'NewExpression') return;
    const c = n.callee;
    let name = null;
    if (c.type === 'Identifier') name = c.name;
    else if (c.type === 'MemberExpression' && !c.computed) name = propName(c.property);
    if (name) out.push({ node: n, calleeName: name, isNew: n.type === 'NewExpression' });
  });
  return out;
}

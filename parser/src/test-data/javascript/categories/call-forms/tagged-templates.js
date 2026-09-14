// fixture: cjs/call-forms/tagged-templates.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// callKind = TAGGED_TEMPLATE_CALL, 20 sites measured. A call with NO PARENTHESES
// and no comma-separated argument list: the tag function receives the string
// parts as an array and each substitution as a further argument, so
// argumentCount is 1 + the number of substitutions and none of them is written
// as an argument.
//
// The template's raw strings are also a `strings.raw` array, and the SAME array
// object is passed on every evaluation of that call site — which is what makes
// the WeakMap-keyed caching in CSS-in-JS and query-tag libraries work.
//
// Grounded in a query library's `gql`, a CSS-in-JS library's `styled.div`, and
// String.raw / a terminal-colour library's template literal API.

'use strict';

function tag(strings, ...values) {
  return strings.raw.join('|') + '::' + values.join(',');
}

const name = 'world';
const count = 2;

// --- the shapes -------------------------------------------------------------------

// No substitutions at all. One argument, an array of length 1.
const noSubs = tag`plain`;

// One substitution: two arguments.
const oneSub = tag`hello ${name}`;

// Several, including adjacent ones with an empty string between them.
const manySubs = tag`${name}${count} items for ${name}`;

// A substitution containing a CALL. The nested call is a call site of its own,
// nested inside a tagged template's argument list that has no parentheses.
const nested = tag`upper: ${name.toUpperCase()}`;

// A multiline template.
const multiline = tag`
  line one
  line two ${count}
`;

// --- the tag is not always an identifier ---------------------------------------------

const tags = { sql: tag, html: tag };

// A member expression as the tag. The receiver is `tags`, and the whole
// receiver/callee analysis of a method call applies with no parentheses in sight.
const memberTag = tags.sql`SELECT 1`;

// A computed member as the tag.
const key = 'html';
const computedTag = tags[key]`<b>${name}</b>`;

// A CALL as the tag — the CSS-in-JS signature. `styled('div')` returns
// the tag, so there are two call sites: one ordinary, one tagged.
function styled(element) {
  return function (strings, ...values) { return element + ':' + strings.join('') + values.join(''); };
}
const styledTag = styled('div')`color: ${'red'};`;

// A chain: call, member, tagged.
const chained = styled('a').call(null, ['x'], []);

// String.raw, the builtin tag. Its whole purpose is the `.raw` array. What is
// load-bearing in the literal is the backslash sequences that a normal string
// would interpret — `\U`, `\f`, `\n` — not the path they spell. The segment was
// renamed away from a home-directory shape because the OSS scrub gate flags
// `<drive>:\Users\<name>` as a home-path disclosure, and the gate cannot know a
// fixture's path is synthetic. That is the gate behaving correctly.
const rawPath = String.raw`D:\Uploads\fixture\n`;

// A tag stored in a variable that is reassigned. Which function runs is not
// fixed by the call site.
let current = tag;
const first = current`before`;
current = (strings) => strings.join('!');
const second = current`after`;

// --- the control: an UNTAGGED template ------------------------------------------------
//
// Same literal, no tag, no call. A parser that mints a call site per
// TemplateExpression is wrong here, and the substitution is still an expression
// that must be walked — TEMPLATE_SUBSTITUTION is its edgeRole.

const untagged = `hello ${name}, ${count} times, ${name.length + count}`;
const noSubstitutions = `just a string`;
const nestedTemplate = `outer ${`inner ${name}`} end`;

module.exports = {
  tag, noSubs, oneSub, manySubs, nested, multiline,
  memberTag, computedTag, styledTag, chained, rawPath,
  first, second, untagged, noSubstitutions, nestedTemplate
};

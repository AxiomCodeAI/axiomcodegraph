// fixture: jsx/unterminated-element.jsx
// module system: CommonJS  (governing: staging/jsx/package.json, "type": "commonjs")
// nature: runtime-bearing in intent — it does not compile. That is the point.
// syntax floor: ES2015 + JSX
//
// A GENUINE SYNTAX ERROR, and the only non-Flow one in the corpus.
//
// ## Why it exists: PARSE_ERROR is about to drop to zero
//
// A collateral audit of the Flow exclusion — every schema-declared enum value,
// against the set of files that will be `FLOW_EXCLUDED` — found exactly three
// values whose only producers are Flow files:
//
//   | value | correct to drop? |
//   |---|---|
//   | `JsBodyPresence.NO_BODY` | **yes** — `declare function` is Flow, and §7.3a-2 rule 3 asserts no `NO_BODY` row survives in an emitted file |
//   | `JsParseGapKind.FLOW_SYNTAX` | **yes** — it only ever applied to Flow files |
//   | `JsParseGapKind.PARSE_ERROR` | **NO** — it is a general-purpose gap kind that applies to any malformed JavaScript, and it happened to be produced only by Flow files |
//
// That third one is the `hasWithStatement` shape: a general value carried
// accidentally by a file class that is being removed. This fixture carries it on
// purpose instead, in a file that has nothing to do with Flow.
//
// ## Why the error is an unterminated JSX element and not something worse
//
// A file that does not parse AT ALL — an unterminated string, an unbalanced
// brace at top level — is an input to every sweep, editor and gate in this
// repository, and `cjs/parse-gaps/README-parse-error.md` declined to add one on
// those grounds. This is the mild version and the calculus is different:
// TypeScript RECOVERS from it cleanly, producing exactly **one** diagnostic
// (`17008: JSX element 'Footer' has no corresponding closing tag`) and a usable
// tree — every other declaration in the file still extracts. `node --check`
// rejects it, but `node --check` rejects every `.jsx` file in this corpus
// anyway, because JSX is not ECMAScript.
//
// ## What it does NOT do, measured
//
// It does not reproduce the duplicate `js_parse_gap` primary key. Five malformed
// JSX shapes — unterminated element, unterminated nested, mismatched close,
// unterminated fragment, unclosed attribute brace — produce 1–2 diagnostics each
// and **zero** positions carrying more than one. TypeScript's JSX recovery is
// well behaved in a way its Flow recovery is not, so `flow/casts.js` remains the
// only reproducer of that defect, and excluding Flow retires it. See MANIFEST.md
// Findings 16 for the ordering consequence.

'use strict';

const View = require('view-lib');
const Avatar = require('./component').Avatar;

function Card({ user, items }) {
  return (
    <div className="card">
      <h2>{user.name}</h2>
      <ul>
        {items.map((item) => <li key={item.id}>{item.label}</li>)}
      </ul>
      <section>
        <Avatar user={user} />
        {/* The error: opened and never closed. Everything below still parses. */}
        <Footer>
      </section>
    </div>
  );
}

// Declarations after the error. If these do not appear in the fact base, the
// gap swallowed more than the construct it names.
function Sidebar({ links }) {
  return (
    <nav>
      {links.map((link) => <a href={link.href}>{link.text}</a>)}
    </nav>
  );
}

const AFTER_ERROR = 'this constant is declared after the malformed element';

module.exports = { Card, Sidebar, AFTER_ERROR };

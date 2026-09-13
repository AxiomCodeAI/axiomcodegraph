// fixture: jsx/component-in-js.js
// module system: CommonJS  (governing: staging/jsx/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 + JSX, in a plain .js file
//
// JSX in .js. This is what scaffolded app output, every pre-2020 component
// codebase and most of the JSX in the schema's corpus (38 files, one small app)
// actually looks like on disk: the extension says nothing and the bundler is
// what knows.
//
// The schema's ruling is that scriptKind is recorded as PROVENANCE and never
// read from config, because ts.ScriptKind.JS already carries
// languageVariant = JSX and 0 of 2,942 files parsed differently. This file is
// the test of that claim from one side; the bottom section is the test from the
// other, because it contains `<` used as a COMPARISON in the same file as `<`
// used to open an element.
//
// If a parser ever needs the extension to decide, one of the two sections here
// breaks — and hasJsxContent, which the schema says is recorded AFTER parsing,
// is what a fixture can check that a config-derived flag cannot.

'use strict';

const View = require('view-lib');

function Badge({ count, max }) {
  // `<` opening JSX, on a line that also has arithmetic.
  return <span className="badge">{count > max ? max + '+' : count}</span>;
}

function List({ items, threshold }) {
  // Comparison operators in the SAME FILE as JSX. `a < b` and `<Badge`, four
  // lines apart, and the parser must get both.
  const visible = items.filter((item) => item.weight < threshold);
  const overflow = items.length > visible.length;
  const ratio = visible.length / (items.length || 1);

  // A generic-looking comparison chain, which is the classic ambiguity: in
  // .ts this parses as a type argument list and in .tsx it does not. In
  // JavaScript there are no type arguments, so it is unambiguously comparison.
  const chained = ratio < 1 && items.length > 0;

  return (
    <ul data-ratio={ratio}>
      {visible.map((item) => <li key={item.id}><Badge count={item.weight} max={threshold} /></li>)}
      {overflow && <li className="more">…</li>}
      {chained ? <li className="ok" /> : null}
    </ul>
  );
}

// A shift operator and a JSX element on adjacent lines.
const mask = 1 << 4;
const element = <List items={[]} threshold={mask} />;

// An arrow whose entire body is JSX, with no parentheses.
const Inline = (props) => <List {...props} />;

// JSX in a conditional expression, in an array, and as a default parameter —
// three positions where the element is not a statement.
const conditional = mask > 0 ? <Badge count={1} max={2} /> : <br />;
const collection = [<Badge key="a" count={1} max={2} />, <br key="b" />];
function withDefault(node = <br />) { return node; }

module.exports = { Badge, List, Inline, element, conditional, collection, withDefault, mask };

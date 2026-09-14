// fixture: jsx/component.jsx
// module system: CommonJS  (governing: staging/jsx/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 + JSX (which is not ECMAScript at all — it is a syntax
//   extension that no runtime executes; every line of it is compiled away)
//
// The .jsx extension is unambiguous. component-in-js.js is the same content in a
// .js file, which is what a pre-Vite View app actually ships, and the pair is
// the fixture: the schema's ruling is that scriptKind is PROVENANCE, never read
// from config, because ts.ScriptKind.JS already carries languageVariant = JSX
// and 0 of 2,942 corpus files parsed differently between JS and JSX.
//
// That ruling is only checkable against a file where `<` genuinely opens JSX and
// a file where it does not — see the comparison operators at the bottom of
// component-in-js.js.
//
// The extractor consequence, from TypeScript: a JSX BRACE produces no row of its
// own, so a subtree rooted at one dies before its children are enqueued. That
// cost 4,488 of one application's 14,335 call sites. Every call inside a brace below is
// there to make that failure visible.

'use strict';

const View = require('view-lib');
const { useValue, useSideEffect, useMemoizedFn } = require('view-lib');

function formatName(user) {
  return user.first + ' ' + user.last;
}

function Avatar({ user, size = 32 }) {
  return <img className="avatar" src={user.avatarUrl} width={size} height={size} alt={formatName(user)} />;
}

function UserCard({ user, onSelect, children }) {
  const [expanded, setExpanded] = useValue(false);
  const toggle = useMemoizedFn(() => setExpanded((v) => !v), []);

  useSideEffect(() => {
    if (expanded) { onSelect(user.id); }
  }, [expanded, user.id, onSelect]);

  return (
    <div className="card" onClick={toggle}>
      {/* A call inside a JSX brace, which is the case that vanished in TS */}
      <h2>{formatName(user)}</h2>

      {/* A component element: the tag name IS a call target */}
      <Avatar user={user} size={expanded ? 64 : 32} />

      {/* Conditional rendering by && and by ternary */}
      {expanded && <p className="bio">{user.bio || 'no bio'}</p>}
      {expanded ? <button onClick={toggle}>collapse</button> : null}

      {/* A map with an arrow returning JSX — a function boundary inside a brace */}
      <ul>
        {(user.tags || []).map((tag) => (
          <li key={tag}>{tag.toUpperCase()}</li>
        ))}
      </ul>

      {/* Spread attributes: the prop names are not in this file */}
      <section {...user.sectionProps} data-id={user.id} />

      {/* A fragment, both spellings */}
      <>
        <span>short</span>
      </>
      <View.Fragment key="long">
        <span>long</span>
      </View.Fragment>

      {/* A namespaced/member component: the tag is a member expression */}
      <View.StrictMode>{children}</View.StrictMode>

      {/* Text children, entities, and a self-closing tag with no attributes */}
      <p>plain text &amp; an entity &mdash; and {'a string expression'}</p>
      <br />
    </div>
  );
}

class ClassComponent extends View.Component {
  render() {
    const { items } = this.props;
    return (
      <ul>
        {items.map((item, index) => <li key={index}>{this.renderItem(item)}</li>)}
      </ul>
    );
  }
  renderItem(item) {
    return <UserCard user={item} onSelect={() => this.props.onSelect(item)} />;
  }
}

module.exports = { Avatar, UserCard, ClassComponent, formatName };

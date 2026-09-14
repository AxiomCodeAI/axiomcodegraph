// fixture: jsx/tag-forms.jsx
// module system: CommonJS  (governing: staging/jsx/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 + JSX
//
// WHAT A JSX TAG NAME *IS*, which is the open schema question behind js-impl's
// recall finding that 833 JSX tag names emit nothing.
//
// The rule JSX actually uses is **syntactic, not semantic**, and it is not the
// one most people state:
//
//   * a tag is a VALUE REFERENCE iff its name is a MEMBER EXPRESSION, or a
//     simple identifier that is a VALID ECMASCRIPT IDENTIFIER not beginning with
//     a lowercase ASCII letter. It compiles to the expression itself and
//     resolves through the scope chain like any other name.
//   * everything else that is a simple name is an INTRINSIC — it compiles to a
//     STRING. That covers both `div` (lowercase) and `my-element` (hyphenated,
//     so not an identifier at all), and it references no binding: a local named
//     `div` in scope is not consulted.
//   * a NAMESPACED name (`svg:circle`) is neither: it is a third form that most
//     transforms reject outright.
//
// The validity clause is not pedantry. TypeScript reports `ts.isIdentifier()`
// TRUE for `my-element` AND for `Foo-Bar`, so a rule written as
// "isIdentifier && starts lowercase" gets `Foo-Bar` wrong — see the tag of that
// name below.
//
// So "capitalised = component" is a useful shorthand and a wrong rule. The two
// cases that break it are both below and both are common:
//
//   `<foo.bar />`  lowercase, and a VALUE REFERENCE, because it is a member
//                  expression — the lowercase rule applies only to a bare
//                  identifier
//   `<_Private />` not a capital letter, and still a value reference, because
//                  `_` is not a lowercase ASCII letter
//   `<Foo-Bar />`  capitalised, and NOT a reference, because a hyphen makes it
//                  an invalid identifier — no such binding can exist
//
// This file puts every form in ONE file so the discrimination is forced rather
// than inferred across fixtures, and it discriminates whichever way js-oracle
// rules: if tag names become expression rows, the intrinsics must NOT resolve to
// a binding and the member forms MUST; if they stay silent, the count is zero
// and nothing here is emitted. Either ruling has something that can fail.
//
// Grounded in real View: `<div>` and `<Modal.Header>` are View-Bootstrap's
// documented API, `<Foo.Bar.Baz>` is how compound components are namespaced,
// and `<svg:circle>` appears in SVG-in-JSX written before the transform settled.

'use strict';

const View = require('view-lib');
const Button = require('./component').UserCard;
const Modal = { Header: Button, Body: { Inner: Button } };
const widgets = { panel: Button, 'data-view': Button };
const _Private = Button;
const $Dollar = Button;

// A local binding named exactly like an intrinsic tag. If `<div />` below
// resolves to THIS, the rule has been implemented as resolution rather than as
// syntax — which is the single sharpest discriminator in the file.
const div = function ShadowingDiv() { return null; };
const span = 'not a component either';

class Host {
  constructor() { this.Slot = Button; }
  render() {
    // `this.Slot` is a member expression whose object is `this`.
    return <this.Slot />;
  }
}

function AllTagForms({ user, ...rest }) {
  return (
    <div className="root" data-testid="root" aria-label="root">

      {/* --- intrinsics: lowercase bare identifiers, compiled to STRINGS --- */}
      <span>text</span>
      <a href="#x">link</a>
      <input type="text" disabled />
      <br />
      <h1>heading</h1>

      {/* A hyphenated custom element. `-` cannot appear in an identifier, so
          this can ONLY be a string — it is an intrinsic by construction. */}
      <my-element attr="1" />
      <ion-button size="small" />

      {/* CAPITALISED AND HYPHENATED. `ts.isIdentifier(tagName)` is TRUE here —
          TypeScript gives `Foo-Bar` the node kind `Identifier` even though it is
          not a valid ECMAScript identifier — and the first letter is uppercase.
          So a rule implemented as "isIdentifier && starts lowercase = intrinsic"
          classifies this as a REFERENCE, and there is no binding it could ever
          refer to: `Foo-Bar` cannot be declared in JavaScript. It compiles to
          the string "Foo-Bar", exactly as `my-element` does. Rare in practice
          and the precise boundary of the rule, which is why it is here. */}
      <Foo-Bar attr="1" />

      {/* --- value references: capitalised bare identifiers --- */}
      <Button user={user} />
      <Host />

      {/* Capitalised and NOT IN SCOPE. At runtime this throws ReferenceError,
          which is the proof that a capitalised tag really is a name lookup and
          not a string. An extractor that emits nothing here loses the only
          evidence that the reference existed. */}
      <NotDeclaredAnywhere />

      {/* --- value references that are NOT capitalised --- */}
      {/* Lowercase MEMBER expression. A value reference despite the lowercase
          first letter, because the rule applies to bare identifiers only. */}
      <widgets.panel />
      {/* And a computed-looking one that is not computed: the property name is
          quoted in the object but written as a member here, so it is invalid —
          `<widgets.data-view />` cannot parse. Recorded, not written. */}

      {/* Leading underscore and dollar: neither is a lowercase ASCII letter, so
          both are value references. */}
      <_Private />
      <$Dollar />

      {/* --- member expression tags --- */}
      <Modal.Header />
      <Modal.Body.Inner />
      <View.Fragment key="f">
        <span>in a named fragment</span>
      </View.Fragment>

      {/* --- namespaced: a third form, neither intrinsic nor reference --- */}
      <svg:circle cx="1" cy="1" r="1" />
      <use xlink:href="#icon" />

      {/* --- the anonymous fragment: no tag name at all --- */}
      <>
        <span>in an anonymous fragment</span>
      </>

      {/* --- open/close pairs: the name appears TWICE in the source --- */}
      {/* One element, one reference — or two? A walker that visits the closing
          element as well double-counts every non-self-closing component. */}
      <Button user={user}></Button>
      <div></div>

      {/* --- attributes are never references --- */}
      {/* `className`, `data-testid` and `xlink:href` are names in the source and
          none of them resolves to anything. The SPREAD is the exception: `rest`
          is a real read. */}
      <Button {...rest} className="spread" />
      <div {...{ id: 'inline' }} />

      {/* --- a tag inside an attribute value, and inside a child expression --- */}
      <Button icon={<Modal.Header />} render={() => <span>from an arrow</span>} />
      {user ? <Button user={user} /> : <div />}
      {[1, 2].map((n) => <li key={n}><Modal.Header /></li>)}

    </div>
  );
}

module.exports = { AllTagForms, Host, Button, Modal, widgets, div, span };

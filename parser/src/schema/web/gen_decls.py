#!/usr/bin/env python3
"""Generate decls_base_web.dl FROM schema.json, the frozen column lists of the HTML and CSS relations.

The .dl carries positional `c0..cN` and nothing else, so column ORDER is the contract with
the Soufflé engine: a rename is free after the freeze and a reorder is not. Generating the
declarations from the one place the columns are listed is what makes that asymmetry safe,
and `web-tests.ts` checks the parser's own headers against the same file, so the three
cannot drift apart. Run with --check to diff instead of write (for CI).

The web relations are CONFIG-SHAPED, like Java's XML and YAML tables: client-only, with no
`lib_` pair, because a dependency's pages and stylesheets are not the project's.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(HERE, "schema.json")
OUT = os.path.join(HERE, "decls_base_web.dl")

DOCS = {
    "html_document": "One HTML file; the root of every HTML key. c5 documentKind says whether the file writes\n"
                     "// <html>/a doctype or is a fragment the algorithm wrapped; c9 templateDialects is a comma\n"
                     "// set of the template families whose markers the text shows.",
    "html_element": "One element, keyed on its XPath-like c2 path. c4 id and c5 classNames are repeated from the\n"
                    "// attributes because they are what CSS and script references join on. c7 isImplied marks\n"
                    "// an element the HTML algorithm inserted (html, head, body, tbody).",
    "html_attribute": "One attribute; (element, prefix, name) is unique by the algorithm. c3 attributeKind is what\n"
                      "// the attribute does: ID, CLASS, STYLE, EVENT_HANDLER, URL, TEMPLATE_DIRECTIVE, ...",
    "html_class_reference": "One token of a class attribute: the row css_selector_part (CLASS) joins on.",
    "html_reference": "One URL a page names. c0 referenceKind says what it points at (SCRIPT, STYLESHEET, ANCHOR,\n"
                      "// IMAGE, FORM_ACTION, ...); c2 urlKind what kind of URL it is; c6 resolvedFilePath the file\n"
                      "// on disk when a RELATIVE or ROOT_RELATIVE URL names one, else empty, with c7 isResolved.",
    "html_script": "One <script>, 1:1 with its element. EXTERNAL rows carry the src and its resolution;\n"
                   "// INLINE rows carry the body's line/column range so a script front end can read it in place.",
    "html_handler_call": "One call written in an on* attribute, a javascript: URL or a template dialect's event\n"
                         "// directive (c0 handlerSource). The callee is kept as name, receiver and full text;\n"
                         "// resolution is the engine's, as for a JavaScript call site.",
    "html_template_expression": "One expression a template dialect evaluates: a directive's value (c2 directive as written,\n"
                                "// c1 expressionKind what it does, c3 argument the event or property) or a {{ }} interpolation.\n"
                                "// c6 calleeNames and c7 identifiers are read for the JavaScript-shaped dialects (Vue, Alpine,\n"
                                "// Angular); c8 declares are the names a loop or slot introduces.",
    "html_parse_gap": "What the HTML grammar could not read (c1 names the error region, missing token, stray end tag\n"
                      "// or duplicate attribute), a handler or style attribute that did not parse, or the overflow count.",
    "css_stylesheet": "One stylesheet: a .css file (keyed on its path) or a <style> element (keyed on the element,\n"
                      "// c7 ownerHtmlElementLinkHash). c6 sourceProvenance labels minified output; never a skip.",
    "css_rule": "A style rule or an at-rule, in the tree as written: c13 parentRuleLinkHash is the enclosing\n"
                "// block. c2 name is what an at-rule declares (the @keyframes, @layer, @container, @property\n"
                "// name; a @font-face's font-family), the column a css_value_reference joins on.",
    "css_selector": "One complex selector of a rule's selector list, with its (a,b,c) specificity.",
    "css_selector_part": "One simple selector, in writing order; c5 combinatorBefore is the combinator written\n"
                         "// before its compound. A functional pseudo-class's arguments are child parts (c8 depth,\n"
                         "// c11 parentPartLinkHash). CLASS/ID/TYPE names join html_class_reference, html_element; a\n"
                         "// namespaced type (svg|rect) is the name rect with value svg|.",
    "css_declaration": "One property: value. Owned by a rule (c10) OR a style attribute (c11), never both.",
    "css_value_reference": "A name a value refers to: VARIABLE (var(--x)), URL, IMPORT, KEYFRAMES, LAYER, CONTAINER,\n"
                           "// FONT_FAMILY. URL and IMPORT carry c3 urlKind and c4 resolvedFilePath; the rest join by c1 name.",
    "css_comment": "A /* */ comment with its text and range.",
    "css_parse_gap": "An error region of the CSS grammar, text CSS has no place for, a preprocessor marker in a .css file, or the overflow count.",
}


def parse_doc():
    schema = json.load(open(DOC))
    rels, errors, seen = [], [], set()
    for name, spec in schema["relations"].items():
        if not (name.startswith("html_") or name.startswith("css_")):
            errors.append("%s: not an html_ or css_ relation" % name)
        if name in seen:
            errors.append("%s: declared twice" % name)
        seen.add(name)
        cols = spec.get("columns", [])
        if not cols:
            errors.append("%s: no columns — arity unverifiable" % name)
        if len(set(cols)) != len(cols):
            errors.append("%s: a column name repeats" % name)
        if cols and not cols[-1].endswith("UniqueHash"):
            errors.append("%s: the last column is not the row's own key" % name)
        rels.append((name, len(cols)))
    for name, _ in rels:
        if name not in DOCS:
            errors.append("%s: no purpose comment in gen_decls.py DOCS" % name)
    for name in DOCS:
        if name not in seen:
            errors.append("%s: has a DOCS comment but no entry in schema.json" % name)
    return rels, errors


def decl(name, arity):
    return ".decl %s(%s)" % (name, ",".join("c%d:symbol" % i for i in range(arity)))


def render(rels):
    out = ["""// ============================================================================
// Base input relations — HTML and CSS parser IR (the web front end).
//
// GENERATED FROM schema.json BY gen_decls.py — DO NOT HAND-EDIT.
// Re-run `python3 gen_decls.py --check` in CI; drift here is a silent schema break.
//
// CLIENT-ONLY, like Java's XML and YAML tables: no lib_ pair is declared, because a
// dependency's pages and stylesheets are not the project's. An engine that reads these
// copies the .decl lines it needs into its decls_base.dl and maps the CSV in client-ir.map:
//
//     html_<entity>   all-html-<entities>.csv       css_<entity>   all-css-<entities>.csv
//
// COLUMN ORDER IS THE CONTRACT. All columns are `symbol`. New columns append ONLY.
// The last column of every relation is the row's own unique hash.
//
// JOINS AN ENGINE AUTHOR WILL WANT:
//   html_reference.resolvedFilePath (SCRIPT)     = <script front end>'s module file path
//   html_reference.resolvedFilePath (STYLESHEET) = css_stylesheet.filePath
//   html_class_reference.className              = css_selector_part.name where partKind = CLASS
//   html_element.id                             = css_selector_part.name where partKind = ID
//   html_element.tagName                        = css_selector_part.name where partKind = TYPE
//   html_handler_call.calleeName                = a global function of a classic script the page loads
//   css_value_reference.name (VARIABLE)         = css_declaration.property where isCustomProperty
//   css_value_reference.name (KEYFRAMES)        = css_rule.name where atRuleName = keyframes
// ============================================================================"""]
    for name, arity in rels:
        out.append("")
        out.append("// " + DOCS[name])
        out.append("// (%d columns)" % arity)
        out.append(decl(name, arity))
    out.append("")
    return "\n".join(out)


def main():
    check = "--check" in sys.argv
    rels, errors = parse_doc()
    if errors:
        print("SCHEMA DOC ERRORS — refusing to generate:")
        for e in errors:
            print("  " + e)
        return 2
    text = render(rels)
    if check:
        have = open(OUT).read() if os.path.exists(OUT) else ""
        if have != text:
            print("DRIFT: %s does not match %s — run python3 src/schema/web/gen_decls.py" % (os.path.basename(OUT), os.path.basename(DOC)))
            return 1
        print("OK  %d relations, %d columns — .dl matches schema.json" % (len(rels), sum(a for _, a in rels)))
        return 0
    open(OUT, "w").write(text)
    print("wrote %s — %d relations, %d columns" % (os.path.basename(OUT), len(rels), sum(a for _, a in rels)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

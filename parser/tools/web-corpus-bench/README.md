# web-corpus-bench

Stress-tests the HTML/CSS front end against reference parsers over large corpora, and lists
what it misses. Not part of the test suite: the corpora are downloaded (~500MB) and the
reference parsers are extra dependencies.

- HTML reference: **parse5** (the WHATWG tree-construction algorithm; only elements with a
  source position count, so implied `html`/`head`/`body` are ignored) and **htmlparser2**
  (elements as written). Compared per file: written-element count, tag multiset, parent>child
  edge multiset, attribute name=value multiset, class tokens, ids, URL-bearing attributes vs
  `html_reference` rows, script/style counts and inline script length, `style` attribute
  declaration counts and `<style>` rule/declaration counts (css-tree), event-handler
  attributes vs handler calls, direct text, title, parse errors vs parse gaps, timing.
- CSS reference: **css-tree** (tolerant parse), **postcss** (does it throw) and
  **@bramus/specificity**. Compared per sheet: style rules, at-rule names, selector texts,
  specificity per selector, selector-part kinds per selector, declarations
  (property|value|important), custom properties, `var()`/`url()`/`@import`/`@keyframes`/
  `@font-face`/`@layer`/`@container` names, comments, errors vs gaps, timing.

```
npm install            # in this directory: parse5, htmlparser2, css-tree, postcss, @bramus/specificity
./fetch-corpora.sh     # html5lib tree-construction, wpt (sparse), csstree + postcss fixtures,
                       # Angular/Django/Bootstrap/petclinic/dom-examples repos, a set of live pages and CDN stylesheets
./run.sh               # one process per corpus, then results/report.md
```

`results/*.jsonl` holds one record per file with the diffs and samples; `report.md` aggregates
them: coverage totals, the top missing/extra tags, edges, attributes, URLs, selectors,
declarations, and the gap texts recorded where the reference parsers saw no error.

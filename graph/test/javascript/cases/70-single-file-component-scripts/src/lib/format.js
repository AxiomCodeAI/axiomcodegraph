// Helpers called only from single-file components: every call to them lives in a
// <script> block or an Astro frontmatter fence, never in a .js file.
export function formatPrice(n) { return '$' + n.toFixed(2); }
export function slugify(s) { return s.toLowerCase(); }
export function fetchProducts() { return []; }
// CONTROL: named only in markup, a <script lang="ts"> block and a commented-out
// <script>, none of which is JavaScript the front end reads. It must stay without callers.
export function onlyInMarkup(x) { return x; }

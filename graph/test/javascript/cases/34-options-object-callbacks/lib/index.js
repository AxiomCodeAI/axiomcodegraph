'use strict';
function walk(items, opts) {
  const out = [];
  for (const x of items) { if (opts.filter(x)) out.push(opts.hooks.visit(x)); }
  return out;
}
module.exports = walk;

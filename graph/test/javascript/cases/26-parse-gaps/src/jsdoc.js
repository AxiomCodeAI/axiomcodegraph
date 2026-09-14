// The type channel: a written type the parser could not read is not the same
// fact as no type at all.
class Widget { render() { return 1; } }
/** @param {keyof Widget} w */
function unreadable(w) { return w.render(); }
/** @param {Widget} w */
function readable(w) { return w.render(); }
function untyped(w) { return w.render(); }
module.exports = { Widget, unreadable, readable, untyped };

'use strict';
// The same class with no tag: the compiler names the override itself, and the site is
// decided. This is the control that shows the verdict above turns on the comment.
class EagerMap extends Map {
  get(key) { return super.get(key); }
}
module.exports = new EagerMap([['b', 2]]);

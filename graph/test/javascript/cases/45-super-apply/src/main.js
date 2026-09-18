// super.apply(...) and super.call(...) are the base's members of those names
// (#697), not Function.prototype.apply on super.
class Template {
  apply(dep, source) { return dep + source; }
  call(x) { return x; }
}
class Guarded extends Template {
  apply(dep, source) {
    if (!dep) { return null; }
    return super.apply(dep, source);
  }
  call(x) { return super.call(x) + 1; }
}
// The controls: a function's apply runs the function; an object's own apply is its member.
function target(a) { return a; }
const selector = { apply(node) { return node; } };
function run() {
  new Guarded().apply(1, 2);
  new Guarded().call(3);
  target.apply(null, [1]);
  selector.apply('node');
}
module.exports = { run };

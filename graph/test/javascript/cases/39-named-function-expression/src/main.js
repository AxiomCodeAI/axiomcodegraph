// A named function expression binds its own name inside its body, and a
// declaration or parameter of the same name in the body shadows it.
function Aggregate() { this.steps = []; }
Aggregate.prototype.model = function model(m) { this.m = m; return this; };
Aggregate.prototype.exec = function exec() { return this.steps.length; };

function Model() {}
Model.prototype.save = function () { return 1; };   // a prototype member: Model is a class
// The own name is shadowed by a const in the body: `aggregate.model(this)` is the
// instance, not the enclosing function.
Model.aggregate = function aggregate(pipeline) {
  const aggregate = new Aggregate();
  aggregate.model(this);
  return aggregate.exec();
};
// The own name of a function expression assigned to a static slot: the recursive
// call is the function itself.
Model.applyDefaults = function applyDefaults(doc, depth) {
  if (depth > 0) { applyDefaults(doc.child, depth - 1); }
  return doc;
};
// A parameter of the same name shadows the own name.
Model.walk = function walk(walk) { return walk.exec(); };
// A plain named function expression bound to a const, recursing through its own name.
const countDown = function countDown(n) { return n <= 0 ? 0 : countDown(n - 1); };

function run() {
  Model.aggregate([]);
  Model.applyDefaults({ child: {} }, 1);
  Model.walk(new Aggregate());
  return countDown(2);
}
module.exports = { run };

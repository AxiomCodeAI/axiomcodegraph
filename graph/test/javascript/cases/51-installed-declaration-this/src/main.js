'use strict';
// A function DECLARATION installed later as a static or object member has the
// receiver it was installed on as `this` (#708), as the function-expression form
// on the same member always had.
function Model() {}
Model.create = function () { return 1; };
Model.prototype.save = function () { return 2; };

function viaDecl() { return this.create(); }
Model.viaDecl = viaDecl;
Model.viaExpr = function () { return this.create(); };
const obj = { hello() { return 3; } };
function onObj() { return this.hello(); }
obj.onObj = onObj;
class K { static make() { return 4; } }
K.viaDeclK = viaDeclK;
function viaDeclK() { return this.make(); }
function proto() { return this.save(); }
Model.prototype.viaProto = proto;
// Through a const holding a function expression, and a chain onto two constructors.
const viaConst = function () { return this.create(); };
Model.viaConst = viaConst;
function Other() { this.save(); }                    // Other's own save only
Other.make = function () { return 5; };
Other.prototype = Object.create(Model.prototype);
Other.prototype.constructor = Other;                 // a back-reference, not an installation: the Object.create object is not `this`
Other.prototype.save = function () { return 6; };
function shared() { return this.make(); }
Model.shared = Other.shared = shared;

// The two-argument extend helper installed on a constructor: `this` is the
// constructor, so the child links to it and inherits its prototype members.
function extend(protoProps) {
  const parent = this;
  const child = function () { return parent.apply(this, arguments); };
  child.prototype = Object.create(parent.prototype);
  for (const k in protoProps) child.prototype[k] = protoProps[k];
  return child;
}
Model.extend = extend;
const Sub = Model.extend({ tick() { return this.save(); } });

function run() {
  Model.viaDecl(); Model.viaExpr(); obj.onObj(); K.viaDeclK(); new Model().viaProto();
  Model.viaConst(); Model.shared(); Other.shared(); new Other();
  new Sub().tick(); new Sub().save();
}
module.exports = { run };

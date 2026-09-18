// A member declared by one link of a CHAINED assignment (#706): the value is
// declared under every target that is a member form, not only when its
// assignment is the whole statement.
function log() { return 1; }
export const W = function () {};
W.api = W.prototype = { each() { return log(); } };          // chained prototype literal
W.mixin = W.api.mixin = function () { return log(); };     // chained static through the alias
W.both = W.prototype.both = function () { return log(); }; // one function, a static and an instance member

export function Item() {}
Item.prototype.run = Item.prototype.alias = function () { return log(); }; // two instance names
export const helper = Item.prototype.helper = function () { return log(); }; // an export and a member
export const Model = function () {};
Model.prototype = Object.create(Item.prototype);
Model.tag = Item.tag = function () { return log(); };       // two statics
Item.tag2 = Model.tag2 = function () { return log(); };     // known gap: the const-function constructor as the SECOND link is its function in this module and its type through the export

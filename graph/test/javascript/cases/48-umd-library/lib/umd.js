'use strict';
// A UMD entry: the export value is what the factory RETURNS, and the factory reaches
// module.exports only through the wrapper's parameter (#710).
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Umd = factory();
})(this, function () {
  function format(x) { return String(x); }
  function Formatter() {}
  Formatter.prototype.render = function render(x) { return format(x); };
  return { format: format, Formatter: Formatter, VERSION: '1' };
});

'use strict';
function Codec(name, options) {
  options = options || {};
  this.name = name;
  this.decode = options['decode'] || function () { return true; };
}
module.exports = Codec;

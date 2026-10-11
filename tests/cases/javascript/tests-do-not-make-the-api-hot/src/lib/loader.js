'use strict';
var codecs = [require('./codecs/alpha'), require('./codecs/beta'), require('./codecs/gamma')];
function load(x) {
  for (var i = 0; i < codecs.length; i++) {
    var codec = codecs[i];
    if (codec.decode(x)) return codec.name;
  }
  return null;
}
module.exports = { load, Codec: require('./codec') };

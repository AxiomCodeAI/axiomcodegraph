'use strict';
var Codec = require('../codec');
function decode_alpha(data) { return data === 'alpha'; }
module.exports = new Codec('codec:alpha', { decode: decode_alpha });

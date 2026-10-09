'use strict';
var Codec = require('../codec');
function decode_gamma(data) { return data === 'gamma'; }
module.exports = new Codec('codec:gamma', { decode: decode_gamma });

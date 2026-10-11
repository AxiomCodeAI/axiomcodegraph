'use strict';
var Codec = require('../codec');
function decode_beta(data) { return data === 'beta'; }
module.exports = new Codec('codec:beta', { decode: decode_beta });

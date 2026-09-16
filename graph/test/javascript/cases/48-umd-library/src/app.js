'use strict';
// the dependency is DECLARED and NOT INSTALLED; its IR is staged with --library.
const umd = require('umdlib');
const { format } = require('umdlib');
umd.format(1);
format(2);
new umd.Formatter().render(3);

const path = require('path');

module.exports = {
  resolve: {
    alias: {
      // exact match only: 'Lib' resolves, 'Lib/extra' does not
      Lib$: path.resolve(__dirname, 'lib/index.js'),
      Util: path.join(__dirname, 'lib/util'),
      // CONTROL: a bare relative replacement is read from the importer, so it fixes nothing
      Loose: './lib',
    },
  },
};

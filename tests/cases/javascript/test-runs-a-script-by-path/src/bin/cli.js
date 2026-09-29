#!/usr/bin/env node
const { shout } = require('../lib/shout');

function main(argv) {
  process.stdout.write(shout(argv[2] || 'hi') + '\n');
}

main(process.argv);
